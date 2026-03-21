/**
 * Form validation and utility functions for the auth page
 */

/**
 * Validates email format
 * @param {string} email Email to validate
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validates password strength
 * Returns object with strength level and missing requirements
 * @param {string} password Password to validate
 * @returns {{level: 'weak'|'fair'|'strong', score: number, requirements: {hasMinLength: boolean, hasUppercase: boolean, hasNumber: boolean, hasSpecial: boolean}}}
 */
export function validatePassword(password) {
  let score = 0;
  const requirements = {
    hasMinLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  if (requirements.hasMinLength) score++;
  if (requirements.hasUppercase) score++;
  if (requirements.hasNumber) score++;
  if (requirements.hasSpecial) score++;

  let level = 'weak';
  if (score >= 3) level = 'strong';
  else if (score >= 2) level = 'fair';

  return {
    level,
    score,
    requirements,
  };
}

/**
 * Gets strength text and recommendation
 * @param {string} password Password to analyze
 * @returns {{text: string, recommendation: string}}
 */
export function getPasswordStrengthText(password) {
  if (!password) {
    return { text: '', recommendation: '' };
  }

  const { level, requirements } = validatePassword(password);

  const messages = {
    weak: {
      text: 'Weak password',
      recommendation: 'Add uppercase, numbers, and special characters',
    },
    fair: {
      text: 'Fair password',
      recommendation: 'Consider adding more variety for better security',
    },
    strong: {
      text: 'Strong password',
      recommendation: 'Great security!',
    },
  };

  return messages[level];
}

/**
 * Validates name field
 * @param {string} name Name to validate
 * @returns {{valid: boolean, error: string}}
 */
export function validateName(name) {
  const trimmed = (name || '').trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' };
  }
  if (trimmed.length > 50) {
    return { valid: false, error: 'Name must be less than 50 characters' };
  }
  return { valid: true, error: '' };
}

/**
 * Show validation error on a field
 * @param {HTMLInputElement} field Input element
 * @param {string} errorMessage Error message to display
 */
export function showFieldError(field, errorMessage) {
  const errorEl = document.getElementById(`${field.id}Error`);
  if (errorEl) {
    errorEl.textContent = errorMessage;
    errorEl.classList.add('show');
  }
  field.setAttribute('aria-invalid', 'true');
}

/**
 * Clear validation error on a field
 * @param {HTMLInputElement} field Input element
 */
export function clearFieldError(field) {
  const errorEl = document.getElementById(`${field.id}Error`);
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }
  field.setAttribute('aria-invalid', 'false');
}

/**
 * Update password strength indicator
 * @param {string} fieldId Input element ID (e.g., "registerPassword")
 * @param {string} password Password value
 */
export function updatePasswordStrength(fieldId, password) {
  const strengthBar = document.getElementById(`${fieldId}Strength`);
  const strengthText = document.getElementById(`${fieldId}StrengthText`);

  if (!strengthBar || !strengthText) {
    return;
  }

  // Clear previous classes
  strengthBar.className = 'auth-strength-bar';
  strengthText.className = 'auth-strength-text';

  if (!password) {
    return;
  }

  const { level } = validatePassword(password);
  const { text } = getPasswordStrengthText(password);

  strengthBar.classList.add(level);
  strengthText.classList.add(level);
  strengthText.textContent = text;
}

/**
 * Toggle password visibility
 * @param {HTMLInputElement} field Password input element
 * @param {HTMLButtonElement} toggle Toggle button element
 */
export function togglePasswordVisibility(field, toggle) {
  const isPassword = field.type === 'password';
  field.type = isPassword ? 'text' : 'password';
  toggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  toggle.classList.toggle('active');
}

/**
 * Set loading state on button
 * @param {HTMLButtonElement} button Button element
 * @param {boolean} isLoading Loading state
 */
export function setButtonLoading(button, isLoading) {
  if (isLoading) {
    button.disabled = true;
    button.classList.add('loading');
    button.dataset.originalText = button.textContent;
    button.textContent = '';
  } else {
    button.disabled = false;
    button.classList.remove('loading');
    button.textContent = button.dataset.originalText || 'Submit';
  }
}

/**
 * Remember me token management (secure storage for desktop app)
 */
export class RememberMe {
  static STORAGE_KEY = 'memora_remember_me';

  /**
   * Save credentials for auto-login
   * @param {string} email User email
   * @param {object} user User object from login response
   */
  static save(email, user) {
    try {
      // In production, tokens should be stored in secure storage (keytar/secure-storage)
      // For now, store encrypted user ID with timestamp
      const data = {
        email: email,
        userId: user.id,
        displayName: user.displayName,
        timestamp: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      };
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save remember-me token:', e);
    }
  }

  /**
   * Get saved remember-me data if still valid
   * @returns {object|null} Saved data or null if expired/not found
   */
  static get() {
    try {
      const data = sessionStorage.getItem(this.STORAGE_KEY);
      if (!data) return null;

      const parsed = JSON.parse(data);
      if (parsed.expiresAt < Date.now()) {
        this.clear();
        return null;
      }

      return parsed;
    } catch (e) {
      console.error('Failed to retrieve remember-me token:', e);
      return null;
    }
  }

  /**
   * Clear saved remember-me data
   */
  static clear() {
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear remember-me token:', e);
    }
  }
}

/**
 * Prevent form double-submission
 * @param {HTMLFormElement} form Form element
 * @param {Function} submitHandler Submit handler function
 */
export function preventDoubleSubmit(form, submitHandler) {
  let isSubmitting = false;

  form?.addEventListener('submit', async (event) => {
    if (isSubmitting) {
      event.preventDefault();
      return;
    }

    isSubmitting = true;
    try {
      await submitHandler(event);
    } finally {
      isSubmitting = false;
    }
  });
}
