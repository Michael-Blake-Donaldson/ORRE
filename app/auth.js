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
const privacyModal = document.getElementById("privacyModal");
const privacyOpenBtn = document.getElementById("privacyOpenBtn");
const privacyCloseBtn = document.getElementById("privacyCloseBtn");
const privacyBackdrop = document.getElementById("privacyBackdrop");
const forgotModal = document.getElementById("forgotModal");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const forgotCloseBtn = document.getElementById("forgotCloseBtn");
const forgotBackdrop = document.getElementById("forgotBackdrop");
const forgotForm = document.getElementById("forgotForm");
const forgotEmail = document.getElementById("forgotEmail");
const forgotStatus = document.getElementById("forgotStatus");
const forgotSubmitBtn = document.getElementById("forgotSubmitBtn");

// Login form fields
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginPasswordToggle = document.getElementById("loginPasswordToggle");
const loginRememberMe = document.getElementById("loginRememberMe");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const passkeyLoginBtn = document.getElementById("passkeyLoginBtn");
const passkeyHint = document.getElementById("passkeyHint");

// Register form fields
const registerFirstName = document.getElementById("registerFirstName");
const registerLastName = document.getElementById("registerLastName");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerPasswordToggle = document.getElementById("registerPasswordToggle");
const registerTerms = document.getElementById("registerTerms");
const registerEnablePasskey = document.getElementById("registerEnablePasskey");
const registerSubmitBtn = document.getElementById("registerSubmitBtn");

// MFA form fields
const mfaSubmitBtn = document.getElementById("mfaSubmitBtn");
const authShell = document.getElementById("authShell");
const authPreloader = document.getElementById("authPreloader");
const authPreloaderText = document.getElementById("authPreloaderText");
const authPreloaderSubtext = document.getElementById("authPreloaderSubtext");

let pendingMfa = null;
let isSubmitting = false;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setLoaderStatus(title, subtitle) {
  if (authPreloaderText) {
    authPreloaderText.textContent = title;
  }

  if (authPreloaderSubtext) {
    authPreloaderSubtext.textContent = subtitle;
  }
}

async function waitForOnlineConnection() {
  if (navigator.onLine) {
    return;
  }

  setLoaderStatus("Waiting for connection...", "We will continue automatically when you are back online.");

  await new Promise((resolve) => {
    const onOnline = () => {
      window.removeEventListener("online", onOnline);
      resolve(undefined);
    };

    window.addEventListener("online", onOnline);
  });
}

async function waitForConnectionReadiness() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  // Keep loading until we can talk to the desktop bridge and the device is online.
  while (true) {
    await waitForOnlineConnection();

    try {
      setLoaderStatus("Connecting securely...", "Checking your authentication services.");

      await Promise.race([
        api.getCurrentUser(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("connection-timeout")), 2600)),
      ]);

      return;
    } catch {
      setLoaderStatus("Still reconnecting...", "Connection is unstable, retrying now.");
      await wait(900);
    }
  }
}

async function startAuthEntrance() {
  const minimumLoadMs = 3000 + Math.floor(Math.random() * 2001);
  const minTimer = wait(minimumLoadMs);

  setLoaderStatus("Warming up your secure workspace...", "Loading interface and preparing your session.");

  await Promise.all([minTimer, waitForConnectionReadiness()]);

  authPreloader?.classList.add("auth-preloader--hidden");
  authShell?.classList.remove("auth-shell--hidden");
  authShell?.classList.add("auth-shell--ready");
  authShell?.classList.add("auth-shell--staggered");
  document.body.classList.remove("auth-preload");

  setTimeout(() => {
    authPreloader?.remove();
  }, 420);
}

function base64UrlToArrayBuffer(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toPublicKeyCreationOptions(optionsJSON) {
  return {
    ...optionsJSON,
    challenge: base64UrlToArrayBuffer(optionsJSON.challenge),
    user: {
      ...optionsJSON.user,
      id: base64UrlToArrayBuffer(optionsJSON.user.id),
    },
    excludeCredentials: (optionsJSON.excludeCredentials ?? []).map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  };
}

function toPublicKeyRequestOptions(optionsJSON) {
  return {
    ...optionsJSON,
    challenge: base64UrlToArrayBuffer(optionsJSON.challenge),
    allowCredentials: (optionsJSON.allowCredentials ?? []).map((credential) => ({
      ...credential,
      id: base64UrlToArrayBuffer(credential.id),
    })),
  };
}

function serializeAttestationCredential(credential) {
  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
  };
}

function serializeAssertionCredential(credential) {
  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(credential.response.authenticatorData),
      signature: arrayBufferToBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle ? arrayBufferToBase64Url(credential.response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
  };
}

async function isWindowsHelloAvailable() {
  if (!(window.PublicKeyCredential && navigator.credentials)) {
    return false;
  }

  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return false;
  }

  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function tryEnrollWindowsHello() {
  const api = getMemoraApi();
  if (!api) {
    return { ok: false, reason: "Desktop bridge unavailable." };
  }

  const begin = await api.passkeyBeginRegistration();
  if (!begin.ok) {
    return begin;
  }

  const publicKey = toPublicKeyCreationOptions(begin.options);
  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) {
    return { ok: false, reason: "Windows Hello enrollment was cancelled." };
  }

  const finish = await api.passkeyFinishRegistration({
    challenge: String(begin.options.challenge),
    response: serializeAttestationCredential(credential),
  });

  return finish;
}

function openLegalModal(modal) {
  if (!modal) {
    return;
  }

  modal.classList.remove("legal-modal--hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeLegalModal(modal) {
  if (!modal) {
    return;
  }

  modal.classList.add("legal-modal--hidden");
  modal.setAttribute("aria-hidden", "true");

  if (
    termsModal?.classList.contains("legal-modal--hidden") &&
    privacyModal?.classList.contains("legal-modal--hidden") &&
    forgotModal?.classList.contains("legal-modal--hidden")
  ) {
    document.body.classList.remove("modal-open");
  }
}

function setForgotStatus(text) {
  if (forgotStatus) {
    forgotStatus.textContent = text;
  }
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
  openLegalModal(termsModal);
});

termsCloseBtn?.addEventListener("click", () => {
  closeLegalModal(termsModal);
});

termsBackdrop?.addEventListener("click", () => {
  closeLegalModal(termsModal);
});

privacyOpenBtn?.addEventListener("click", () => {
  openLegalModal(privacyModal);
});

privacyCloseBtn?.addEventListener("click", () => {
  closeLegalModal(privacyModal);
});

privacyBackdrop?.addEventListener("click", () => {
  closeLegalModal(privacyModal);
});

forgotPasswordBtn?.addEventListener("click", () => {
  if (forgotEmail && loginEmail?.value) {
    forgotEmail.value = loginEmail.value;
  }
  setForgotStatus("");
  openLegalModal(forgotModal);
});

forgotCloseBtn?.addEventListener("click", () => {
  closeLegalModal(forgotModal);
});

forgotBackdrop?.addEventListener("click", () => {
  closeLegalModal(forgotModal);
});

forgotForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const email = (forgotEmail?.value ?? "").trim();
  if (!isValidEmail(email)) {
    setForgotStatus("Enter a valid email address.");
    return;
  }

  setButtonLoading(forgotSubmitBtn, true);
  setForgotStatus("Sending reset instructions...");

  try {
    const result = await api.requestPasswordReset({ email });
    if (!result.ok) {
      setForgotStatus(result.reason || "Could not send reset instructions.");
      return;
    }

    setForgotStatus(result.message || "If an account exists, instructions have been sent.");
  } finally {
    setButtonLoading(forgotSubmitBtn, false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLegalModal(termsModal);
    closeLegalModal(privacyModal);
    closeLegalModal(forgotModal);
  }
});

isWindowsHelloAvailable().then((available) => {
  if (!available) {
    if (passkeyLoginBtn) {
      passkeyLoginBtn.disabled = true;
    }
    if (registerEnablePasskey) {
      registerEnablePasskey.disabled = true;
      registerEnablePasskey.checked = false;
    }
    if (passkeyHint) {
      passkeyHint.textContent = "Windows Hello is not available on this device or browser context.";
    }
  }
});

passkeyLoginBtn?.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const email = (loginEmail?.value ?? "").trim();
  if (!isValidEmail(email)) {
    showFieldError(loginEmail, "Enter your account email first");
    return;
  }

  clearFieldError(loginEmail);
  clearFieldError(loginPassword);
  setStatus("Waiting for Windows Hello...");

  try {
    const begin = await api.passkeyBeginLogin({ email });
    if (!begin.ok) {
      setStatus(begin.reason);
      return;
    }

    const credential = await navigator.credentials.get({
      publicKey: toPublicKeyRequestOptions(begin.options),
    });

    if (!credential) {
      setStatus("Windows Hello sign-in was cancelled.");
      return;
    }

    const finish = await api.passkeyFinishLogin({
      email,
      challenge: String(begin.options.challenge),
      response: serializeAssertionCredential(credential),
    });

    if (!finish.ok) {
      setStatus(finish.reason || "Windows Hello sign-in failed.");
      return;
    }

    if (loginRememberMe?.checked) {
      RememberMe.save(email, finish.user);
    }

    setStatus(`Welcome back, ${finish.user.displayName}.`);
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 300);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Windows Hello sign-in failed.");
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
      acceptedLegal: Boolean(registerTerms?.checked),
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

    if (registerEnablePasskey?.checked) {
      setStatus("Account created. Setting up Windows Hello...");
      const enrollment = await tryEnrollWindowsHello();
      if (!enrollment.ok) {
        setStatus(`Account created. Windows Hello setup skipped: ${enrollment.reason}`);
      }
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
startAuthEntrance().catch((error) => {
  console.error(error);
  authPreloader?.classList.add("auth-preloader--hidden");
  authShell?.classList.remove("auth-shell--hidden");
  authShell?.classList.add("auth-shell--ready");
  authShell?.classList.add("auth-shell--staggered");
  document.body.classList.remove("auth-preload");
});
checkExistingSession().catch((error) => {
  setStatus("Could not check session.");
  console.error(error);
});
