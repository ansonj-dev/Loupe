// server.js — Loupe API server

require('dotenv').config();

const express        = require('express');
const cors           = require('cors');
const { apiLimiter } = require('./middleware/rateLimiter');
const photosRouter   = require('./routes/photos');
const notesRouter    = require('./routes/notes');

const app  = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─────────────────────────────────────────────────────────────
//  Trust proxy (needed when running behind Render / Railway / etc.)
// ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
//  CORS
// ─────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─────────────────────────────────────────────────────────────
//  Body parsing
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─────────────────────────────────────────────────────────────
//  General rate limit on all /api/* routes
// ─────────────────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ─────────────────────────────────────────────────────────────
//  Health / readiness check
// ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'loupe-api',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    env: {
      node:        process.version,
      gemini_key:  process.env.GEMINI_API_KEY ? '✓ set' : '✗ missing',
    },
  });
});

// ─────────────────────────────────────────────────────────────
//  API routes
// ─────────────────────────────────────────────────────────────
app.use('/api/photos', photosRouter);
app.use('/api/notes',  notesRouter);

// ─────────────────────────────────────────────────────────────
//  404 handler
// ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: 'Not found',
    hint:  'Available: POST /api/photos/analyze, POST /api/photos/analyze-one, POST /api/notes/scan, POST /api/notes/scan-stream',
  });
});

// ─────────────────────────────────────────────────────────────
//  Global error handler
// ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[${status}] ${message}`, err.stack || '');
  }

  res.status(status).json({ error: message });
});

// ─────────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌────────────────────────────────────┐
  │   Loupe API  →  http://localhost:${PORT}  │
  │                                    │
  │   POST  /api/photos/analyze        │
  │   POST  /api/photos/analyze-one    │
  │   POST  /api/notes/scan            │
  │   POST  /api/notes/scan-stream     │
  │   GET   /health                    │
  └────────────────────────────────────┘
  `);

  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠  GEMINI_API_KEY is not set — AI scoring will fail. Add it to backend/.env');
  }
});

module.exports = app;
