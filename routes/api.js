const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const { apiKeyMiddleware } = require('../middleware/auth');
const { generateLimiter, apiLimiter } = require('../middleware/rateLimiter');

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/tmp'),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// =========================================================================
// FITUR BARU: MESIN STREAMING & DOWNLOADER UNLIMITED (BEBAS BLOKIR)
// Bisa dipanggil oleh Web Admin maupun Website Utama Anda nanti
// Endpoint: GET /api/v1/audio/:audioId?download=true&title=JudulLagu
// =========================================================================
router.get('/v1/audio/:audioId', async (req, res) => {
  const { audioId } = req.params;
  const { download, title } = req.query;

  // Daftar CDN Mirror Resmi Suno
  const mirrors = [
    `https://cdn1.suno.ai/${audioId}.mp3`,
    `https://audiopipe.suno.ai/track/${audioId}.mp3`,
    `https://cdn2.suno.ai/${audioId}.mp3`
  ];

  for (const url of mirrors) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://suno.com/',
          'Origin': 'https://suno.com'
        },
        timeout: 20000
      });

      if (download === 'true') {
        const safeTitle = (title || 'suno_song').replace(/[^a-zA-Z0-9_-]/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      return response.data.pipe(res);
    } catch (err) {
      // Coba mirror berikutnya jika CDN 1 sibuk
    }
  }

  res.status(404).json({ error: 'Audio file not ready or not found on Suno CDN' });
});

// Apply rate limiter to other API routes
router.use(apiLimiter);

/**
 * POST /api/v1/generate
 */
router.post('/v1/generate', apiKeyMiddleware, generateLimiter, async (req, res) => {
  try {
    const { prompt, lyrics, style, title, instrumental = false, modelVersion = 'v6-mini', accountId } = req.body;

    if (!prompt && !lyrics) {
      return res.status(400).json({ error: 'Missing required field', message: 'Either "prompt" or "lyrics" is required' });
    }

    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.generateSong(accountId || null, {
      prompt,
      lyrics,
      style,
      title,
      isCustom: !!(lyrics || style || title),
      instrumental,
      modelVersion
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('API generate error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/status/:taskId
 */
router.get('/v1/status/:taskId', apiKeyMiddleware, async (req, res) => {
  try {
    const { taskId } = req.params;
    const sunoService = req.app.locals.sunoService;
    const task = await sunoService.getTaskStatus(taskId);

    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/accounts
 */
router.get('/v1/accounts', apiKeyMiddleware, async (req, res) => {
  try {
    const accounts = req.app.locals.accountManager.getAllAccounts();
    res.json({
      success: true,
      data: accounts.map(a => ({
        id: a.id,
        email: a.email,
        statusCookie: a.statusCookie,
        creditsLeft: a.creditsLeft
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;