const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showLoginBtn = document.getElementById("showLoginBtn");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const authStatus = document.getElementById("authStatus");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const registerName = document.getElementById("registerName");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");

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

  const result = await api.registerUser({
    displayName: registerName?.value ?? "",
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

setMode("login");
checkExistingSession().catch((error) => {
  setStatus("Could not check session.");
  console.error(error);
});
