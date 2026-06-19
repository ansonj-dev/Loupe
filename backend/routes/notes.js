// routes/notes.js
//
// POST /api/notes/scan
//   Body: multipart/form-data
//     - image: file (required)
//     - style: "structured" | "bullets" | "prose" | "summary" (optional)
//     - language: ISO 639-1 code, e.g. "en" | "ml" | "hi" (optional, default: auto-detect)
//
// POST /api/notes/scan-stream
//   Same as above but streams tokens via Server-Sent Events

const express  = require('express');
const sharp    = require('sharp');
const { uploadOne }               = require('../middleware/upload');
const { aiLimiter }               = require('../middleware/rateLimiter');
const { callGemini, streamGemini, imageBlock } = require('../utils/gemini');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
//  Style → prompt map
// ─────────────────────────────────────────────────────────────
const STYLE_PROMPTS = {
  structured: `
Extract ALL text content from this image and format it as well-structured Markdown notes:
- Use ## for major headings, ### for subheadings
- Use bullet points (- ) for lists and enumerated items
- Preserve any numbered lists as numbered lists
- Bold (**text**) any terms that look like key vocabulary or definitions
- Group related information under the appropriate heading
- Correct obvious spelling errors from the original
- If a formula or equation appears, render it as a code block
`.trim(),

  bullets: `
Extract ALL text from this image and reformat it as a flat bullet-point list using - for each item.
- Each bullet should be a single, self-contained idea
- Group closely-related items under a short bold heading like **Topic**
- Remove duplication
- Correct obvious spelling errors
`.trim(),

  prose: `
Extract ALL text from this image and rewrite it as clean, flowing prose paragraphs.
- Use ## headings only for distinct topic changes
- Combine short disconnected fragments into coherent sentences
- Correct grammar and spelling from the original handwriting
- Maintain the original meaning precisely — do not summarise or omit information
`.trim(),

  summary: `
Read all the content in this image and produce a concise summary:
- Open with a single sentence stating the main topic
- Follow with 3–5 short paragraphs, each covering a distinct key point
- Close with a "Key takeaways" section as a short bullet list (3–5 bullets max)
`.trim(),
};

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

async function prepareImage(buffer) {
  return sharp(buffer)
    .rotate()                                              // honour EXIF orientation
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 88 })
    .toBuffer();
}

function mdToHtml(md) {
  return md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (/^<h[1-6]>/.test(block)) return block;
      if (/^- /.test(block)) {
        const items = block.split('\n').filter(l => l.startsWith('- '))
          .map(l => `<li>${l.slice(2)}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      if (/^\d+\. /.test(block)) {
        const items = block.split('\n').filter(l => /^\d+\. /.test(l))
          .map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
        return `<ol>${items}</ol>`;
      }
      return `<p>${block.replace(/\n/g, ' ')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function extractTitle(markdown) {
  const headingMatch = markdown.match(/^#{1,3} (.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = markdown.split('\n').find(l => l.trim());
  return firstLine ? firstLine.replace(/^[#\-*\d. ]+/, '').slice(0, 60).trim() : 'Scanned notes';
}

function buildSystemPrompt(language) {
  const langInstruction = language === 'auto'
    ? 'Detect the language of the notes and respond in that same language.'
    : `The notes may be in multiple languages. Produce your output in ${language}.`;

  return `You are an expert note-transcription and document-formatting assistant. You receive photos of handwritten notes, whiteboards, printed pages, or any text-bearing surface.

Your rules:
1. Extract EVERY piece of text visible in the image — miss nothing.
2. ${langInstruction}
3. Return ONLY the formatted content as clean Markdown. No preamble ("Here are your notes:"), no closing remarks, no code fences.
4. If the image contains NO readable text, return exactly: _No readable text found in this image._`;
}

// ─────────────────────────────────────────────────────────────
//  POST /api/notes/scan
// ─────────────────────────────────────────────────────────────
router.post('/scan', aiLimiter, uploadOne, async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No image uploaded. Send an image file under the "image" field.' });
  }

  const style    = ['structured', 'bullets', 'prose', 'summary'].includes(req.body.style)
    ? req.body.style : 'structured';
  const language = req.body.language || 'auto';
  const t0       = Date.now();

  try {
    const imageBuffer = await prepareImage(file.buffer);
    const systemNote  = buildSystemPrompt(language);
    const userPrompt  = `${systemNote}\n\n${STYLE_PROMPTS[style]}`;

    const markdown = await callGemini(
      [imageBlock(imageBuffer, 'image/jpeg'), { text: userPrompt }],
      1024,
    );

    const html      = mdToHtml(markdown);
    const wordCount = markdown.split(/\s+/).filter(Boolean).length;
    const title     = extractTitle(markdown);

    res.json({
      markdown,
      html,
      title,
      word_count:          wordCount,
      style_used:          style,
      processing_ms:       Date.now() - t0,
      original_filename:   file.originalname,
      original_size_bytes: file.size,
    });

  } catch (err) {
    console.error('[/notes/scan]', err);
    res.status(err.status || 500).json({ error: err.message || 'Notes scan failed.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/notes/scan-stream — streaming via SSE
// ─────────────────────────────────────────────────────────────
router.post('/scan-stream', aiLimiter, uploadOne, async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No image uploaded.' });
  }

  const style = ['structured', 'bullets', 'prose', 'summary'].includes(req.body.style)
    ? req.body.style : 'structured';

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const imageBuffer = await prepareImage(file.buffer);
    const systemNote  = buildSystemPrompt(req.body.language || 'auto');
    const userPrompt  = `${systemNote}\n\n${STYLE_PROMPTS[style]}`;

    send({ style });

    let fullText = '';
    for await (const token of streamGemini(
      [imageBlock(imageBuffer, 'image/jpeg'), { text: userPrompt }],
      1024,
    )) {
      fullText += token;
      send({ token });
    }

    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    send({
      markdown:   fullText,
      word_count: wordCount,
      title:      extractTitle(fullText),
    });

  } catch (err) {
    console.error('[/notes/scan-stream]', err);
    send({ message: err.message || 'Streaming scan failed.' });
  } finally {
    res.end();
  }
});

module.exports = router;
