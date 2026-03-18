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
