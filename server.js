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

// In-Memory Live Logs
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

function deleteSessionFile(accountId) {
  try {
    const p = path.join(SESSIONS_DIR, `${accountId}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {}
}

// Perhitungan Masa Aktif Nyata Token Clerk
function calculateRealExpiry(expSeconds) {
  if (!expSeconds) return 'Aktif (Auto-Refresh)';
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = expSeconds - nowSec;
  if (diffSec <= 0) return 'Kedaluwarsa';
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  if (days > 0) return `${days}h ${hours}j`;
  return `${hours} Jam`;
}

// ==========================================
// 2. MESIN UTAMA SUNO API (OFFICIAL v6-mini) & CLERK KEEP-ALIVE
// ==========================================
const SUNO_API_BASE = 'https://studio-api.prod.suno.com';

async function keepAliveSession(session, accountId) {
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
        addLiveLog('auth', 'Auto-Refresh Sesi Berhasil', `Token diperbarui untuk ID akun: ${accountId}`);
      }
    }
  } catch (err) {
    addLiveLog('auth', 'Gagal Refresh Token Sesi', err.message);
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

async function checkCreditsAPI(session, accountId) {
  if (accountId) await keepAliveSession(session, accountId);
  const config = getAxiosConfig(session);
  const res = await axios.get(`${SUNO_API_BASE}/api/billing/info/`, config);
  return res.data?.total_credits_left !== undefined ? res.data.total_credits_left : (res.data?.credits_left || 0);
}

async function getFeedAPI(session, accountId) {
  if (accountId) await keepAliveSession(session, accountId);
  const config = getAxiosConfig(session);
  const res = await axios.get(`${SUNO_API_BASE}/api/feed/`, config);
  const clips = res.data || [];
  
  if (clips.length > 0) {
    latestRawSunoData = clips[0];
    addLiveLog('suno_raw', 'Data Raw Suno Diterima', clips[0]);
  }

  return clips.map(c => {
    const durationSec = Math.floor(c.metadata?.duration || 0);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    
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

async function generateSongAPI(session, options, accountId) {
  if (accountId) await keepAliveSession(session, accountId);
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

// ==========================================
// 3. MESIN STREAMING & DOWNLOAD AUDIO NYATA (BUFFER & CORS LENGKAP)
// ==========================================
app.get('/api/v1/audio/:audioId', async (req, res) => {
  const { audioId } = req.params;
  const { download, title } = req.query;

  try {
    const streamUrl = `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${audioId}.m4a`;
    const safeTitle = (title || 'suno_song').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();

    const audioRes = await axios({
      method: 'GET',
      url: streamUrl,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 45000
    });

    const buffer = Buffer.from(audioRes.data);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Accept-Ranges', 'bytes');

    if (download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.m4a"`);
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    return res.end(buffer);
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*');
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
// 4. WEBSOCKET REAL-TIME ENGINE (MULTI-AKUN POOL)
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
        const songs = await getFeedAPI(session, accounts[0].id);
        socket.emit('songs:loaded', songs);
      } catch (e) {}
    }
  }

  socket.on('rawsuno:get', (data, callback) => {
    if (callback) {
      callback({
        success: true,
        data: latestRawSunoData || { message: 'Belum ada data lagu. Buat lagu terlebih dahulu.' }
      });
    }
  });

  // IMPORT COOKIE KE POOL MULTI-AKUN
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

      let currentAccounts = getAccounts();
      let accountIndex = currentAccounts.findIndex(a => a.email === email);
      const accountId = (accountIndex !== -1) ? currentAccounts[accountIndex].id : ('acc_' + uuidv4().substring(0, 8));

      const sessionData = { bearerToken, clientToken, sessionId, cookies: cookiesHeader };

      let credits = 0;
      try {
        credits = await checkCreditsAPI(sessionData);
      } catch (errAuth) {
        throw new Error('Cookie sudah KADALUARSA! Buka suno.com di Kiwi, REFRESH halamannya, lalu Export ulang!');
      }

      saveSession(accountId, sessionData);

      const realExpiryStr = calculateRealExpiry(realExp);

      const accData = {
        id: accountId,
        email: email,
        creditsLeft: credits,
        statusCookie: 'active',
        realExpiry: realExpiryStr,
        expTimestamp: realExp,
        lastLogin: new Date().toISOString()
      };

      if (accountIndex !== -1) {
        currentAccounts[accountIndex] = accData;
      } else {
        currentAccounts.push(accData);
      }

      saveAccounts(currentAccounts);
      const totalPoolCredits = currentAccounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0);

      addLiveLog('auth', 'Akun Pool Ditambahkan/Diperbarui', `Email: ${email} | Saldo: ${credits} | Masa Aktif: ${realExpiryStr}`);

      io.emit('accounts:updated', currentAccounts);
      io.emit('account:credits', { id: accountId, credits: totalPoolCredits });
      io.emit('notification', { type: 'success', message: `Akun Terhubung: ${email} (${credits} Kredit)` });

      const songs = await getFeedAPI(sessionData, accountId);
      io.emit('songs:loaded', songs);

      if (callback) callback({ success: true, credits, realExpiry: realExpiryStr, totalCredits: totalPoolCredits });
    } catch (err) {
      addLiveLog('auth', 'Gagal Import Cookie', err.message);
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // BIKIN LAGU DENGAN AUTO-FAILOVER PINDAH AKUN OTOMATIS
  socket.on('song:generate', async (data, callback) => {
    try {
      let accounts = getAccounts();
      if (!accounts.length) throw new Error('Belum ada akun Suno aktif. Import cookie dulu!');

      // Cari akun dengan saldo minimal 10
      let candidateAccounts = accounts.filter(a => a.statusCookie === 'active' && a.creditsLeft >= 10);
      if (candidateAccounts.length === 0) {
        throw new Error('Semua saldo akun habis! Silakan tambahkan cookie akun yang memiliki saldo.');
      }

      let resSuno = null;
      let usedAccount = null;
      let lastErrorMessage = '';

      for (const candidate of candidateAccounts) {
        const session = loadSession(candidate.id);
        if (!session) continue;

        try {
          addLiveLog('system', 'Mencoba Generate Lagu', `Menggunakan Akun: ${candidate.email} (Saldo: ${candidate.creditsLeft})`);
          resSuno = await generateSongAPI(session, data, candidate.id);
          if (resSuno && resSuno.clips) {
            usedAccount = candidate;
            break;
          }
        } catch (genErr) {
          const rawErr = genErr.response?.data?.detail || genErr.response?.data?.message || genErr.message || '';
          
          if (rawErr.toLowerCase().includes('copyright') || rawErr.toLowerCase().includes('artist')) {
            throw new Error('Ditolak Suno: Lirik/Judul mengandung Hak Cipta atau Nama Artis!');
          }
          if (rawErr.toLowerCase().includes('moderation') || rawErr.toLowerCase().includes('flag')) {
            throw new Error('Ditolak Suno: Lirik melanggar Pedoman Konten / Moderasi!');
          }
          
          // Jika masalah kredit, set saldo akun tersebut 0 dan lanjut ke akun berikutnya
          if (rawErr.toLowerCase().includes('credit') || genErr.response?.status === 402) {
            candidate.creditsLeft = 0;
            saveAccounts(accounts);
            io.emit('accounts:updated', accounts);
            addLiveLog('system', 'Saldo Akun Habis', `Akun ${candidate.email} habis saldo, otomatis berpindah ke akun cadangan...`);
            continue;
          }

          lastErrorMessage = rawErr;
        }
      }

      if (!resSuno || !usedAccount) {
        throw new Error(lastErrorMessage || 'Gagal membuat lagu di seluruh akun yang tersedia.');
      }

      const taskId = uuidv4();
      const clipIds = resSuno.clips.map(c => c.id);

      const tasks = getTasks();
      tasks.unshift({
        taskId,
        clipIds,
        title: data.title || 'Untitled',
        status: 'processing',
        accountEmail: usedAccount.email,
        createdAt: new Date().toISOString()
      });
      saveTasks(tasks);

      addLiveLog('system', 'Produksi Lagu Dimulai', `Judul: ${data.title} | Akun: ${usedAccount.email}`);

      io.emit('tasks:updated', tasks.slice(0, 50));
      if (callback) callback({ success: true });

      // Polling hasil klip
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > 35) { clearInterval(interval); return; }
        try {
          const currentSession = loadSession(usedAccount.id);
          const freshSongs = await getFeedAPI(currentSession, usedAccount.id);
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

            addLiveLog('system', 'Lagu Selesai', `Judul: ${data.title} (Siap Diputar & Diunduh)`);

            const newCredits = await checkCreditsAPI(currentSession, usedAccount.id);
            usedAccount.creditsLeft = newCredits;
            saveAccounts(accounts);
            
            const totalPool = accounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0);
            io.emit('accounts:updated', accounts);
            io.emit('account:credits', { id: usedAccount.id, credits: totalPool });
          }
        } catch (e) {}
      }, 5000);

    } catch (err) {
      io.emit('notification', { type: 'error', message: err.message });
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // CEK SALDO AKUN SPESIFIK
  socket.on('account:checkCredits', async (data, callback) => {
    try {
      let accounts = getAccounts();
      const targetAcc = accounts.find(a => a.id === data.id);
      if (!targetAcc) throw new Error('Akun tidak ditemukan.');
      
      const session = loadSession(targetAcc.id);
      const credits = await checkCreditsAPI(session, targetAcc.id);
      targetAcc.creditsLeft = credits;
      targetAcc.statusCookie = 'active';
      saveAccounts(accounts);

      const totalPool = accounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0);
      io.emit('accounts:updated', accounts);
      io.emit('account:credits', { id: targetAcc.id, credits: totalPool });
      io.emit('notification', { type: 'info', message: `Saldo ${targetAcc.email}: ${credits} Kredit` });
      if (callback) callback({ success: true, credits });
    } catch (e) {
      let accounts = getAccounts();
      const targetAcc = accounts.find(a => a.id === data.id);
      if (targetAcc) {
        targetAcc.statusCookie = 'expired';
        saveAccounts(accounts);
        io.emit('accounts:updated', accounts);
      }
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // HAPUS AKUN TERTENTU
  socket.on('account:delete', (data, callback) => {
    const targetId = data.id;
    let accounts = getAccounts();
    if (targetId) {
      deleteSessionFile(targetId);
      accounts = accounts.filter(a => a.id !== targetId);
    } else {
      accounts.forEach(a => deleteSessionFile(a.id));
      accounts = [];
    }
    saveAccounts(accounts);
    const totalPool = accounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0);
    io.emit('accounts:updated', accounts);
    io.emit('account:credits', { id: 'pool', credits: totalPool });
    io.emit('notification', { type: 'info', message: 'Akun berhasil dihapus dari pool.' });
    addLiveLog('system', 'Akun Dihapus', `Akun ${targetId || 'Semua'} telah dihapus.`);
    if (callback) callback({ success: true, remainingAccounts: accounts });
  });

  socket.on('refresh:all', async (data, callback) => {
    try {
      const accounts = getAccounts();
      if (accounts.length > 0) {
        for (const acc of accounts) {
          const session = loadSession(acc.id);
          if (session) {
            try {
              acc.creditsLeft = await checkCreditsAPI(session, acc.id);
            } catch (e) {}
          }
        }
        saveAccounts(accounts);
        const sessionFirst = loadSession(accounts[0].id);
        const songs = await getFeedAPI(sessionFirst, accounts[0].id);
        const totalPool = accounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0);
        io.emit('accounts:updated', accounts);
        io.emit('account:credits', { id: 'pool', credits: totalPool });
        io.emit('songs:loaded', songs);
      }
      io.emit('tasks:updated', getTasks().slice(0, 50));
      io.emit('notification', { type: 'success', message: 'Data seluruh akun & lagu disinkronkan!' });
      if (callback) callback({ success: true });
    } catch (e) {
      if (callback) callback({ success: false, error: e.message });
    }
  });
});

// Auto-refresh token untuk seluruh akun di pool setiap 30 menit
cron.schedule('*/30 * * * *', async () => {
  try {
    const accounts = getAccounts();
    for (const acc of accounts) {
      const session = loadSession(acc.id);
      if (session) {
        await keepAliveSession(session, acc.id);
      }
    }
  } catch (e) {}
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Suno Studio Multi-Akun berjalan di port ${PORT}`);
});