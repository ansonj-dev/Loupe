// middleware/rateLimiter.js

const rateLimit = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const max      = parseInt(process.env.RATE_LIMIT_MAX       || '60',    10);

function makeHandler(message) {
  return (_req, res) =>
    res.status(429).json({ error: message });
}

// General API limit (60 req / min per IP by default)
const apiLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: makeHandler('Too many requests. Please slow down.'),
});

// Stricter limit for AI endpoints (they're expensive)
const aiLimiter = rateLimit({
  windowMs,
  max: Math.max(1, Math.floor(max / 4)), // 25% of general limit
  standardHeaders: true,
  legacyHeaders:   false,
  handler: makeHandler('AI request limit reached. Try again in a minute.'),
});

module.exports = { apiLimiter, aiLimiter };
