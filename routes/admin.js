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

// Accounts page
router.get('/accounts', authMiddleware, (req, res) => {
  res.redirect('/admin/dashboard');
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
  <title>Suno Admin - Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); }
    .gradient-bg { background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%); }
    .glow { box-shadow: 0 0 40px rgba(99, 102, 241, 0.3); }
  </style>
</head>
<body class="gradient-bg min-h-screen flex items-center justify-center">
  <div class="glass rounded-2xl p-8 w-full max-w-md glow">
    <div class="text-center mb-8">
      <div class="text-4xl mb-2">🎵</div>
      <h1 class="text-2xl font-bold text-white">Suno Admin</h1>
      <p class="text-gray-400 text-sm mt-1">Login to Dashboard</p>
    </div>
    <form id="loginForm" class="space-y-4">
      <div>
        <label class="block text-sm text-gray-300 mb-1">Username</label>
        <input type="text" id="username" name="username" required
          class="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
          placeholder="admin">
      </div>
      <div>
        <label class="block text-sm text-gray-300 mb-1">Password</label>
        <input type="password" id="password" name="password" required
          class="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
          placeholder="••••••••">
      </div>
      <div id="loginError" class="hidden text-red-400 text-sm text-center"></div>
      <button type="submit" id="loginBtn"
        class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition transform hover:scale-[1.02] active:scale-[0.98]">
        Sign In
      </button>
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
        if (data.success) {
          window.location.href = '/admin/dashboard';
        } else {
          err.textContent = data.error || 'Login failed';
          err.classList.remove('hidden');
        }
      } catch (e) {
        err.textContent = 'Connection error';
        err.classList.remove('hidden');
      }
      btn.textContent = 'Sign In';
      btn.disabled = false;
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
  <title>Suno AI Admin Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); }
    .glass-card { background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
    .gradient-bg { background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0f0f2e 100%); }
    .glow-indigo { box-shadow: 0 0 30px rgba(99,102,241,0.15); }
    .glow-green { box-shadow: 0 0 30px rgba(34,197,94,0.15); }
    .stat-card { transition: all 0.3s ease; }
    .stat-card:hover { transform: translateY(-2px); }
    .pulse-dot { animation: pulse-dot 2s infinite; }
    @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .table-row { transition: all 0.2s ease; }
    .table-row:hover { background: rgba(255,255,255,0.05); }
    .modal-overlay { background: rgba(0,0,0,0.7); backdrop-filter: blur(5px); }
    .toast-enter { animation: slideIn 0.3s ease; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .btn-action { transition: all 0.2s ease; }
    .btn-action:hover { transform: scale(1.03); }
    .tab-active { border-bottom: 2px solid #6366f1; color: #818cf8; }
  </style>
</head>
<body class="gradient-bg min-h-screen text-gray-200">

  <!-- Header -->
  <header class="glass border-b border-white/10 sticky top-0 z-40">
    <div class="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <span class="text-3xl">🎵</span>
        <div>
          <h1 class="text-xl font-bold text-white">Suno AI Studio & Admin</h1>
          <p class="text-xs text-gray-500">Multi-Account & Music Generator</p>
        </div>
      </div>
      <div class="flex items-center space-x-4">
        <div id="connectionStatus" class="flex items-center space-x-2 text-sm">
          <span class="w-2 h-2 rounded-full bg-green-500 pulse-dot"></span>
          <span class="text-gray-400">Connected</span>
        </div>
        <button onclick="refreshAll()" class="p-2 rounded-lg hover:bg-white/10 transition" title="Refresh">
          <i class="fas fa-sync-alt text-gray-400"></i>
        </button>
        <a href="/admin/logout" class="p-2 rounded-lg hover:bg-white/10 transition" title="Logout">
          <i class="fas fa-sign-out-alt text-gray-400"></i>
        </a>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="max-w-[1600px] mx-auto px-6 py-6">

    <!-- Stats Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
      <div class="stat-card glass-card rounded-xl p-4 glow-indigo">
        <div class="text-xs text-gray-500 uppercase tracking-wider">Total Accounts</div>
        <div id="statTotalAccounts" class="text-2xl font-bold text-white mt-1">0</div>
      </div>
      <div class="stat-card glass-card rounded-xl p-4 glow-green">
        <div class="text-xs text-gray-500 uppercase tracking-wider">Active Sessions</div>
        <div id="statActiveSessions" class="text-2xl font-bold text-green-400 mt-1">0</div>
      </div>
      <div class="stat-card glass-card rounded-xl p-4">
        <div class="text-xs text-gray-500 uppercase tracking-wider">Total Credits</div>
        <div id="statTotalCredits" class="text-2xl font-bold text-yellow-400 mt-1">0</div>
      </div>
      <div class="stat-card glass-card rounded-xl p-4">
        <div class="text-xs text-gray-500 uppercase tracking-wider">Active Tasks</div>
        <div id="statActiveTasks" class="text-2xl font-bold text-purple-400 mt-1">0</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex space-x-6 mb-6 border-b border-white/10">
      <button onclick="switchTab('accounts')" id="tab-accounts" class="pb-3 text-sm font-medium tab-active">
        <i class="fas fa-users mr-2"></i>Accounts
      </button>
      <button onclick="switchTab('generator')" id="tab-generator" class="pb-3 text-sm font-medium text-gray-500 hover:text-gray-300">
        <i class="fas fa-magic mr-2"></i>🎵 Song Generator Studio
      </button>
      <button onclick="switchTab('tasks')" id="tab-tasks" class="pb-3 text-sm font-medium text-gray-500 hover:text-gray-300">
        <i class="fas fa-tasks mr-2"></i>Task Queue
      </button>
      <button onclick="switchTab('logs')" id="tab-logs" class="pb-3 text-sm font-medium text-gray-500 hover:text-gray-300">
        <i class="fas fa-terminal mr-2"></i>Logs
      </button>
    </div>

    <!-- Accounts Tab -->
    <div id="panel-accounts">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <button onclick="openImportCookieModal()"
          class="btn-action px-4 py-2.5 bg-green-600 hover:bg-green-700 rounded-xl text-sm font-semibold text-white flex items-center space-x-2 glow-green">
          <i class="fas fa-cookie-bite"></i>
          <span>Import Cookie (Kiwi)</span>
        </button>
      </div>

      <!-- Accounts Table -->
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-white/10">
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">ID</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Session Status</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Credits</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody id="accountsTableBody">
              <tr>
                <td colspan="5" class="text-center py-12 text-gray-500">
                  <i class="fas fa-inbox text-3xl mb-3 block"></i>Belum ada akun. Klik "Import Cookie (Kiwi)" untuk memasukkan akun.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Song Generator Studio Tab -->
    <div id="panel-generator" class="hidden">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Form Pembuatan Lagu -->
        <div class="glass-card rounded-2xl p-6 glow-indigo">
          <h2 class="text-lg font-bold text-white mb-4"><i class="fas fa-music mr-2 text-indigo-400"></i>Create New Song</h2>
          <form id="songGenForm" class="space-y-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Song Title (Judul Lagu)</label>
              <input type="text" id="songTitle" class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" placeholder="e.g. Senja di Jakarta">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Style / Genre Musik</label>
              <input type="text" id="songStyle" class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" placeholder="e.g. Indonesian Pop, Acoustic, Warm Vocals">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Lyrics or Prompt (Lirik atau Deskripsi)</label>
              <textarea id="songLyrics" rows="5" class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500" placeholder="Tuliskan lirik lagu atau deskripsi lagu yang ingin dibuat..."></textarea>
            </div>
            <div class="flex items-center space-x-2">
              <input type="checkbox" id="songInstrumental" class="rounded bg-white/10 border-white/20 text-indigo-600 focus:ring-0">
              <label for="songInstrumental" class="text-sm text-gray-300">Instrumental Only (Tanpa Vokal)</label>
            </div>
            <button type="submit" id="btnGenSong" class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center space-x-2">
              <i class="fas fa-play"></i>
              <span>Generate Song Now</span>
            </button>
          </form>
        </div>

        <!-- Player & Hasil Musik -->
        <div class="glass-card rounded-2xl p-6">
          <h2 class="text-lg font-bold text-white mb-4"><i class="fas fa-headphones mr-2 text-indigo-400"></i>Generated Songs</h2>
          <div id="generatedList" class="space-y-4 max-h-[500px] overflow-y-auto pr-2">
            <div class="text-center py-12 text-gray-500">
              <i class="fas fa-compact-disc text-3xl mb-3 block animate-spin"></i>
              Belum ada lagu yang di-generate. Silakan isi form di samping!
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tasks Tab -->
    <div id="panel-tasks" class="hidden">
      <div class="glass-card rounded-xl overflow-hidden p-4">
        <h3 class="text-lg font-semibold text-white mb-3">Task Queue</h3>
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10 text-xs text-gray-500">
              <th class="text-left py-2">Task ID</th>
              <th class="text-center py-2">Status</th>
              <th class="text-left py-2">Created</th>
            </tr>
          </thead>
          <tbody id="tasksTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- Logs Tab -->
    <div id="panel-logs" class="hidden">
      <div class="glass-card rounded-xl p-4">
        <div id="logOutput" class="font-mono text-xs text-green-400 bg-black/30 rounded-lg p-4 h-96 overflow-y-auto whitespace-pre-wrap"></div>
      </div>
    </div>
  </main>

  <!-- Import Cookie Modal -->
  <div id="importCookieModal" class="fixed inset-0 z-50 hidden items-center justify-center modal-overlay">
    <div class="glass-card rounded-2xl p-6 w-full max-w-lg mx-4 glow-green">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-white"><i class="fas fa-cookie-bite mr-2 text-green-400"></i>Import Cookie Suno (Kiwi Browser)</h2>
        <button onclick="closeModal('importCookieModal')" class="text-gray-500 hover:text-white"><i class="fas fa-times text-xl"></i></button>
      </div>
      <form id="importCookieForm" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Email Akun Suno</label>
          <input type="email" id="cookieEmail" required class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-green-500" placeholder="user@gmail.com">
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Paste JSON Cookie dari Cookie-Editor</label>
          <textarea id="cookieJsonRaw" rows="6" required class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-green-500 font-mono text-xs" placeholder='[ { "name": "__session", "value": "..." } ]'></textarea>
        </div>
        <button type="submit" id="btnImportSubmit" class="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold transition">
          <i class="fas fa-check mr-2"></i>Aktifkan Akun Sekarang
        </button>
      </form>
    </div>
  </div>

  <!-- Toast Container -->
  <div id="toastContainer" class="fixed top-4 right-4 z-50 space-y-2 select-text"></div>

  <script>
    const socket = io();
    let accounts = [];
    let tasks = [];

    socket.on('connect', () => { addLog('WebSocket connected'); });
    socket.on('accounts:updated', (data) => { accounts = data; renderAccounts(); updateStats(); });
    socket.on('tasks:updated', (data) => { tasks = data; renderTasks(); });
    
    socket.on('task:progress', (data) => {
      addLog(\`Task \${data.taskId.slice(0,8)} progress...\`);
    });

    socket.on('task:completed', (data) => {
      addLog(\`Task \${data.taskId} COMPLETED!\`);
      showToast('SUCCESS', 'Lagu berhasil dibuat!', 'success');
      renderGeneratedMusic(data.result);
    });

    socket.on('notification', (data) => {
      showToast(data.type.toUpperCase(), data.message, data.type);
      addLog(\`[\${data.type}] \${data.message}\`);
    });

    function renderAccounts() {
      const tbody = document.getElementById('accountsTableBody');
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-12 text-gray-500">Belum ada akun. Klik Import Cookie (Kiwi) di atas!</td></tr>';
        return;
      }
      tbody.innerHTML = accounts.map(acc => \`
        <tr class="table-row border-b border-white/5">
          <td class="px-4 py-3 text-xs font-mono text-indigo-400">\${acc.id}</td>
          <td class="px-4 py-3 text-sm text-white">\${acc.email}</td>
          <td class="px-4 py-3 text-center">
            \${acc.statusCookie === 'active' ? '<span class="text-green-400 text-xs font-bold">🟢 Active</span>' : '<span class="text-red-400 text-xs">🔴 Expired</span>'}
          </td>
          <td class="px-4 py-3 text-center text-sm font-bold text-yellow-400">\${acc.creditsLeft || 0}</td>
          <td class="px-4 py-3 text-center">
            <button onclick="checkCredits('\${acc.id}')" class="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded text-xs mr-2"><i class="fas fa-coins"></i> Cek Saldo</button>
            <button onclick="deleteAccount('\${acc.id}')" class="px-2 py-1 bg-red-600/20 text-red-400 rounded text-xs"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      \`).join('');
    }

    function renderGeneratedMusic(clips) {
      if (!clips || !clips.length) return;
      const container = document.getElementById('generatedList');
      container.innerHTML = clips.map(clip => \`
        <div class="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
          <div class="flex items-center space-x-3">
            <img src="\${clip.imageUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100'}" class="w-14 h-14 rounded-lg object-cover">
            <div>
              <h4 class="text-white font-bold text-sm">\${clip.title || 'Untitled Song'}</h4>
              <p class="text-xs text-gray-400">\${clip.tags || 'Music'}</p>
            </div>
          </div>
          \${clip.audioUrl ? \`<audio controls class="w-full h-8 mt-2"><source src="\${clip.audioUrl}" type="audio/mpeg"></audio>\` : '<p class="text-xs text-yellow-400">Masih memproses audio...</p>'}
        </div>
      \`).join('') + container.innerHTML;
    }

    function renderTasks() {
      const tbody = document.getElementById('tasksTableBody');
      tbody.innerHTML = tasks.slice(0, 10).map(t => \`
        <tr class="border-b border-white/5 text-xs">
          <td class="py-2 font-mono text-gray-400">\${t.taskId.slice(0,8)}...</td>
          <td class="py-2 text-center text-indigo-400 font-bold">\${t.status}</td>
          <td class="py-2 text-gray-500">\${new Date(t.createdAt).toLocaleTimeString()}</td>
        </tr>
      \`).join('');
    }

    function updateStats() {
      document.getElementById('statTotalAccounts').textContent = accounts.length;
      document.getElementById('statActiveSessions').textContent = accounts.filter(a => a.statusCookie === 'active').length;
      document.getElementById('statTotalCredits').textContent = accounts.reduce((s, a) => s + (a.creditsLeft || 0), 0);
      document.getElementById('statActiveTasks').textContent = tasks.filter(t => t.status === 'processing').length;
    }

    // Generator Form Submit
    document.getElementById('songGenForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnGenSong');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Generating...';

      socket.emit('song:generate', {
        title: document.getElementById('songTitle').value,
        style: document.getElementById('songStyle').value,
        lyrics: document.getElementById('songLyrics').value,
        instrumental: document.getElementById('songInstrumental').checked
      }, (res) => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play mr-2"></i>Generate Song Now';
        if (res.success) {
          showToast('PROSES', 'Lagu sedang diproduksi oleh Suno AI...', 'info');
        } else {
          showToast('ERROR', res.error, 'error');
        }
      });
    });

    // Import Cookie Form Submit
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
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Aktifkan Akun Sekarang';
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
      ['accounts', 'generator', 'tasks', 'logs'].forEach(t => {
        document.getElementById(\`panel-\${t}\`).classList.toggle('hidden', t !== tab);
        document.getElementById(\`tab-\${t}\`).classList.toggle('tab-active', t === tab);
        document.getElementById(\`tab-\${t}\`).classList.toggle('text-gray-500', t !== tab);
      });
    }

    function showToast(title, message, type = 'info') {
      const c = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = \`toast-enter glass-card rounded-xl p-4 border-l-4 \${type === 'success' ? 'border-green-500' : type === 'error' ? 'border-red-500' : 'border-indigo-500'} min-w-[300px] max-w-md\`;
      toast.innerHTML = \`<div class="text-sm font-bold text-white">\${title}</div><div class="text-xs text-gray-300 mt-1">\${message}</div>\`;
      c.appendChild(toast);
      setTimeout(() => toast.remove(), 6000);
    }

    function addLog(msg) {
      const el = document.getElementById('logOutput');
      el.textContent += \`[\${new Date().toLocaleTimeString()}] \${msg}\\n\`;
      el.scrollTop = el.scrollHeight;
    }

    fetch('/admin/api/stats').then(r=>r.json()).then(s=>{
      document.getElementById('statTotalAccounts').textContent = s.totalAccounts;
      document.getElementById('statActiveSessions').textContent = s.activeAccounts;
      document.getElementById('statTotalCredits').textContent = s.totalCredits;
      document.getElementById('statActiveTasks').textContent = s.activeTasks;
    }).catch(()=>{});
  </script>
</body>
</html>`;
}

module.exports = router;