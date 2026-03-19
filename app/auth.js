import { clientRateLimiters, showRateLimitError } from "./rateLimitClient.js";
import {
  isValidEmail,
  validatePassword,
  getPasswordStrengthText,
  validateName,
  showFieldError,
  clearFieldError,
  updatePasswordStrength,
  togglePasswordVisibility,
  setButtonLoading,
  RememberMe,
} from "./authValidation.js";

// Form elements
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
const termsModal = document.getElementById("termsModal");
const termsOpenBtn = document.getElementById("termsOpenBtn");
const termsCloseBtn = document.getElementById("termsCloseBtn");
const termsBackdrop = document.getElementById("termsBackdrop");

// Login form fields
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginPasswordToggle = document.getElementById("loginPasswordToggle");
const loginRememberMe = document.getElementById("loginRememberMe");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");

// Register form fields
const registerFirstName = document.getElementById("registerFirstName");
const registerLastName = document.getElementById("registerLastName");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerPasswordToggle = document.getElementById("registerPasswordToggle");
const registerTerms = document.getElementById("registerTerms");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

// MFA form fields
const mfaSubmitBtn = document.getElementById("mfaSubmitBtn");

let pendingMfa = null;
let isSubmitting = false;

function openTermsModal() {
  if (!termsModal) {
    return;
  }

  termsModal.classList.remove("legal-modal--hidden");
  termsModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeTermsModal() {
  if (!termsModal) {
    return;
  }

  termsModal.classList.add("legal-modal--hidden");
  termsModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

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

  // Clear forms when switching
  if (isLogin) {
    registerForm?.reset?.();
    if (registerPassword) {
      updatePasswordStrength("registerPassword", "");
    }
  } else {
    loginForm?.reset?.();
    if (loginPassword) {
      clearFieldError(loginPassword);
    }
  }

  if (authTitle) {
    authTitle.textContent = isLogin ? "Welcome back" : "Create an account";
  }

  if (authSwitchPrompt) {
    authSwitchPrompt.textContent = isLogin ? "Need an account?" : "Already have an account?";
  }

  if (switchInlineBtn) {
    switchInlineBtn.textContent = isLogin ? "Register" : "Log in";
  }

  setStatus("");
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

// Password visibility toggles
loginPasswordToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  togglePasswordVisibility(loginPassword, loginPasswordToggle);
});

registerPasswordToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  togglePasswordVisibility(registerPassword, registerPasswordToggle);
});

// Real-time password strength updates
registerPassword?.addEventListener("input", (e) => {
  updatePasswordStrength("registerPassword", e.target.value);
});

// Real-time validation for register fields
registerFirstName?.addEventListener("blur", (e) => {
  const { valid, error } = validateName(e.target.value);
  if (e.target.value.trim() && !valid) {
    showFieldError(e.target, error);
  } else {
    clearFieldError(e.target);
  }
});

registerLastName?.addEventListener("blur", (e) => {
  const { valid, error } = validateName(e.target.value);
  if (e.target.value.trim() && !valid) {
    showFieldError(e.target, error);
  } else {
    clearFieldError(e.target);
  }
});

registerEmail?.addEventListener("blur", (e) => {
  const valid = isValidEmail(e.target.value);
  if (e.target.value.trim() && !valid) {
    showFieldError(e.target, "Enter a valid email address");
  } else {
    clearFieldError(e.target);
  }
});

registerPassword?.addEventListener("blur", (e) => {
  if (e.target.value.length > 0 && e.target.value.length < 8) {
    showFieldError(e.target, "Password must be at least 8 characters");
  } else {
    clearFieldError(e.target);
  }
});

termsOpenBtn?.addEventListener("click", () => {
  openTermsModal();
});

termsCloseBtn?.addEventListener("click", () => {
  closeTermsModal();
});

termsBackdrop?.addEventListener("click", () => {
  closeTermsModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTermsModal();
  }
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) return;

  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const email = loginEmail?.value ?? "";
  const password = loginPassword?.value ?? "";

  // Clear previous errors
  clearFieldError(loginEmail);
  clearFieldError(loginPassword);

  // Validation
  if (!isValidEmail(email)) {
    showFieldError(loginEmail, "Enter a valid email address");
    return;
  }

  if (!password) {
    showFieldError(loginPassword, "Enter your password");
    return;
  }

  // Check client-side rate limit
  const loginLimit = clientRateLimiters.login.check(email);
  if (!loginLimit.allowed) {
    showRateLimitError(loginLimit.message);
    return;
  }

  isSubmitting = true;
  setButtonLoading(loginSubmitBtn, true);
  setStatus("Signing in...");

  try {
    const result = await api.loginUser({ email, password });

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

      showFieldError(loginPassword, result.reason || "Login failed");
      setStatus("");
      return;
    }

    // Handle remember me
    if (loginRememberMe?.checked) {
      RememberMe.save(email, result.user);
    }

    setResendVisibility(false);
    setStatus(`Welcome back, ${result.user.displayName}.`);
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 300);
  } finally {
    isSubmitting = false;
    setButtonLoading(loginSubmitBtn, false);
  }
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) return;

  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const firstName = (registerFirstName?.value ?? "").trim();
  const lastName = (registerLastName?.value ?? "").trim();
  const email = registerEmail?.value ?? "";
  const password = registerPassword?.value ?? "";

  // Clear previous errors
  clearFieldError(registerFirstName);
  clearFieldError(registerLastName);
  clearFieldError(registerEmail);
  clearFieldError(registerPassword);

  let hasErrors = false;

  // Validation
  const firstNameValidation = validateName(firstName);
  if (!firstNameValidation.valid) {
    showFieldError(registerFirstName, firstNameValidation.error);
    hasErrors = true;
  }

  const lastNameValidation = validateName(lastName);
  if (!lastNameValidation.valid) {
    showFieldError(registerLastName, lastNameValidation.error);
    hasErrors = true;
  }

  if (!isValidEmail(email)) {
    showFieldError(registerEmail, "Enter a valid email address");
    hasErrors = true;
  }

  if (password.length < 8) {
    showFieldError(registerPassword, "Password must be at least 8 characters");
    hasErrors = true;
  }

  if (!registerTerms?.checked) {
    setStatus("Please accept the Terms and Conditions");
    hasErrors = true;
  }

  if (hasErrors) {
    return;
  }

  const displayName = `${firstName} ${lastName}`;

  // Check client-side rate limit
  const registerLimit = clientRateLimiters.register.check(email);
  if (!registerLimit.allowed) {
    showRateLimitError(registerLimit.message);
    return;
  }

  isSubmitting = true;
  setButtonLoading(registerSubmitBtn, true);
  setStatus("Creating account...");

  try {
    const result = await api.registerUser({
      displayName,
      email,
      password,
    });

    if (!result.ok) {
      showFieldError(registerEmail, result.reason || "Could not create account");
      setStatus("");
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
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 300);
  } finally {
    isSubmitting = false;
    setButtonLoading(registerSubmitBtn, false);
  }
});

mfaForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) return;

  const api = getMemoraApi();
  if (!api || !pendingMfa) {
    return;
  }

  clearFieldError(mfaCode);

  const code = (mfaCode?.value ?? "").trim();
  if (code.length < 6) {
    showFieldError(mfaCode, "Enter the 6-digit verification code");
    return;
  }

  // Check client-side rate limit
  const mfaLimit = clientRateLimiters.mfa.check(pendingMfa.challengeId);
  if (!mfaLimit.allowed) {
    showRateLimitError(mfaLimit.message);
    return;
  }

  isSubmitting = true;
  setButtonLoading(mfaSubmitBtn, true);
  setStatus("Verifying code...");

  try {
    const result = await api.verifyMfaLogin({
      factorId: pendingMfa.factorId,
      challengeId: pendingMfa.challengeId,
      code,
    });

    if (!result.ok) {
      showFieldError(mfaCode, result.reason || "Verification failed");
      setStatus("");
      return;
    }

    setStatus(`Welcome back, ${result.user.displayName}.`);
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 300);
  } finally {
    isSubmitting = false;
    setButtonLoading(mfaSubmitBtn, false);
  }
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

  // Check client-side rate limit for resend attempts
  const resendLimit = clientRateLimiters.resendVerification.check(emailValue);
  if (!resendLimit.allowed) {
    showRateLimitError(resendLimit.message);
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
