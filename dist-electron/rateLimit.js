/**
 * Rate limiting utility for protecting IPC handlers and endpoints
 * from brute force attacks and resource exhaustion.
 */
/**
 * Creates a rate limiter for a specific action/endpoint
 * @param config Configuration for the rate limiter
 * @returns Rate limit checker function
 */
export function createRateLimiter(config) {
    const store = new Map();
    const { maxRequests, windowMs, message = `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.round(windowMs / 1000)} seconds.`, keyGenerator = (key) => key, } = config;
    // Cleanup expired entries every minute
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            if (entry.resetTime < now) {
                store.delete(key);
            }
        }
    }, 60000);
    return {
        /**
         * Check if a request should be allowed
         * @param key Identifier for the rate limit (e.g., email, userId, IP)
         * @returns Object with isAllowed boolean and remaining requests
         */
        check: (key) => {
            const normalizedKey = keyGenerator(key);
            const now = Date.now();
            let entry = store.get(normalizedKey);
            if (!entry || now >= entry.resetTime) {
                // Create new entry
                entry = {
                    count: 1,
                    resetTime: now + windowMs,
                };
                store.set(normalizedKey, entry);
                return {
                    isAllowed: true,
                    remaining: maxRequests - 1,
                    resetTime: entry.resetTime,
                };
            }
            // Existing entry, increment count
            entry.count++;
            const isAllowed = entry.count <= maxRequests;
            return {
                isAllowed,
                remaining: Math.max(0, maxRequests - entry.count),
                resetTime: entry.resetTime,
                message: isAllowed ? undefined : message,
            };
        },
        /**
         * Reset the rate limit for a specific key
         */
        reset: (key) => {
            const normalizedKey = keyGenerator(key);
            store.delete(normalizedKey);
        },
        /**
         * Clear all entries
         */
        clear: () => {
            store.clear();
        },
        /**
         * Cleanup interval for automatic garbage collection
         */
        destroy: () => {
            clearInterval(cleanupInterval);
            store.clear();
        },
    };
}
/**
 * Pre-configured rate limiters for common authentication scenarios
 */
export const rateLimiters = {
    // Max 5 login attempts per 15 minutes per email
    authLogin: createRateLimiter({
        maxRequests: 5,
        windowMs: 15 * 60 * 1000, // 15 minutes
        message: "Too many login attempts. Please try again in 15 minutes.",
        keyGenerator: (email) => `login:${email.toLowerCase().trim()}`,
    }),
    // Max 3 registration attempts per 1 hour per email
    authRegister: createRateLimiter({
        maxRequests: 3,
        windowMs: 60 * 60 * 1000, // 1 hour
        message: "Too many registration attempts. Please try again in 1 hour.",
        keyGenerator: (email) => `register:${email.toLowerCase().trim()}`,
    }),
    // Max 5 MFA verification attempts per 10 minutes per user
    authMfaVerify: createRateLimiter({
        maxRequests: 5,
        windowMs: 10 * 60 * 1000, // 10 minutes
        message: "Too many MFA verification attempts. Please try again in 10 minutes.",
        keyGenerator: (userId) => `mfa-verify:${userId}`,
    }),
    // Max 3 verification email resends per 1 hour per email
    authResendVerification: createRateLimiter({
        maxRequests: 3,
        windowMs: 60 * 60 * 1000, // 1 hour
        message: "Too many verification email resends. Please try again in 1 hour.",
        keyGenerator: (email) => `resend-verify:${email.toLowerCase().trim()}`,
    }),
    // Max 3 password reset requests per 1 hour per email
    authPasswordReset: createRateLimiter({
        maxRequests: 3,
        windowMs: 60 * 60 * 1000, // 1 hour
        message: "Too many password reset attempts. Please try again in 1 hour.",
        keyGenerator: (email) => `password-reset:${email.toLowerCase().trim()}`,
    }),
    // Max 10 processing operations per minute per user
    processing: createRateLimiter({
        maxRequests: 10,
        windowMs: 60 * 1000, // 1 minute
        message: "Processing limit exceeded. Please wait before submitting more requests.",
        keyGenerator: (userId) => `processing:${userId}`,
    }),
    // Max 30 ask queries per hour per user (respects user settings but provides API limit)
    askQuery: createRateLimiter({
        maxRequests: 30,
        windowMs: 60 * 60 * 1000, // 1 hour
        message: "Ask limit exceeded. Please wait before submitting more queries.",
        keyGenerator: (userId) => `ask:${userId}`,
    }),
};
/**
 * Helper to create a middleware-like wrapper for IPC handlers
 * @param handler The IPC handler function
 * @param limiter The rate limiter instance
 * @param keyExtractor Function to extract the rate limit key from handler args
 * @returns Wrapped handler with rate limiting
 */
export function withRateLimit(handler, limiter, keyExtractor) {
    return async (...args) => {
        const key = keyExtractor(...args);
        const check = limiter.check(key);
        if (!check.isAllowed) {
            return {
                ok: false,
                reason: check.message || "Rate limit exceeded",
            };
        }
        return handler(...args);
    };
}
/**
 * Helper to check if response is a rate limit error
 */
export function isRateLimitError(response) {
    return response?.ok === false && response?.reason?.includes("Rate limit");
}
