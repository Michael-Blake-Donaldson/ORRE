const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const switchInlineBtn = document.getElementById("switchInlineBtn");
const authTitle = document.getElementById("authTitle");
const authSwitchPrompt = document.getElementById("authSwitchPrompt");
const authStatus = document.getElementById("authStatus");
const mfaForm = document.getElementById("mfaForm");
const mfaCode = document.getElementById("mfaCode");
const mfaBackBtn = document.getElementById("mfaBackBtn");
const resendVerificationBtn = document.getElementById("resendVerificationBtn");

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const registerFirstName = document.getElementById("registerFirstName");
const registerLastName = document.getElementById("registerLastName");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerTerms = document.getElementById("registerTerms");

let pendingMfa = null;

function setResendVisibility(visible) {
  resendVerificationBtn?.classList.toggle("auth-form__helper--hidden", !visible);
}

function hideMfaForm() {
  pendingMfa = null;
  mfaForm?.classList.add("auth-form--hidden");
  if (mfaCode) {
    mfaCode.value = "";
  }
}

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
  hideMfaForm();
  setResendVisibility(false);

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
    if (result.reason === "mfa-required") {
      pendingMfa = {
        factorId: result.factorId,
        challengeId: result.challengeId,
      };

      loginForm?.classList.add("auth-form--hidden");
      mfaForm?.classList.remove("auth-form--hidden");
      if (authTitle) {
        authTitle.textContent = "Verify your sign in";
      }
      if (authSwitchPrompt) {
        authSwitchPrompt.textContent = "Use another account?";
      }
      if (switchInlineBtn) {
        switchInlineBtn.textContent = "Back";
      }

      setStatus("Multi-factor code required. Enter the code from your authenticator app.");
      return;
    }

    if (typeof result.reason === "string" && result.reason.toLowerCase().includes("verify")) {
      setResendVisibility(true);
    }

    setStatus(result.reason || "Login failed.");
    return;
  }

  setResendVisibility(false);
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

  if (result.requiresEmailVerification) {
    setMode("login");
    if (loginEmail && registerEmail) {
      loginEmail.value = registerEmail.value;
    }
    setResendVisibility(true);
    setStatus("Account created. Check your email to verify, then sign in.");
    return;
  }

  setStatus(`Account created. Welcome, ${result.user.displayName}.`);
  window.location.href = "./index.html";
});

mfaForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const api = getMemoraApi();
  if (!api || !pendingMfa) {
    return;
  }

  const code = (mfaCode?.value ?? "").trim();
  if (code.length < 6) {
    setStatus("Enter the verification code from your authenticator app.");
    return;
  }

  setStatus("Verifying code...");

  const result = await api.verifyMfaLogin({
    factorId: pendingMfa.factorId,
    challengeId: pendingMfa.challengeId,
    code,
  });

  if (!result.ok) {
    setStatus(result.reason || "Verification failed.");
    return;
  }

  setStatus(`Welcome back, ${result.user.displayName}.`);
  window.location.href = "./index.html";
});

mfaBackBtn?.addEventListener("click", () => {
  setMode("login");
  setStatus("Login with your account.");
});

resendVerificationBtn?.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const emailValue = (loginEmail?.value ?? "").trim();
  if (!emailValue) {
    setStatus("Enter your email first, then resend verification.");
    return;
  }

  setStatus("Sending verification email...");

  const result = await api.resendVerificationEmail({
    email: emailValue,
  });

  if (!result.ok) {
    setStatus(result.reason || "Could not resend verification email.");
    return;
  }

  setStatus("Verification email sent. Please check your inbox.");
});

switchInlineBtn?.addEventListener("click", () => {
  const nextMode = registerForm?.classList.contains("auth-form--hidden") ? "register" : "login";
  setMode(nextMode);
  setStatus(nextMode === "login" ? "Login with your account." : "Create your account to keep your data private.");
});

setMode("login");
checkExistingSession().catch((error) => {
  setStatus("Could not check session.");
  console.error(error);
});
