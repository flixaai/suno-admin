const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => { res.send(getLoginHTML()); });
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    res.cookie('auth_token', 'admin_logged_in', { httpOnly: true, maxAge: 86400000 });
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Password atau username salah' });
});

router.get('/logout', (req, res) => { res.clearCookie('auth_token'); res.redirect('/admin/login'); });
router.get('/dashboard', (req, res) => { res.send(getDashboardHTML()); });

function getLoginHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suno Studio - Login</title><script src="https://cdn.tailwindcss.com"></script>
  <style> body { font-family: sans-serif; background: #09090b; } </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
  <div class="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl">
    <div class="w-12 h-12 rounded-2xl bg-orange-600 text-white font-black text-xl flex items-center justify-center mx-auto mb-4">S</div>
    <h1 class="text-xl font-bold text-white mb-6">Suno Studio</h1>
    <form id="loginForm" class="space-y-4">
      <input type="text" id="username" required class="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-orange-500" placeholder="admin">
      <input type="password" id="password" required class="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-orange-500" placeholder="Password">
      <div id="loginError" class="hidden text-red-400 text-xs"></div>
      <button type="submit" id="btnSign" class="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm transition">Sign In</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('btnSign');
      btn.disabled = true; btn.textContent = 'Checking...';
      var res = await fetch('/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
      });
      var data = await res.json();
      if (data.success) window.location.href = '/admin/dashboard';
      else {
        document.getElementById('loginError').textContent = data.error;
        document.getElementById('loginError').classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Sign In';
      }
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
  <title>Suno AI Studio v6-mini</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    body { font-family: system-ui, sans-serif; background-color: #0c0d12; }
    .suno-card { background-color: #12131a; border: 1px solid #1f212c; }
    .suno-input { background-color: #181922; border: 1px solid #242735; }
    .suno-input:focus { border-color: #ff5e36; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-thumb { background: #262836; border-radius: 4px; }
  </style>
</head>
<body class="text-zinc-200 min-h-screen flex flex-col">

  <!-- NOTIFIKASI PAS DI TENGAH LAYAR -->
  <div id="toastContainer" class="fixed top-6 left-1/2 -translate-x-1/2 z-50 space-y-2 pointer-events-none w-full max-w-sm px-4 flex flex-col items-center"></div>

  <!-- HEADER -->
  <header class="bg-[#101117] border-b border-[#1c1e28] sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-orange-600/30">S</div>
      <div>
        <h1 class="text-sm font-bold text-white tracking-wide">SUNO <span class="text-orange-500">STUDIO</span></h1>
        <p class="text-[10px] text-zinc-500">Official v6-mini Engine</p>
      </div>
    </div>
    
    <div class="flex items-center space-x-2 sm:space-x-3">
      <!-- Tombol DATA RAW SUNO Langsung Di Header -->
      <button onclick="fetchRawSunoData()" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold text-xs shadow-md transition flex items-center space-x-1.5">
        <i class="fas fa-code text-[11px]"></i><span class="hidden sm:inline">DATA RAW SUNO</span>
      </button>

      <div class="flex items-center px-3 py-1.5 rounded-full bg-[#181924] border border-[#242738] space-x-2 text-xs">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span class="text-zinc-400">Credits:</span>
        <span id="topCreditDisplay" class="text-orange-400 font-bold">0</span>
      </div>
      <button onclick="refreshAll()" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition" title="Refresh Data"><i class="fas fa-sync-alt text-xs"></i></button>
      <button onclick="toggleDrawer(true)" class="p-2 px-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center space-x-1.5 transition">
        <i class="fas fa-bars"></i><span class="hidden sm:inline">Menu</span>
      </button>
    </div>
  </header>

  <!-- DRAWER MENU KANAN ATAS -->
  <div id="drawerOverlay" onclick="toggleDrawer(false)" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 hidden"></div>
  <div id="sideDrawer" class="fixed top-0 right-0 bottom-0 w-72 bg-[#12131c] border-l border-[#202230] z-50 transform translate-x-full transition-transform duration-300 flex flex-col p-6 shadow-2xl">
    <div class="flex items-center justify-between pb-6 border-b border-[#202230]">
      <h3 class="text-sm font-bold text-white uppercase tracking-wider">Menu Fitur</h3>
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
      <button onclick="openLogsModal()" class="w-full p-3 rounded-xl hover:bg-zinc-800/70 text-left flex items-center space-x-3 text-zinc-300 hover:text-white">
        <i class="fas fa-file-waveform text-orange-500 w-5"></i><span>Log Sistem & Error</span>
      </button>
    </div>
    <div class="pt-6 border-t border-[#202230]">
      <a href="/admin/logout" class="w-full p-3 rounded-xl bg-red-600/10 text-red-400 hover:bg-red-600 hover:text-white transition flex items-center justify-center space-x-2 text-xs font-bold">
        <i class="fas fa-sign-out-alt"></i><span>Logout</span>
      </a>
    </div>
  </div>

  <main class="max-w-[1500px] w-full mx-auto px-4 lg:px-8 py-6 flex-1">

    <!-- VIEW 1: DASHBOARD & AKUN -->
    <div id="view-dashboard">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Saldo Kredit</span>
          <div id="statTotalCredits" class="text-2xl font-black text-orange-400 mt-1">0</div>
        </div>
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Status Sesi</span>
          <div id="statActiveSessions" class="text-2xl font-black text-emerald-400 mt-1">0</div>
        </div>
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Total Akun</span>
          <div id="statTotalAccounts" class="text-2xl font-black text-white mt-1">0</div>
        </div>
        <div class="suno-card rounded-2xl p-4">
          <span class="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Lagu di Suno</span>
          <div id="statTotalSongs" class="text-2xl font-black text-indigo-400 mt-1">0</div>
        </div>
      </div>

      <div class="suno-card rounded-2xl p-5 mb-6">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div>
            <h2 class="text-sm font-bold text-white uppercase tracking-wider">Manajemen Akun Suno</h2>
            <p class="text-xs text-zinc-500">Akun tersimpan permanen & auto-refresh (bebas hilang saat deploy)</p>
          </div>
          <div class="flex items-center space-x-2">
            <button onclick="fetchRawSunoData()" class="px-3.5 py-2.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 border border-orange-500/30 rounded-xl text-xs font-bold transition flex items-center space-x-1.5">
              <i class="fas fa-code"></i><span>DATA RAW SUNO</span>
            </button>
            <button onclick="openImportCookieModal()" class="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2">
              <i class="fas fa-cookie-bite"></i><span>Import Cookie Baru</span>
            </button>
          </div>
        </div>

        <div class="overflow-x-auto w-full rounded-xl border border-[#202230]">
          <table class="w-full text-left text-xs whitespace-nowrap">
            <thead class="bg-[#171822] text-zinc-400 border-b border-[#202230]">
              <tr>
                <th class="p-3.5">ID Akun</th>
                <th class="p-3.5">Email Suno</th>
                <th class="p-3.5 text-center">Status & Masa Aktif Asli</th>
                <th class="p-3.5 text-center">Kredit</th>
                <th class="p-3.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody id="accountsTableBody" class="divide-y divide-[#1e202c]"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VIEW 2: SONG STUDIO (MURNI V6-MINI) -->
    <div id="view-generator" class="hidden">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-5 suno-card rounded-2xl p-5 shadow-2xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <i class="fas fa-sliders text-orange-500"></i>
              <span>Song Creator</span>
            </h2>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">V6-MINI READY</span>
          </div>

          <form id="songGenForm" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1">Model Version</label>
              <div class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs font-bold bg-[#181922]">
                ✨ v6-mini (Model Resmi Akun Free Suno AI)
              </div>
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
                <th class="p-3.5 text-center">Status</th>
                <th class="p-3.5 text-center">Aksi / Putar</th>
              </tr>
            </thead>
            <tbody id="queueTableBody" class="divide-y divide-[#1e202c]"></tbody>
          </table>
        </div>
      </div>
    </div>

  </main>

  <!-- POPUP MINI PLAYER (PUTAR & DOWNLOAD MULTI-FORMAT) -->
  <div id="miniPlayerModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="suno-card rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl relative border border-orange-500/30">
      <button onclick="closeMiniPlayer()" class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2"><i class="fas fa-times text-lg"></i></button>
      <img id="mpCover" src="" class="w-40 h-40 rounded-2xl mx-auto object-cover mb-4 shadow-xl border border-zinc-800">
      <h3 id="mpTitle" class="text-sm font-bold text-white truncate">Title</h3>
      <p id="mpTags" class="text-xs text-zinc-400 truncate mt-1">Tags</p>
      
      <!-- Pemutar Audio Native -->
      <div class="mt-4">
        <audio id="mpAudio" controls class="w-full h-10"></audio>
      </div>

      <!-- Tombol Download Multi-Format -->
      <div class="mt-5 pt-4 border-t border-[#202230] space-y-2">
        <div class="text-[11px] text-zinc-500 font-bold uppercase tracking-wider mb-2">Pilihan Download:</div>
        <div class="grid grid-cols-2 gap-2 text-xs font-bold">
          <a id="mpDownloadM4A" href="#" target="_blank" class="py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center space-x-1.5 transition">
            <i class="fas fa-download"></i><span>M4A (Asli)</span>
          </a>
          <a id="mpDownloadMP3" href="#" target="_blank" class="py-2.5 px-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl flex items-center justify-center space-x-1.5 transition">
            <i class="fas fa-file-audio"></i><span>MP3 (320)</span>
          </a>
        </div>
      </div>
    </div>
  </div>

  <!-- POPUP MODAL "DATA RAW SUNO" (LANGSUNG AUTO-COPY) -->
  <div id="rawSunoModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="suno-card rounded-3xl p-6 w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl relative border border-orange-500/40">
      <div class="flex items-center justify-between pb-3 border-b border-[#202230]">
        <div class="flex items-center space-x-2">
          <i class="fas fa-code text-orange-500"></i>
          <h3 class="text-sm font-bold text-white uppercase tracking-wider">DATA RAW SUNO (Respon Asli)</h3>
        </div>
        <button onclick="closeModal('rawSunoModal')" class="text-zinc-400 hover:text-white p-1"><i class="fas fa-times text-lg"></i></button>
      </div>
      <div class="flex-1 overflow-y-auto my-4 rounded-xl bg-[#0a0a0f] p-3.5 border border-[#1f212d]">
        <pre id="rawSunoContent" class="text-[11px] font-mono text-emerald-400 whitespace-pre-wrap select-all"></pre>
      </div>
      <div class="pt-3 border-t border-[#202230] flex items-center justify-between">
        <span class="text-[10px] text-zinc-500">Otomatis tersalin saat tombol ditekan</span>
        <button onclick="copyRawSunoText()" class="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5">
          <i class="fas fa-copy"></i><span>Salin Ulang Teks</span>
        </button>
      </div>
    </div>
  </div>

  <!-- POPUP MODAL "LOG SISTEM & ERROR" -->
  <div id="systemLogsModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="suno-card rounded-3xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl relative border border-zinc-700/40">
      <div class="flex items-center justify-between pb-3 border-b border-[#202230]">
        <div class="flex items-center space-x-2">
          <i class="fas fa-file-waveform text-orange-500"></i>
          <h3 class="text-sm font-bold text-white uppercase tracking-wider">Log Sistem & Error (Realtime)</h3>
        </div>
        <button onclick="closeModal('systemLogsModal')" class="text-zinc-400 hover:text-white p-1"><i class="fas fa-times text-lg"></i></button>
      </div>
      <div id="logsContainer" class="flex-1 overflow-y-auto my-4 space-y-2.5 rounded-xl bg-[#0a0a0f] p-3.5 border border-[#1f212d]"></div>
      <div class="pt-3 border-t border-[#202230] text-right">
        <button onclick="closeModal('systemLogsModal')" class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold">Tutup</button>
      </div>
    </div>
  </div>

  <!-- MODAL IMPORT COOKIE -->
  <div id="importCookieModal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="suno-card rounded-2xl p-6 w-full max-w-md">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-white">Import Cookie Suno (Kiwi Browser)</h3>
        <button onclick="closeModal('importCookieModal')" class="text-zinc-500 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <p class="text-[11px] text-zinc-400 mb-3">Cookie akan disimpan permanen. Saat server deploy ulang, sesi akan pulih otomatis.</p>
      <form id="importCookieForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1">Email Akun Suno</label>
          <input type="email" id="cookieEmail" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs focus:outline-none" placeholder="user@gmail.com">
        </div>
        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1">Paste JSON Cookie (Lengkap)</label>
          <textarea id="cookieJsonRaw" rows="6" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs font-mono focus:outline-none" placeholder='[ { "name": "__client", "value": "..." } ]'></textarea>
        </div>
        <button type="submit" id="btnImportSubmit" class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">Aktifkan & Tes Akun</button>
      </form>
    </div>
  </div>

  <script>
    var socket = io();
    var accounts = [];
    var tasks = [];
    var libraryClips = [];
    var systemLogsData = [];
    var cachedRawSuno = '';

    socket.on('accounts:updated', function(data) {
      accounts = data || [];
      renderAccounts();
      // Auto-Restore Sesi jika Server Habis Dideploy Ulang
      if (accounts.length === 0) {
        autoRestoreLocalSession();
      }
    });

    socket.on('tasks:updated', function(data) { tasks = data; renderQueueTable(); });
    socket.on('logs:updated', function(data) { systemLogsData = data || []; renderLogs(); });
    
    socket.on('songs:loaded', function(data) {
      libraryClips = data || [];
      renderLibrary();
      renderQueueTable();
      document.getElementById('statTotalSongs').textContent = libraryClips.length;
    });

    socket.on('account:credits', function(data) {
      document.getElementById('topCreditDisplay').textContent = data.credits;
      document.getElementById('statTotalCredits').textContent = data.credits;
    });

    socket.on('task:completed', function(data) {
      showToast('SUCCESS', '2 Lagu baru siap diputar!', 'success');
      refreshAll();
    });

    socket.on('notification', function(data) {
      showToast(data.type.toUpperCase(), data.message, data.type);
    });

    // Auto-Restore Sesi dari LocalStorage setelah Deploy
    function autoRestoreLocalSession() {
      try {
        var saved = localStorage.getItem('suno_session_store');
        if (saved) {
          var parsed = JSON.parse(saved);
          if (parsed && parsed.email && parsed.cookieJson) {
            socket.emit('account:importCookie', parsed, function(res) {
              if (res && res.success) {
                showToast('PULIH', 'Sesi akun dipulihkan otomatis setelah deploy!', 'success');
              }
            });
          }
        }
      } catch (e) {}
    }

    function renderAccounts() {
      var tbody = document.getElementById('accountsTableBody');
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-zinc-500">Belum ada akun aktif. Klik Import Cookie di atas!</td></tr>';
        document.getElementById('statTotalAccounts').textContent = '0';
        document.getElementById('statActiveSessions').textContent = '0';
        document.getElementById('topCreditDisplay').textContent = '0';
        document.getElementById('statTotalCredits').textContent = '0';
        return;
      }

      tbody.innerHTML = accounts.map(function(acc) {
        var statusBadge = acc.statusCookie === 'active' 
          ? '<span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded-full text-[10px]">🟢 Active (Sisa: ' + (acc.realExpiry || 'Aktif') + ')</span>' 
          : '<span class="text-red-400 font-bold bg-red-500/10 px-2 py-1 rounded-full text-[10px]">🔴 Expired</span>';

        return '<tr class="hover:bg-[#181a24] transition">' +
          '<td class="p-3.5 font-mono text-zinc-400 font-bold">' + acc.id + '</td>' +
          '<td class="p-3.5 text-white font-medium">' + acc.email + '</td>' +
          '<td class="p-3.5 text-center">' + statusBadge + '</td>' +
          '<td class="p-3.5 text-center font-bold text-orange-400">' + (acc.creditsLeft || 0) + '</td>' +
          '<td class="p-3.5 text-center">' +
            '<button onclick="checkCredits(\'' + acc.id + '\')" class="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs mr-2"><i class="fas fa-coins mr-1"></i>Cek</button>' +
            '<button onclick="deleteAccountDirect(\'' + acc.id + '\')" class="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition"><i class="fas fa-trash"></i></button>' +
          '</td>' +
        '</tr>';
      }).join('');

      document.getElementById('statTotalAccounts').textContent = accounts.length;
      document.getElementById('statActiveSessions').textContent = '1';
      document.getElementById('topCreditDisplay').textContent = accounts[0].creditsLeft || 0;
      document.getElementById('statTotalCredits').textContent = accounts[0].creditsLeft || 0;
    }

    function renderLibrary() {
      var c = document.getElementById('libraryContainer');
      if (!libraryClips.length) {
        c.innerHTML = '<div class="suno-card rounded-2xl p-12 text-center text-zinc-500"><i class="fas fa-music text-4xl mb-3 block opacity-30"></i><p class="text-xs">Belum ada lagu. Buat lagu di form sebelah kiri!</p></div>';
        return;
      }

      c.innerHTML = libraryClips.map(function(clip) {
        var cleanTitle = (clip.title || '').replace(/'/g, "\\'");
        var cleanTags = (clip.tags || '').replace(/'/g, "\\'");
        return '<div class="suno-card rounded-2xl p-3.5 flex items-center justify-between hover:bg-[#181924] transition">' +
          '<div class="flex items-center space-x-3.5 overflow-hidden">' +
            '<div class="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 cursor-pointer shadow-md" onclick="openMiniPlayer(\'' + clip.id + '\', \'' + cleanTitle + '\', \'' + cleanTags + '\', \'' + clip.imageUrl + '\', \'' + clip.audioUrl + '\')">' +
              '<img src="' + clip.imageUrl + '" class="w-full h-full object-cover">' +
              '<div class="absolute inset-0 bg-black/40 flex items-center justify-center">' +
                '<div class="w-7 h-7 rounded-full bg-white text-zinc-900 flex items-center justify-center pl-0.5 shadow-lg">' +
                  '<i class="fas fa-play text-[10px]"></i>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="overflow-hidden">' +
              '<div class="flex items-center space-x-2">' +
                '<h4 class="text-xs font-bold text-white truncate max-w-[180px] sm:max-w-[260px]">' + clip.title + '</h4>' +
                '<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">v6-mini</span>' +
              '</div>' +
              '<p class="text-[11px] text-zinc-400 truncate mt-0.5">' + clip.tags + '</p>' +
              '<span class="text-[10px] text-zinc-500"><i class="far fa-clock mr-1"></i>' + (clip.duration || '3:29') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center space-x-2 shrink-0">' +
            '<button onclick="openMiniPlayer(\'' + clip.id + '\', \'' + cleanTitle + '\', \'' + cleanTags + '\', \'' + clip.imageUrl + '\', \'' + clip.audioUrl + '\')" class="p-2.5 rounded-xl bg-orange-600/10 text-orange-400 hover:bg-orange-600 hover:text-white text-xs transition" title="Putar">' +
              '<i class="fas fa-play"></i>' +
            '</button>' +
            '<a href="/api/v1/audio/' + clip.id + '?download=true&format=mp3&title=' + encodeURIComponent(clip.title || 'song') + '" class="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition" title="Download MP3">' +
              '<i class="fas fa-download"></i>' +
            '</a>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderQueueTable() {
      var tbody = document.getElementById('queueTableBody');
      if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-zinc-500">Belum ada antrean tugas.</td></tr>';
        return;
      }
      tbody.innerHTML = tasks.map(function(t) {
        var actionBtn = t.result 
          ? '<button onclick="openMiniPlayer(\'' + t.result[0].id + '\', \'' + (t.result[0].title || '').replace(/'/g, "\\'") + '\', \'' + (t.result[0].tags || '').replace(/'/g, "\\'") + '\', \'' + t.result[0].imageUrl + '\', \'' + t.result[0].audioUrl + '\')" class="px-3 py-1 bg-orange-600 text-white rounded-lg text-xs font-bold"><i class="fas fa-play mr-1"></i>Play</button>'
          : '<span class="text-zinc-500">Memproses...</span>';

        return '<tr class="hover:bg-[#181a24] transition">' +
          '<td class="p-3.5 font-bold text-white">' + t.title + '</td>' +
          '<td class="p-3.5 text-center"><span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[10px]">' + t.status + '</span></td>' +
          '<td class="p-3.5 text-center">' + actionBtn + '</td>' +
        '</tr>';
      }).join('');
    }

    // Pemutar Audio Langsung & Download
    function openMiniPlayer(audioId, title, tags, cover, audioUrl) {
      document.getElementById('mpTitle').textContent = title;
      document.getElementById('mpTags').textContent = tags;
      document.getElementById('mpCover').src = cover;
      
      var playUrl = audioUrl || ('https://d2lwuy8qc234o3.cloudfront.net/1/clip/' + audioId + '.m4a');

      // Tombol Download M4A Langsung
      var dlM4A = document.getElementById('mpDownloadM4A');
      dlM4A.href = playUrl;
      dlM4A.setAttribute('download', (title || 'song') + '.m4a');

      // Tombol Download MP3 Proxy
      var dlMP3 = document.getElementById('mpDownloadMP3');
      dlMP3.href = '/api/v1/audio/' + audioId + '?download=true&format=mp3&title=' + encodeURIComponent(title || 'song');

      // Play Audio
      var audio = document.getElementById('mpAudio');
      audio.src = playUrl;
      audio.load();

      var modal = document.getElementById('miniPlayerModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      audio.play().catch(function(e) {});
    }

    function closeMiniPlayer() {
      var audio = document.getElementById('mpAudio');
      audio.pause();
      document.getElementById('miniPlayerModal').classList.add('hidden');
      document.getElementById('miniPlayerModal').classList.remove('flex');
    }

    // FITUR TOMBOL "DATA RAW SUNO" (LANGSUNG COPY KE CLIPBOARD)
    function fetchRawSunoData() {
      socket.emit('rawsuno:get', {}, function(res) {
        if (res && res.data) {
          cachedRawSuno = JSON.stringify(res.data, null, 2);
          document.getElementById('rawSunoContent').textContent = cachedRawSuno;
          
          // Buka Modal
          var modal = document.getElementById('rawSunoModal');
          modal.classList.remove('hidden');
          modal.classList.add('flex');

          // Otomatis Salin ke Clipboard
          copyRawSunoText();
        }
      });
    }

    function copyRawSunoText() {
      if (cachedRawSuno) {
        navigator.clipboard.writeText(cachedRawSuno).then(function() {
          showToast('COPIED', 'DATA RAW SUNO Berhasil Disalin ke Clipboard!', 'success');
        }).catch(function() {
          showToast('INFO', 'Silakan blok teks untuk menyalin', 'info');
        });
      }
    }

    // FITUR MODAL LOG SISTEM & ERROR
    function openLogsModal() {
      renderLogs();
      var modal = document.getElementById('systemLogsModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      toggleDrawer(false);
    }

    function renderLogs() {
      var c = document.getElementById('logsContainer');
      if (!c) return;
      if (!systemLogsData.length) {
        c.innerHTML = '<div class="text-center py-6 text-zinc-500 text-xs">Belum ada riwayat aktivitas sistem.</div>';
        return;
      }
      c.innerHTML = systemLogsData.map(function(l) {
        var badgeColor = l.type === 'generate_error' ? 'bg-red-500/10 text-red-400 border-red-500/20' 
          : l.type === 'suno_raw' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

        return '<div class="p-3 rounded-xl bg-[#11121a] border border-[#1f212e] text-xs">' +
          '<div class="flex items-center justify-between mb-1">' +
            '<span class="font-bold text-white flex items-center space-x-1.5">' +
              '<span class="px-2 py-0.5 rounded text-[9px] border ' + badgeColor + '">' + l.type.toUpperCase() + '</span>' +
              '<span>' + l.title + '</span>' +
            '</span>' +
            '<span class="text-[10px] text-zinc-500 font-mono">' + l.time + '</span>' +
          '</div>' +
          '<pre class="text-[10px] font-mono text-zinc-400 mt-1.5 whitespace-pre-wrap overflow-x-auto bg-[#0a0b10] p-2 rounded-lg">' + l.detail + '</pre>' +
        '</div>';
      }).join('');
    }

    function toggleDrawer(open) {
      document.getElementById('drawerOverlay').classList.toggle('hidden', !open);
      document.getElementById('sideDrawer').classList.toggle('translate-x-full', !open);
    }

    function switchTab(view) {
      ['dashboard', 'generator', 'queue'].forEach(function(v) {
        document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
      });
      toggleDrawer(false);
    }

    document.getElementById('songGenForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var btn = document.getElementById('btnGenSong');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating v6-mini...';

      socket.emit('song:generate', {
        title: document.getElementById('songTitle').value,
        style: document.getElementById('songStyle').value,
        lyrics: document.getElementById('songLyrics').value,
        instrumental: document.getElementById('songInstrumental').checked
      }, function(res) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generate Song Now';
        if (res.success) {
          showToast('PROSES', '2 Lagu v6-mini sedang diproduksi oleh Suno AI...', 'info');
        } else {
          showToast('DITOLAK SUNO', res.error, 'error');
        }
      });
    });

    document.getElementById('importCookieForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var btn = document.getElementById('btnImportSubmit');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Memverifikasi...';

      var payload = {
        email: document.getElementById('cookieEmail').value,
        cookieJson: document.getElementById('cookieJsonRaw').value
      };

      socket.emit('account:importCookie', payload, function(res) {
        btn.disabled = false;
        btn.innerHTML = 'Aktifkan & Tes Akun';
        if (res.success) {
          // Simpan permanen di LocalStorage agar tidak hilang saat deploy ulang
          try {
            localStorage.setItem('suno_session_store', JSON.stringify(payload));
          } catch(e) {}

          closeModal('importCookieModal');
          document.getElementById('importCookieForm').reset();
          showToast('BERHASIL', 'Akun AKTIF! Sisa Masa: ' + (res.realExpiry || 'Aktif'), 'success');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    function checkCredits(id) { socket.emit('account:checkCredits', { id: id }); }
    function deleteAccountDirect(id) { 
      try { localStorage.removeItem('suno_session_store'); } catch(e) {}
      socket.emit('account:delete', { id: id }); 
    }
    function refreshAll() { socket.emit('refresh:all', {}); }
    function openImportCookieModal() { document.getElementById('importCookieModal').classList.remove('hidden'); document.getElementById('importCookieModal').classList.add('flex'); }
    function closeModal(id) { document.getElementById(id).classList.add('hidden'); document.getElementById(id).classList.remove('flex'); }

    // NOTIFIKASI PAS DI TENGAH LAYAR
    function showToast(title, message, type) {
      var c = document.getElementById('toastContainer');
      var toast = document.createElement('div');
      var bgBorder = (type === 'success') ? 'bg-[#121c16]/95 border-emerald-500/50 text-emerald-300' 
        : (type === 'error') ? 'bg-[#211214]/95 border-red-500/50 text-red-300' 
        : 'bg-[#1e1713]/95 border-orange-500/50 text-orange-300';
      
      toast.className = 'pointer-events-auto p-3.5 rounded-2xl shadow-2xl border text-xs w-full text-center backdrop-blur-md transition-all transform animate-bounce ' + bgBorder;
      toast.innerHTML = '<div class="font-black text-sm uppercase tracking-wide">' + title + '</div><div class="mt-1 text-zinc-300">' + message + '</div>';
      c.appendChild(toast);
      setTimeout(function() { 
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
      }, 5000);
    }
  </script>
</body>
</html>`;
}

module.exports = router;