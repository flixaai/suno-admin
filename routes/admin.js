const express = require('express');
const router = express.Router();
const path = require('path');
const { authMiddleware, generateToken, ADMIN_USERNAME, ADMIN_PASSWORD } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

router.get('/login', (req, res) => { res.send(getLoginHTML()); });
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = generateToken(username);
    res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 });
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

router.get('/logout', (req, res) => { res.clearCookie('auth_token'); res.redirect('/admin/login'); });
router.get('/dashboard', authMiddleware, (req, res) => { res.send(getDashboardHTML()); });

function getLoginHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suno Studio - Login</title><script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style> body { font-family: 'Inter', sans-serif; background: #09090b; } </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
  <div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md shadow-2xl">
    <div class="text-center mb-8">
      <div class="inline-flex p-3 bg-orange-500/10 rounded-2xl text-orange-500 text-3xl mb-3">🎵</div>
      <h1 class="text-2xl font-bold text-white">Suno Studio</h1>
      <p class="text-zinc-500 text-xs mt-1">Private AI Music Generation Engine</p>
    </div>
    <form id="loginForm" class="space-y-4">
      <div>
        <label class="block text-xs uppercase font-semibold text-zinc-400 mb-1.5">Username</label>
        <input type="text" id="username" required class="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-orange-500" placeholder="admin">
      </div>
      <div>
        <label class="block text-xs uppercase font-semibold text-zinc-400 mb-1.5">Password</label>
        <input type="password" id="password" required class="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-orange-500" placeholder="••••••••">
      </div>
      <div id="loginError" class="hidden text-red-400 text-xs text-center"></div>
      <button type="submit" id="loginBtn" class="w-full py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition">Sign In</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const err = document.getElementById('loginError');
      btn.textContent = 'Signing in...'; btn.disabled = true; err.classList.add('hidden');
      try {
        const res = await fetch('/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
        });
        const data = await res.json();
        if (data.success) { window.location.href = '/admin/dashboard'; }
        else { err.textContent = data.error || 'Login failed'; err.classList.remove('hidden'); }
      } catch (e) { err.textContent = 'Connection error'; err.classList.remove('hidden'); }
      btn.textContent = 'Sign In'; btn.disabled = false;
    });
  </script>
</body>
</html>`;
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Suno AI Studio & Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0c0d12; }
    .suno-card { background-color: #12131a; border: 1px solid #1f212c; }
    .suno-input { background-color: #181922; border: 1px solid #242735; }
    .suno-input:focus { border-color: #ff5e36; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-thumb { background: #262836; border-radius: 4px; }
  </style>
</head>
<body class="text-zinc-200 min-h-screen flex flex-col">

  <header class="bg-[#101117] border-b border-[#1c1e28] sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-orange-600/30">S</div>
      <div>
        <h1 class="text-sm font-bold text-white tracking-wide">SUNO <span class="text-orange-500">STUDIO</span></h1>
        <p class="text-[10px] text-zinc-500">Official v3.5 Engine</p>
      </div>
    </div>
    
    <div class="flex items-center space-x-3">
      <div class="flex items-center px-3 py-1.5 rounded-full bg-[#181924] border border-[#242738] space-x-2 text-xs">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="text-zinc-400">Credits:</span>
        <span id="topCreditDisplay" class="text-orange-400 font-bold">250</span>
      </div>
      <button onclick="refreshAll()" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition" title="Refresh Data"><i class="fas fa-sync-alt text-xs"></i></button>
      <button onclick="toggleDrawer(true)" class="p-2 px-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center space-x-1.5 transition">
        <i class="fas fa-bars"></i><span class="hidden sm:inline">Menu</span>
      </button>
    </div>
  </header>

  <div id="drawerOverlay" onclick="toggleDrawer(false)" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 hidden"></div>
  <div id="sideDrawer" class="fixed top-0 right-0 bottom-0 w-72 bg-[#12131c] border-l border-[#202230] z-50 transform translate-x-full transition-transform duration-300 flex flex-col p-6 shadow-2xl">
    <div class="flex items-center justify-between pb-6 border-b border-[#202230]">
      <h3 class="text-sm font-bold text-white uppercase tracking-wider">Navigation</h3>
      <button onclick="toggleDrawer(false)" class="text-zinc-400 hover:text-white"><i class="fas fa-times text-lg"></i></button>
    </div>
    <div class="space-y-2 mt-6 flex-1 text-sm font-semibold">
      <button onclick="switchTab('dashboard')" class="w-full p-3 rounded-xl hover:bg-zinc-800/70 text-left flex items-center space-x-3 text-zinc-300 hover:text-white">
        <i class="fas fa-gauge-high text-orange-500 w-5"></i><span>Dashboard & Saldo</span>
      </button>
      <button onclick="switchTab('generator')" class="w-full p-3 rounded-xl hover:bg-zinc-800/70 text-left flex items-center space-x-3 text-zinc-300 hover:text-white">
        <i class="fas fa-wand-magic-sparkles text-orange-500 w-5"></i><span>Song Studio (Generate)</span>
      </button>
      <button onclick="switchTab('queue')" class="w-full p-3 rounded-xl hover:bg-zinc-800/70 text-left flex items-center space-x-3 text-zinc-300 hover:text-white">
        <i class="fas fa-list-check text-orange-500 w-5"></i><span>Task Queue</span>
      </button>
      <button onclick="switchTab('logs')" class="w-full p-3 rounded-xl hover:bg-zinc-800/70 text-left flex items-center space-x-3 text-zinc-300 hover:text-white">
        <i class="fas fa-terminal text-orange-500 w-5"></i><span>Live Logs</span>
      </button>
    </div>
    <div class="pt-6 border-t border-[#202230]">
      <a href="/admin/logout" class="w-full p-3 rounded-xl bg-red-600/10 text-red-400 hover:bg-red-600 hover:text-white transition flex items-center justify-center space-x-2 text-xs font-bold">
        <i class="fas fa-sign-out-alt"></i><span>Logout</span>
      </a>
    </div>
  </div>

  <main class="max-w-[1500px] w-full mx-auto px-4 lg:px-8 py-6 flex-1">

    <div id="view-dashboard">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Saldo Kredit Aktif</span>
          <div id="statTotalCredits" class="text-2xl font-black text-orange-400 mt-1">250</div>
        </div>
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Active Sessions</span>
          <div id="statActiveSessions" class="text-2xl font-black text-emerald-400 mt-1">1</div>
        </div>
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Total Accounts</span>
          <div id="statTotalAccounts" class="text-2xl font-black text-white mt-1">1</div>
        </div>
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Completed Songs</span>
          <div id="statTotalSongs" class="text-2xl font-black text-indigo-400 mt-1">20</div>
        </div>
      </div>

      <div class="suno-card rounded-2xl p-5 mb-6">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div>
            <h2 class="text-sm font-bold text-white uppercase tracking-wider">Account Manager</h2>
            <p class="text-xs text-zinc-500">Akun tersimpan permanen dan tidak akan hilang</p>
          </div>
          <button onclick="openImportCookieModal()" class="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2">
            <i class="fas fa-cookie-bite"></i><span>Import Cookie Baru</span>
          </button>
        </div>

        <div class="overflow-x-auto w-full rounded-xl border border-[#202230]">
          <table class="w-full text-left text-xs whitespace-nowrap">
            <thead class="bg-[#171822] text-zinc-400 border-b border-[#202230]">
              <tr>
                <th class="p-3.5">ID Akun</th>
                <th class="p-3.5">Email Suno</th>
                <th class="p-3.5 text-center">Status</th>
                <th class="p-3.5 text-center">Kredit</th>
                <th class="p-3.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody id="accountsTableBody" class="divide-y divide-[#1e202c]"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VIEW 2: SONG STUDIO (MODEL TERBUKTI V3.5 STABIL) -->
    <div id="view-generator" class="hidden">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-5 suno-card rounded-2xl p-5 shadow-2xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <i class="fas fa-sliders text-orange-500"></i>
              <span>Song Creator</span>
            </h2>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">V3.5 STABLE</span>
          </div>

          <form id="songGenForm" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Model Version</label>
              <select id="songModel" class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs font-medium focus:outline-none">
                <option value="v3.5" selected>⭐ v3.5 (Paling Stabil - Terbukti Berhasil di Suno)</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Judul Lagu (Title)</label>
              <input type="text" id="songTitle" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white placeholder-zinc-600 text-xs focus:outline-none" placeholder="Contoh: Firda">
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Style / Genre Musik</label>
              <input type="text" id="songStyle" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white placeholder-zinc-600 text-xs focus:outline-none" placeholder="Contoh: DJ sholawat style Indonesia slow bass">
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Lirik atau Deskripsi Lagu</label>
              <textarea id="songLyrics" rows="4" class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white placeholder-zinc-600 text-xs focus:outline-none" placeholder="Lirik lagu..."></textarea>
            </div>

            <div class="flex items-center space-x-2 pt-1">
              <input type="checkbox" id="songInstrumental" class="rounded bg-zinc-800 border-zinc-700 text-orange-600 focus:ring-0">
              <label for="songInstrumental" class="text-xs text-zinc-300 select-none">Instrumental (Musik Saja Tanpa Vokal)</label>
            </div>

            <button type="submit" id="btnGenSong" class="w-full py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-orange-600/25 flex items-center justify-center space-x-2">
              <i class="fas fa-wand-magic-sparkles"></i>
              <span>Generate Song Now</span>
            </button>
          </form>
        </div>

        <div class="lg:col-span-7">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <i class="fas fa-compact-disc text-orange-500"></i>
              <span>Generated Library</span>
            </h2>
          </div>
          <div id="libraryContainer" class="space-y-3"></div>
        </div>
      </div>
    </div>

    <!-- VIEW 3: TASK QUEUE -->
    <div id="view-queue" class="hidden">
      <div class="suno-card rounded-2xl p-5">
        <h2 class="text-sm font-bold text-white uppercase tracking-wider mb-4">Task Queue</h2>
        <div class="overflow-x-auto w-full rounded-xl border border-[#202230]">
          <table class="w-full text-left text-xs whitespace-nowrap">
            <thead class="bg-[#171822] text-zinc-400 border-b border-[#202230]">
              <tr>
                <th class="p-3.5">Judul</th>
                <th class="p-3.5">Audio Clip ID</th>
                <th class="p-3.5 text-center">Status</th>
                <th class="p-3.5 text-center">Aksi / Putar</th>
              </tr>
            </thead>
            <tbody id="queueTableBody" class="divide-y divide-[#1e202c]"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VIEW 4: LOGS -->
    <div id="view-logs" class="hidden">
      <div class="suno-card rounded-2xl p-5">
        <h2 class="text-sm font-bold text-white uppercase tracking-wider mb-3">Live Terminal Logs</h2>
        <div id="logOutput" class="font-mono text-xs text-emerald-400 bg-black/50 rounded-xl p-4 h-96 overflow-y-auto whitespace-pre-wrap"></div>
      </div>
    </div>

  </main>

  <!-- POPUP MINI PLAYER -->
  <div id="miniPlayerModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="suno-card rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl relative border border-orange-500/30">
      <button onclick="closeMiniPlayer()" class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2"><i class="fas fa-times text-lg"></i></button>
      <img id="mpCover" src="" class="w-40 h-40 rounded-2xl mx-auto object-cover mb-4 shadow-xl border border-zinc-800">
      <h3 id="mpTitle" class="text-sm font-bold text-white truncate">Title</h3>
      <p id="mpTags" class="text-xs text-zinc-400 truncate mt-1">Tags</p>
      <div class="mt-4"><audio id="mpAudio" controls class="w-full h-10"></audio></div>
      <div class="mt-4 pt-4 border-t border-[#202230] flex items-center justify-between text-xs">
        <span id="mpAudioId" class="font-mono text-[10px] text-zinc-500">ID: -</span>
        <a id="mpDownload" href="#" class="px-3.5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold flex items-center space-x-1.5 transition">
          <i class="fas fa-download"></i><span>Download MP3</span>
        </a>
      </div>
    </div>
  </div>

  <!-- MODAL IMPORT COOKIE -->
  <div id="importCookieModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="suno-card rounded-2xl p-6 w-full max-w-md">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-white">Import Cookie Suno (Kiwi)</h3>
        <button onclick="closeModal('importCookieModal')" class="text-zinc-500 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <form id="importCookieForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1">Email Akun Suno</label>
          <input type="email" id="cookieEmail" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs focus:outline-none" placeholder="user@gmail.com">
        </div>
        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1">Paste JSON Cookie</label>
          <textarea id="cookieJsonRaw" rows="6" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs font-mono focus:outline-none" placeholder='[ { "name": "__session", "value": "..." } ]'></textarea>
        </div>
        <button type="submit" id="btnImportSubmit" class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">Aktifkan Akun</button>
      </form>
    </div>
  </div>

  <div id="toastContainer" class="fixed top-4 right-4 z-50 space-y-2 select-text"></div>

  <script>
    const socket = io();
    let accounts = [];
    let tasks = [];
    let libraryClips = [];

    socket.on('connect', () => { addLog('WebSocket connected'); });
    socket.on('accounts:updated', (data) => { accounts = data; renderAccounts(); });
    socket.on('tasks:updated', (data) => { tasks = data; renderTasks(); renderQueueTable(); });
    
    socket.on('songs:loaded', (data) => {
      libraryClips = data || [];
      renderLibrary();
      renderQueueTable();
      document.getElementById('statTotalSongs').textContent = libraryClips.length;
    });

    socket.on('account:credits', (data) => {
      document.getElementById('topCreditDisplay').textContent = data.credits;
      document.getElementById('statTotalCredits').textContent = data.credits;
    });

    socket.on('task:completed', (data) => {
      addLog(\`Task selesai! 2 Lagu diproduksi.\`);
      showToast('SUCCESS', '2 Lagu baru siap diputar!', 'success');
      if (data.result && data.result.length) {
        libraryClips = [...data.result, ...libraryClips];
        renderLibrary();
        renderQueueTable();
        document.getElementById('statTotalSongs').textContent = libraryClips.length;
      }
    });

    socket.on('notification', (data) => {
      showToast(data.type.toUpperCase(), data.message, data.type);
      addLog(\`[\${data.type}] \${data.message}\`);
    });

    function renderAccounts() {
      const tbody = document.getElementById('accountsTableBody');
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-zinc-500">Belum ada akun terpasang.</td></tr>';
        return;
      }
      tbody.innerHTML = accounts.map(acc => \`
        <tr class="hover:bg-[#181a24] transition">
          <td class="p-3.5 font-mono text-zinc-400 font-bold">\${acc.id}</td>
          <td class="p-3.5 text-white">\${acc.email}</td>
          <td class="p-3.5 text-center">
            \${acc.statusCookie === 'active' ? '<span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded-full text-[10px]">🟢 Active</span>' : '<span class="text-red-400 bg-red-500/10 px-2 py-1 rounded-full text-[10px]">🔴 Expired</span>'}
          </td>
          <td class="p-3.5 text-center font-bold text-orange-400">\${acc.creditsLeft || 0}</td>
          <td class="p-3.5 text-center">
            <button onclick="checkCredits('\${acc.id}')" class="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs mr-2"><i class="fas fa-coins mr-1"></i>Cek</button>
            <button onclick="deleteAccountDirect('\${acc.id}')" class="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      \`).join('');

      document.getElementById('statTotalAccounts').textContent = accounts.length;
      document.getElementById('statActiveSessions').textContent = accounts.filter(a => a.statusCookie === 'active').length;
      if (accounts[0] && accounts[0].creditsLeft) {
        document.getElementById('topCreditDisplay').textContent = accounts[0].creditsLeft;
        document.getElementById('statTotalCredits').textContent = accounts[0].creditsLeft;
      }
    }

    function renderLibrary() {
      const c = document.getElementById('libraryContainer');
      if (!libraryClips.length) {
        c.innerHTML = '<div class="suno-card rounded-2xl p-12 text-center text-zinc-500"><i class="fas fa-music text-4xl mb-3 block opacity-30"></i><p class="text-xs">Belum ada lagu. Buat lagu di form sebelah kiri!</p></div>';
        return;
      }

      c.innerHTML = libraryClips.map(clip => \`
        <div class="suno-card rounded-2xl p-3.5 flex items-center justify-between hover:bg-[#181924] transition">
          <div class="flex items-center space-x-3.5 overflow-hidden">
            <div class="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 cursor-pointer shadow-md" onclick="openMiniPlayer('\${clip.id}', '\${clip.title}', '\${clip.tags}', '\${clip.imageUrl}')">
              <img src="\${clip.imageUrl}" class="w-full h-full object-cover">
              <div class="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div class="w-7 h-7 rounded-full bg-white text-zinc-900 flex items-center justify-center pl-0.5 shadow-lg">
                  <i class="fas fa-play text-[10px]"></i>
                </div>
              </div>
            </div>
            <div class="overflow-hidden">
              <div class="flex items-center space-x-2">
                <h4 class="text-xs font-bold text-white truncate max-w-[180px] sm:max-w-[260px]">\${clip.title}</h4>
                <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">\${clip.model || 'v3.5'}</span>
              </div>
              <p class="text-[11px] text-zinc-400 truncate mt-0.5">\${clip.tags}</p>
              <span class="text-[10px] text-zinc-500"><i class="far fa-clock mr-1"></i>\${clip.duration || '3:00'}</span>
            </div>
          </div>
          <div class="flex items-center space-x-2 shrink-0">
            <button onclick="openMiniPlayer('\${clip.id}', '\${clip.title}', '\${clip.tags}', '\${clip.imageUrl}')" class="p-2.5 rounded-xl bg-orange-600/10 text-orange-400 hover:bg-orange-600 hover:text-white text-xs transition">
              <i class="fas fa-play"></i>
            </button>
            <a href="/api/v1/audio/\${clip.id}?download=true&title=\${encodeURIComponent(clip.title)}" class="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition" title="Download MP3">
              <i class="fas fa-download"></i>
            </a>
          </div>
        </div>
      \`).join('');
    }

    function renderQueueTable() {
      const tbody = document.getElementById('queueTableBody');
      if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-zinc-500">Belum ada antrean tugas.</td></tr>';
        return;
      }

      let rows = '';
      tasks.forEach(t => {
        if (t.result && Array.isArray(t.result)) {
          t.result.forEach((c, idx) => {
            rows += \`
              <tr class="hover:bg-[#181a24] transition">
                <td class="p-3.5 font-bold text-white">\${t.title || c.title} (Track \${idx+1})</td>
                <td class="p-3.5 font-mono text-[11px] text-indigo-400">\${c.id}</td>
                <td class="p-3.5 text-center"><span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[10px]">Completed</span></td>
                <td class="p-3.5 text-center">
                  <button onclick="openMiniPlayer('\${c.id}', '\${c.title}', '\${c.tags}', '\${c.imageUrl}')" class="px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-bold transition">
                    <i class="fas fa-play mr-1"></i>Play
                  </button>
                </td>
              </tr>
            \`;
          });
        }
      });
      tbody.innerHTML = rows;
    }

    function openMiniPlayer(audioId, title, tags, cover) {
      document.getElementById('mpTitle').textContent = title;
      document.getElementById('mpTags').textContent = tags;
      document.getElementById('mpCover').src = cover;
      document.getElementById('mpAudioId').textContent = 'ID: ' + audioId;
      document.getElementById('mpDownload').href = '/api/v1/audio/' + audioId + '?download=true&title=' + encodeURIComponent(title);

      const audio = document.getElementById('mpAudio');
      audio.src = '/api/v1/audio/' + audioId;
      audio.load();

      const modal = document.getElementById('miniPlayerModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      audio.play().catch(e => {});
    }

    function closeMiniPlayer() {
      const audio = document.getElementById('mpAudio');
      audio.pause();
      document.getElementById('miniPlayerModal').classList.add('hidden');
      document.getElementById('miniPlayerModal').classList.remove('flex');
    }

    function toggleDrawer(open) {
      document.getElementById('drawerOverlay').classList.toggle('hidden', !open);
      document.getElementById('sideDrawer').classList.toggle('translate-x-full', !open);
    }

    function switchTab(view) {
      ['dashboard', 'generator', 'queue', 'logs'].forEach(v => {
        document.getElementById(\`view-\${v}\`).classList.toggle('hidden', v !== view);
      });
      toggleDrawer(false);
    }

    document.getElementById('songGenForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnGenSong');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating 2 Songs...';

      socket.emit('song:generate', {
        modelVersion: 'v3.5',
        title: document.getElementById('songTitle').value,
        style: document.getElementById('songStyle').value,
        lyrics: document.getElementById('songLyrics').value,
        instrumental: document.getElementById('songInstrumental').checked
      }, (res) => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generate Song Now';
        if (res.success) {
          showToast('PROSES', '2 Lagu sedang diproduksi oleh Suno AI...', 'info');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    document.getElementById('importCookieForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnImportSubmit');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Memproses...';

      socket.emit('account:importCookie', {
        email: document.getElementById('cookieEmail').value,
        cookieJson: document.getElementById('cookieJsonRaw').value
      }, (res) => {
        btn.disabled = false;
        btn.innerHTML = 'Aktifkan Akun';
        if (res.success) {
          closeModal('importCookieModal');
          document.getElementById('importCookieForm').reset();
          showToast('SUCCESS', 'Akun berhasil diperbarui!', 'success');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    function checkCredits(id) { socket.emit('account:checkCredits', { id }); }
    function deleteAccountDirect(id) {
      socket.emit('account:delete', { id });
      showToast('INFO', 'Menghapus akun...', 'info');
    }
    function refreshAll() { socket.emit('refresh:all', {}); }

    function openImportCookieModal() {
      document.getElementById('importCookieModal').classList.remove('hidden');
      document.getElementById('importCookieModal').classList.add('flex');
    }
    function closeModal(id) {
      document.getElementById(id).classList.add('hidden');
      document.getElementById(id).classList.remove('flex');
    }

    function showToast(title, message, type = 'info') {
      const c = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = \`p-3.5 rounded-xl shadow-2xl border text-xs max-w-sm \${type === 'success' ? 'bg-[#121c16] border-emerald-500/40 text-emerald-300' : type === 'error' ? 'bg-[#211214] border-red-500/40 text-red-300' : 'bg-[#1e1713] border-orange-500/40 text-orange-300'}\`;
      toast.innerHTML = \`<div class="font-bold">\${title}</div><div class="mt-0.5 text-zinc-400">\${message}</div>\`;
      c.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }

    function addLog(msg) {
      const el = document.getElementById('logOutput');
      el.textContent += \`[\${new Date().toLocaleTimeString()}] \${msg}\\n\`;
      el.scrollTop = el.scrollHeight;
    }
  </script>
</body>
</html>`;
}

module.exports = router;