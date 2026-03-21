# Rate Limiting Documentation

## Overview

Rate limiting has been implemented across the Memora application to prevent brute force attacks, resource exhaustion, and system overload. The implementation uses a **two-layer approach**:

1. **Client-side rate limiting** - Immediate, responsive feedback to users
2. **Server-side rate limiting** - Authoritative protection against abuse

## Architecture

### Server-Side Rate Limiting (`electron/rateLimit.ts`)

A configurable rate limiting module that tracks requests in memory using a time-window strategy.

**Key Features:**
- In-memory storage with automatic cleanup (garbage collection every minute)
- Configurable max requests per time window
- Custom key normalization (e.g., email lowercasing)
- Per-endpoint, per-user, or per-action rate limiters

**Pre-configured Rate Limiters:**

| Limiter | Limit | Window | Purpose |
|---------|-------|--------|---------|
| `authLogin` | 5 attempts | 15 minutes | Prevent brute force login attacks |
| `authRegister` | 3 attempts | 1 hour | Prevent account creation spam |
| `authMfaVerify` | 5 attempts | 10 minutes | Prevent MFA brute force |
| `authResendVerification` | 3 attempts | 1 hour | Prevent email spam |
| `processing` | 10 requests | 1 minute | Prevent processing queue overload |
| `askQuery` | 30 queries | 1 hour | API limit for ask/benchmark operations |

### Client-Side Rate Limiting (`app/rateLimitClient.js`)

A lightweight JavaScript module that provides immediate user feedback before making IPC calls.

**Key Features:**
- Same limits as server-side for consistency
- In-memory tracking with automatic expiration
- User-friendly error messages with time remaining
- Integration helpers (button disable with countdown, error display)

## Integration Points

### Backend IPC Handlers (electron/main.ts)

Rate limiting is enforced in the following IPC channel handlers:

```typescript
// Authentication handlers
ipcMain.handle("auth:register", ...)      // Checks authRegister limiter
ipcMain.handle("auth:login", ...)         // Checks authLogin limiter
ipcMain.handle("auth:verifyMfa", ...)     // Checks authMfaVerify limiter
ipcMain.handle("auth:resendVerification", ...)  // Checks authResendVerification limiter

// Processing handlers
ipcMain.handle("processing:rerun", ...)   // Checks processing limiter
ipcMain.handle("benchmark:run", ...)      // Checks askQuery limiter
```

Each handler checks the rate limit **before validation** to prevent timing attacks and immediately return a rate limit error if exceeded.

### Frontend Forms (app/auth.js)

Rate limiting is checked on the client-side before submitting forms:

```javascript
// Login form
const loginLimit = clientRateLimiters.login.check(email);
if (!loginLimit.allowed) {
  showRateLimitError(loginLimit.message);
  return;
}

// Register form
const registerLimit = clientRateLimiters.register.check(email);
if (!registerLimit.allowed) {
  showRateLimitError(registerLimit.message);
  return;
}

// MFA verification
const mfaLimit = clientRateLimiters.mfa.check(challengeId);
if (!mfaLimit.allowed) {
  showRateLimitError(mfaLimit.message);
  return;
}

// Resend verification email
const resendLimit = clientRateLimiters.resendVerification.check(email);
if (!resendLimit.allowed) {
  showRateLimitError(resendLimit.message);
  return;
}
```

## Security Benefits

### 1. **Brute Force Protection**
- Login attempts are limited to 5 per 15 minutes per email
- MFA verification attempts are limited to 5 per 10 minutes
- Prevents attackers from guessing passwords or MFA codes

### 2. **Account Enumeration Prevention**
- All sensitive endpoints (login, register, resend verification) normalize email keys
- Rate limits prevent attackers from discovering valid accounts through timing

### 3. **Resource Protection**
- Processing operations limited to 10 per minute per user
- Ask/benchmark queries limited to 30 per hour per user
- Prevents processing queue from being overwhelmed
- Protects database from excessive query load

### 4. **Email Spam Prevention**
- Verification email resends limited to 3 per hour per email
- Username enumeration attacks harder due to rate limits on registration

### 5. **DOS Attack Mitigation**
- Distributed rate limiting per-user/per-email prevents single attacker from overloading system
- Time-window based tracking with automatic expiration prevents memory bloat

## Implementation Details

### Rate Limit Check Flow

```
User Action
    ↓
Client-side Rate Limit Check
    ├─ BLOCKED → Show error message + exit
    └─ ALLOWED
         ↓
    Send IPC Request
         ↓
    Server-side Rate Limit Check
    ├─ BLOCKED → Return rate limit error
    └─ ALLOWED
         ↓
    Process Request
```

### Error Messages

**Client-side (immediate feedback):**
```
"Too many login attempts. Please try again in 15 minutes."
"Too many registration attempts. Please try again in 1 hour."
"Too many MFA verification attempts. Please try again in 10 minutes."
```

**Server-side (as fallback):**
Same messages are returned if rate limit check passes client-side but fails server-side (potential clock skew or rate limit reset).

### Rate Limit Key Normalization

- **Email-based limiters:** Emails are normalized (lowercased, trimmed)
  - Prevents bypassing limits with email variations (user@email.com vs User@Email.Com)
  
- **User-based limiters:** Use user ID directly
  - Prevents users from exceeding processing limits with multiple sessions

- **Challenge-based limiters:** Use challenge ID for MFA
  - Ties verification attempts to specific login challenge

## Configuration

### Modifying Limits

To change rate limits, edit `electron/rateLimit.ts`:

```typescript
export const rateLimiters = {
  authLogin: createRateLimiter({
    maxRequests: 5,              // Change this
    windowMs: 15 * 60 * 1000,   // Or this
    message: "...",
    keyGenerator: email => `login:${email.toLowerCase().trim()}`,
  }),
  // ...
};
```

**Important:** Keep client-side limits (`app/rateLimitClient.js`) in sync with server-side limits for best UX.

### Adding New Rate Limiters

```typescript
// In electron/rateLimit.ts
export const rateLimiters = {
  // ... existing limiters
  
  myNewAction: createRateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000,
    message: "Too many attempts. Please wait.",
    keyGenerator: userId => `myaction:${userId}`,
  }),
};
```

Then use in IPC handler:

```typescript
ipcMain.handle("my:action", async (_event, payload) => {
  const userId = getActiveUserId();
  const limit = rateLimiters.myNewAction.check(userId);
  
  if (!limit.isAllowed) {
    return { ok: false, reason: limit.message };
  }
  
  // ... process request
});
```

## Monitoring & Debugging

### Checking Rate Limit Status

```javascript
// In client-side code
const status = clientRateLimiters.login.check(email);
console.log(status);
// Output: { allowed: true, remaining: 4, resetTime: 1234567890 }
```

### Resetting Rate Limits

**Server-side:**
```typescript
// For testing/admin purposes
rateLimiters.authLogin.reset("user@example.com");
rateLimiters.authLogin.clear(); // Clear all
```

**Client-side:**
```javascript
clientRateLimiters.login.reset(email);
clientRateLimiters.login.clear(); // Clear all
```

### Memory Management

- Server-side rate limiters automatically clean up expired entries every 60 seconds
- No manual cleanup required for normal operation
- For long-running processes, consider periodic `clear()` in test environments

## Testing

### Manual Testing

1. **Login Rate Limiting:**
   - Attempt to login 6 times in succession
   - Should be blocked on 6th attempt
   - Wait 15 minutes (or clear in dev tools) to retry

2. **Register Rate Limiting:**
   - Attempt to register 4 times in succession with same email
   - Should be blocked on 4th attempt

3. **MFA Rate Limiting:**
   - Attempt MFA verification 6 times with wrong codes
   - Should be blocked on 6th attempt

### Automated Testing

```typescript
import { rateLimiters } from './rateLimit.js';

describe('Rate Limiting', () => {
  it('should block excessive login attempts', () => {
    const email = 'test@example.com';
    
    for (let i = 0; i < 5; i++) {
      const result = rateLimiters.authLogin.check(email);
      expect(result.isAllowed).toBe(true);
    }
    
    const blocked = rateLimiters.authLogin.check(email);
    expect(blocked.isAllowed).toBe(false);
    expect(blocked.message).toContain('Too many login attempts');
  });
});
```

## Recommendations for Production

1. **Monitor Rate Limit Violations:**
   - Log rate limit errors for security auditing
   - Alert on suspicious patterns (many failures from same IP)

2. **Adjust Limits Based on Usage:**
   - Monitor legitimate user patterns
   - Adjust `maxRequests` or `windowMs` if limits are too restrictive

3. **Consider Distribution:**
   - For distributed systems, migrate from in-memory to Redis-based rate limiting
   - Use per-IP rate limiting in addition to per-user for DOS protection

4. **Add Captcha:**
   - Consider adding CAPTCHA after 2-3 failed login attempts
   - Provides additional brute force protection

5. **IP-Based Rate Limiting:**
   - Implement global IP-based rate limits as additional DOS protection
   - Combine with per-user limits for defense in depth

## API Reference

### `createRateLimiter(config)`

Creates a new rate limiter instance.

**Parameters:**
- `config.maxRequests` (number): Maximum requests in the window
- `config.windowMs` (number): Time window in milliseconds
- `config.message` (string, optional): Error message
- `config.keyGenerator` (function, optional): Custom key normalization

**Returns:**
- `check(key)` - Check if request is allowed
- `reset(key)` - Reset specific key
- `clear()` - Clear all entries
- `destroy()` - Cleanup interval and clear all entries

### Pre-configured Limiters

All available as `rateLimiters.{name}`:
- `authLogin`
- `authRegister`
- `authMfaVerify`
- `authResendVerification`
- `processing`
- `askQuery`

## Troubleshooting

### "Rate limit exceeded" on first request
- **Cause:** Clock skew or time window calculation error
- **Solution:** Check system time; restart app

### Rate limits not working
- **Check:** Verify import statement includes `{ rateLimiters }`
- **Check:** Verify limiter is checked before processing
- **Check:** Verify limit configuration has reasonable values

### Users getting blocked legitimately
- **Solution:** Increase `maxRequests` or `windowMs` for that limiter
- **Alternative:** Implement user whitelisting for trusted accounts
