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

// MESIN STREAMING & DOWNLOADER MP3 UNLIMITED
router.get('/v1/audio/:audioId', async (req, res) => {
  const { audioId } = req.params;
  const { download, title } = req.query;

  // Jalur Resmi Suno CDN & Audiopipe
  const mirrors = [
    `https://audiopipe.suno.ai/track/${audioId}.mp3`,
    `https://cdn1.suno.ai/${audioId}.mp3`,
    `https://cdn2.suno.ai/${audioId}.mp3`
  ];

  for (const url of mirrors) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://suno.com/',
          'Origin': 'https://suno.com'
        },
        timeout: 25000
      });

      if (download === 'true') {
        const safeTitle = (title || 'suno_song').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle || 'music'}.mp3"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      return response.data.pipe(res);
    } catch (err) {}
  }

  res.status(404).send('Audio file not ready');
});

router.use(apiLimiter);

router.post('/v1/generate', apiKeyMiddleware, generateLimiter, async (req, res) => {
  try {
    const { prompt, lyrics, style, title, instrumental = false, modelVersion = 'v6-mini', accountId } = req.body;
    const sunoService = req.app.locals.sunoService;
    const result = await sunoService.generateSong(accountId || null, {
      prompt, lyrics, style, title, isCustom: !!(lyrics || style || title), instrumental, modelVersion
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/v1/status/:taskId', apiKeyMiddleware, async (req, res) => {
  try {
    const sunoService = req.app.locals.sunoService;
    const task = await sunoService.getTaskStatus(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/v1/accounts', apiKeyMiddleware, async (req, res) => {
  try {
    const accounts = req.app.locals.accountManager.getAllAccounts();
    res.json({
      success: true,
      data: accounts.map(a => ({ id: a.id, email: a.email, statusCookie: a.statusCookie, creditsLeft: a.creditsLeft }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;