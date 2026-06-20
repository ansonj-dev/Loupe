// utils/gemini.js — Gemini AI wrapper with multi-key fallback

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// Parse API keys (supports comma-separated multiple keys)
const API_KEYS = (process.env.GEMINI_API_KEY || '')
  .split(',')
  .map(k => k.trim())
  .filter(k => k.length > 0);

let currentKeyIndex = 0; // Track which API key to use

function getModel(maxOutputTokens = 1024) {
  if (API_KEYS.length === 0) {
    throw new GeminiError('GEMINI_API_KEY is not set', 500);
  }
  
  const apiKey = API_KEYS[currentKeyIndex];
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: { maxOutputTokens },
  });
}

/**
 * Rotate to next API key when quota exceeded
 */
function rotateApiKey() {
  if (API_KEYS.length <= 1) return false;
  
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log(`🔄 Rotating to API key ${currentKeyIndex + 1}/${API_KEYS.length}`);
  return true;
}

/**
 * Check if error is quota/rate limit related
 */
function isQuotaError(error) {
  const msg = error?.message || '';
  return msg.includes('quota') || 
         msg.includes('429') || 
         msg.includes('RESOURCE_EXHAUSTED') ||
         msg.includes('rate limit');
}

/**
 * Call Gemini with an array of parts (text and/or inlineData).
 * Automatically tries next API key if quota exceeded.
 * Retries up to 3 times per key with exponential back-off.
 * @param {Array}  parts
 * @param {number} [maxOutputTokens]
 * @returns {Promise<string>}
 */
async function callGemini(parts, maxOutputTokens = 1024) {
  const maxKeysToTry = API_KEYS.length;
  let keysTriedCount = 0;
  
  while (keysTriedCount < maxKeysToTry) {
    const model = getModel(maxOutputTokens);
    let lastError;

    // Try current key with retries
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await model.generateContent(parts);
        return result.response.text();
      } catch (err) {
        lastError = err;
        
        // If quota error, try next key immediately
        if (isQuotaError(err)) {
          console.warn(`⚠ API key ${currentKeyIndex + 1} quota exceeded`);
          if (rotateApiKey()) {
            keysTriedCount++;
            break; // Break retry loop, try next key
          }
        }
        
        // For other errors, retry with backoff
        if (attempt < 3) await sleep(attempt * 1000);
      }
    }
    
    // If we exhausted retries on this key without quota error, throw
    if (lastError && !isQuotaError(lastError)) {
      throw lastError;
    }
    
    keysTriedCount++;
  }
  
  // All keys exhausted
  throw new GeminiError(
    `All ${API_KEYS.length} API key(s) exhausted. Please try again later.`,
    429
  );
}

/**
 * Streaming version — yields string tokens one by one.
 * Also supports API key rotation on quota errors.
 * @param {Array} parts
 * @param {number} [maxOutputTokens]
 * @returns {AsyncGenerator<string>}
 */
async function* streamGemini(parts, maxOutputTokens = 1024) {
  const maxKeysToTry = API_KEYS.length;
  let keysTriedCount = 0;
  
  while (keysTriedCount < maxKeysToTry) {
    try {
      const model = getModel(maxOutputTokens);
      const result = await model.generateContentStream(parts);
      
      for await (const chunk of result.stream) {
        const token = chunk.text();
        if (token) yield token;
      }
      
      return; // Success, exit
      
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(`⚠ API key ${currentKeyIndex + 1} quota exceeded (stream)`);
        if (rotateApiKey()) {
          keysTriedCount++;
          continue; // Try next key
        }
      }
      throw err; // Non-quota error or no more keys
    }
  }
  
  throw new GeminiError(
    `All ${API_KEYS.length} API key(s) exhausted. Please try again later.`,
    429
  );
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

// Log configuration on startup
console.log(`🔑 Loaded ${API_KEYS.length} Gemini API key(s)`);
console.log(`📦 Using model: ${MODEL_NAME}`);

module.exports = { callGemini, streamGemini, imageBlock, GeminiError };
