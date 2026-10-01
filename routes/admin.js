const express = require('express');
const router = express.Router();
const path = require('path');
const { authMiddleware, generateToken, ADMIN_USERNAME, ADMIN_PASSWORD } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

// Login page
router.get('/login', (req, res) => {
  res.send(getLoginHTML());
});

// Login action
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = generateToken(username);
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// Logout
router.get('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/admin/login');
});

// Dashboard (main page)
router.get('/dashboard', authMiddleware, (req, res) => {
  res.send(getDashboardHTML());
});

// API for stats
router.get('/api/stats', authMiddleware, (req, res) => {
  const accounts = req.app.locals.accountManager.getAllAccounts();
  res.json({
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter(a => a.statusCookie === 'active').length,
    expiredAccounts: accounts.filter(a => a.statusCookie === 'expired').length,
    onlineProxies: accounts.filter(a => a.statusProxy === 'online').length,
    totalCredits: accounts.reduce((sum, a) => sum + (a.creditsLeft || 0), 0),
    activeTasks: req.app.locals.queueManager.getActiveJobCount(),
    uptime: process.uptime()
  });
});

function getLoginHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suno AI - Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #09090b; }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
  <div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md shadow-2xl">
    <div class="text-center mb-8">
      <div class="inline-flex p-3 bg-orange-500/10 rounded-2xl text-orange-500 text-3xl mb-3">🎵</div>
      <h1 class="text-2xl font-bold text-white tracking-tight">Suno Studio</h1>
      <p class="text-zinc-400 text-sm mt-1">Sign in to your private engine</p>
    </div>
    <form id="loginForm" class="space-y-4">
      <div>
        <label class="block text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">Username</label>
        <input type="text" id="username" required class="w-full px-4 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700/80 text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500 transition text-sm" placeholder="admin">
      </div>
      <div>
        <label class="block text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1.5">Password</label>
        <input type="password" id="password" required class="w-full px-4 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700/80 text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500 transition text-sm" placeholder="••••••••">
      </div>
      <div id="loginError" class="hidden text-red-400 text-xs text-center"></div>
      <button type="submit" id="loginBtn" class="w-full py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold transition shadow-lg shadow-orange-600/20 text-sm">Sign In</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const err = document.getElementById('loginError');
      btn.textContent = 'Signing in...';
      btn.disabled = true;
      err.classList.add('hidden');
      try {
        const res = await fetch('/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value
          })
        });
        const data = await res.json();
        if (data.success) { window.location.href = '/admin/dashboard'; }
        else { err.textContent = data.error || 'Login failed'; err.classList.remove('hidden'); }
      } catch (e) {
        err.textContent = 'Connection error'; err.classList.remove('hidden');
      }
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
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Suno AI Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0b0b0e; }
    .suno-card { background-color: #121318; border: 1px solid #1e2029; }
    .suno-card:hover { border-color: #2b2e3b; }
    .suno-input { background-color: #181920; border: 1px solid #232530; }
    .suno-input:focus { border-color: #ff5e36; }
    .suno-tab-active { border-bottom: 2px solid #ff5e36; color: #ff5e36; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-thumb { background: #262836; border-radius: 4px; }
  </style>
</head>
<body class="text-zinc-200 min-h-screen flex flex-col pb-24">

  <!-- Top Navigation Bar -->
  <header class="bg-[#101116] border-b border-[#1c1d26] sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-8 h-8 rounded-xl bg-orange-600 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-orange-600/30">S</div>
      <div>
        <h1 class="text-sm font-bold text-white tracking-wide">SUNO <span class="text-orange-500 font-normal">STUDIO</span></h1>
        <p class="text-[10px] text-zinc-500 font-medium">AI Music Generation Engine</p>
      </div>
    </div>
    
    <div class="flex items-center space-x-3">
      <div class="flex items-center px-3 py-1.5 rounded-full bg-[#181922] border border-[#242634] space-x-2 text-xs">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="text-zinc-400 font-medium">Credits:</span>
        <span id="topCreditDisplay" class="text-orange-400 font-bold">290</span>
      </div>
      <button onclick="refreshAll()" class="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"><i class="fas fa-sync-alt text-xs"></i></button>
      <a href="/admin/logout" class="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"><i class="fas fa-sign-out-alt text-xs"></i></a>
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="bg-[#101116] border-b border-[#1c1d26] px-6">
    <div class="max-w-[1500px] mx-auto flex space-x-8 text-xs font-semibold">
      <button onclick="switchTab('studio')" id="tab-studio" class="py-3.5 suno-tab-active flex items-center space-x-2">
        <i class="fas fa-wand-magic-sparkles"></i><span>Create & Library</span>
      </button>
      <button onclick="switchTab('accounts')" id="tab-accounts" class="py-3.5 text-zinc-400 hover:text-white flex items-center space-x-2">
        <i class="fas fa-user-shield"></i><span>Accounts</span>
      </button>
      <button onclick="switchTab('tasks')" id="tab-tasks" class="py-3.5 text-zinc-400 hover:text-white flex items-center space-x-2">
        <i class="fas fa-list-check"></i><span>Queue</span>
      </button>
      <button onclick="switchTab('logs')" id="tab-logs" class="py-3.5 text-zinc-400 hover:text-white flex items-center space-x-2">
        <i class="fas fa-terminal"></i><span>Logs</span>
      </button>
    </div>
  </div>

  <!-- Main Container -->
  <main class="max-w-[1500px] w-full mx-auto px-4 lg:px-6 py-6 flex-1">

    <!-- ==================== TAB 1: SUNO STUDIO (MIRIP SUNO ASLI) ==================== -->
    <div id="panel-studio">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <!-- Form Pembuatan Lagu (Kiri) -->
        <div class="lg:col-span-5 suno-card rounded-2xl p-5 shadow-xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <i class="fas fa-sliders text-orange-500"></i>
              <span>Song Creator</span>
            </h2>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">V6-MINI READY</span>
          </div>

          <form id="songGenForm" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Model AI</label>
              <select id="songModel" class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs font-medium focus:outline-none">
                <option value="v6-mini" selected>✨ v6-mini (Terbaru - Kualitas Terbaik & Cepat)</option>
                <option value="v3.5">v3.5 (chirp-v3-5 - Klasik Stabil)</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Judul Lagu (Song Title)</label>
              <input type="text" id="songTitle" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white placeholder-zinc-600 text-xs focus:outline-none" placeholder="Contoh: Senja di Jakarta">
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Style / Genre Musik</label>
              <input type="text" id="songStyle" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white placeholder-zinc-600 text-xs focus:outline-none" placeholder="Contoh: Dangdut Koplo, Kendang, Upbeat, Warm Female Vocals">
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Lirik atau Deskripsi Lagu</label>
              <textarea id="songLyrics" rows="4" class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white placeholder-zinc-600 text-xs focus:outline-none" placeholder="[Verse 1]&#10;Di bawah sinar rembulan...&#10;[Chorus]&#10;Kutatap paras ayumu..."></textarea>
            </div>

            <div class="flex items-center space-x-2 pt-1">
              <input type="checkbox" id="songInstrumental" class="rounded bg-zinc-800 border-zinc-700 text-orange-600 focus:ring-0">
              <label for="songInstrumental" class="text-xs text-zinc-300 select-none">Instrumental (Hanya Musik Tanpa Vokal)</label>
            </div>

            <button type="submit" id="btnGenSong" class="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-orange-600/25 flex items-center justify-center space-x-2">
              <i class="fas fa-wand-magic-sparkles"></i>
              <span>Create Song</span>
            </button>
          </form>
        </div>

        <!-- Tracklist / Hasil Musik Mirip Suno Library (Kanan) -->
        <div class="lg:col-span-7">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <i class="fas fa-compact-disc text-orange-500"></i>
              <span>Your Library</span>
            </h2>
            <span class="text-xs text-zinc-500">Auto-Refreshed via WebSocket</span>
          </div>

          <div id="libraryContainer" class="space-y-3">
            <div class="suno-card rounded-2xl p-12 text-center text-zinc-500">
              <i class="fas fa-music text-4xl mb-3 block opacity-30"></i>
              <p class="text-xs">Belum ada lagu yang dibuat. Klik tombol Create di samping!</p>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- ==================== TAB 2: ACCOUNTS ==================== -->
    <div id="panel-accounts" class="hidden">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-sm font-bold text-white uppercase tracking-wider">Account Manager</h2>
        <button onclick="openImportCookieModal()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2">
          <i class="fas fa-cookie-bite"></i><span>Import Cookie (Kiwi)</span>
        </button>
      </div>

      <div class="suno-card rounded-2xl overflow-hidden">
        <table class="w-full text-left text-xs">
          <thead class="bg-[#181922] text-zinc-400 border-b border-[#242634]">
            <tr>
              <th class="p-3.5">ID</th>
              <th class="p-3.5">Email</th>
              <th class="p-3.5 text-center">Status</th>
              <th class="p-3.5 text-center">Credits</th>
              <th class="p-3.5 text-center">Action</th>
            </tr>
          </thead>
          <tbody id="accountsTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== TAB 3: QUEUE ==================== -->
    <div id="panel-tasks" class="hidden">
      <div class="suno-card rounded-2xl p-4">
        <h2 class="text-sm font-bold text-white uppercase tracking-wider mb-3">Task Queue</h2>
        <table class="w-full text-left text-xs">
          <thead class="text-zinc-500 border-b border-zinc-800">
            <tr>
              <th class="py-2">Task ID</th>
              <th class="py-2 text-center">Status</th>
              <th class="py-2 text-right">Time</th>
            </tr>
          </thead>
          <tbody id="tasksTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== TAB 4: LOGS ==================== -->
    <div id="panel-logs" class="hidden">
      <div class="suno-card rounded-2xl p-4">
        <h2 class="text-sm font-bold text-white uppercase tracking-wider mb-3">Live Logs</h2>
        <div id="logOutput" class="font-mono text-xs text-emerald-400 bg-black/40 rounded-xl p-4 h-96 overflow-y-auto whitespace-pre-wrap"></div>
      </div>
    </div>

  </main>

  <!-- Floating Audio Player (Persis Player Suno / Spotify) -->
  <div id="audioPlayerBar" class="fixed bottom-0 left-0 right-0 bg-[#12131a] border-t border-[#232535] px-6 py-3 flex items-center justify-between z-50 shadow-2xl">
    <div class="flex items-center space-x-3 w-1/3">
      <img id="playerCover" src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100" class="w-12 h-12 rounded-lg object-cover border border-zinc-700">
      <div class="overflow-hidden">
        <h4 id="playerTitle" class="text-xs font-bold text-white truncate">Pilih Lagu</h4>
        <p id="playerTags" class="text-[10px] text-zinc-400 truncate">Suno AI Audio</p>
      </div>
    </div>

    <!-- Audio Element dengan NO-REFERRER (Bypass Blokir Suno) -->
    <div class="w-1/2 flex flex-col items-center">
      <audio id="mainAudioElement" controls referrerpolicy="no-referrer" class="w-full h-8 brightness-90"></audio>
    </div>

    <div class="w-1/3 flex justify-end">
      <a id="playerDownloadBtn" href="#" download target="_blank" class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold flex items-center space-x-1.5 transition">
        <i class="fas fa-download"></i><span>Download MP3</span>
      </a>
    </div>
  </div>

  <!-- Modal Import Cookie -->
  <div id="importCookieModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/70 backdrop-blur-sm">
    <div class="suno-card rounded-2xl p-6 w-full max-w-lg mx-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-white">Import Cookie Suno (Kiwi Browser)</h3>
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

  <!-- Toast Container -->
  <div id="toastContainer" class="fixed top-4 right-4 z-50 space-y-2 select-text"></div>

  <script>
    const socket = io();
    let accounts = [];
    let tasks = [];
    let libraryClips = [];

    socket.on('connect', () => { addLog('WebSocket connected'); });
    socket.on('accounts:updated', (data) => { accounts = data; renderAccounts(); });
    socket.on('tasks:updated', (data) => { tasks = data; renderTasks(); });
    
    socket.on('account:credits', (data) => {
      document.getElementById('topCreditDisplay').textContent = data.credits;
    });

    socket.on('task:completed', (data) => {
      addLog(\`Lagu selesai diproduksi!\`);
      showToast('SUCCESS', 'Lagu baru berhasil dibuat!', 'success');
      if (data.result && data.result.length) {
        libraryClips = [...data.result, ...libraryClips];
        renderLibrary();
      }
    });

    socket.on('notification', (data) => {
      showToast(data.type.toUpperCase(), data.message, data.type);
      addLog(\`[\${data.type}] \${data.message}\`);
    });

    // RENDER LIBRARY PERSIS SUNO AI
    function renderLibrary() {
      const c = document.getElementById('libraryContainer');
      if (!libraryClips.length) {
        c.innerHTML = '<div class="suno-card rounded-2xl p-12 text-center text-zinc-500"><i class="fas fa-music text-4xl mb-3 block opacity-30"></i><p class="text-xs">Belum ada lagu yang dibuat. Klik tombol Create di samping!</p></div>';
        return;
      }

      c.innerHTML = libraryClips.map((clip, index) => \`
        <div class="suno-card rounded-2xl p-3.5 flex items-center justify-between hover:bg-[#181922] transition group">
          <div class="flex items-center space-x-3.5 overflow-hidden">
            <!-- Cover Art dengan Tombol Play -->
            <div class="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 cursor-pointer shadow-md" onclick="playMusic('\${clip.audioUrl}', '\${clip.title}', '\${clip.tags}', '\${clip.imageUrl}')">
              <img src="\${clip.imageUrl}" referrerpolicy="no-referrer" class="w-full h-full object-cover">
              <div class="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/20 transition">
                <div class="w-8 h-8 rounded-full bg-white/90 text-zinc-900 flex items-center justify-center pl-0.5 shadow-lg">
                  <i class="fas fa-play text-xs"></i>
                </div>
              </div>
            </div>

            <!-- Detail Info Lagu -->
            <div class="overflow-hidden">
              <div class="flex items-center space-x-2">
                <h4 class="text-xs font-bold text-white truncate max-w-[200px] lg:max-w-[280px]">\${clip.title}</h4>
                <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">\${clip.model || 'V6-MINI'}</span>
              </div>
              <p class="text-[11px] text-zinc-400 truncate mt-0.5">\${clip.tags}</p>
              <div class="flex items-center space-x-2 text-[10px] text-zinc-500 mt-1">
                <span><i class="far fa-clock mr-1"></i>\${clip.duration || '3:00'}</span>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex items-center space-x-2 shrink-0">
            <button onclick="playMusic('\${clip.audioUrl}', '\${clip.title}', '\${clip.tags}', '\${clip.imageUrl}')" class="p-2.5 rounded-xl bg-orange-600/10 text-orange-400 hover:bg-orange-600 hover:text-white text-xs transition" title="Play">
              <i class="fas fa-play"></i>
            </button>
            <a href="\${clip.audioUrl}" download target="_blank" class="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition" title="Download MP3">
              <i class="fas fa-download"></i>
            </a>
          </div>
        </div>
      \`).join('');
    }

    // FUNGSI MEMUTAR MUSIK DI FLOATING PLAYER
    function playMusic(url, title, tags, cover) {
      const audio = document.getElementById('mainAudioElement');
      document.getElementById('playerTitle').textContent = title;
      document.getElementById('playerTags').textContent = tags;
      document.getElementById('playerCover').src = cover;
      document.getElementById('playerDownloadBtn').href = url;

      audio.src = url;
      audio.load();
      audio.play().catch(e => {
        showToast('INFO', 'Klik play pada bar audio di bawah jika tidak otomatis jalan.', 'info');
      });
      showToast('PLAYING', \`Memutar: \${title}\`, 'success');
    }

    function renderAccounts() {
      const tbody = document.getElementById('accountsTableBody');
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-zinc-500">Belum ada akun.</td></tr>';
        return;
      }
      tbody.innerHTML = accounts.map(acc => \`
        <tr class="border-b border-[#1c1d26]">
          <td class="p-3.5 font-mono text-zinc-400">\${acc.id}</td>
          <td class="p-3.5 font-medium text-white">\${acc.email}</td>
          <td class="p-3.5 text-center">
            \${acc.statusCookie === 'active' ? '<span class="text-emerald-400 font-bold">🟢 Active</span>' : '<span class="text-red-400">🔴 Expired</span>'}
          </td>
          <td class="p-3.5 text-center font-bold text-orange-400">\${acc.creditsLeft || 0}</td>
          <td class="p-3.5 text-center">
            <button onclick="checkCredits('\${acc.id}')" class="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs mr-2"><i class="fas fa-coins mr-1"></i>Cek Saldo</button>
            <button onclick="deleteAccount('\${acc.id}')" class="px-2.5 py-1 bg-red-600/20 text-red-400 rounded-lg text-xs"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      \`).join('');

      if (accounts[0] && accounts[0].creditsLeft) {
        document.getElementById('topCreditDisplay').textContent = accounts[0].creditsLeft;
      }
    }

    function renderTasks() {
      const tbody = document.getElementById('tasksTableBody');
      tbody.innerHTML = tasks.slice(0, 10).map(t => \`
        <tr class="border-b border-zinc-800 text-xs">
          <td class="py-2.5 font-mono text-zinc-400">\${t.taskId.slice(0,8)}...</td>
          <td class="py-2.5 text-center text-orange-400 font-bold">\${t.status}</td>
          <td class="py-2.5 text-right text-zinc-500">\${new Date(t.createdAt).toLocaleTimeString()}</td>
        </tr>
      \`).join('');
    }

    // FORM GENERATOR
    document.getElementById('songGenForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnGenSong');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating...';

      socket.emit('song:generate', {
        modelVersion: document.getElementById('songModel').value,
        title: document.getElementById('songTitle').value,
        style: document.getElementById('songStyle').value,
        lyrics: document.getElementById('songLyrics').value,
        instrumental: document.getElementById('songInstrumental').checked
      }, (res) => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Create Song';
        if (res.success) {
          showToast('PROSES', 'Lagu sedang diproduksi oleh Suno AI...', 'info');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    // FORM IMPORT COOKIE
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
          showToast('SUCCESS', 'Akun berhasil AKTIF!', 'success');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    function checkCredits(id) { socket.emit('account:checkCredits', { id }); }
    function deleteAccount(id) { if (confirm('Hapus akun ini?')) socket.emit('account:delete', { id }); }
    function refreshAll() { socket.emit('refresh:all', {}); }

    function openImportCookieModal() {
      document.getElementById('importCookieModal').classList.remove('hidden');
      document.getElementById('importCookieModal').classList.add('flex');
    }
    function closeModal(id) {
      document.getElementById(id).classList.add('hidden');
      document.getElementById(id).classList.remove('flex');
    }

    function switchTab(tab) {
      ['studio', 'accounts', 'tasks', 'logs'].forEach(t => {
        document.getElementById(\`panel-\${t}\`).classList.toggle('hidden', t !== tab);
        document.getElementById(\`tab-\${t}\`).classList.toggle('suno-tab-active', t === tab);
        document.getElementById(\`tab-\${t}\`).classList.toggle('text-zinc-400', t !== tab);
      });
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