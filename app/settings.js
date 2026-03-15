const settingDefaultMode = document.getElementById("settingDefaultMode");
const settingSourceStrategy = document.getElementById("settingSourceStrategy");
const settingAskLimit = document.getElementById("settingAskLimit");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const resetSettingsBtn = document.getElementById("resetSettingsBtn");
const settingsStatus = document.getElementById("settingsStatus");
const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page]"));
const backToTopBtn = document.getElementById("backToTopBtn");

const DEFAULT_SETTINGS = {
  defaultMode: "session",
  sourceStrategy: "remember-last",
  askLimit: 60,
};

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
}

function setupNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
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

setupNavigation();
setupBackToTop();
loadSettings().catch((error) => {
  setStatus("Could not load settings.");
  console.error(error);
});