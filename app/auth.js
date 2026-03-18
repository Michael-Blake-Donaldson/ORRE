const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showLoginBtn = document.getElementById("showLoginBtn");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const switchInlineBtn = document.getElementById("switchInlineBtn");
const authTitle = document.getElementById("authTitle");
const authSwitchPrompt = document.getElementById("authSwitchPrompt");
const authStatus = document.getElementById("authStatus");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const registerFirstName = document.getElementById("registerFirstName");
const registerLastName = document.getElementById("registerLastName");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerTerms = document.getElementById("registerTerms");

function getMemoraApi() {
  if (window.memora) {
    return window.memora;
  }

  if (authStatus) {
    authStatus.textContent = "Desktop bridge unavailable. Restart Memora with npm run dev.";
  }
  return null;
}

function setStatus(text) {
  if (authStatus) {
    authStatus.textContent = text;
  }
}

function setMode(mode) {
  const isLogin = mode === "login";

  loginForm?.classList.toggle("auth-form--hidden", !isLogin);
  registerForm?.classList.toggle("auth-form--hidden", isLogin);

  showLoginBtn?.classList.toggle("button--primary", isLogin);
  showRegisterBtn?.classList.toggle("button--primary", !isLogin);

  if (authTitle) {
    authTitle.textContent = isLogin ? "Welcome back" : "Create an account";
  }

  if (authSwitchPrompt) {
    authSwitchPrompt.textContent = isLogin ? "Need an account?" : "Already have an account?";
  }

  if (switchInlineBtn) {
    switchInlineBtn.textContent = isLogin ? "Register" : "Log in";
  }
}

async function checkExistingSession() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const user = await api.getCurrentUser();
  if (user) {
    window.location.href = "./index.html";
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const api = getMemoraApi();
  if (!api) {
    return;
  }

  setStatus("Signing in...");

  const result = await api.loginUser({
    email: loginEmail?.value ?? "",
    password: loginPassword?.value ?? "",
  });

  if (!result.ok) {
    setStatus(result.reason || "Login failed.");
    return;
  }

  setStatus(`Welcome back, ${result.user.displayName}.`);
  window.location.href = "./index.html";
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const api = getMemoraApi();
  if (!api) {
    return;
  }

  setStatus("Creating account...");

  const firstName = (registerFirstName?.value ?? "").trim();
  const lastName = (registerLastName?.value ?? "").trim();
  const displayName = `${firstName} ${lastName}`.trim();

  if (!displayName) {
    setStatus("Please enter your first and last name.");
    return;
  }

  if (registerTerms && !registerTerms.checked) {
    setStatus("Please accept the Terms and Conditions.");
    return;
  }

  const result = await api.registerUser({
    displayName,
    email: registerEmail?.value ?? "",
    password: registerPassword?.value ?? "",
  });

  if (!result.ok) {
    setStatus(result.reason || "Could not create account.");
    return;
  }

  setStatus(`Account created. Welcome, ${result.user.displayName}.`);
  window.location.href = "./index.html";
});

showLoginBtn?.addEventListener("click", () => {
  setMode("login");
  setStatus("Login with your account.");
});

showRegisterBtn?.addEventListener("click", () => {
  setMode("register");
  setStatus("Create your account to keep your data private.");
});

switchInlineBtn?.addEventListener("click", () => {
  const nextMode = loginForm?.classList.contains("auth-form--hidden") ? "login" : "register";
  setMode(nextMode);
  setStatus(nextMode === "login" ? "Login with your account." : "Create your account to keep your data private.");
});

setMode("register");
checkExistingSession().catch((error) => {
  setStatus("Could not check session.");
  console.error(error);
});
