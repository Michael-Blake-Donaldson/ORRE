const settingDefaultMode = document.getElementById("settingDefaultMode");
const settingSourceStrategy = document.getElementById("settingSourceStrategy");
const settingAskLimit = document.getElementById("settingAskLimit");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const resetSettingsBtn = document.getElementById("resetSettingsBtn");
const settingsStatus = document.getElementById("settingsStatus");
const grantScreenBtn = document.getElementById("grantScreenBtn");
const grantMicBtn = document.getElementById("grantMicBtn");
const screenPermissionStatus = document.getElementById("screenPermissionStatus");
const micPermissionStatus = document.getElementById("micPermissionStatus");
const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page], .nav-item[data-action]"));
const backToTopBtn = document.getElementById("backToTopBtn");
const diagBridgeLoaded = document.getElementById("diagBridgeLoaded");
const diagSourceCount = document.getElementById("diagSourceCount");
const diagSelectedSource = document.getElementById("diagSelectedSource");
const diagLastError = document.getElementById("diagLastError");
const mfaStateLabel = document.getElementById("mfaStateLabel");
const mfaStartBtn = document.getElementById("mfaStartBtn");
const mfaDisableBtn = document.getElementById("mfaDisableBtn");
const mfaEnrollPanel = document.getElementById("mfaEnrollPanel");
const mfaQrContainer = document.getElementById("mfaQrContainer");
const mfaCodeInput = document.getElementById("mfaCodeInput");
const mfaVerifyBtn = document.getElementById("mfaVerifyBtn");
const mfaCancelBtn = document.getElementById("mfaCancelBtn");
const mfaStatusText = document.getElementById("mfaStatusText");
const revokeSessionsBtn = document.getElementById("revokeSessionsBtn");
const revokeSessionsStatus = document.getElementById("revokeSessionsStatus");
const reauthSecurityBtn = document.getElementById("reauthSecurityBtn");
const reauthSecurityStatus = document.getElementById("reauthSecurityStatus");

const DEFAULT_SETTINGS = {
  defaultMode: "session",
  sourceStrategy: "remember-last",
  askLimit: 60,
};

const permissionState = {
  screen: localStorage.getItem("memora-permission-screen") === "granted" ? "granted" : "unknown",
  mic: localStorage.getItem("memora-permission-mic") === "granted" ? "granted" : "unknown",
};

const diagnostics = {
  bridgeLoaded: false,
  sourceCount: 0,
  selectedSource: "none",
  lastCaptureError: "none",
};

let currentUserEmail = "";

const mfaState = {
  configured: false,
  enabled: false,
  factors: [],
  pendingFactorId: null,
  requiresPasswordReauth: false,
};

function setMfaStatus(text) {
  if (mfaStatusText) {
    mfaStatusText.textContent = text;
  }
}

function setRevokeSessionsStatus(text) {
  if (revokeSessionsStatus) {
    revokeSessionsStatus.textContent = text;
  }
}

function setReauthSecurityStatus(text) {
  if (reauthSecurityStatus) {
    reauthSecurityStatus.textContent = text;
  }
}

function renderMfaShell() {
  if (mfaStateLabel) {
    if (!mfaState.configured) {
      mfaStateLabel.textContent = "Supabase auth not configured";
    } else {
      mfaStateLabel.textContent = mfaState.enabled ? "Enabled" : "Disabled";
    }
  }

  if (mfaStartBtn) {
    mfaStartBtn.disabled = !mfaState.configured || mfaState.enabled || mfaState.requiresPasswordReauth;
  }

  if (mfaDisableBtn) {
    mfaDisableBtn.disabled = !mfaState.enabled || mfaState.requiresPasswordReauth;
  }

  if (revokeSessionsBtn) {
    revokeSessionsBtn.disabled = !mfaState.configured || mfaState.requiresPasswordReauth;
  }
}

function resetMfaEnrollmentUI() {
  mfaState.pendingFactorId = null;
  mfaEnrollPanel?.classList.add("mfa-panel--hidden");
  if (mfaCodeInput) {
    mfaCodeInput.value = "";
  }
  if (mfaQrContainer) {
    mfaQrContainer.textContent = "Start setup to generate your QR code.";
  }
}

function renderMfaQr(value) {
  if (!mfaQrContainer) {
    return;
  }

  if (!value) {
    mfaQrContainer.textContent = "QR code unavailable. Use your authenticator app with the manual setup key.";
    return;
  }

  if (value.includes("<svg")) {
    mfaQrContainer.innerHTML = value;
    return;
  }

  if (value.startsWith("data:image")) {
    mfaQrContainer.innerHTML = `<img src="${value}" alt="MFA QR code" class="mfa-qr-image" />`;
    return;
  }

  mfaQrContainer.textContent = value;
}

async function loadMfaStatus() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const sessionContext = await api.getAuthSessionContext();
  if (!sessionContext.ok) {
    setMfaStatus(sessionContext.reason || "Could not load account session context.");
    return;
  }

  mfaState.configured = sessionContext.cloudConfigured;
  mfaState.requiresPasswordReauth = sessionContext.requiresPasswordReauth;

  if (mfaState.requiresPasswordReauth) {
    mfaState.enabled = false;
    mfaState.factors = [];
    renderMfaShell();
    setMfaStatus("Password re-authentication required to manage MFA.");
    setRevokeSessionsStatus("Re-authenticate to revoke active cloud sessions.");
    setReauthSecurityStatus("You are signed in for app access, but cloud security actions need a fresh password sign-in.");
    return;
  }

  const response = await api.getMfaStatus();
  if (!response.ok) {
    setMfaStatus(response.reason || "Could not load MFA status.");
    return;
  }

  mfaState.configured = response.configured;
  mfaState.enabled = response.enabled;
  mfaState.factors = response.factors || [];

  renderMfaShell();
  if (!mfaState.configured) {
    setMfaStatus("Supabase auth is not configured. Add SUPABASE_URL and key in .env to use MFA.");
    setRevokeSessionsStatus("Global session revoke is available with cloud authentication.");
    setReauthSecurityStatus("Cloud security re-auth is unavailable because cloud auth is not configured.");
    return;
  }

  setMfaStatus(mfaState.enabled ? "MFA is enabled for your account." : "MFA is not enabled yet.");
  setRevokeSessionsStatus("Use this if your account was accessed on a device you no longer trust.");
  setReauthSecurityStatus("Cloud security session active.");
}

function startSecurityReauth() {
  const emailHint = encodeURIComponent(currentUserEmail || "");
  window.location.href = `./auth.html?reauth=1&mode=login&email=${emailHint}`;
}

async function revokeAllSessionsFlow() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const confirmed = window.confirm("Sign out all active devices and sessions for this account?");
  if (!confirmed) {
    return;
  }

  if (revokeSessionsBtn) {
    revokeSessionsBtn.disabled = true;
  }
  setRevokeSessionsStatus("Revoking active sessions...");

  const response = await api.logoutAllDevices();
  if (!response.ok) {
    setRevokeSessionsStatus(response.reason || "Could not revoke active sessions.");
    renderMfaShell();
    return;
  }

  setRevokeSessionsStatus("All sessions revoked. Redirecting to sign in...");
  setTimeout(() => {
    window.location.href = "./auth.html";
  }, 350);
}

async function startMfaEnrollment() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const response = await api.beginMfaEnrollment({
    displayName: "Memora Authenticator",
  });

  if (!response.ok) {
    setMfaStatus(response.reason || "Could not start MFA setup.");
    return;
  }

  mfaState.pendingFactorId = response.factorId;
  mfaEnrollPanel?.classList.remove("mfa-panel--hidden");
  renderMfaQr(response.qrCodeSvg || response.uri || response.secret || null);
  setMfaStatus("Scan the QR code and enter your authenticator code to finish setup.");
}

async function verifyMfaEnrollmentFlow() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const factorId = mfaState.pendingFactorId;
  const code = (mfaCodeInput?.value ?? "").trim();
  if (!factorId) {
    setMfaStatus("Start MFA setup first.");
    return;
  }

  if (code.length < 6) {
    setMfaStatus("Enter the code from your authenticator app.");
    return;
  }

  const response = await api.verifyMfaEnrollment({ factorId, code });
  if (!response.ok) {
    setMfaStatus(response.reason || "MFA verification failed.");
    return;
  }

  resetMfaEnrollmentUI();
  await loadMfaStatus();
  setMfaStatus("MFA enabled successfully.");
}

async function disableMfaFlow() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const verifiedFactor = (mfaState.factors || []).find((factor) => factor.status === "verified") || null;
  if (!verifiedFactor) {
    setMfaStatus("No verified MFA factor found.");
    return;
  }

  const response = await api.disableMfa({ factorId: verifiedFactor.id });
  if (!response.ok) {
    setMfaStatus(response.reason || "Could not disable MFA.");
    return;
  }

  resetMfaEnrollmentUI();
  await loadMfaStatus();
  setMfaStatus("MFA disabled.");
}

function refreshDiagnosticsUI() {
  if (diagBridgeLoaded) {
    diagBridgeLoaded.textContent = diagnostics.bridgeLoaded ? "true" : "false";
  }

  if (diagSourceCount) {
    diagSourceCount.textContent = String(diagnostics.sourceCount);
  }

  if (diagSelectedSource) {
    diagSelectedSource.textContent = diagnostics.selectedSource;
  }

  if (diagLastError) {
    diagLastError.textContent = diagnostics.lastCaptureError;
  }
}

function getMemoraApi() {
  if (window.memora) {
    return window.memora;
  }

  if (settingsStatus) {
    settingsStatus.textContent = "Desktop bridge unavailable. Restart Memora with npm run dev.";
  }
  return null;
}

function setStatus(text) {
  if (settingsStatus) {
    settingsStatus.textContent = text;
  }
}

function persistPermissionState(key, state) {
  if (state === "granted") {
    localStorage.setItem(`memora-permission-${key}`, "granted");
    return;
  }

  localStorage.removeItem(`memora-permission-${key}`);
}

function setPermissionStatus(element, state) {
  if (!element) {
    return;
  }

  element.classList.remove("status-inline--ok", "status-inline--warn", "status-inline--error");

  if (state === "granted") {
    element.textContent = "Granted";
    element.classList.add("status-inline--ok");
    return;
  }

  if (state === "denied") {
    element.textContent = "Denied";
    element.classList.add("status-inline--error");
    return;
  }

  element.textContent = "Unknown";
  element.classList.add("status-inline--warn");
}

function refreshPermissionUI() {
  setPermissionStatus(screenPermissionStatus, permissionState.screen);
  setPermissionStatus(micPermissionStatus, permissionState.mic);
}

async function requestScreenPermission() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    permissionState.screen = "granted";
    persistPermissionState("screen", "granted");
    refreshPermissionUI();
    return { granted: true, reason: "granted" };
  } catch (error) {
    permissionState.screen = error?.name === "NotAllowedError" ? "denied" : "unknown";
    persistPermissionState("screen", permissionState.screen);
    refreshPermissionUI();
    return { granted: false, reason: error?.name ?? "unknown" };
  }
}

async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    permissionState.mic = "granted";
    persistPermissionState("mic", "granted");
    refreshPermissionUI();
    return { granted: true, reason: "granted" };
  } catch (error) {
    permissionState.mic = error?.name === "NotAllowedError" ? "denied" : "unknown";
    persistPermissionState("mic", permissionState.mic);
    refreshPermissionUI();
    return { granted: false, reason: error?.name ?? "unknown" };
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseIntOrFallback(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function renderSettingsForm(settings) {
  if (settingDefaultMode) {
    settingDefaultMode.value = settings.defaultMode;
  }

  if (settingSourceStrategy) {
    settingSourceStrategy.value = settings.sourceStrategy;
  }

  if (settingAskLimit) {
    settingAskLimit.value = String(settings.askLimit);
  }
}

function readSettingsFromForm() {
  return {
    defaultMode:
      settingDefaultMode?.value === "clip" || settingDefaultMode?.value === "always-on"
        ? settingDefaultMode.value
        : DEFAULT_SETTINGS.defaultMode,
    sourceStrategy: settingSourceStrategy?.value === "system-picker" ? "system-picker" : DEFAULT_SETTINGS.sourceStrategy,
    askLimit: parseIntOrFallback(settingAskLimit?.value, DEFAULT_SETTINGS.askLimit, 20, 120),
  };
}

async function loadSettings() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const settings = await api.getSettings();
  renderSettingsForm(settings);
  setStatus("Loaded saved settings.");
  await refreshDiagnostics();
}

async function refreshDiagnostics() {
  const api = getMemoraApi();

  diagnostics.bridgeLoaded = Boolean(api);
  diagnostics.lastCaptureError = localStorage.getItem("memora-last-capture-error") ?? "none";

  if (!api) {
    diagnostics.sourceCount = 0;
    diagnostics.selectedSource = "none";
    refreshDiagnosticsUI();
    return;
  }

  try {
    const sources = await api.listDisplaySources();
    diagnostics.sourceCount = Array.isArray(sources) ? sources.length : 0;
  } catch (error) {
    diagnostics.sourceCount = 0;
    diagnostics.lastCaptureError = error?.name ?? "source-list-failed";
  }

  const sourceStrategy = settingSourceStrategy?.value ?? DEFAULT_SETTINGS.sourceStrategy;
  const rememberedSource = localStorage.getItem("memora-last-selected-source");
  diagnostics.selectedSource =
    sourceStrategy === "system-picker" ? "system-picker" : rememberedSource ?? "remember-last";

  refreshDiagnosticsUI();
}

async function saveSettings() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const response = await api.updateSettings(readSettingsFromForm());
  if (!response.ok) {
    setStatus("Could not save settings.");
    return;
  }

  renderSettingsForm(response.settings);
  setStatus("Settings saved.");
  await refreshDiagnostics();
}

async function resetSettingsToDefaults() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const response = await api.updateSettings(DEFAULT_SETTINGS);
  if (!response.ok) {
    setStatus("Could not reset settings.");
    return;
  }

  renderSettingsForm(response.settings);
  setStatus("Settings reset to defaults.");
  await refreshDiagnostics();
}

function setupNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (action === "logout") {
        const api = getMemoraApi();
        if (api) {
          api.logoutUser().catch(() => {
            // Continue to auth page even if logout IPC fails.
          });
        }
        window.location.href = "./auth.html";
        return;
      }

      const page = button.getAttribute("data-page");
      if (!page) {
        return;
      }

      const pageMap = {
        dashboard: "./index.html",
        library: "./library.html",
        settings: "./settings.html",
        benchmarks: "./benchmark.html",
      };

      const nextHref = pageMap[page];
      if (nextHref) {
        window.location.href = nextHref;
      }
    });
  });
}

async function ensureAuthenticated() {
  const api = getMemoraApi();
  if (!api) {
    return false;
  }

  const user = await api.getCurrentUser();
  if (!user) {
    window.location.href = "./auth.html";
    return false;
  }

  currentUserEmail = user.email || "";

  return true;
}

function setupBackToTop() {
  if (!backToTopBtn) {
    return;
  }

  const syncVisibility = () => {
    backToTopBtn.classList.toggle("back-to-top--visible", window.scrollY > 260);
  };

  window.addEventListener("scroll", syncVisibility, { passive: true });
  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  syncVisibility();
}

saveSettingsBtn?.addEventListener("click", async () => {
  await saveSettings();
});

resetSettingsBtn?.addEventListener("click", async () => {
  await resetSettingsToDefaults();
});

settingSourceStrategy?.addEventListener("change", () => {
  refreshDiagnostics().catch((error) => {
    diagnostics.lastCaptureError = error?.name ?? "diagnostics-unavailable";
    refreshDiagnosticsUI();
    console.error(error);
  });
});

grantScreenBtn?.addEventListener("click", async () => {
  const result = await requestScreenPermission();
  setStatus(result.granted ? "Screen permission granted." : "Screen permission was not granted. You can retry anytime.");
});

grantMicBtn?.addEventListener("click", async () => {
  const result = await requestMicPermission();
  if (result.granted) {
    setStatus("Microphone permission granted.");
    return;
  }

  if (result.reason === "NotFoundError") {
    setStatus("No microphone device detected. Screen recording still works.");
    return;
  }

  setStatus("Microphone access not granted. Screen recording still works without mic.");
});

mfaStartBtn?.addEventListener("click", async () => {
  await startMfaEnrollment();
});

mfaVerifyBtn?.addEventListener("click", async () => {
  await verifyMfaEnrollmentFlow();
});

mfaDisableBtn?.addEventListener("click", async () => {
  await disableMfaFlow();
});

mfaCancelBtn?.addEventListener("click", () => {
  resetMfaEnrollmentUI();
  setMfaStatus("MFA setup canceled.");
});

revokeSessionsBtn?.addEventListener("click", async () => {
  await revokeAllSessionsFlow();
});

reauthSecurityBtn?.addEventListener("click", () => {
  startSecurityReauth();
});

setupNavigation();
setupBackToTop();
refreshPermissionUI();

ensureAuthenticated()
  .then((authenticated) => {
    if (!authenticated) {
      return;
    }

    loadSettings().catch((error) => {
      setStatus("Could not load settings.");
      console.error(error);
    });

    loadMfaStatus().catch((error) => {
      setMfaStatus("Could not load MFA status.");
      console.error(error);
    });

    refreshDiagnostics().catch((error) => {
      diagnostics.lastCaptureError = error?.name ?? "diagnostics-unavailable";
      refreshDiagnosticsUI();
      console.error(error);
    });
  })
  .catch((error) => {
    setStatus("Could not verify account session.");
    console.error(error);
  });
