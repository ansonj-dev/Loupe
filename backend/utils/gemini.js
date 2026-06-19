// utils/gemini.js — Gemini AI wrapper (replaces Claude)

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL_NAME = 'gemini-1.5-flash';

function getModel(maxOutputTokens = 1024) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY is not set', 500);
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: { maxOutputTokens },
  });
}

/**
 * Call Gemini with an array of parts (text and/or inlineData).
 * Retries up to 3 times with exponential back-off.
 * @param {Array}  parts
 * @param {number} [maxOutputTokens]
 * @returns {Promise<string>}
 */
async function callGemini(parts, maxOutputTokens = 1024) {
  const model = getModel(maxOutputTokens);
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent(parts);
      return result.response.text();
    } catch (err) {
      lastError = err;
      if (attempt < 3) await sleep(attempt * 1000);
    }
  }
  throw lastError || new GeminiError('Gemini API request failed after retries', 502);
}

/**
 * Streaming version — yields string tokens one by one.
 * @param {Array} parts
 * @param {number} [maxOutputTokens]
 * @returns {AsyncGenerator<string>}
 */
async function* streamGemini(parts, maxOutputTokens = 1024) {
  const model = getModel(maxOutputTokens);
  const result = await model.generateContentStream(parts);
  for await (const chunk of result.stream) {
    const token = chunk.text();
    if (token) yield token;
  }
}

/**
 * Build an inlineData image part from a Buffer.
 * @param {Buffer} buffer
 * @param {string} mimeType  e.g. 'image/jpeg'
 * @returns {object}
 */
function imageBlock(buffer, mimeType) {
  return {
    inlineData: {
      mimeType: sanitiseMime(mimeType),
      data: buffer.toString('base64'),
    },
  };
}

function sanitiseMime(mime) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const clean = (mime || '').toLowerCase().split(';')[0].trim();
  return allowed.includes(clean) ? clean : 'image/jpeg';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class GeminiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

module.exports = { callGemini, streamGemini, imageBlock, GeminiError };
