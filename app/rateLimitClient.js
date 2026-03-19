/**
 * Client-side rate limiting utilities for the frontend
 * Provides immediate feedback to users before making IPC calls
 */

/**
 * Client-side rate limiter using in-memory tracking
 * @param {number} maxAttempts Maximum attempts allowed
 * @param {number} windowMs Time window in milliseconds
 * @returns {object} Rate limiter with check() method
 */
function createClientRateLimiter(maxAttempts, windowMs) {
  const attempts = new Map();

  return {
    /**
     * Check if an action is allowed
     * @param {string} key Identifier for rate limiting
     * @returns {object} {allowed: boolean, message?: string, remaining: number}
     */
    check(key) {
      const now = Date.now();
      let record = attempts.get(key);

      if (!record || now >= record.expiresAt) {
        // New or expired record
        record = {
          count: 1,
          expiresAt: now + windowMs,
        };
        attempts.set(key, record);
        return {
          allowed: true,
          remaining: maxAttempts - 1,
        };
      }

      // Existing record within window
      record.count++;
      const allowed = record.count <= maxAttempts;
      return {
        allowed,
        remaining: Math.max(0, maxAttempts - record.count),
        message: allowed
          ? undefined
          : `Too many attempts. Please wait ${Math.ceil((record.expiresAt - now) / 1000)} seconds.`,
        resetTime: record.expiresAt,
      };
    },

    reset(key) {
      attempts.delete(key);
    },

    clear() {
      attempts.clear();
    },
  };
}

/**
 * Pre-configured client-side rate limiters matching backend limits
 */
const clientRateLimiters = {
  // Login: 5 attempts per 15 minutes
  login: createClientRateLimiter(5, 15 * 60 * 1000),

  // Register: 3 attempts per 1 hour
  register: createClientRateLimiter(3, 60 * 60 * 1000),

  // MFA: 5 attempts per 10 minutes
  mfa: createClientRateLimiter(5, 10 * 60 * 1000),

  // Resend verification: 3 attempts per 1 hour
  resendVerification: createClientRateLimiter(3, 60 * 60 * 1000),

  // Processing: 10 per minute
  processing: createClientRateLimiter(10, 60 * 1000),

  // Queries/Benchmark: 30 per hour
  queries: createClientRateLimiter(30, 60 * 60 * 1000),
};

/**
 * Helper to show rate limit error to user
 * @param {string} message Error message
 * @param {number} duration How long to show (ms)
 */
function showRateLimitError(message, duration = 3000) {
  const authStatus = document.getElementById("authStatus");
  if (authStatus) {
    authStatus.textContent = message;
    setTimeout(() => {
      authStatus.textContent = "";
    }, duration);
  } else {
    console.warn("Rate limited:", message);
  }
}

/**
 * Utility to disable a button temporarily with countdown
 * @param {HTMLElement} button The button to disable
 * @param {number} seconds How long to disable for
 */
function disableButtonWithCountdown(button, seconds) {
  const originalText = button.textContent;
  let remaining = seconds;

  button.disabled = true;
  button.textContent = `Wait ${remaining}s...`;

  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      button.textContent = `Wait ${remaining}s...`;
    } else {
      button.disabled = false;
      button.textContent = originalText;
      clearInterval(interval);
    }
  }, 1000);
}

export {
  createClientRateLimiter,
  clientRateLimiters,
  showRateLimitError,
  disableButtonWithCountdown,
};
