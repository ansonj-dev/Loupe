// routes/photos.js
//
// POST /api/photos/analyze
//   Body: multipart/form-data, field name "images" (1–20 files)
//   Returns: JSON array of scored photos + cluster groupings
//
// POST /api/photos/analyze-one
//   Body: multipart/form-data, field name "image" (single file)
//   Returns: single scored photo object

const express  = require('express');
const sharp    = require('sharp');
const { uploadMany, uploadOne } = require('../middleware/upload');
const { aiLimiter }             = require('../middleware/rateLimiter');
const { callGemini, imageBlock } = require('../utils/gemini');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────

/**
 * Run fast on-server metrics using sharp:
 *  - sharpness via Laplacian standard deviation on greyscale
 *  - exposure (mean luminance)
 *  - perceptual hash for similarity grouping
 */
async function localMetrics(buffer) {
  const meta  = await sharp(buffer).metadata();

  // Greyscale thumbnail for cheap stats
  const { data, info } = await sharp(buffer)
    .resize(200, 200, { fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Mean luminance (exposure)
  let lumSum = 0;
  for (let i = 0; i < data.length; i++) lumSum += data[i];
  const meanLum = lumSum / data.length; // 0–255

  // Laplacian variance (sharpness proxy)
  const w = info.width, h = info.height;
  let lapSum = 0, lapSumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c  = data[y * w + x];
      const t  = data[(y - 1) * w + x];
      const b  = data[(y + 1) * w + x];
      const l  = data[y * w + (x - 1)];
      const r  = data[y * w + (x + 1)];
      const lap = t + b + l + r - 4 * c;
      lapSum   += lap;
      lapSumSq += lap * lap;
      n++;
    }
  }
  const lapMean = lapSum / n;
  const lapVar  = Math.sqrt(Math.max(0, lapSumSq / n - lapMean * lapMean));

  // Perceptual hash (8×8 average hash)
  const { data: hashData } = await sharp(buffer)
    .resize(8, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hashAvg = 0;
  for (let i = 0; i < 64; i++) hashAvg += hashData[i];
  hashAvg /= 64;
  const hash = Array.from(hashData).map(v => (v >= hashAvg ? 1 : 0));

  // Normalise to 0–100 scores
  const sharpScore = Math.round(Math.min(100, (lapVar / 35) * 100));
  const expScore   = Math.round(100 - Math.abs(meanLum - 128) / 128 * 100);

  return {
    sharpScore,
    expScore,
    meanLum,
    lapVar,
    hash,
    width:  meta.width  || 0,
    height: meta.height || 0,
    format: meta.format || 'unknown',
  };
}

/**
 * Ask Gemini to score a single photo with comprehensive professional photography criteria.
 * Evaluates 25+ quality factors including technical quality, composition, aesthetics, and more.
 * Returns parsed JSON or graceful fallback.
 */
async function aiScore(buffer, mimeType) {
  const prompt = `You are a PROFESSIONAL PHOTO EDITOR and QUALITY ANALYST. Analyze this image comprehensively across ALL quality dimensions.

EVALUATE THESE FACTORS:

📸 TECHNICAL QUALITY (40%):
- Sharpness / Focus (overall and subject-specific)
- Motion Blur presence and severity
- Exposure Quality (histogram balance, not too dark/bright)
- Color Accuracy & White Balance
- Contrast Quality and tonal range
- Noise / Grain Level
- Resolution / Detail Level
- Dynamic Range

👤 SUBJECT QUALITY (30% - if applicable):
- Face Sharpness (eyes, facial details)
- Face Orientation (looking at camera vs away)
- Eyes Open Detection
- Smile / Expression Quality
- Facial Occlusion (hands, objects, hair blocking face)
- Subject Visibility and clarity
- Subject separation from background

🎨 COMPOSITION & AESTHETICS (20%):
- Composition Score (rule of thirds, golden ratio, framing)
- Background Quality (distraction level, bokeh, context)
- Subject Centering and positioning
- Cropping Quality (nothing cut off improperly)
- Leading lines, symmetry, balance
- Color Harmony and palette
- Lighting quality and direction

✨ OVERALL APPEAL (10%):
- Aesthetic Quality (artistic value)
- Emotional Impact (does it evoke feeling?)
- Professional Photography Score
- Shareability / Social Media readiness
- Uniqueness vs generic/repetitive

🔍 DUPLICATE & SIMILARITY:
- Is this likely a burst/duplicate of another shot?
- Any obvious repetition patterns?

---

RETURN **ONLY** THIS EXACT JSON (no markdown, no explanation):

{
  "quality_score": <0-100 integer, composite of all factors>,
  "keeper": <true/false - would a professional keep this?>,
  "category": "<string: portrait|landscape|product|food|architecture|abstract|animal|other>",
  "technical_scores": {
    "sharpness": <0-100>,
    "focus": <0-100>,
    "exposure": <0-100>,
    "color_accuracy": <0-100>,
    "contrast": <0-100>,
    "noise_level": <0-100, higher = cleaner>,
    "resolution": <0-100>,
    "dynamic_range": <0-100>
  },
  "subject_scores": {
    "face_sharpness": <0-100 or null if no face>,
    "eyes_open": <true/false/null>,
    "expression_quality": <0-100 or null>,
    "occlusion": <0-100, higher = less occluded>,
    "orientation": <"frontal"|"profile"|"back"|"none">
  },
  "composition_scores": {
    "overall": <0-100>,
    "rule_of_thirds": <0-100>,
    "background": <0-100, higher = cleaner>,
    "centering": <0-100>,
    "cropping": <0-100>,
    "balance": <0-100>
  },
  "aesthetic_scores": {
    "overall": <0-100>,
    "emotional_impact": <0-100>,
    "professional_grade": <0-100>,
    "social_media_ready": <0-100>
  },
  "issues": [<array of: "blurry","motion_blur","underexposed","overexposed","out_of_focus","bad_composition","duplicate_likely","noise","grainy","color_cast","facial_occlusion","eyes_closed","cut_off","distracted_bg","low_resolution","compressed","washed_out","too_dark","overprocessed">],
  "highlights": [<array of strengths: "sharp_subject","perfect_focus","excellent_exposure","vibrant_colors","clean_background","great_composition","professional_lighting","emotional","unique","rule_of_thirds","well_framed","good_expression","natural_colors","high_detail","perfect_moment","creative","aesthetic">],
  "reason": "<one sentence, max 15 words, explaining keeper status>"
}

SCORING RULES:
- Be STRICT: Only truly excellent photos score >80
- Be HONEST: Bad photos should score <40
- Keeper = true ONLY if you'd actually share/post it
- If portrait: Weight face/expression heavily
- If landscape: Weight composition/lighting heavily
- If product: Weight clarity/detail/lighting heavily
- Duplicates: Analyze individually but flag if obvious burst

RESPOND WITH JSON ONLY.`;

  try {
    const raw   = await callGemini([imageBlock(buffer, mimeType), { text: prompt }], 1000);
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('AI scoring error:', err.message);
    return {
      quality_score: null,
      keeper: null,
      category: 'other',
      technical_scores: {},
      subject_scores: {},
      composition_scores: {},
      aesthetic_scores: {},
      issues: [],
      highlights: [],
      reason: 'AI scoring unavailable',
    };
  }
}

/**
 * Group photos by perceptual similarity (hamming distance on avg hash).
 */
function buildClusters(metrics, threshold = 12) {
  const ids = metrics.map(() => null);
  let next = 0;
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const dist = metrics[i].hash.reduce((acc, bit, k) => acc + (bit !== metrics[j].hash[k] ? 1 : 0), 0);
      if (dist <= threshold) {
        if (ids[i] === null && ids[j] === null) { ids[i] = next; ids[j] = next; next++; }
        else if (ids[i] === null) ids[i] = ids[j];
        else if (ids[j] === null) ids[j] = ids[i];
      }
    }
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────
//  POST /api/photos/analyze  — full batch
// ─────────────────────────────────────────────────────────────
router.post('/analyze', aiLimiter, uploadMany, async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded. Send files under the "images" field.' });
  }

  try {
    // 1. Local metrics for all photos in parallel (fast, free)
    const metricsArr = await Promise.all(files.map(f => localMetrics(f.buffer)));

    // 2. Cluster similar shots
    const clusterIds = buildClusters(metricsArr);

    // 3. AI scoring — cap concurrency at 4 to avoid hammering the API
    const CONCURRENCY = 4;
    const aiResults   = new Array(files.length).fill(null);

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const slice  = files.slice(i, i + CONCURRENCY);
      const scored = await Promise.all(
        slice.map((f, j) => aiScore(f.buffer, f.mimetype).then(r => [i + j, r]))
      );
      scored.forEach(([idx, result]) => { aiResults[idx] = result; });
    }

    // 4. Merge and produce final composite score
    const results = files.map((file, i) => {
      const m  = metricsArr[i];
      const ai = aiResults[i];

      // Blend: 40% local signal + 60% AI quality (when available)
      const localScore = Math.round(0.5 * m.sharpScore + 0.5 * m.expScore);
      const composite  = ai.quality_score !== null
        ? Math.round(0.4 * localScore + 0.6 * ai.quality_score)
        : localScore;

      const keeper = ai.keeper !== null ? ai.keeper : composite >= 55;

      return {
        filename:       file.originalname,
        index:          i,
        cluster_id:     clusterIds[i],
        score:          composite,
        local_score:    localScore,
        ai_score:       ai.quality_score,
        keeper,
        category:       ai.category || 'other',
        
        // Detailed scoring breakdown
        technical_scores:   ai.technical_scores || {},
        subject_scores:     ai.subject_scores || {},
        composition_scores: ai.composition_scores || {},
        aesthetic_scores:   ai.aesthetic_scores || {},
        
        issues:         ai.issues     || [],
        highlights:     ai.highlights || [],
        reason:         ai.reason     || '',
        
        // Local metrics (fast, on-device)
        sharpness:      m.sharpScore,
        exposure:       m.expScore,
        mean_luminance: Math.round(m.meanLum),
        dimensions:     { width: m.width, height: m.height },
        format:         m.format,
      };
    });

    // 5. Within each cluster, keep only the best-scoring shot
    const clusterBest = {};
    results.forEach(r => {
      if (r.cluster_id === null) return;
      if (!clusterBest[r.cluster_id] || r.score > clusterBest[r.cluster_id].score) {
        clusterBest[r.cluster_id] = r;
      }
    });
    results.forEach(r => {
      if (r.cluster_id !== null && clusterBest[r.cluster_id] !== r) {
        r.keeper = false;
        r.cluster_best = false;
      } else if (r.cluster_id !== null) {
        r.cluster_best = true;
      }
    });

    // 6. Build summary
    const keepers  = results.filter(r => r.keeper);
    const clusters = [...new Set(results.map(r => r.cluster_id).filter(c => c !== null))];

    res.json({
      total:         results.length,
      keepers_count: keepers.length,
      blurry_count:  results.filter(r => r.issues.includes('blurry') || r.issues.includes('out_of_focus')).length,
      cluster_count: clusters.length,
      top_picks:     [...keepers].sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.index),
      photos:        results,
    });

  } catch (err) {
    console.error('[/photos/analyze]', err);
    res.status(err.status || 500).json({ error: err.message || 'Photo analysis failed.' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/photos/analyze-one  — single photo (auto-scan)
// ─────────────────────────────────────────────────────────────
router.post('/analyze-one', aiLimiter, uploadOne, async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No image uploaded. Send a single file under the "image" field.' });
  }

  try {
    const [m, ai] = await Promise.all([
      localMetrics(file.buffer),
      aiScore(file.buffer, file.mimetype),
    ]);

    const localScore = Math.round(0.5 * m.sharpScore + 0.5 * m.expScore);
    const composite  = ai.quality_score !== null
      ? Math.round(0.4 * localScore + 0.6 * ai.quality_score)
      : localScore;

    res.json({
      filename:       file.originalname,
      score:          composite,
      keeper:         ai.keeper !== null ? ai.keeper : composite >= 55,
      category:       ai.category || 'other',
      
      // Detailed scoring breakdown
      technical_scores:   ai.technical_scores || {},
      subject_scores:     ai.subject_scores || {},
      composition_scores: ai.composition_scores || {},
      aesthetic_scores:   ai.aesthetic_scores || {},
      
      issues:         ai.issues     || [],
      highlights:     ai.highlights || [],
      reason:         ai.reason     || '',
      
      // Local metrics
      sharpness:      m.sharpScore,
      exposure:       m.expScore,
      mean_luminance: Math.round(m.meanLum),
      dimensions:     { width: m.width, height: m.height },
      format:         m.format,
    });
  } catch (err) {
    console.error('[/photos/analyze-one]', err);
    res.status(err.status || 500).json({ error: err.message || 'Photo scoring failed.' });
  }
});

module.exports = router;
