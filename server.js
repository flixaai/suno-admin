require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const winston = require('winston');

// Logger Setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console({ format: winston.format.simple() })]
});
global.logger = logger;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
global.io = io;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Folders Setup
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');

// ==========================================
// 1. DATABASE LOKAL (ACCOUNTS & QUEUE)
// ==========================================
function getAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8') || '[]');
  } catch (e) {}
  return [];
}

function saveAccounts(accounts) {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
  } catch (e) {}
}

function getTasks() {
  try {
    if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8') || '[]');
  } catch (e) {}
  return [];
}

function saveTasks(tasks) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(tasks.slice(-200), null, 2), 'utf-8');
  } catch (e) {}
}

function saveSession(accountId, data) {
  fs.writeFileSync(path.join(SESSIONS_DIR, `${accountId}.json`), JSON.stringify(data, null, 2));
}

function loadSession(accountId) {
  const p = path.join(SESSIONS_DIR, `${accountId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
}

// ==========================================
// 2. MESIN UTAMA SUNO API (OFFICIAL v6-mini)
// ==========================================
const SUNO_API_BASE = 'https://studio-api.prod.suno.com';

function getAxiosConfig(session) {
  return {
    headers: {
      'Authorization': `Bearer ${session.bearerToken}`,
      'Cookie': session.cookies || '',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Origin': 'https://suno.com',
      'Referer': 'https://suno.com/'
    },
    timeout: 45000
  };
}

async function checkCreditsAPI(session) {
  const config = getAxiosConfig(session);
  const res = await axios.get(`${SUNO_API_BASE}/api/billing/info/`, config);
  return res.data?.total_credits_left !== undefined ? res.data.total_credits_left : (res.data?.credits_left || 0);
}

async function getFeedAPI(session) {
  const config = getAxiosConfig(session);
  const res = await axios.get(`${SUNO_API_BASE}/api/feed/`, config);
  const clips = res.data || [];
  return clips.map(c => {
    const durationSec = Math.floor(c.metadata?.duration || 0);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    return {
      id: c.id,
      audioId: c.id,
      title: c.title || 'Untitled Song',
      status: c.status,
      audioUrl: c.audio_url || `https://audiopipe.suno.ai/track/${c.id}.mp3`,
      imageUrl: c.image_url || c.image_large_url || `https://cdn1.suno.ai/image_${c.id}.png`,
      tags: c.metadata?.tags || 'Music',
      model: c.model_name || 'v6-mini',
      duration: durationSec > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : '3:00'
    };
  });
}

async function generateSongAPI(session, options) {
  const config = getAxiosConfig(session);
  const { title, style, lyrics, instrumental } = options;

  let payload = {
    make_instrumental: !!instrumental,
    mv: 'v6-mini' // MURNI MODEL RESMI V6-MINI SUNO
  };

  if (instrumental) {
    payload.prompt = '';
    payload.tags = style || 'Instrumental';
    payload.title = title || 'Untitled Instrumental';
  } else if (lyrics || style || title) {
    payload.prompt = lyrics || 'Song lyrics';
    payload.tags = style || 'Pop';
    payload.title = title || 'Untitled Song';
  } else {
    payload.gpt_description_prompt = prompt || 'Song';
  }

  const res = await axios.post(`${SUNO_API_BASE}/api/generate/v2/`, payload, config);
  return res.data;
}

// ==========================================
// 3. MESIN STREAMING & DOWNLOAD MP3 LOKAL
// ==========================================
app.get('/api/v1/audio/:audioId', async (req, res) => {
  const { audioId } = req.params;
  const { download, title } = req.query;

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
          'Referer': 'https://suno.com/'
        },
        timeout: 25000
      });

      if (download === 'true') {
        const safeTitle = (title || 'suno_music').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle || 'song'}.mp3"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      return response.data.pipe(res);
    } catch (e) {}
  }

  res.status(404).send('Audio not found');
});

// Admin Route
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

app.get('/', (req, res) => { res.redirect('/admin/dashboard'); });

// ==========================================
// 4. WEBSOCKET REAL-TIME ENGINE
// ==========================================
io.on('connection', async (socket) => {
  socket.emit('accounts:updated', getAccounts());
  socket.emit('tasks:updated', getTasks().slice(0, 50));

  const accounts = getAccounts();
  if (accounts.length > 0) {
    const session = loadSession(accounts[0].id);
    if (session) {
      try {
        const songs = await getFeedAPI(session);
        socket.emit('songs:loaded', songs);
      } catch (e) {}
    }
  }

  // IMPORT COOKIE LENGKAP
  socket.on('account:importCookie', async (data, callback) => {
    try {
      const { email, cookieJson } = data;
      const cookiesArray = typeof cookieJson === 'string' ? JSON.parse(cookieJson) : cookieJson;

      const sessionCookie = cookiesArray.find(c => c.name === '__session' || c.name.startsWith('__session_'));
      if (!sessionCookie || !sessionCookie.value) {
        throw new Error('Cookie __session tidak ditemukan di dalam JSON!');
      }

      const bearerToken = sessionCookie.value;
      const cookiesHeader = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');

      const accountId = 'acc_main';
      const sessionData = { bearerToken, cookies: cookiesHeader };

      // TES VALIDITAS TOKEN SEBELUM SIMPAN!
      let credits = 0;
      try {
        credits = await checkCreditsAPI(sessionData);
      } catch (errAuth) {
        throw new Error('Cookie sudah KADALUARSA! Buka suno.com di Kiwi, REFRESH halamannya, lalu Export ulang!');
      }

      saveSession(accountId, sessionData);

      const updatedAccounts = [{
        id: accountId,
        email: email,
        creditsLeft: credits,
        statusCookie: 'active',
        lastLogin: new Date().toISOString()
      }];

      saveAccounts(updatedAccounts);

      io.emit('accounts:updated', updatedAccounts);
      io.emit('account:credits', { id: accountId, credits });
      io.emit('notification', { type: 'success', message: `Token Aktif! Saldo Resmi: ${credits} Kredit` });

      const songs = await getFeedAPI(sessionData);
      io.emit('songs:loaded', songs);

      if (callback) callback({ success: true, credits });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // BIKIN LAGU RESMI
  socket.on('song:generate', async (data, callback) => {
    try {
      const accounts = getAccounts();
      if (!accounts.length) throw new Error('Belum ada akun Suno aktif. Import cookie dulu!');

      const session = loadSession(accounts[0].id);
      if (!session) throw new Error('Sesi tidak ditemukan. Import cookie ulang!');

      io.emit('notification', { type: 'info', message: 'Membuat lagu dengan model resmi v6-mini...' });

      const resSuno = await generateSongAPI(session, data);
      if (!resSuno || !resSuno.clips) throw new Error('Suno menolak request. Cek saldo akun.');

      const taskId = uuidv4();
      const clipIds = resSuno.clips.map(c => c.id);

      const tasks = getTasks();
      tasks.unshift({
        taskId,
        clipIds,
        title: data.title || 'Untitled',
        status: 'processing',
        createdAt: new Date().toISOString()
      });
      saveTasks(tasks);

      io.emit('tasks:updated', tasks.slice(0, 50));
      if (callback) callback({ success: true });

      // Polling hasil klip di latar belakang
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > 30) { clearInterval(interval); return; }
        try {
          const freshSongs = await getFeedAPI(session);
          const found = freshSongs.filter(s => clipIds.includes(s.id));
          const allDone = found.length > 0 && found.every(s => s.status === 'complete' || (s.status === 'streaming' && s.audioUrl));
          if (allDone) {
            clearInterval(interval);
            const currentTasks = getTasks();
            const tIndex = currentTasks.findIndex(t => t.taskId === taskId);
            if (tIndex !== -1) {
              currentTasks[tIndex].status = 'completed';
              currentTasks[tIndex].result = found;
              saveTasks(currentTasks);
            }
            io.emit('tasks:updated', currentTasks.slice(0, 50));
            io.emit('songs:loaded', freshSongs);
            io.emit('task:completed', { taskId, result: found });

            const newCredits = await checkCreditsAPI(session);
            accounts[0].creditsLeft = newCredits;
            saveAccounts(accounts);
            io.emit('account:credits', { id: accounts[0].id, credits: newCredits });
          }
        } catch (e) {}
      }, 5000);

    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message;
      io.emit('notification', { type: 'error', message: `Gagal: ${errMsg}` });
      if (callback) callback({ success: false, error: errMsg });
    }
  });

  // CEK SALDO MANUAL
  socket.on('account:checkCredits', async (data, callback) => {
    try {
      const accounts = getAccounts();
      if (!accounts.length) throw new Error('Tidak ada akun.');
      const session = loadSession(accounts[0].id);
      const credits = await checkCreditsAPI(session);
      accounts[0].creditsLeft = credits;
      saveAccounts(accounts);
      io.emit('accounts:updated', accounts);
      io.emit('account:credits', { id: accounts[0].id, credits });
      io.emit('notification', { type: 'info', message: `Saldo Saat Ini: ${credits} Kredit` });
      if (callback) callback({ success: true, credits });
    } catch (e) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // REFRESH ALL
  socket.on('refresh:all', async (data, callback) => {
    try {
      const accounts = getAccounts();
      if (accounts.length > 0) {
        const session = loadSession(accounts[0].id);
        if (session) {
          const credits = await checkCreditsAPI(session);
          accounts[0].creditsLeft = credits;
          saveAccounts(accounts);
          const songs = await getFeedAPI(session);
          io.emit('accounts:updated', accounts);
          io.emit('account:credits', { id: accounts[0].id, credits });
          io.emit('songs:loaded', songs);
        }
      }
      io.emit('tasks:updated', getTasks().slice(0, 50));
      io.emit('notification', { type: 'success', message: 'Semua data dan lagu berhasil disinkronkan!' });
      if (callback) callback({ success: true });
    } catch (e) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  socket.on('account:delete', (data, callback) => {
    saveAccounts([]);
    io.emit('accounts:updated', []);
    io.emit('account:credits', { id: 'acc_main', credits: 0 });
    io.emit('notification', { type: 'info', message: 'Akun berhasil dihapus.' });
    if (callback) callback({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Suno Studio berjalan di port ${PORT}`);
});