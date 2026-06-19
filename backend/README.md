# Loupe — Backend API

Express.js server that powers the Loupe PWA's two AI features:

| Endpoint | What it does |
|---|---|
| `POST /api/photos/analyze` | Batch photo scoring (up to 20 images) — local sharpness/exposure + Claude vision |
| `POST /api/photos/analyze-one` | Score a single photo (used by auto-scan mode) |
| `POST /api/notes/scan` | OCR a photo of notes → structured Markdown |
| `POST /api/notes/scan-stream` | Same as above but streams tokens via SSE |
| `GET /health` | Readiness check |

---

## Quick start

```bash
# 1. Clone / download this folder
cd loupe-backend

# 2. Install deps
npm install

# 3. Configure
cp .env.example .env
# Then edit .env and paste your Anthropic API key

# 4. Run
npm run dev       # development (auto-restart)
npm start         # production
```

The server starts on `http://localhost:3001` by default.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | — | Your Anthropic API key |
| `PORT` | No | `3001` | Server port |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS origins |
| `MAX_FILE_SIZE_MB` | No | `10` | Max upload size per file (MB) |
| `MAX_PHOTOS_PER_BATCH` | No | `20` | Max images per `/analyze` call |
| `RATE_LIMIT_MAX` | No | `60` | Requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |

---

## API reference

### `POST /api/photos/analyze`

Upload 1–20 images. Field name: `images`.

**Response:**
```json
{
  "total": 6,
  "keepers_count": 2,
  "blurry_count": 1,
  "cluster_count": 1,
  "top_picks": [2, 0],
  "photos": [
    {
      "filename": "IMG_001.jpg",
      "index": 0,
      "cluster_id": null,
      "score": 82,
      "keeper": true,
      "issues": [],
      "highlights": ["sharp subject", "good light"],
      "reason": "Well-exposed portrait with sharp focus",
      "sharpness": 78,
      "exposure": 64,
      "dimensions": { "width": 4032, "height": 3024 }
    }
  ]
}
```

---

### `POST /api/notes/scan`

Upload one image. Field name: `image`. Optional body fields: `style`, `language`.

**Response:**
```json
{
  "markdown": "## Lecture Notes\n\n- Point one\n- Point two",
  "html": "<h2>Lecture Notes</h2><ul><li>Point one</li>...",
  "title": "Lecture Notes",
  "word_count": 156,
  "style_used": "structured",
  "processing_ms": 2341
}
```

---

### `POST /api/notes/scan-stream`

Same params as `/scan`. Returns `text/event-stream` with events:

```
event: start
data: {"style":"structured"}

event: token
data: {"token":"## "}

event: token
data: {"token":"Lecture"}

event: done
data: {"word_count":156,"title":"Lecture Notes","markdown":"...full text..."}
```

---

## Deploying to Render (free tier)

1. Push `loupe-backend/` to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, set **Build command**: `npm install`, **Start command**: `npm start`
4. Under **Environment**, add `ANTHROPIC_API_KEY` and `ALLOWED_ORIGINS` (your Vercel frontend URL)
5. Deploy — you'll get a URL like `https://loupe-api.onrender.com`

Update the frontend: open `loupe/js/notes.js` and `loupe/js/photos.js`, change:
```js
const API_BASE = 'https://loupe-api.onrender.com';
```

Or host a `config.js` file and set `window.LOUPE_API_BASE` before loading the other scripts.

---

## Deploying to Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=sk-ant-...
```

---

## Project structure

```
loupe-backend/
├── server.js              ← Express app, routes wired here
├── package.json
├── .env.example
├── routes/
│   ├── photos.js          ← /api/photos/* (batch + single scoring)
│   └── notes.js           ← /api/notes/* (scan + scan-stream)
├── middleware/
│   ├── upload.js          ← Multer config, file type/size guards
│   └── rateLimiter.js     ← Per-IP rate limits (general + AI tier)
└── utils/
    └── claude.js          ← Anthropic API wrapper with retry logic
```
