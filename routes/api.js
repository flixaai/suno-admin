const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { apiKeyMiddleware } = require('../middleware/auth');
const { generateLimiter, apiLimiter } = require('../middleware/rateLimiter');

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/tmp'),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Apply rate limiter to all API routes
router.use(apiLimiter);

/**
 * POST /api/v1/generate
 * Generate a new song
 */
router.post('/v1/generate', apiKeyMiddleware, generateLimiter, async (req, res) => {
  try {
    const {
      prompt,
      lyrics,
      style,
      title,
      instrumental = false,
      modelVersion = 'v4',
      vocalGender,
      personaId,
      voiceId,
      accountId
    } = req.body;

    if (!prompt && !lyrics) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'Either "prompt" or "lyrics" is required'
      });
    }

    const sunoService = req.app.locals.sunoService;

    const result = await sunoService.generateSong(accountId || null, {
      prompt,
      lyrics,
      style,
      title,
      isCustom: !!(lyrics || style || title),
      instrumental,
      modelVersion,
      vocalGender,
      personaId,
      voiceId
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    logger.error('API generate error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/v1/status/:taskId
 * Check task status
 */
router.get('/v1/status/:taskId', apiKeyMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const sunoService = req.app.locals.sunoService;
    const task = await sunoService.getTaskStatus(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    res.json({
      success: true,
      data: task
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/v1/extend
 * Extend/continue a track
 */
router.post('/v1/extend', apiKeyMiddleware, generateLimiter, async (req, res) => {
  try {
    const { audioId, prompt, continueAt, accountId } = req.body;

    if (!audioId) {
      return res.status(400).json({ error: '"audioId" is required' });
    }

    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.extendTrack(audioId, prompt, continueAt, accountId);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/remix
 * Create a remix/cover
 */
router.post('/v1/remix', apiKeyMiddleware, generateLimiter, async (req, res) => {
  try {
    const { audioId, newStyle, accountId } = req.body;

    if (!audioId || !newStyle) {
      return res.status(400).json({ error: '"audioId" and "newStyle" are required' });
    }

    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.createRemixOrCover(audioId, newStyle, accountId);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/stems
 * Separate stems (vocals & instruments)
 */
router.post('/v1/stems', apiKeyMiddleware, async (req, res) => {
  try {
    const { audioId, accountId } = req.body;

    if (!audioId) {
      return res.status(400).json({ error: '"audioId" is required' });
    }

    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.separateStems(audioId, accountId);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/concat
 * Concatenate/extend song
 */
router.post('/v1/concat', apiKeyMiddleware, generateLimiter, async (req, res) => {
  try {
    const { clipId, options, accountId } = req.body;

    if (!clipId) {
      return res.status(400).json({ error: '"clipId" is required' });
    }

    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.concatSong(clipId, options || {}, accountId);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/upload
 * Upload audio and infill
 */
router.post('/v1/upload', apiKeyMiddleware, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const options = JSON.parse(req.body.options || '{}');
    const accountId = req.body.accountId;

    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.uploadAudioAndInfill(req.file.path, options, accountId);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/accounts
 * List all accounts (masked)
 */
router.get('/v1/accounts', apiKeyMiddleware, async (req, res) => {
  try {
    const accounts = req.app.locals.accountManager.getAllAccounts();
    res.json({
      success: true,
      data: accounts.map(a => ({
        id: a.id,
        email: a.email,
        statusProxy: a.statusProxy,
        statusCookie: a.statusCookie,
        creditsLeft: a.creditsLeft
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/credits
 * Get total available credits
 */
router.get('/v1/credits', apiKeyMiddleware, async (req, res) => {
  try {
    const accounts = req.app.locals.accountManager.getAllAccounts();
    const activeAccounts = accounts.filter(a => a.statusCookie === 'active');
    const totalCredits = activeAccounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0);

    res.json({
      success: true,
      data: {
        totalCredits,
        activeAccounts: activeAccounts.length,
        breakdown: activeAccounts.map(a => ({
          id: a.id,
          credits: a.creditsLeft
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;