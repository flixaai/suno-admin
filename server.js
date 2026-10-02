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

// In-Memory Live System Logs
const liveLogs = [];
let latestRawSunoData = null;

function addLiveLog(type, title, detail) {
  const entry = {
    id: uuidv4(),
    time: new Date().toLocaleTimeString('id-ID', { hour12: false }),
    type: type, // 'suno_raw', 'generate_error', 'system', 'auth'
    title: title,
    detail: typeof detail === 'object' ? JSON.stringify(detail, null, 2) : String(detail)
  };
  liveLogs.unshift(entry);
  if (liveLogs.length > 80) liveLogs.pop();
  io.emit('logs:updated', liveLogs);
}

// Database Helpers
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

// Perhitungan Masa Aktif Nyata Token Clerk
function calculateRealExpiry(expSeconds) {
  if (!expSeconds) return 'Aktif (Permanen Auto-Refresh)';
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = expSeconds - nowSec;
  if (diffSec <= 0) return 'Kedaluwarsa (Expired)';
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  if (days > 0) return `${days} Hari ${hours} Jam`;
  return `${hours} Jam`;
}

// ==========================================
// 2. MESIN UTAMA SUNO API (OFFICIAL v6-mini) & CLERK KEEP-ALIVE
// ==========================================
const SUNO_API_BASE = 'https://studio-api.prod.suno.com';

async function keepAliveSession(session, accountId = 'acc_main') {
  if (!session || !session.clientToken) return session;
  try {
    let sid = session.sessionId;
    if (!sid && session.bearerToken) {
      try {
        const payload = JSON.parse(Buffer.from(session.bearerToken.split('.')[1], 'base64').toString('utf-8'));
        sid = payload.sid;
      } catch (e) {}
    }
    if (!sid) {
      const cRes = await axios.get('https://auth.suno.com/v1/client?__clerk_api_version=2025-11-10', {
        headers: { 'Authorization': session.clientToken, 'Cookie': session.cookies || '' },
        timeout: 10000
      });
      sid = cRes.data?.response?.last_active_session_id || cRes.data?.client?.last_active_session_id;
    }
    if (sid) {
      const tRes = await axios.post(`https://auth.suno.com/v1/client/sessions/${sid}/tokens`, {}, {
        headers: { 'Authorization': session.clientToken, 'Cookie': session.cookies || '' },
        timeout: 10000
      });
      if (tRes.data?.jwt) {
        session.bearerToken = tRes.data.jwt;
        session.sessionId = sid;
        saveSession(accountId, session);
        addLiveLog('auth', 'Auto-Refresh Berhasil', 'Sesi token Clerk diperbarui secara otomatis');
      }
    }
  } catch (err) {
    addLiveLog('auth', 'Gagal Auto-Refresh Token', err.message);
  }
  return session;
}

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
  await keepAliveSession(session);
  const config = getAxiosConfig(session);
  const res = await axios.get(`${SUNO_API_BASE}/api/billing/info/`, config);
  return res.data?.total_credits_left !== undefined ? res.data.total_credits_left : (res.data?.credits_left || 0);
}

async function getFeedAPI(session) {
  await keepAliveSession(session);
  const config = getAxiosConfig(session);
  const res = await axios.get(`${SUNO_API_BASE}/api/feed/`, config);
  const clips = res.data || [];
  
  if (clips.length > 0) {
    latestRawSunoData = clips[0];
    addLiveLog('suno_raw', 'Data Raw Suno Terbaru Diterima', clips[0]);
  }

  return clips.map(c => {
    const durationSec = Math.floor(c.metadata?.duration || 0);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    
    // Prioritas link audio resmi Suno
    let realAudioUrl = '';
    if (c.media_urls && c.media_urls[0] && c.media_urls[0].url) {
      realAudioUrl = c.media_urls[0].url;
    } else if (c.audio_url && !c.audio_url.includes('forbidden')) {
      realAudioUrl = c.audio_url;
    } else {
      realAudioUrl = `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${c.id}.m4a`;
    }

    return {
      id: c.id,
      audioId: c.id,
      title: c.title || 'Untitled Song',
      status: c.status,
      audioUrl: realAudioUrl,
      imageUrl: c.image_url || c.image_large_url || `https://cdn2.suno.ai/image_${c.id}.jpeg`,
      tags: c.metadata?.tags || 'Music',
      model: c.major_model_version || c.model_name || 'v6-mini',
      duration: durationSec > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : '3:29'
    };
  });
}

async function generateSongAPI(session, options) {
  await keepAliveSession(session);
  const config = getAxiosConfig(session);
  const { title, style, lyrics, instrumental } = options;

  let payload = {
    make_instrumental: !!instrumental
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
    payload.gpt_description_prompt = title || style || 'Song';
  }

  const res = await axios.post(`${SUNO_API_BASE}/api/generate/v2/`, payload, config);
  return res.data;
}

// Endpoint Unduh Audio / Proxy Aman
app.get('/api/v1/audio/:audioId', async (req, res) => {
  const { audioId } = req.params;
  const { download, title, format } = req.query;

  try {
    const streamUrl = `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${audioId}.m4a`;
    const safeTitle = (title || 'suno_song').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();

    if (download === 'true') {
      const ext = format === 'mp3' ? 'mp3' : 'm4a';
      const audioRes = await axios({
        method: 'GET',
        url: streamUrl,
        responseType: 'stream',
        timeout: 45000
      });
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
      res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
      return audioRes.data.pipe(res);
    } else {
      return res.redirect(streamUrl);
    }
  } catch (err) {
    res.status(404).send('Audio sedang diproses atau tidak ditemukan');
  }
});

// Admin Route
let adminRoutes;
try {
  adminRoutes = require('./routes/admin');
} catch (e) {
  adminRoutes = require('./admin');
}
app.use('/admin', adminRoutes);

app.get('/', (req, res) => { res.redirect('/admin/dashboard'); });

// ==========================================
// 4. WEBSOCKET REAL-TIME ENGINE
// ==========================================
io.on('connection', async (socket) => {
  socket.emit('accounts:updated', getAccounts());
  socket.emit('tasks:updated', getTasks().slice(0, 50));
  socket.emit('logs:updated', liveLogs);

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

  // Permintaan Data Raw Suno dari Tombol Web
  socket.on('rawsuno:get', (data, callback) => {
    if (callback) {
      callback({
        success: true,
        data: latestRawSunoData || { message: 'Belum ada data lagu. Buat lagu terlebih dahulu.' }
      });
    }
  });

  // IMPORT COOKIE LENGKAP
  socket.on('account:importCookie', async (data, callback) => {
    try {
      const { email, cookieJson } = data;
      const cookiesArray = typeof cookieJson === 'string' ? JSON.parse(cookieJson) : cookieJson;

      const sessionCookie = cookiesArray.find(c => c.name === '__session' || c.name.startsWith('__session_'));
      if (!sessionCookie || !sessionCookie.value) {
        throw new Error('Cookie __session tidak ditemukan di dalam JSON!');
      }

      const clientCookie = cookiesArray.find(c => c.name === '__client' || c.name.startsWith('__client_'));
      const clientToken = clientCookie ? clientCookie.value : null;

      let sessionId = null;
      let realExp = null;

      if (clientCookie && clientCookie.expirationDate) {
        realExp = Math.floor(clientCookie.expirationDate);
      }

      try {
        const payload = JSON.parse(Buffer.from(sessionCookie.value.split('.')[1], 'base64').toString('utf-8'));
        sessionId = payload.sid || null;
      } catch (e) {}

      const bearerToken = sessionCookie.value;
      const cookiesHeader = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');

      const accountId = 'acc_main';
      const sessionData = { bearerToken, clientToken, sessionId, cookies: cookiesHeader };

      let credits = 0;
      try {
        credits = await checkCreditsAPI(sessionData);
      } catch (errAuth) {
        throw new Error('Cookie sudah KADALUARSA! Buka suno.com di Kiwi, REFRESH halamannya, lalu Export ulang!');
      }

      saveSession(accountId, sessionData);

      const realExpiryStr = calculateRealExpiry(realExp);

      const updatedAccounts = [{
        id: accountId,
        email: email,
        creditsLeft: credits,
        statusCookie: 'active',
        realExpiry: realExpiryStr,
        lastLogin: new Date().toISOString()
      }];

      saveAccounts(updatedAccounts);

      addLiveLog('auth', 'Akun Berhasil Diaktifkan', `Email: ${email} | Saldo: ${credits} Kredit | Masa Aktif: ${realExpiryStr}`);

      io.emit('accounts:updated', updatedAccounts);
      io.emit('account:credits', { id: accountId, credits });
      io.emit('notification', { type: 'success', message: `Akun Terhubung! Masa Aktif: ${realExpiryStr} (${credits} Kredit)` });

      const songs = await getFeedAPI(sessionData);
      io.emit('songs:loaded', songs);

      if (callback) callback({ success: true, credits, realExpiry: realExpiryStr });
    } catch (err) {
      addLiveLog('auth', 'Gagal Import Cookie', err.message);
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

      let resSuno;
      try {
        resSuno = await generateSongAPI(session, data);
      } catch (genErr) {
        const rawErr = genErr.response?.data?.detail || genErr.response?.data?.message || genErr.message;
        let humanReason = rawErr;
        
        // Deteksi alasan penolakan Suno secara spesifik
        if (typeof rawErr === 'string') {
          if (rawErr.toLowerCase().includes('copyright') || rawErr.toLowerCase().includes('artist')) {
            humanReason = 'Ditolak Suno: Lirik/Judul mengandung Hak Cipta atau Nama Artis Terkenal!';
          } else if (rawErr.toLowerCase().includes('credit') || rawErr.toLowerCase().includes('insufficient')) {
            humanReason = 'Ditolak Suno: Saldo kredit akun Anda habis!';
          } else if (rawErr.toLowerCase().includes('moderation') || rawErr.toLowerCase().includes('flag')) {
            humanReason = 'Ditolak Suno: Lirik melanggar Pedoman Konten / Moderasi!';
          }
        }

        addLiveLog('generate_error', 'Gagal Generate Lagu', {
          alasan: humanReason,
          errorAsli: rawErr,
          judul: data.title,
          genre: data.style
        });

        throw new Error(humanReason);
      }

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

      addLiveLog('system', 'Produksi Lagu Dimulai', `Judul: ${data.title} | ID Task: ${taskId}`);

      io.emit('tasks:updated', tasks.slice(0, 50));
      if (callback) callback({ success: true });

      // Polling hasil klip
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > 35) { clearInterval(interval); return; }
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

            addLiveLog('system', 'Lagu Selesai Diproduksi', `Judul: ${data.title} (Siap Diputar & Diunduh)`);

            const newCredits = await checkCreditsAPI(session);
            accounts[0].creditsLeft = newCredits;
            saveAccounts(accounts);
            io.emit('account:credits', { id: accounts[0].id, credits: newCredits });
          }
        } catch (e) {}
      }, 5000);

    } catch (err) {
      io.emit('notification', { type: 'error', message: err.message });
      if (callback) callback({ success: false, error: err.message });
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
      accounts[0].statusCookie = 'active';
      saveAccounts(accounts);
      io.emit('accounts:updated', accounts);
      io.emit('account:credits', { id: accounts[0].id, credits });
      io.emit('notification', { type: 'info', message: `Saldo Saat Ini: ${credits} Kredit` });
      if (callback) callback({ success: true, credits });
    } catch (e) {
      const accounts = getAccounts();
      if (accounts.length > 0) {
        accounts[0].statusCookie = 'expired';
        saveAccounts(accounts);
        io.emit('accounts:updated', accounts);
      }
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
    addLiveLog('system', 'Akun Dihapus', 'Data akun Suno telah dihapus oleh pengguna');
    if (callback) callback({ success: true });
  });
});

// Auto-refresh token Clerk setiap 30 menit agar tidak pernah mati
cron.schedule('*/30 * * * *', async () => {
  try {
    const accounts = getAccounts();
    if (accounts.length > 0) {
      const session = loadSession(accounts[0].id);
      if (session) {
        await keepAliveSession(session, accounts[0].id);
      }
    }
  } catch (e) {}
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Suno Studio berjalan di port ${PORT}`);
});