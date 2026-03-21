import "dotenv/config";
import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dialog } from "electron";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createDb, type MemoraStore, type SessionRow } from "./db.js";
import { ProcessingQueue } from "./processing.js";
import { buildAskMemoraAnswer } from "./qa.js";
import { buildSessionSummary } from "./summary.js";
import { estimateTokensFromText, generateAiAskAnswer, generateAiSessionSummary, isOpenAiConfigured } from "./ai.js";
import { ensureAppServer, stopAppServer } from "./appServer.js";
import {
  assignCloudSessionCategory,
  createCloudCategory,
  deleteCloudCategory,
  deleteCloudSession,
  getCloudAiUsage,
  getCloudSubscriptionStatus,
  getCloudSessionDetail,
  getCloudSettings,
  incrementCloudAiUsage,
  listCloudCategories,
  listCloudSessions,
  listCloudSessionsByCategory,
  listRecentCloudExtractedRows,
  searchCloudExtractedContent,
  syncCloudSessionDetail,
  updateCloudSettings,
} from "./supabaseData.js";
import {
  beginSupabaseTotpEnrollment,
  disableSupabaseMfaFactor,
  getSupabaseSessionState,
  getSupabaseMfaStatus,
  isSupabaseAuthConfigured,
  loginWithSupabase,
  logoutFromSupabase,
  requestSupabasePasswordReset,
  registerWithSupabase,
  resendSupabaseVerification,
  verifySupabaseTotpEnrollment,
  verifySupabaseMfaCode,
} from "./supabase.js";
import { rateLimiters } from "./rateLimit.js";

type RecordingMode = "idle" | "session" | "clip" | "always-on";
type SubscriptionTier = "free" | "premium";
type SubscriptionLifecycle = "inactive" | "active" | "past_due" | "canceled";
type PremiumFeature = "search" | "ask" | "summary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let recordingMode: RecordingMode = "idle";
let recordingStartedAt: string | null = null;
let activeSessionId: string | null = null;
let preferredDisplaySourceId: string | null = null;
let activeUserId: string | null = null;
let activeAuthUser: AuthUser | null = null;
let currentAppOrigin = "http://localhost";
const store = createDb(app.getPath("userData")) as MemoraStore;
const processingQueue = new ProcessingQueue(store, async (sessionId) => {
  await syncSessionToCloud(sessionId);
});

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

type AppSettings = {
  defaultMode: "session" | "clip" | "always-on";
  sourceStrategy: "remember-last" | "system-picker";
  askLimit: number;
  benchmarkQuestions: string;
  benchmarkLimit: number;
};

const DEFAULT_SETTINGS: AppSettings = {
  defaultMode: "session",
  sourceStrategy: "remember-last",
  askLimit: 60,
  benchmarkQuestions: [
    "What were the top 3 action items discussed?",
    "What apps or tools were used most recently?",
    "Summarize the latest decision that was made.",
  ].join("\n"),
  benchmarkLimit: 80,
};

const MONTHLY_TOKEN_LIMITS: Record<SubscriptionTier, number> = {
  free: 0,
  premium: 260_000,
};

const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-03-18.1",
  privacyPolicy: "2026-03-18.1",
} as const;

const PASSKEY_RP_ID = "localhost";
const PASSKEY_RP_NAME = "Memora";
const PASSKEY_CHALLENGE_TTL_MS = 3 * 60 * 1000;

const pendingPasskeyChallenges = new Map<
  string,
  {
    type: "registration" | "authentication";
    userId: string;
    expiresAt: number;
  }
>();

function toBase64Url(bytes: Uint8Array | Buffer) {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(encoded: string) {
  return Buffer.from(encoded, "base64url");
}

function clearExpiredPasskeyChallenges() {
  const now = Date.now();
  for (const [challenge, record] of pendingPasskeyChallenges.entries()) {
    if (record.expiresAt <= now) {
      pendingPasskeyChallenges.delete(challenge);
    }
  }
}

function savePasskeyChallenge(challenge: string, userId: string, type: "registration" | "authentication") {
  clearExpiredPasskeyChallenges();
  pendingPasskeyChallenges.set(challenge, {
    type,
    userId,
    expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_MS,
  });
}

function consumePasskeyChallenge(challenge: string, userId: string, type: "registration" | "authentication") {
  clearExpiredPasskeyChallenges();
  const record = pendingPasskeyChallenges.get(challenge);
  if (!record) {
    return false;
  }

  const valid = record.type === type && record.userId === userId && record.expiresAt > Date.now();
  pendingPasskeyChallenges.delete(challenge);
  return valid;
}

function parseStoredPasskeyTransports(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as string[];
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }

    return parsed.filter((item) => typeof item === "string");
  } catch {
    return [] as string[];
  }
}

const TEXT_ENCODER = new TextEncoder();

function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
}

function toAuthUser(row: { id: string; email: string; display_name: string }): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  };
}

function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return {
    hashHex: hash.toString("hex"),
    saltHex: salt.toString("hex"),
  };
}

function verifyPassword(password: string, expectedHashHex: string, saltHex: string) {
  const next = hashPassword(password, saltHex);
  const left = Buffer.from(next.hashHex, "hex");
  const right = Buffer.from(expectedHashHex, "hex");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function getActiveUserId() {
  return activeUserId;
}

function syncShadowUser(authUser: AuthUser, options?: { lastLoginAt?: string | null }) {
  return store.upsertShadowUser({
    id: authUser.id,
    email: normalizeEmail(authUser.email),
    displayName: authUser.displayName,
    createdAt: new Date().toISOString(),
    lastLoginAt: options?.lastLoginAt ?? null,
  });
}

async function canUseCloudData() {
  if (!isSupabaseAuthConfigured() || !activeAuthUser) {
    return false;
  }

  const sessionState = await getSupabaseSessionState();
  return sessionState.ok && sessionState.active && sessionState.userId === activeAuthUser.id;
}

async function syncSessionToCloud(sessionId: string) {
  if (!(await canUseCloudData())) {
    return;
  }

  const userId = getActiveUserId();
  if (!userId) {
    return;
  }

  const detail = store.getSessionDetail(userId, sessionId);
  if (!detail.session) {
    return;
  }

  await syncCloudSessionDetail(detail);
}

function getBillingPeriodKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function isPremiumBypassEnabled() {
  const raw = (process.env.MEMORA_PREMIUM_BETA ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getFeatureLabel(feature: PremiumFeature) {
  if (feature === "search") {
    return "Search Memory";
  }

  if (feature === "ask") {
    return "Ask Memora";
  }

  return "Session Summary";
}

async function getBillingStatus() {
  const periodKey = getBillingPeriodKey();
  const cloudReady = await canUseCloudData();

  if (isPremiumBypassEnabled()) {
    return {
      tier: "premium" as SubscriptionTier,
      status: "active" as SubscriptionLifecycle,
      premiumActive: true,
      cloudReady,
      periodKey,
      monthlyTokensUsed: cloudReady ? await getCloudAiUsage(periodKey) : 0,
      monthlyTokenLimit: MONTHLY_TOKEN_LIMITS.premium,
    };
  }

  if (!cloudReady) {
    return {
      tier: "free" as SubscriptionTier,
      status: "inactive" as SubscriptionLifecycle,
      premiumActive: false,
      cloudReady: false,
      periodKey,
      monthlyTokensUsed: 0,
      monthlyTokenLimit: MONTHLY_TOKEN_LIMITS.free,
    };
  }

  const subscription = await getCloudSubscriptionStatus();
  const premiumActive = subscription.tier === "premium" && (subscription.status === "active" || subscription.status === "past_due");
  const monthlyTokenLimit = MONTHLY_TOKEN_LIMITS[subscription.tier];
  const monthlyTokensUsed = await getCloudAiUsage(periodKey);

  return {
    tier: subscription.tier,
    status: subscription.status,
    premiumActive,
    cloudReady,
    periodKey,
    monthlyTokensUsed,
    monthlyTokenLimit,
  };
}

async function requirePremiumFeature(feature: PremiumFeature) {
  const billing = await getBillingStatus();
  if (billing.premiumActive) {
    return { ok: true as const, billing };
  }

  return {
    ok: false as const,
    reason: `premium-required:${getFeatureLabel(feature)} is available with Memora Premium.`,
    billing,
  };
}

async function enforceAiTokenBudget(estimatedTokens: number) {
  const billing = await getBillingStatus();
  const safeEstimate = Math.max(1, Math.floor(estimatedTokens));

  if (!billing.premiumActive) {
    return {
      ok: false as const,
      reason: "premium-required:This AI feature requires Memora Premium.",
      billing,
    };
  }

  if (billing.monthlyTokenLimit <= 0 || billing.monthlyTokensUsed + safeEstimate > billing.monthlyTokenLimit) {
    return {
      ok: false as const,
      reason: `monthly-token-limit:Monthly AI budget reached (${billing.monthlyTokensUsed}/${billing.monthlyTokenLimit} tokens).`,
      billing,
    };
  }

  return {
    ok: true as const,
    billing,
  };
}

async function recordAiUsageTokens(tokens: number) {
  const cloudReady = await canUseCloudData();
  if (!cloudReady) {
    return;
  }

  const safeTokens = Math.max(0, Math.floor(tokens));
  if (!safeTokens) {
    return;
  }

  await incrementCloudAiUsage(getBillingPeriodKey(), safeTokens);
}

function parseSettings(raw: Record<string, unknown>): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
  } as AppSettings;

  if (!["session", "clip", "always-on"].includes(merged.defaultMode)) {
    merged.defaultMode = DEFAULT_SETTINGS.defaultMode;
  }

  if (!["remember-last", "system-picker"].includes(merged.sourceStrategy)) {
    merged.sourceStrategy = DEFAULT_SETTINGS.sourceStrategy;
  }

  merged.askLimit = Number.isFinite(Number(merged.askLimit)) ? Math.min(120, Math.max(20, Number(merged.askLimit))) : 60;
  merged.benchmarkLimit = Number.isFinite(Number(merged.benchmarkLimit))
    ? Math.min(140, Math.max(20, Number(merged.benchmarkLimit)))
    : 80;

  if (typeof merged.benchmarkQuestions !== "string") {
    merged.benchmarkQuestions = DEFAULT_SETTINGS.benchmarkQuestions;
  }

  return merged;
}

function runBenchmark(userId: string, questionList: string[], limit: number) {
  const questions = questionList.map((q) => q.trim()).filter((q) => q.length >= 4);

  const results = questions.map((question) => {
    const primaryRows = store.searchExtractedContent(userId, question, limit);
    const transcriptRows = store.listRecentExtractedRows(userId, limit * 2, "transcript");
    const ocrRows = store.listRecentExtractedRows(userId, limit * 2, "ocr");

    const mergedMap = new Map<string, (typeof primaryRows)[number]>();
    for (const row of [...primaryRows, ...transcriptRows, ...ocrRows]) {
      if (!mergedMap.has(row.chunk_id)) {
        mergedMap.set(row.chunk_id, row);
      }
    }

    const answer = buildAskMemoraAnswer(question, [...mergedMap.values()]);
    const modalities = [...new Set(answer.citations.map((citation) => citation.modality))];

    return {
      question,
      confidenceScore: answer.confidenceScore,
      confidenceLabel: answer.confidenceLabel,
      citationCount: answer.citations.length,
      modalityCoverage: modalities,
      hasAudioEvidence: modalities.includes("audio"),
      hasVisualEvidence: modalities.includes("visual-transcript") || modalities.includes("ocr"),
    };
  });

  const avgConfidence =
    results.length > 0
      ? results.reduce((total, result) => total + result.confidenceScore, 0) / results.length
      : 0;

  const lowConfidenceCount = results.filter((result) => result.confidenceLabel === "low").length;
  const lowCoverageCount = results.filter((result) => !result.hasAudioEvidence || !result.hasVisualEvidence).length;

  return {
    questionCount: questions.length,
    avgConfidence,
    lowConfidenceCount,
    lowCoverageCount,
    results,
  };
}

async function getAvailableDisplaySources() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });

  if (sources.length > 0) {
    return sources;
  }

  // Retry with screen-only for environments where window listing can fail.
  return desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 320, height: 180 },
  });
}

async function createWindow() {
  const appServer = await ensureAppServer(path.resolve(__dirname, "../app"));
  currentAppOrigin = appServer.origin;
  const appIconPath = path.resolve(__dirname, "../app/assets/memora-logo.png");

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: "Memora",
    icon: appIconPath,
    backgroundColor: "#0f1218",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await mainWindow.loadURL(`${appServer.origin}/auth.html`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Route display capture through an app-selected source when provided.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (request.videoRequested) {
        const sources = await getAvailableDisplaySources();

        const preferredSource =
          (preferredDisplaySourceId ? sources.find((source) => source.id === preferredDisplaySourceId) : null) ??
          sources.find((source) => source.id.startsWith("screen:")) ??
          sources[0];

        if (!preferredSource) {
          callback({});
          return;
        }

        callback({
          video: preferredSource,
          audio: request.audioRequested ? "loopback" : undefined,
        });
        return;
      }

      callback({});
    },
  );

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void stopAppServer();
    app.quit();
  }
});

app.on("before-quit", () => {
  void stopAppServer();
});

ipcMain.handle("recording:getState", async () => {
  const userId = getActiveUserId();
  return {
    mode: recordingMode,
    isRecording: recordingMode !== "idle" && Boolean(userId),
  };
});

ipcMain.handle("auth:getCurrentUser", async () => {
  if (activeAuthUser) {
    return activeAuthUser;
  }

  const userId = getActiveUserId();
  if (!userId) {
    return null;
  }

  if (isSupabaseAuthConfigured()) {
    activeUserId = null;
    return null;
  }

  const user = store.getUserById(userId);
  if (!user) {
    activeUserId = null;
    return null;
  }

  const authUser = toAuthUser(user);
  activeAuthUser = authUser;
  return authUser;
});

ipcMain.handle("auth:getSessionContext", async () => {
  const cloudConfigured = isSupabaseAuthConfigured();
  if (!cloudConfigured) {
    return {
      ok: true,
      cloudConfigured: false,
      cloudSessionActive: false,
      requiresPasswordReauth: false,
    };
  }

  const activeUser = activeAuthUser;
  if (!activeUser) {
    return {
      ok: true,
      cloudConfigured: true,
      cloudSessionActive: false,
      requiresPasswordReauth: false,
    };
  }

  const sessionState = await getSupabaseSessionState();
  if (!sessionState.ok) {
    return { ok: false, reason: sessionState.reason };
  }

  const cloudSessionMatchesUser = sessionState.active && sessionState.userId === activeUser.id;

  return {
    ok: true,
    cloudConfigured: true,
    cloudSessionActive: cloudSessionMatchesUser,
    requiresPasswordReauth: !cloudSessionMatchesUser,
  };
});

ipcMain.handle("auth:register", async (_event, payload: { email: string; password: string; displayName: string; acceptedLegal?: boolean }) => {
  const email = normalizeEmail(payload.email ?? "");
  const password = String(payload.password ?? "");
  const displayName = String(payload.displayName ?? "").trim();
  const acceptedLegal = Boolean(payload.acceptedLegal);

  // Check rate limit before validation
  const registerLimit = rateLimiters.authRegister.check(email);
  if (!registerLimit.isAllowed) {
    return { ok: false, reason: registerLimit.message };
  }

  if (!email || !email.includes("@")) {
    return { ok: false, reason: "Enter a valid email address." };
  }

  if (password.length < 8) {
    return { ok: false, reason: "Password must be at least 8 characters." };
  }

  if (!displayName || displayName.length < 2) {
    return { ok: false, reason: "Display name must be at least 2 characters." };
  }

  if (!acceptedLegal) {
    return { ok: false, reason: "You must accept the Terms and Conditions and Privacy Policy." };
  }

  const legalAcceptedAt = new Date().toISOString();

  if (isSupabaseAuthConfigured()) {
    const cloud = await registerWithSupabase(email, password, displayName, {
      acceptedAt: legalAcceptedAt,
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      privacyPolicyVersion: LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
    });
    if (!cloud.ok) {
      return { ok: false, reason: cloud.reason };
    }

    if (cloud.requiresEmailVerification) {
      return {
        ok: true,
        user: cloud.user,
        requiresEmailVerification: true,
      };
    }

    activeUserId = cloud.user.id;
    activeAuthUser = cloud.user;
    recordingMode = "idle";
    recordingStartedAt = null;
    activeSessionId = null;

    const shadowSync = syncShadowUser(cloud.user);
    if (!shadowSync.ok) {
      return { ok: false, reason: shadowSync.reason };
    }

    return {
      ok: true,
      user: cloud.user,
      requiresEmailVerification: false,
    };
  }

  if (store.getUserByEmail(email)) {
    return { ok: false, reason: "An account with this email already exists." };
  }

  const createdAt = legalAcceptedAt;
  const userId = crypto.randomUUID();
  const passwordData = hashPassword(password);

  store.createUser({
    id: userId,
    email,
    displayName,
    passwordHash: passwordData.hashHex,
    passwordSalt: passwordData.saltHex,
    createdAt,
  });

  store.recordUserLegalAcceptances(userId, [
    {
      documentType: "terms",
      documentVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      acceptedAt: legalAcceptedAt,
    },
    {
      documentType: "privacy-policy",
      documentVersion: LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
      acceptedAt: legalAcceptedAt,
    },
  ]);

  activeUserId = userId;
  activeAuthUser = {
    id: userId,
    email,
    displayName,
  };
  recordingMode = "idle";
  recordingStartedAt = null;
  activeSessionId = null;

  return {
    ok: true,
    user: {
      id: userId,
      email,
      displayName,
    },
    requiresEmailVerification: false,
  };
});

ipcMain.handle("auth:login", async (_event, payload: { email: string; password: string }) => {
  const email = normalizeEmail(payload.email ?? "");
  const password = String(payload.password ?? "");

  // Check rate limit before processing
  const loginLimit = rateLimiters.authLogin.check(email);
  if (!loginLimit.isAllowed) {
    return { ok: false, reason: loginLimit.message };
  }

  if (isSupabaseAuthConfigured()) {
    const cloud = await loginWithSupabase(email, password);
    if (!cloud.ok) {
      if (cloud.reason === "mfa-required") {
        if (!("factorId" in cloud) || !("challengeId" in cloud)) {
          return { ok: false, reason: "Could not initialize MFA challenge." };
        }

        return {
          ok: false,
          reason: cloud.reason,
          factorId: cloud.factorId,
          challengeId: cloud.challengeId,
        };
      }

      if (cloud.reason === "email-not-confirmed") {
        return { ok: false, reason: "Please verify your email before logging in." };
      }

      return { ok: false, reason: cloud.reason || "Invalid email or password." };
    }

    activeUserId = cloud.user.id;
    activeAuthUser = cloud.user;
    recordingMode = "idle";
    recordingStartedAt = null;
    activeSessionId = null;

    // Keep a local identity mirror so device passkeys work consistently for cloud accounts.
    void syncShadowUser(cloud.user, { lastLoginAt: new Date().toISOString() });

    return {
      ok: true,
      user: cloud.user,
    };
  }

  const user = store.getUserByEmail(email);
  if (!user) {
    return { ok: false, reason: "Invalid email or password." };
  }

  const verified = verifyPassword(password, user.password_hash, user.password_salt);
  if (!verified) {
    return { ok: false, reason: "Invalid email or password." };
  }

  activeUserId = user.id;
  activeAuthUser = toAuthUser(user);
  recordingMode = "idle";
  recordingStartedAt = null;
  activeSessionId = null;
  store.setUserLastLoginAt(user.id, new Date().toISOString());

  return {
    ok: true,
    user: toAuthUser(user),
  };
});

ipcMain.handle(
  "auth:verifyMfa",
  async (_event, payload: { factorId: string; challengeId: string; code: string }) => {
    // Check rate limit for MFA attempts (use challengeId or a fallback key)
    const mfaLimit = rateLimiters.authMfaVerify.check(payload.challengeId);
    if (!mfaLimit.isAllowed) {
      return { ok: false, reason: mfaLimit.message };
    }

    if (!isSupabaseAuthConfigured()) {
      return { ok: false, reason: "MFA verification requires Supabase configuration." };
    }

    const result = await verifySupabaseMfaCode(payload.factorId, payload.challengeId, payload.code);
    if (!result.ok) {
      if (result.reason === "email-not-confirmed") {
        return { ok: false, reason: "Please verify your email before logging in." };
      }
      return { ok: false, reason: result.reason };
    }

    activeUserId = result.user.id;
    activeAuthUser = result.user;
    recordingMode = "idle";
    recordingStartedAt = null;
    activeSessionId = null;

    void syncShadowUser(result.user, { lastLoginAt: new Date().toISOString() });

    return {
      ok: true,
      user: result.user,
    };
  },
);

ipcMain.handle("auth:resendVerification", async (_event, payload: { email: string }) => {
  const email = normalizeEmail(payload.email ?? "");

  // Check rate limit before validation
  const resendLimit = rateLimiters.authResendVerification.check(email);
  if (!resendLimit.isAllowed) {
    return { ok: false, reason: resendLimit.message };
  }

  if (!email || !email.includes("@")) {
    return { ok: false, reason: "Enter a valid email address first." };
  }

  if (!isSupabaseAuthConfigured()) {
    return { ok: false, reason: "Email verification resend is available when Supabase is configured." };
  }

  const result = await resendSupabaseVerification(email);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return { ok: true };
});

ipcMain.handle("auth:forgotPassword", async (_event, payload: { email: string }) => {
  const email = normalizeEmail(payload.email ?? "");

  const passwordResetLimit = rateLimiters.authPasswordReset.check(email);
  if (!passwordResetLimit.isAllowed) {
    return { ok: false, reason: passwordResetLimit.message };
  }

  if (!email || !email.includes("@")) {
    return { ok: false, reason: "Enter a valid email address first." };
  }

  if (!isSupabaseAuthConfigured()) {
    return {
      ok: false,
      reason: "Password reset email is available when cloud authentication is enabled.",
    };
  }

  const result = await requestSupabasePasswordReset(email);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return {
    ok: true,
    message: "If an account exists for that email, reset instructions have been sent.",
  };
});

ipcMain.handle("auth:getMfaStatus", async () => {
  if (!isSupabaseAuthConfigured()) {
    return { ok: true, configured: false, enabled: false, factors: [] };
  }

  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "Sign in to manage multi-factor authentication." };
  }

  const status = await getSupabaseMfaStatus();
  if (!status.ok) {
    return { ok: false, reason: status.reason };
  }

  return {
    ok: true,
    configured: true,
    enabled: status.enabled,
    factors: status.factors,
  };
});

ipcMain.handle("auth:beginMfaEnrollment", async (_event, payload: { displayName?: string }) => {
  if (!isSupabaseAuthConfigured()) {
    return { ok: false, reason: "Supabase is not configured." };
  }

  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "Sign in to enroll MFA." };
  }

  const result = await beginSupabaseTotpEnrollment(payload.displayName);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return {
    ok: true,
    factorId: result.factorId,
    qrCodeSvg: result.qrCodeSvg,
    secret: result.secret,
    uri: result.uri,
  };
});

ipcMain.handle("auth:verifyMfaEnrollment", async (_event, payload: { factorId: string; code: string }) => {
  if (!isSupabaseAuthConfigured()) {
    return { ok: false, reason: "Supabase is not configured." };
  }

  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "Sign in to verify MFA enrollment." };
  }

  const result = await verifySupabaseTotpEnrollment(payload.factorId, payload.code);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return { ok: true };
});

ipcMain.handle("auth:disableMfa", async (_event, payload: { factorId: string }) => {
  if (!isSupabaseAuthConfigured()) {
    return { ok: false, reason: "Supabase is not configured." };
  }

  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "Sign in to disable MFA." };
  }

  const result = await disableSupabaseMfaFactor(payload.factorId);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return { ok: true };
});

ipcMain.handle("auth:logout", async () => {
  if (isSupabaseAuthConfigured()) {
    try {
      await logoutFromSupabase("local");
    } catch {
      // Best-effort sign-out; local session will still clear.
    }
  }

  activeUserId = null;
  activeAuthUser = null;
  recordingMode = "idle";
  recordingStartedAt = null;
  activeSessionId = null;
  preferredDisplaySourceId = null;
  return { ok: true };
});

ipcMain.handle("auth:logoutAllDevices", async () => {
  if (!isSupabaseAuthConfigured()) {
    return { ok: false, reason: "Global session revoke is available when cloud authentication is enabled." };
  }

  try {
    await logoutFromSupabase("global");
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Could not revoke active sessions.",
    };
  }

  activeUserId = null;
  activeAuthUser = null;
  recordingMode = "idle";
  recordingStartedAt = null;
  activeSessionId = null;
  preferredDisplaySourceId = null;

  return { ok: true };
});

ipcMain.handle("auth:passkeyBeginRegistration", async () => {
  const userId = getActiveUserId();
  const authUser = activeAuthUser;
  if (!userId || !authUser) {
    return { ok: false, reason: "Sign in with your password first to enable Windows Hello." };
  }

  const shadowSync = syncShadowUser(authUser);
  if (!shadowSync.ok) {
    return { ok: false, reason: shadowSync.reason };
  }

  const user = store.getUserById(userId);
  if (!user) {
    return { ok: false, reason: "User account was not found." };
  }

  const existingPasskeys = store.listUserPasskeys(userId);

  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID: PASSKEY_RP_ID,
    userID: TEXT_ENCODER.encode(user.id),
    userName: user.email,
    userDisplayName: user.display_name,
    timeout: 60000,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: existingPasskeys.map((credential) => ({
      id: credential.credential_id,
      type: "public-key",
      transports: parseStoredPasskeyTransports(credential.transports) as any,
    })),
  });

  savePasskeyChallenge(options.challenge, userId, "registration");

  return {
    ok: true,
    options,
  };
});

ipcMain.handle("auth:passkeyFinishRegistration", async (_event, payload: { challenge: string; response: unknown }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "Sign in with your password first to enable Windows Hello." };
  }

  if (!payload?.challenge || typeof payload.challenge !== "string") {
    return { ok: false, reason: "Registration challenge is missing." };
  }

  const challengeValid = consumePasskeyChallenge(payload.challenge, userId, "registration");
  if (!challengeValid) {
    return { ok: false, reason: "Windows Hello setup timed out. Please try again." };
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: payload.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: payload.challenge,
      expectedOrigin: currentAppOrigin,
      expectedRPID: PASSKEY_RP_ID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { ok: false, reason: "Windows Hello setup could not be verified." };
    }

    const credential = verification.registrationInfo.credential;
    const now = new Date().toISOString();

    store.upsertUserPasskey({
      userId,
      credentialId: credential.id,
      publicKey: toBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      createdAt: now,
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Windows Hello setup failed.",
    };
  }
});

ipcMain.handle("auth:passkeyBeginLogin", async (_event, payload: { email: string }) => {
  const email = normalizeEmail(payload?.email ?? "");
  if (!email || !email.includes("@")) {
    return { ok: false, reason: "Enter your account email to use Windows Hello." };
  }

  if (activeAuthUser && normalizeEmail(activeAuthUser.email) === email) {
    const shadowSync = syncShadowUser(activeAuthUser);
    if (!shadowSync.ok) {
      return { ok: false, reason: shadowSync.reason };
    }
  }

  const user = store.getUserByEmail(email);
  if (!user) {
    return { ok: false, reason: "No account was found for this email on this device." };
  }

  const passkeys = store.listUserPasskeys(user.id);
  if (!passkeys.length) {
    return { ok: false, reason: "Windows Hello is not set up yet for this account on this device." };
  }

  const options = await generateAuthenticationOptions({
    rpID: PASSKEY_RP_ID,
    timeout: 60000,
    userVerification: "required",
    allowCredentials: passkeys.map((credential) => ({
      id: credential.credential_id,
      type: "public-key",
      transports: parseStoredPasskeyTransports(credential.transports) as any,
    })),
  });

  savePasskeyChallenge(options.challenge, user.id, "authentication");

  return {
    ok: true,
    options,
  };
});

ipcMain.handle(
  "auth:passkeyFinishLogin",
  async (_event, payload: { email: string; challenge: string; response: unknown }) => {
    const email = normalizeEmail(payload?.email ?? "");
    if (!email || !email.includes("@")) {
      return { ok: false, reason: "Enter your account email to use Windows Hello." };
    }

    const user = store.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: "No local account was found for this email." };
    }

    if (!payload?.challenge || typeof payload.challenge !== "string") {
      return { ok: false, reason: "Authentication challenge is missing." };
    }

    const challengeValid = consumePasskeyChallenge(payload.challenge, user.id, "authentication");
    if (!challengeValid) {
      return { ok: false, reason: "Windows Hello request expired. Please try again." };
    }

    const credentialId =
      payload.response && typeof payload.response === "object" && "id" in payload.response
        ? String((payload.response as { id: string }).id)
        : "";

    if (!credentialId) {
      return { ok: false, reason: "Credential identifier is missing." };
    }

    const storedPasskey = store.getUserPasskeyByCredentialId(credentialId);
    if (!storedPasskey || storedPasskey.user_id !== user.id) {
      return { ok: false, reason: "Passkey was not recognized for this account." };
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response: payload.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: payload.challenge,
        expectedOrigin: currentAppOrigin,
        expectedRPID: PASSKEY_RP_ID,
        requireUserVerification: true,
        credential: {
          id: storedPasskey.credential_id,
          publicKey: fromBase64Url(storedPasskey.public_key),
          counter: storedPasskey.counter,
          transports: parseStoredPasskeyTransports(storedPasskey.transports) as any,
        },
      });

      if (!verification.verified || !verification.authenticationInfo) {
        return { ok: false, reason: "Windows Hello sign-in could not be verified." };
      }

      const usedAt = new Date().toISOString();
      store.updateUserPasskeyCounter(storedPasskey.credential_id, verification.authenticationInfo.newCounter, usedAt);

      activeUserId = user.id;
      activeAuthUser = toAuthUser(user);
      recordingMode = "idle";
      recordingStartedAt = null;
      activeSessionId = null;
      store.setUserLastLoginAt(user.id, usedAt);

      void syncShadowUser(activeAuthUser, { lastLoginAt: usedAt });

      return {
        ok: true,
        user: toAuthUser(user),
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Windows Hello sign-in failed.",
      };
    }
  },
);

ipcMain.handle("recording:start", async (_event, mode: RecordingMode) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  recordingMode = mode;
  recordingStartedAt = new Date().toISOString();
  activeSessionId = crypto.randomUUID();

  store.createSession({
    id: activeSessionId,
    userId,
    mode: mode,
    startedAt: recordingStartedAt,
  });

  await syncSessionToCloud(activeSessionId);

  return {
    ok: true,
    sessionId: activeSessionId,
    mode: recordingMode,
    startedAt: recordingStartedAt,
  };
});

ipcMain.handle("recording:stop", async () => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required", sessionId: null, stoppedAt: new Date().toISOString(), startedAt: null };
  }

  recordingMode = "idle";
  const stoppedAt = new Date().toISOString();
  const stoppedSessionId = activeSessionId;

  if (stoppedSessionId) {
    store.stopSession({
      id: stoppedSessionId,
      userId,
      stoppedAt,
    });
    await syncSessionToCloud(stoppedSessionId);
  }

  const response = {
    ok: true,
    sessionId: stoppedSessionId,
    stoppedAt,
    startedAt: recordingStartedAt,
  };

  // Reset active pointers once stop is acknowledged.
  recordingStartedAt = null;
  activeSessionId = null;

  return response;
});

ipcMain.handle("recording:save", async (_event, payload: { sessionId: string; bytes: number[]; suggestedName: string }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  if (!mainWindow) {
    return { ok: false, reason: "window-unavailable" };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Memora Recording",
    defaultPath: payload.suggestedName,
    filters: [{ name: "WebM Video", extensions: ["webm"] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, reason: "cancelled" };
  }

  await fs.writeFile(result.filePath, Buffer.from(payload.bytes));

  store.markSessionSaved({
    id: payload.sessionId,
    userId,
    filePath: result.filePath,
  });

  await syncSessionToCloud(payload.sessionId);

  // Queue asynchronous extraction work so UI is responsive.
  processingQueue.enqueue({ sessionId: payload.sessionId, filePath: result.filePath });

  return { ok: true, filePath: result.filePath };
});

ipcMain.handle("sessions:list", async () => {
  const userId = getActiveUserId();
  if (!userId) {
    return [] as SessionRow[];
  }

  if (await canUseCloudData()) {
    return listCloudSessions(20);
  }

  const rows = store.listSessions(userId, 20) as SessionRow[];

  return rows;
});

ipcMain.handle("sessions:listByCategory", async (_event, payload: { categoryId: string | null; limit?: number }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return [] as SessionRow[];
  }

  if (await canUseCloudData()) {
    return listCloudSessionsByCategory(payload.categoryId ?? null, payload.limit ?? 200);
  }

  return store.listSessionsByCategory(userId, payload.categoryId ?? null, payload.limit ?? 200);
});

ipcMain.handle("sessions:getDetail", async (_event, sessionId: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return {
      session: null,
      jobs: [],
      chunks: [],
      health: null,
    };
  }

  if (await canUseCloudData()) {
    return (
      (await getCloudSessionDetail(sessionId)) ?? {
        session: null,
        jobs: [],
        chunks: [],
        health: null,
      }
    );
  }

  return store.getSessionDetail(userId, sessionId);
});

ipcMain.handle("processing:rerun", async (_event, sessionId: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  // Check rate limit for processing operations
  const processingLimit = rateLimiters.processing.check(userId);
  if (!processingLimit.isAllowed) {
    return { ok: false, reason: processingLimit.message };
  }

  const session = store.getSessionById(userId, sessionId);

  if (!session?.file_path) {
    return { ok: false, reason: "missing-file" };
  }

  const enqueued = processingQueue.enqueue({ sessionId, filePath: session.file_path });
  if (!enqueued) {
    return { ok: false, reason: "already-processing" };
  }

  return { ok: true };
});

ipcMain.handle("settings:get", async () => {
  const userId = getActiveUserId();
  if (!userId) {
    return parseSettings({});
  }

  if (await canUseCloudData()) {
    return parseSettings(await getCloudSettings());
  }

  return parseSettings(store.getSettings(userId));
});

ipcMain.handle("settings:update", async (_event, updates: Partial<AppSettings>) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required", settings: parseSettings({}) };
  }

  const current = parseSettings(store.getSettings(userId));
  const next = parseSettings({ ...current, ...updates });
  store.updateSettings(userId, next as Record<string, unknown>);

  if (await canUseCloudData()) {
    const cloudResult = await updateCloudSettings(next as Record<string, unknown>);
    if (!cloudResult.ok) {
      return { ok: false, reason: cloudResult.reason, settings: next };
    }
  }

  return { ok: true, settings: next };
});

ipcMain.handle("billing:getStatus", async () => {
  return getBillingStatus();
});

ipcMain.handle("billing:startCheckout", async () => {
  const gate = await canUseCloudData();
  if (!gate) {
    return { ok: false as const, reason: "Sign in with cloud auth to start checkout." };
  }

  const checkoutUrl = process.env.STRIPE_PREMIUM_CHECKOUT_URL?.trim();
  if (!checkoutUrl) {
    return { ok: false as const, reason: "Stripe checkout URL is not configured." };
  }

  await shell.openExternal(checkoutUrl);
  return { ok: true as const };
});

ipcMain.handle("billing:openPortal", async () => {
  const gate = await canUseCloudData();
  if (!gate) {
    return { ok: false as const, reason: "Sign in with cloud auth to manage billing." };
  }

  const portalUrl = process.env.STRIPE_CUSTOMER_PORTAL_URL?.trim();
  if (!portalUrl) {
    return { ok: false as const, reason: "Stripe customer portal URL is not configured." };
  }

  await shell.openExternal(portalUrl);
  return { ok: true as const };
});

ipcMain.handle("benchmark:run", async (_event, payload: { questions: string[]; limit: number }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return {
      questionCount: 0,
      avgConfidence: 0,
      lowConfidenceCount: 0,
      lowCoverageCount: 0,
      results: [],
    };
  }

  // Check rate limit for ask/benchmark queries
  const askLimit = rateLimiters.askQuery.check(userId);
  if (!askLimit.isAllowed) {
    return {
      ok: false,
      reason: askLimit.message,
      questionCount: 0,
      avgConfidence: 0,
      lowConfidenceCount: 0,
      lowCoverageCount: 0,
      results: [],
    };
  }

  return runBenchmark(userId, payload.questions, payload.limit);
});

ipcMain.handle("sessions:assignCategory", async (_event, payload: { sessionId: string; categoryId: string | null }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  try {
    store.assignSessionCategory(userId, payload.sessionId, payload.categoryId);

    if (await canUseCloudData()) {
      const cloudResult = await assignCloudSessionCategory(payload.sessionId, payload.categoryId);
      if (!cloudResult.ok) {
        return { ok: false, reason: cloudResult.reason };
      }
    }

    await syncSessionToCloud(payload.sessionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "assign-failed" };
  }
});

ipcMain.handle("sessions:delete", async (_event, sessionId: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  store.deleteSession(userId, sessionId);

  if (await canUseCloudData()) {
    const cloudResult = await deleteCloudSession(sessionId);
    if (!cloudResult.ok) {
      return { ok: false, reason: cloudResult.reason };
    }
  }

  return { ok: true };
});

ipcMain.handle("categories:list", async () => {
  const userId = getActiveUserId();
  if (!userId) {
    return [];
  }

  if (await canUseCloudData()) {
    return listCloudCategories();
  }

  return store.listCategories(userId);
});

ipcMain.handle("categories:create", async (_event, name: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  try {
    if (await canUseCloudData()) {
      return await createCloudCategory(name);
    }

    const row = store.createCategory(userId, name);
    return { ok: true, category: row };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "create-category-failed" };
  }
});

ipcMain.handle("categories:delete", async (_event, categoryId: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  if (await canUseCloudData()) {
    const cloudResult = await deleteCloudCategory(categoryId);
    if (!cloudResult.ok) {
      return { ok: false, reason: cloudResult.reason };
    }
  }

  store.deleteCategory(userId, categoryId);
  return { ok: true };
});

ipcMain.handle("search:content", async (_event, payload: { query: string; limit?: number }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return [];
  }

  const premium = await requirePremiumFeature("search");
  if (!premium.ok) {
    throw new Error(premium.reason);
  }

  if (await canUseCloudData()) {
    return searchCloudExtractedContent(payload.query, payload.limit ?? 25);
  }

  return store.searchExtractedContent(userId, payload.query, payload.limit ?? 25);
});

ipcMain.handle("ask:query", async (_event, payload: { question: string; limit?: number }) => {
  const userId = getActiveUserId();
  if (!userId) {
    return buildAskMemoraAnswer(payload.question, []);
  }

  const premium = await requirePremiumFeature("ask");
  if (!premium.ok) {
    throw new Error(premium.reason);
  }

  if (await canUseCloudData()) {
    const primaryRows = await searchCloudExtractedContent(payload.question, payload.limit ?? 80);
    const transcriptRows = await listRecentCloudExtractedRows(220, "transcript");
    const ocrRows = await listRecentCloudExtractedRows(220, "ocr");

    const mergedMap = new Map<string, (typeof primaryRows)[number]>();
    for (const row of [...primaryRows, ...transcriptRows, ...ocrRows]) {
      if (!mergedMap.has(row.chunk_id)) {
        mergedMap.set(row.chunk_id, row);
      }
    }

    const fallbackResult = buildAskMemoraAnswer(payload.question, [...mergedMap.values()]);

    if (!isOpenAiConfigured()) {
      return fallbackResult;
    }

    const estimatedTokens =
      estimateTokensFromText(payload.question) +
      estimateTokensFromText(fallbackResult.citations.map((citation) => citation.content).join("\n")) +
      220;

    const budget = await enforceAiTokenBudget(estimatedTokens);
    if (!budget.ok) {
      throw new Error(budget.reason);
    }

    try {
      const aiResult = await generateAiAskAnswer(payload.question, fallbackResult.citations, 520);
      await recordAiUsageTokens(aiResult.usageTokens);
      return {
        ...fallbackResult,
        answer: aiResult.content,
      };
    } catch {
      return fallbackResult;
    }
  }

  const primaryRows = store.searchExtractedContent(userId, payload.question, payload.limit ?? 80);
  const transcriptRows = store.listRecentExtractedRows(userId, 220, "transcript");
  const ocrRows = store.listRecentExtractedRows(userId, 220, "ocr");

  const mergedMap = new Map<string, (typeof primaryRows)[number]>();
  for (const row of [...primaryRows, ...transcriptRows, ...ocrRows]) {
    if (!mergedMap.has(row.chunk_id)) {
      mergedMap.set(row.chunk_id, row);
    }
  }

  const merged = [...mergedMap.values()];
  const fallbackResult = buildAskMemoraAnswer(payload.question, merged);

  if (!isOpenAiConfigured()) {
    return fallbackResult;
  }

  const estimatedTokens =
    estimateTokensFromText(payload.question) +
    estimateTokensFromText(fallbackResult.citations.map((citation) => citation.content).join("\n")) +
    220;

  const budget = await enforceAiTokenBudget(estimatedTokens);
  if (!budget.ok) {
    throw new Error(budget.reason);
  }

  try {
    const aiResult = await generateAiAskAnswer(payload.question, fallbackResult.citations, 520);
    await recordAiUsageTokens(aiResult.usageTokens);
    return {
      ...fallbackResult,
      answer: aiResult.content,
    };
  } catch {
    return fallbackResult;
  }
});

ipcMain.handle("sessions:generateSummary", async (_event, sessionId: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return buildSessionSummary([]);
  }

  const premium = await requirePremiumFeature("summary");
  if (!premium.ok) {
    throw new Error(premium.reason);
  }

  if (await canUseCloudData()) {
    const detail = await getCloudSessionDetail(sessionId);
    const chunks = detail?.chunks ?? [];
    const fallback = buildSessionSummary(chunks);

    if (!isOpenAiConfigured() || chunks.length === 0) {
      return fallback;
    }

    const estimatedTokens = estimateTokensFromText(chunks.map((chunk) => chunk.content).join("\n")) + 340;
    const budget = await enforceAiTokenBudget(estimatedTokens);
    if (!budget.ok) {
      throw new Error(budget.reason);
    }

    try {
      const aiSummary = await generateAiSessionSummary(chunks, 650);
      await recordAiUsageTokens(aiSummary.usageTokens);
      return aiSummary.summary;
    } catch {
      return fallback;
    }
  }

  const detail = store.getSessionDetail(userId, sessionId);
  const fallback = buildSessionSummary(detail.chunks);

  if (!isOpenAiConfigured() || detail.chunks.length === 0) {
    return fallback;
  }

  const estimatedTokens = estimateTokensFromText(detail.chunks.map((chunk) => chunk.content).join("\n")) + 340;
  const budget = await enforceAiTokenBudget(estimatedTokens);
  if (!budget.ok) {
    throw new Error(budget.reason);
  }

  try {
    const aiSummary = await generateAiSessionSummary(detail.chunks, 650);
    await recordAiUsageTokens(aiSummary.usageTokens);
    return aiSummary.summary;
  } catch {
    return fallback;
  }
});

ipcMain.handle("sessions:getReplaySource", async (_event, sessionId: string) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false, reason: "auth-required" };
  }

  const sessionRow = store.getSessionById(userId, sessionId);

  if (!sessionRow?.file_path) {
    return { ok: false, reason: "missing-file" };
  }

  try {
    await fs.access(sessionRow.file_path);
  } catch {
    return { ok: false, reason: "file-not-found" };
  }

  return {
    ok: true,
    fileUrl: pathToFileURL(sessionRow.file_path).toString(),
  };
});

ipcMain.handle("ui:listDisplaySources", async () => {
  const userId = getActiveUserId();
  if (!userId) {
    return [];
  }

  const sources = await getAvailableDisplaySources();

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith("screen:") ? "screen" : "window",
  }));
});

ipcMain.handle("ui:setPreferredDisplaySource", async (_event, sourceId: string | null) => {
  const userId = getActiveUserId();
  if (!userId) {
    return { ok: false };
  }

  preferredDisplaySourceId = sourceId;
  return { ok: true };
});

ipcMain.handle("ui:prepareDisplayPicker", async () => {
  if (!mainWindow) {
    return;
  }

  // Minimizing helps ensure OS picker is visible and not hidden behind the app.
  mainWindow.minimize();
});

ipcMain.handle("ui:restoreAfterDisplayPicker", async () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
});
