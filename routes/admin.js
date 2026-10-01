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
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnSign');
      btn.disabled = true; btn.textContent = 'Checking...';
      const res = await fetch('/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
      });
      const data = await res.json();
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
  <meta name="referrer" content="no-referrer">
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

  <!-- HEADER -->
  <header class="bg-[#101117] border-b border-[#1c1e28] sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <div class="w-9 h-9 rounded-xl bg-orange-600 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-orange-600/30">S</div>
      <div>
        <h1 class="text-sm font-bold text-white tracking-wide">SUNO <span class="text-orange-500">STUDIO</span></h1>
        <p class="text-[10px] text-zinc-500">Official v6-mini Engine</p>
      </div>
    </div>
    
    <div class="flex items-center space-x-3">
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
            <p class="text-xs text-zinc-500">Akun tersimpan aman dan tidak akan hilang</p>
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
        <h3 class="text-sm font-bold text-white">Import Cookie Suno (Kiwi Browser)</h3>
        <button onclick="closeModal('importCookieModal')" class="text-zinc-500 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <p class="text-[11px] text-zinc-400 mb-3">Pastikan Anda sudah me-refresh tab Suno di Kiwi sebelum meng-export cookie baru!</p>
      <form id="importCookieForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1">Email Akun Suno</label>
          <input type="email" id="cookieEmail" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs focus:outline-none" placeholder="user@gmail.com">
        </div>
        <div>
          <label class="block text-xs font-semibold text-zinc-400 mb-1">Paste JSON Cookie</label>
          <textarea id="cookieJsonRaw" rows="6" required class="w-full px-3.5 py-2.5 rounded-xl suno-input text-white text-xs font-mono focus:outline-none" placeholder='[ { "name": "__session", "value": "..." } ]'></textarea>
        </div>
        <button type="submit" id="btnImportSubmit" class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">Aktifkan & Tes Akun</button>
      </form>
    </div>
  </div>

  <div id="toastContainer" class="fixed top-4 right-4 z-50 space-y-2 select-text"></div>

  <script>
    const socket = io();
    let accounts = [];
    let tasks = [];
    let libraryClips = [];

    socket.on('accounts:updated', (data) => { accounts = data; renderAccounts(); });
    socket.on('tasks:updated', (data) => { tasks = data; renderQueueTable(); });
    
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
      showToast('SUCCESS', '2 Lagu baru siap diputar!', 'success');
      refreshAll();
    });

    socket.on('notification', (data) => {
      showToast(data.type.toUpperCase(), data.message, data.type);
    });

    function renderAccounts() {
      const tbody = document.getElementById('accountsTableBody');
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-zinc-500">Belum ada akun. Klik Import Cookie di atas!</td></tr>';
        document.getElementById('statTotalAccounts').textContent = '0';
        document.getElementById('statActiveSessions').textContent = '0';
        document.getElementById('topCreditDisplay').textContent = '0';
        document.getElementById('statTotalCredits').textContent = '0';
        return;
      }
      tbody.innerHTML = accounts.map(acc => \`
        <tr class="hover:bg-[#181a24] transition">
          <td class="p-3.5 font-mono text-zinc-400 font-bold">\${acc.id}</td>
          <td class="p-3.5 text-white">\${acc.email}</td>
          <td class="p-3.5 text-center">
            <span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded-full text-[10px]">🟢 Active</span>
          </td>
          <td class="p-3.5 text-center font-bold text-orange-400">\${acc.creditsLeft || 0}</td>
          <td class="p-3.5 text-center">
            <button onclick="checkCredits('\${acc.id}')" class="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs mr-2"><i class="fas fa-coins mr-1"></i>Cek</button>
            <button onclick="deleteAccountDirect('\${acc.id}')" class="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      \`).join('');

      document.getElementById('statTotalAccounts').textContent = accounts.length;
      document.getElementById('statActiveSessions').textContent = '1';
      document.getElementById('topCreditDisplay').textContent = accounts[0].creditsLeft || 0;
      document.getElementById('statTotalCredits').textContent = accounts[0].creditsLeft || 0;
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
                <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">v6-mini</span>
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
        tbody.innerHTML = '<tr><td colspan="3" class="text-center py-6 text-zinc-500">Belum ada antrean tugas.</td></tr>';
        return;
      }
      tbody.innerHTML = tasks.map(t => \`
        <tr class="hover:bg-[#181a24] transition">
          <td class="p-3.5 font-bold text-white">\${t.title}</td>
          <td class="p-3.5 text-center"><span class="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded text-[10px]">\${t.status}</span></td>
          <td class="p-3.5 text-center">
            \${t.result ? \`<button onclick="openMiniPlayer('\${t.result[0].id}', '\${t.result[0].title}', '\${t.result[0].tags}', '\${t.result[0].imageUrl}')" class="px-3 py-1 bg-orange-600 text-white rounded-lg text-xs font-bold"><i class="fas fa-play mr-1"></i>Play</button>\` : '<span class=\"text-zinc-500\">Memproses...</span>'}
          </td>
        </tr>
      \`).join('');
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
      ['dashboard', 'generator', 'queue'].forEach(v => {
        document.getElementById(\`view-\${v}\`).classList.toggle('hidden', v !== view);
      });
      toggleDrawer(false);
    }

    document.getElementById('songGenForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnGenSong');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating v6-mini...';

      socket.emit('song:generate', {
        title: document.getElementById('songTitle').value,
        style: document.getElementById('songStyle').value,
        lyrics: document.getElementById('songLyrics').value,
        instrumental: document.getElementById('songInstrumental').checked
      }, (res) => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generate Song Now';
        if (res.success) {
          showToast('PROSES', '2 Lagu v6-mini sedang diproduksi oleh Suno AI...', 'info');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    document.getElementById('importCookieForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnImportSubmit');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Memverifikasi...';

      socket.emit('account:importCookie', {
        email: document.getElementById('cookieEmail').value,
        cookieJson: document.getElementById('cookieJsonRaw').value
      }, (res) => {
        btn.disabled = false;
        btn.innerHTML = 'Aktifkan & Tes Akun';
        if (res.success) {
          closeModal('importCookieModal');
          document.getElementById('importCookieForm').reset();
          showToast('SUCCESS', `Akun AKTIF! Saldo: ${res.credits} Kredit`, 'success');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    function checkCredits(id) { socket.emit('account:checkCredits', { id }); }
    function deleteAccountDirect(id) { socket.emit('account:delete', { id }); }
    function refreshAll() { socket.emit('refresh:all', {}); }
    function openImportCookieModal() { document.getElementById('importCookieModal').classList.remove('hidden'); document.getElementById('importCookieModal').classList.add('flex'); }
    function closeModal(id) { document.getElementById(id).classList.add('hidden'); document.getElementById(id).classList.remove('flex'); }

    function showToast(title, message, type = 'info') {
      const c = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = \`p-3.5 rounded-xl shadow-2xl border text-xs max-w-sm \${type === 'success' ? 'bg-[#121c16] border-emerald-500/40 text-emerald-300' : type === 'error' ? 'bg-[#211214] border-red-500/40 text-red-300' : 'bg-[#1e1713] border-orange-500/40 text-orange-300'}\`;
      toast.innerHTML = \`<div class="font-bold">\${title}</div><div class="mt-0.5 text-zinc-400">\${message}</div>\`;
      c.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }
  </script>
</body>
</html>`;
}

module.exports = router;