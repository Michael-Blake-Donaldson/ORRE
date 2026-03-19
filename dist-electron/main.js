import "dotenv/config";
import { app, BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dialog } from "electron";
import { createDb } from "./db.js";
import { ProcessingQueue } from "./processing.js";
import { buildAskMemoraAnswer } from "./qa.js";
import { buildSessionSummary } from "./summary.js";
import { beginSupabaseTotpEnrollment, disableSupabaseMfaFactor, getSupabaseMfaStatus, isSupabaseAuthConfigured, loginWithSupabase, logoutFromSupabase, registerWithSupabase, resendSupabaseVerification, verifySupabaseTotpEnrollment, verifySupabaseMfaCode, } from "./supabase.js";
import { rateLimiters } from "./rateLimit.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let recordingMode = "idle";
let recordingStartedAt = null;
let activeSessionId = null;
let preferredDisplaySourceId = null;
let activeUserId = null;
let activeAuthUser = null;
const store = createDb(app.getPath("userData"));
const processingQueue = new ProcessingQueue(store);
const DEFAULT_SETTINGS = {
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
const LEGAL_DOCUMENT_VERSIONS = {
    terms: "2026-03-18.1",
    privacyPolicy: "2026-03-18.1",
};
function normalizeEmail(input) {
    return input.trim().toLowerCase();
}
function toAuthUser(row) {
    return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
    };
}
function hashPassword(password, saltHex) {
    const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return {
        hashHex: hash.toString("hex"),
        saltHex: salt.toString("hex"),
    };
}
function verifyPassword(password, expectedHashHex, saltHex) {
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
function parseSettings(raw) {
    const merged = {
        ...DEFAULT_SETTINGS,
        ...raw,
    };
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
function runBenchmark(userId, questionList, limit) {
    const questions = questionList.map((q) => q.trim()).filter((q) => q.length >= 4);
    const results = questions.map((question) => {
        const primaryRows = store.searchExtractedContent(userId, question, limit);
        const transcriptRows = store.listRecentExtractedRows(userId, limit * 2, "transcript");
        const ocrRows = store.listRecentExtractedRows(userId, limit * 2, "ocr");
        const mergedMap = new Map();
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
    const avgConfidence = results.length > 0
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
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1100,
        minHeight: 700,
        title: "Memora",
        backgroundColor: "#0f1218",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    mainWindow.loadFile(path.resolve(__dirname, "../app/auth.html"));
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
app.whenReady().then(() => {
    // Route display capture through an app-selected source when provided.
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        if (request.videoRequested) {
            const sources = await getAvailableDisplaySources();
            const preferredSource = (preferredDisplaySourceId ? sources.find((source) => source.id === preferredDisplaySourceId) : null) ??
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
    });
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
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
ipcMain.handle("auth:register", async (_event, payload) => {
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
ipcMain.handle("auth:login", async (_event, payload) => {
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
ipcMain.handle("auth:verifyMfa", async (_event, payload) => {
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
    return {
        ok: true,
        user: result.user,
    };
});
ipcMain.handle("auth:resendVerification", async (_event, payload) => {
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
ipcMain.handle("auth:beginMfaEnrollment", async (_event, payload) => {
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
ipcMain.handle("auth:verifyMfaEnrollment", async (_event, payload) => {
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
ipcMain.handle("auth:disableMfa", async (_event, payload) => {
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
            await logoutFromSupabase();
        }
        catch {
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
ipcMain.handle("recording:start", async (_event, mode) => {
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
ipcMain.handle("recording:save", async (_event, payload) => {
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
    // Queue asynchronous extraction work so UI is responsive.
    processingQueue.enqueue({ sessionId: payload.sessionId, filePath: result.filePath });
    return { ok: true, filePath: result.filePath };
});
ipcMain.handle("sessions:list", async () => {
    const userId = getActiveUserId();
    if (!userId) {
        return [];
    }
    const rows = store.listSessions(userId, 20);
    return rows;
});
ipcMain.handle("sessions:listByCategory", async (_event, payload) => {
    const userId = getActiveUserId();
    if (!userId) {
        return [];
    }
    return store.listSessionsByCategory(userId, payload.categoryId ?? null, payload.limit ?? 200);
});
ipcMain.handle("sessions:getDetail", async (_event, sessionId) => {
    const userId = getActiveUserId();
    if (!userId) {
        return {
            session: null,
            jobs: [],
            chunks: [],
            health: null,
        };
    }
    return store.getSessionDetail(userId, sessionId);
});
ipcMain.handle("processing:rerun", async (_event, sessionId) => {
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
    return parseSettings(store.getSettings(userId));
});
ipcMain.handle("settings:update", async (_event, updates) => {
    const userId = getActiveUserId();
    if (!userId) {
        return { ok: false, reason: "auth-required", settings: parseSettings({}) };
    }
    const current = parseSettings(store.getSettings(userId));
    const next = parseSettings({ ...current, ...updates });
    store.updateSettings(userId, next);
    return { ok: true, settings: next };
});
ipcMain.handle("benchmark:run", async (_event, payload) => {
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
ipcMain.handle("sessions:assignCategory", async (_event, payload) => {
    const userId = getActiveUserId();
    if (!userId) {
        return { ok: false, reason: "auth-required" };
    }
    try {
        store.assignSessionCategory(userId, payload.sessionId, payload.categoryId);
        return { ok: true };
    }
    catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "assign-failed" };
    }
});
ipcMain.handle("sessions:delete", async (_event, sessionId) => {
    const userId = getActiveUserId();
    if (!userId) {
        return { ok: false, reason: "auth-required" };
    }
    store.deleteSession(userId, sessionId);
    return { ok: true };
});
ipcMain.handle("categories:list", async () => {
    const userId = getActiveUserId();
    if (!userId) {
        return [];
    }
    return store.listCategories(userId);
});
ipcMain.handle("categories:create", async (_event, name) => {
    const userId = getActiveUserId();
    if (!userId) {
        return { ok: false, reason: "auth-required" };
    }
    try {
        const row = store.createCategory(userId, name);
        return { ok: true, category: row };
    }
    catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "create-category-failed" };
    }
});
ipcMain.handle("categories:delete", async (_event, categoryId) => {
    const userId = getActiveUserId();
    if (!userId) {
        return { ok: false, reason: "auth-required" };
    }
    store.deleteCategory(userId, categoryId);
    return { ok: true };
});
ipcMain.handle("search:content", async (_event, payload) => {
    const userId = getActiveUserId();
    if (!userId) {
        return [];
    }
    return store.searchExtractedContent(userId, payload.query, payload.limit ?? 25);
});
ipcMain.handle("ask:query", async (_event, payload) => {
    const userId = getActiveUserId();
    if (!userId) {
        return buildAskMemoraAnswer(payload.question, []);
    }
    const primaryRows = store.searchExtractedContent(userId, payload.question, payload.limit ?? 80);
    const transcriptRows = store.listRecentExtractedRows(userId, 220, "transcript");
    const ocrRows = store.listRecentExtractedRows(userId, 220, "ocr");
    const mergedMap = new Map();
    for (const row of [...primaryRows, ...transcriptRows, ...ocrRows]) {
        if (!mergedMap.has(row.chunk_id)) {
            mergedMap.set(row.chunk_id, row);
        }
    }
    const merged = [...mergedMap.values()];
    return buildAskMemoraAnswer(payload.question, merged);
});
ipcMain.handle("sessions:generateSummary", async (_event, sessionId) => {
    const userId = getActiveUserId();
    if (!userId) {
        return buildSessionSummary([]);
    }
    const detail = store.getSessionDetail(userId, sessionId);
    const summary = buildSessionSummary(detail.chunks);
    return summary;
});
ipcMain.handle("sessions:getReplaySource", async (_event, sessionId) => {
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
    }
    catch {
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
ipcMain.handle("ui:setPreferredDisplaySource", async (_event, sourceId) => {
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
