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

// API for admin functions
router.get('/api/accounts', authMiddleware, (req, res) => {
  res.json(req.app.locals.accountManager.getAllAccounts());
});

router.get('/api/tasks', authMiddleware, (req, res) => {
  res.json(req.app.locals.queueManager.getAllTasks().slice(0, 100));
});

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
    .glow-red { box-shadow: 0 0 30px rgba(239,68,68,0.15); }
    .stat-card { transition: all 0.3s ease; }
    .stat-card:hover { transform: translateY(-2px); }
    .pulse-dot { animation: pulse-dot 2s infinite; }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .table-row { transition: all 0.2s ease; }
    .table-row:hover { background: rgba(255,255,255,0.05); }
    .modal-overlay { background: rgba(0,0,0,0.7); backdrop-filter: blur(5px); }
    .toast-enter { animation: slideIn 0.3s ease; }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .btn-action { transition: all 0.2s ease; }
    .btn-action:hover { transform: scale(1.05); }
    .btn-action:active { transform: scale(0.95); }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
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
          <h1 class="text-xl font-bold text-white">Suno AI Admin</h1>
          <p class="text-xs text-gray-500">Multi-Account Management Engine</p>
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
      <div class="stat-card glass-card rounded-xl p-4 glow-red">
        <div class="text-xs text-gray-500 uppercase tracking-wider">Expired</div>
        <div id="statExpired" class="text-2xl font-bold text-red-400 mt-1">0</div>
      </div>
      <div class="stat-card glass-card rounded-xl p-4">
        <div class="text-xs text-gray-500 uppercase tracking-wider">Online Proxies</div>
        <div id="statOnlineProxies" class="text-2xl font-bold text-cyan-400 mt-1">0</div>
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
      <button onclick="switchTab('tasks')" id="tab-tasks" class="pb-3 text-sm font-medium text-gray-500 hover:text-gray-300">
        <i class="fas fa-tasks mr-2"></i>Tasks Queue
      </button>
      <button onclick="switchTab('logs')" id="tab-logs" class="pb-3 text-sm font-medium text-gray-500 hover:text-gray-300">
        <i class="fas fa-terminal mr-2"></i>Logs
      </button>
    </div>

    <!-- Accounts Tab -->
    <div id="panel-accounts">
      <!-- Actions Bar -->
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <button onclick="openAddAccountModal()"
          class="btn-action px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-semibold text-white flex items-center space-x-2">
          <i class="fas fa-plus"></i>
          <span>Add Account</span>
        </button>
        <button onclick="checkAllProxies()"
          class="btn-action px-4 py-2.5 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 rounded-xl text-sm font-medium text-cyan-400 flex items-center space-x-2">
          <i class="fas fa-network-wired"></i>
          <span>Check All Proxies</span>
        </button>
        <button onclick="loginAllExpired()"
          class="btn-action px-4 py-2.5 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-xl text-sm font-medium text-green-400 flex items-center space-x-2">
          <i class="fas fa-sign-in-alt"></i>
          <span>Login All Expired</span>
        </button>
      </div>

      <!-- Accounts Table -->
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-white/10">
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">ID</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Proxy IP</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Proxy Status</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Session</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Credits</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody id="accountsTableBody">
              <tr>
                <td colspan="7" class="text-center py-12 text-gray-500">
                  <i class="fas fa-inbox text-3xl mb-3 block"></i>
                  No accounts added yet. Click "Add Account" to get started.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tasks Tab -->
    <div id="panel-tasks" class="hidden">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-white">Task Queue</h3>
        <button onclick="clearCompletedTasks()" class="px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-white/10 rounded-lg hover:bg-white/5">
          Clear Completed
        </button>
      </div>
      <div class="glass-card rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-white/10">
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Task ID</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Account</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Created</th>
                <th class="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Details</th>
              </tr>
            </thead>
            <tbody id="tasksTableBody">
              <tr>
                <td colspan="5" class="text-center py-12 text-gray-500">
                  <i class="fas fa-list text-3xl mb-3 block"></i>
                  No tasks yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Logs Tab -->
    <div id="panel-logs" class="hidden">
      <div class="glass-card rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Live Logs</h3>
          <button onclick="document.getElementById('logOutput').textContent=''" class="text-xs text-gray-500 hover:text-white">Clear</button>
        </div>
        <div id="logOutput" class="font-mono text-xs text-green-400 bg-black/30 rounded-lg p-4 h-96 overflow-y-auto whitespace-pre-wrap"></div>
      </div>
    </div>
  </main>

  <!-- Add Account Modal -->
  <div id="addAccountModal" class="fixed inset-0 z-50 hidden items-center justify-center modal-overlay">
    <div class="glass-card rounded-2xl p-6 w-full max-w-lg mx-4 glow-indigo">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-bold text-white">
          <i class="fas fa-user-plus mr-2 text-indigo-400"></i>Add Account & Proxy
        </h2>
        <button onclick="closeModal('addAccountModal')" class="text-gray-500 hover:text-white">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <form id="addAccountForm" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Suno Email</label>
          <input type="email" id="accEmail" required
            class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
            placeholder="user@gmail.com">
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Suno Password</label>
          <input type="password" id="accPassword" required
            class="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
            placeholder="••••••••">
        </div>
        <div class="border-t border-white/10 pt-4">
          <label class="block text-sm text-gray-400 mb-3">Proxy Configuration <span class="text-gray-600">(optional)</span></label>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <input type="text" id="proxyHost"
                class="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm transition"
                placeholder="Host / IP">
            </div>
            <div>
              <input type="text" id="proxyPort"
                class="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm transition"
                placeholder="Port">
            </div>
            <div>
              <input type="text" id="proxyUser"
                class="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm transition"
                placeholder="Username (optional)">
            </div>
            <div>
              <input type="text" id="proxyPass"
                class="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm transition"
                placeholder="Password (optional)">
            </div>
          </div>
        </div>
        <div class="flex space-x-3 pt-2">
          <button type="submit"
            class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">
            <i class="fas fa-plus mr-2"></i>Add Account
          </button>
          <button type="button" onclick="closeModal('addAccountModal')"
            class="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition">
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- OTP Modal -->
  <div id="otpModal" class="fixed inset-0 z-50 hidden items-center justify-center modal-overlay">
    <div class="glass-card rounded-2xl p-6 w-full max-w-md mx-4 glow-indigo">
      <div class="text-center mb-6">
        <div class="text-4xl mb-3">🔐</div>
        <h2 class="text-lg font-bold text-white">OTP Verification Required</h2>
        <p id="otpAccountEmail" class="text-sm text-gray-400 mt-1"></p>
      </div>
      <form id="otpForm" class="space-y-4">
        <input type="hidden" id="otpAccountId">
        <div>
          <label class="block text-sm text-gray-400 mb-2 text-center">Enter 6-digit code from your email</label>
          <div class="flex justify-center space-x-2" id="otpInputs">
            <input type="text" maxlength="1" class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-xl bg-white/5 border border-white/20 text-white focus:outline-none focus:border-indigo-500 transition" data-index="0">
            <input type="text" maxlength="1" class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-xl bg-white/5 border border-white/20 text-white focus:outline-none focus:border-indigo-500 transition" data-index="1">
            <input type="text" maxlength="1" class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-xl bg-white/5 border border-white/20 text-white focus:outline-none focus:border-indigo-500 transition" data-index="2">
            <input type="text" maxlength="1" class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-xl bg-white/5 border border-white/20 text-white focus:outline-none focus:border-indigo-500 transition" data-index="3">
            <input type="text" maxlength="1" class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-xl bg-white/5 border border-white/20 text-white focus:outline-none focus:border-indigo-500 transition" data-index="4">
            <input type="text" maxlength="1" class="otp-digit w-12 h-14 text-center text-2xl font-bold rounded-xl bg-white/5 border border-white/20 text-white focus:outline-none focus:border-indigo-500 transition" data-index="5">
          </div>
        </div>
        <div id="otpError" class="hidden text-red-400 text-sm text-center"></div>
        <button type="submit" id="otpSubmitBtn"
          class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">
          <i class="fas fa-check mr-2"></i>Submit OTP
        </button>
        <div class="text-center">
          <span class="text-xs text-gray-500">⏱️ Waiting for OTP... <span id="otpTimer">5:00</span></span>
        </div>
      </form>
    </div>
  </div>

  <!-- Task Detail Modal -->
  <div id="taskDetailModal" class="fixed inset-0 z-50 hidden items-center justify-center modal-overlay">
    <div class="glass-card rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-white"><i class="fas fa-info-circle mr-2 text-indigo-400"></i>Task Details</h2>
        <button onclick="closeModal('taskDetailModal')" class="text-gray-500 hover:text-white">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <pre id="taskDetailContent" class="text-sm text-gray-300 bg-black/30 rounded-lg p-4 overflow-auto font-mono whitespace-pre-wrap"></pre>
    </div>
  </div>

  <!-- Toast Container -->
  <div id="toastContainer" class="fixed top-4 right-4 z-50 space-y-2"></div>

  <!-- Sound for OTP notification -->
  <audio id="otpSound" preload="auto">
    <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JhIBxbXuFi4eAd3R9hYmHg3x3fIWIh4N8d32FiIaDfHd9hYiGg3x3fYWIhoN8d32FiIaDfHd9hYiGg3x3" type="audio/wav">
  </audio>

  <script>
    // ========== SOCKET CONNECTION ==========
    const socket = io();
    let accounts = [];
    let tasks = [];

    socket.on('connect', () => {
      document.getElementById('connectionStatus').innerHTML =
        '<span class="w-2 h-2 rounded-full bg-green-500 pulse-dot"></span><span class="text-gray-400">Connected</span>';
      addLog('WebSocket connected');
    });

    socket.on('disconnect', () => {
      document.getElementById('connectionStatus').innerHTML =
        '<span class="w-2 h-2 rounded-full bg-red-500"></span><span class="text-gray-400">Disconnected</span>';
      addLog('WebSocket disconnected');
    });

    // ========== DATA EVENTS ==========
    socket.on('accounts:updated', (data) => {
      accounts = data;
      renderAccounts();
      updateStats();
    });

    socket.on('tasks:updated', (data) => {
      tasks = data;
      renderTasks();
    });

    socket.on('account:status', (data) => {
      const acc = accounts.find(a => a.id === data.id);
      if (acc) {
        acc.statusCookie = data.statusCookie;
        renderAccounts();
        updateStats();
      }
      addLog(\`Account \${data.id} status: \${data.statusCookie}\`);
    });

    socket.on('account:credits', (data) => {
      const acc = accounts.find(a => a.id === data.id);
      if (acc) {
        acc.creditsLeft = data.credits;
        renderAccounts();
        updateStats();
      }
    });

    socket.on('task:completed', (data) => {
      addLog(\`Task \${data.taskId} completed!\`);
      showToast('Task Completed', \`Task \${data.taskId.slice(0,8)}... finished\`, 'success');
      socket.emit('tasks:get', {}, (t) => { tasks = t; renderTasks(); });
    });

    socket.on('task:progress', (data) => {
      const task = tasks.find(t => t.taskId === data.taskId);
      if (task) {
        task.progress = data.progress;
        renderTasks();
      }
    });

    // ========== OTP EVENT ==========
    socket.on('otp:required', (data) => {
      addLog(\`OTP required for \${data.email} (\${data.accountId})\`);
      showOTPModal(data.accountId, data.email);
      showToast('OTP Required', \`Enter OTP for \${data.email}\`, 'warning');
      // Play sound
      try { document.getElementById('otpSound').play(); } catch(e) {}
    });

    // ========== NOTIFICATIONS ==========
    socket.on('notification', (data) => {
      showToast(data.type.toUpperCase(), data.message, data.type);
      addLog(\`[\${data.type}] \${data.message}\`);
    });

    // ========== RENDER FUNCTIONS ==========
    function renderAccounts() {
      const tbody = document.getElementById('accountsTableBody');
      if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-12 text-gray-500"><i class="fas fa-inbox text-3xl mb-3 block"></i>No accounts added yet.</td></tr>';
        return;
      }

      tbody.innerHTML = accounts.map(acc => {
        const proxyDisplay = acc.proxy ? maskProxy(acc.proxy) : '<span class="text-gray-600">No Proxy</span>';

        const proxyStatus = {
          'online': '<span class="flex items-center justify-center"><span class="w-2 h-2 rounded-full bg-green-500 mr-1.5"></span><span class="text-green-400 text-xs">Online</span></span>',
          'offline': '<span class="flex items-center justify-center"><span class="w-2 h-2 rounded-full bg-red-500 mr-1.5"></span><span class="text-red-400 text-xs">Offline</span></span>',
          'unknown': '<span class="flex items-center justify-center"><span class="w-2 h-2 rounded-full bg-gray-500 mr-1.5"></span><span class="text-gray-400 text-xs">Unknown</span></span>',
          'none': '<span class="text-gray-600 text-xs">N/A</span>'
        }[acc.statusProxy] || '<span class="text-gray-600 text-xs">-</span>';

        const sessionStatus = {
          'active': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">🟢 Active</span>',
          'need_otp': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">🟡 Need OTP</span>',
          'expired': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">🔴 Expired</span>',
          'logging_in': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30"><i class="fas fa-spinner fa-spin mr-1"></i>Logging in</span>'
        }[acc.statusCookie] || '<span class="text-gray-600 text-xs">-</span>';

        const creditsColor = acc.creditsLeft > 100 ? 'text-green-400' : acc.creditsLeft > 10 ? 'text-yellow-400' : 'text-red-400';

        return \`
          <tr class="table-row border-b border-white/5">
            <td class="px-4 py-3">
              <span class="text-xs font-mono text-indigo-400">\${acc.id}</span>
            </td>
            <td class="px-4 py-3">
              <span class="text-sm text-white">\${acc.email}</span>
            </td>
            <td class="px-4 py-3">
              <span class="text-xs font-mono text-gray-400">\${proxyDisplay}</span>
            </td>
            <td class="px-4 py-3 text-center">\${proxyStatus}</td>
            <td class="px-4 py-3 text-center">\${sessionStatus}</td>
            <td class="px-4 py-3 text-center">
              <span class="text-sm font-semibold \${creditsColor}">\${acc.creditsLeft || 0}</span>
            </td>
            <td class="px-4 py-3 text-center">
              <div class="flex items-center justify-center space-x-1">
                <button onclick="triggerLogin('\${acc.id}')" class="btn-action px-2 py-1 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs border border-green-500/20" title="Login/Re-Login">
                  <i class="fas fa-sign-in-alt"></i>
                </button>
                <button onclick="checkCredits('\${acc.id}')" class="btn-action px-2 py-1 rounded-lg bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 text-xs border border-yellow-500/20" title="Check Credits">
                  <i class="fas fa-coins"></i>
                </button>
                <button onclick="checkProxy('\${acc.id}')" class="btn-action px-2 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 text-xs border border-cyan-500/20" title="Check Proxy">
                  <i class="fas fa-network-wired"></i>
                </button>
                <button onclick="deleteAccount('\${acc.id}')" class="btn-action px-2 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs border border-red-500/20" title="Delete">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function renderTasks() {
      const tbody = document.getElementById('tasksTableBody');
      if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-12 text-gray-500"><i class="fas fa-list text-3xl mb-3 block"></i>No tasks yet.</td></tr>';
        return;
      }

      tbody.innerHTML = tasks.slice(0, 50).map(task => {
        const statusBadge = {
          'processing': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30"><i class="fas fa-spinner fa-spin mr-1"></i>Processing</span>',
          'completed': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">✅ Completed</span>',
          'error': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">❌ Error</span>',
          'timeout': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">⏰ Timeout</span>',
          'queued': '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-500/20 text-gray-400 border border-gray-500/30">⏳ Queued</span>'
        }[task.status] || '<span class="text-gray-500 text-xs">-</span>';

        const createdAt = new Date(task.createdAt).toLocaleString();

        return \`
          <tr class="table-row border-b border-white/5">
            <td class="px-4 py-3"><span class="text-xs font-mono text-indigo-400">\${task.taskId.slice(0,12)}...</span></td>
            <td class="px-4 py-3"><span class="text-xs text-gray-400">\${task.accountId}</span></td>
            <td class="px-4 py-3 text-center">\${statusBadge}</td>
            <td class="px-4 py-3"><span class="text-xs text-gray-500">\${createdAt}</span></td>
            <td class="px-4 py-3 text-center">
              <button onclick="showTaskDetail('\${task.taskId}')" class="btn-action px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs">
                <i class="fas fa-eye"></i>
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function updateStats() {
      document.getElementById('statTotalAccounts').textContent = accounts.length;
      document.getElementById('statActiveSessions').textContent = accounts.filter(a => a.statusCookie === 'active').length;
      document.getElementById('statExpired').textContent = accounts.filter(a => a.statusCookie === 'expired').length;
      document.getElementById('statOnlineProxies').textContent = accounts.filter(a => a.statusProxy === 'online').length;
      document.getElementById('statTotalCredits').textContent = accounts.reduce((s, a) => s + (a.creditsLeft || 0), 0);
      document.getElementById('statActiveTasks').textContent = tasks.filter(t => t.status === 'processing' || t.status === 'queued').length;
    }

    // ========== ACCOUNT ACTIONS ==========
    function triggerLogin(id) {
      showToast('Info', \`Starting login for \${id}...\`, 'info');
      socket.emit('account:login', { id }, (result) => {
        if (result.success) {
          showToast('Success', 'Login successful!', 'success');
        } else {
          // Toast error sudah ditangani otomatis oleh emit global 'notification' dari backend
        }
      });
    }

    function checkCredits(id) {
      socket.emit('account:checkCredits', { id }, (result) => {
        if (result.success) {
          showToast('Credits', \`Account \${id}: \${result.credits} credits\`, 'info');
        } else {
          showToast('Error', result.error, 'error');
        }
      });
    }

    function checkProxy(id) {
      socket.emit('proxy:check', { id }, (result) => {
        if (result.success) {
          const status = result.result.online ? '🟢 Online' : '🔴 Offline';
          showToast('Proxy Check', \`\${status} (\${result.result.latency || '-'}ms)\`, result.result.online ? 'success' : 'error');
        } else {
          showToast('Error', result.error, 'error');
        }
      });
    }

    function deleteAccount(id) {
      if (!confirm(\`Delete account \${id}? This cannot be undone.\`)) return;
      socket.emit('account:delete', { id }, (result) => {
        if (result.success) {
          showToast('Deleted', \`Account \${id} deleted\`, 'success');
        } else {
          showToast('Error', result.error, 'error');
        }
      });
    }

    function checkAllProxies() {
      showToast('Info', 'Checking all proxies...', 'info');
      socket.emit('proxy:checkAll', {}, (result) => {
        showToast(result.success ? 'Done' : 'Error', result.success ? 'All proxies checked' : result.error, result.success ? 'success' : 'error');
      });
    }

    function loginAllExpired() {
      const expired = accounts.filter(a => a.statusCookie === 'expired');
      if (!expired.length) {
        showToast('Info', 'No expired accounts to login', 'info');
        return;
      }
      showToast('Info', \`Logging in \${expired.length} expired accounts...\`, 'info');
      expired.forEach(acc => {
        socket.emit('account:login', { id: acc.id });
      });
    }

    function refreshAll() {
      socket.emit('refresh:all', {}, () => {
        showToast('Refreshed', 'All data refreshed', 'info');
      });
    }

    // ========== MODALS ==========
    function openAddAccountModal() {
      document.getElementById('addAccountModal').classList.remove('hidden');
      document.getElementById('addAccountModal').classList.add('flex');
    }

    function closeModal(id) {
      document.getElementById(id).classList.add('hidden');
      document.getElementById(id).classList.remove('flex');
    }

    document.getElementById('addAccountForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('accEmail').value;
      const password = document.getElementById('accPassword').value;
      const host = document.getElementById('proxyHost').value;
      const port = document.getElementById('proxyPort').value;
      const user = document.getElementById('proxyUser').value;
      const pass = document.getElementById('proxyPass').value;

      let proxy = null;
      if (host && port) {
        proxy = user && pass
          ? \`http://\${user}:\${pass}@\${host}:\${port}\`
          : \`http://\${host}:\${port}\`;
      }

      socket.emit('account:add', { email, password, proxy }, (result) => {
        if (result.success) {
          closeModal('addAccountModal');
          document.getElementById('addAccountForm').reset();
          showToast('Success', \`Account \${email} added\`, 'success');
        } else {
          showToast('Error', result.error, 'error');
        }
      });
    });

    // ========== OTP MODAL ==========
    let otpTimerInterval;

    function showOTPModal(accountId, email) {
      document.getElementById('otpAccountId').value = accountId;
      document.getElementById('otpAccountEmail').textContent = email;
      document.getElementById('otpModal').classList.remove('hidden');
      document.getElementById('otpModal').classList.add('flex');

      // Clear previous inputs
      document.querySelectorAll('.otp-digit').forEach(input => { input.value = ''; });
      document.querySelectorAll('.otp-digit')[0].focus();

      // Start timer
      let timeLeft = 300;
      clearInterval(otpTimerInterval);
      otpTimerInterval = setInterval(() => {
        timeLeft--;
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        document.getElementById('otpTimer').textContent = \`\${mins}:\${secs.toString().padStart(2, '0')}\`;
        if (timeLeft <= 0) {
          clearInterval(otpTimerInterval);
          closeModal('otpModal');
          showToast('Timeout', 'OTP entry timed out', 'error');
        }
      }, 1000);
    }

    // OTP digit input handling
    document.querySelectorAll('.otp-digit').forEach((input, index) => {
      input.addEventListener('input', (e) => {
        const value = e.target.value;
        if (value && index < 5) {
          document.querySelectorAll('.otp-digit')[index + 1].focus();
        }
        // Auto-submit when all filled
        const allFilled = Array.from(document.querySelectorAll('.otp-digit')).every(i => i.value);
        if (allFilled) {
          document.getElementById('otpForm').dispatchEvent(new Event('submit'));
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) {
          document.querySelectorAll('.otp-digit')[index - 1].focus();
        }
      });

      // Allow paste
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\\D/g, '');
        document.querySelectorAll('.otp-digit').forEach((inp, i) => {
          if (paste[i]) inp.value = paste[i];
        });
        if (paste.length >= 6) {
          document.getElementById('otpForm').dispatchEvent(new Event('submit'));
        }
      });
    });

    document.getElementById('otpForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = Array.from(document.querySelectorAll('.otp-digit')).map(i => i.value).join('');
      if (code.length !== 6) {
        document.getElementById('otpError').textContent = 'Please enter all 6 digits';
        document.getElementById('otpError').classList.remove('hidden');
        return;
      }

      const accountId = document.getElementById('otpAccountId').value;
      document.getElementById('otpSubmitBtn').innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
      document.getElementById('otpSubmitBtn').disabled = true;

      socket.emit('otp:submit', { accountId, code }, (result) => {
        if (result.success) {
          clearInterval(otpTimerInterval);
          closeModal('otpModal');
          showToast('OTP Submitted', 'OTP code sent to Puppeteer', 'success');
        } else {
          document.getElementById('otpError').textContent = result.error || 'Failed to submit OTP';
          document.getElementById('otpError').classList.remove('hidden');
        }
        document.getElementById('otpSubmitBtn').innerHTML = '<i class="fas fa-check mr-2"></i>Submit OTP';
        document.getElementById('otpSubmitBtn').disabled = false;
      });
    });

    // ========== TABS ==========
    function switchTab(tab) {
      ['accounts', 'tasks', 'logs'].forEach(t => {
        document.getElementById(\`panel-\${t}\`).classList.toggle('hidden', t !== tab);
        document.getElementById(\`tab-\${t}\`).classList.toggle('tab-active', t === tab);
        document.getElementById(\`tab-\${t}\`).classList.toggle('text-gray-500', t !== tab);
      });

      if (tab === 'tasks') {
        socket.emit('tasks:get', {}, (t) => { tasks = t; renderTasks(); });
      }
    }

    // ========== TASK DETAIL ==========
    function showTaskDetail(taskId) {
      const task = tasks.find(t => t.taskId === taskId);
      if (task) {
        document.getElementById('taskDetailContent').textContent = JSON.stringify(task, null, 2);
        document.getElementById('taskDetailModal').classList.remove('hidden');
        document.getElementById('taskDetailModal').classList.add('flex');
      }
    }

    function clearCompletedTasks() {
      fetch('/admin/api/tasks/clear', { method: 'POST' }).catch(() => {});
      tasks = tasks.filter(t => t.status === 'processing' || t.status === 'queued');
      renderTasks();
    }

    // ========== UTILITIES ==========
    function maskProxy(proxy) {
      try {
        const url = new URL(proxy);
        return \`\${url.hostname}:\${url.port}\`;
      } catch {
        return proxy ? proxy.substring(0, 20) + '...' : '-';
      }
    }

    function showToast(title, message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const colors = {
        success: 'border-green-500 bg-green-500/10',
        error: 'border-red-500 bg-red-500/10',
        warning: 'border-yellow-500 bg-yellow-500/10',
        info: 'border-indigo-500 bg-indigo-500/10'
      };
      const icons = {
        success: 'fa-check-circle text-green-400',
        error: 'fa-exclamation-circle text-red-400',
        warning: 'fa-exclamation-triangle text-yellow-400',
        info: 'fa-info-circle text-indigo-400'
      };

      const toast = document.createElement('div');
      // Tambahkan 'select-text' agar bisa di-copy & z-50 agar di depan
      toast.className = \`toast-enter glass-card rounded-xl p-4 border-l-4 \${colors[type]} min-w-[300px] max-w-md select-text relative z-50\`;
      toast.innerHTML = \`
        <div class="flex items-start space-x-3">
          <i class="fas \${icons[type]} mt-0.5 shrink-0"></i>
          <div class="flex-1 overflow-hidden">
            <div class="text-sm font-semibold text-white">\${title}</div>
            <!-- break-words agar text error yang panjang tidak terpotong -->
            <div class="text-xs text-gray-300 mt-0.5 break-words whitespace-pre-wrap">\${message}</div>
          </div>
          <button onclick="this.parentElement.parentElement.remove()" class="text-gray-500 hover:text-white shrink-0">
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>
      \`;
      container.appendChild(toast);

      // Jika tipe 'error', biarkan popup stay di layar agar bisa di-copy.
      // Jika bukan error (info/success), hilangkan otomatis dalam 6 detik.
      if (type !== 'error') {
        setTimeout(() => toast.remove(), 6000);
      }
    }

    function addLog(message) {
      const el = document.getElementById('logOutput');
      const time = new Date().toLocaleTimeString();
      el.textContent += \`[\${time}] \${message}\\n\`;
      el.scrollTop = el.scrollHeight;
    }

    // ========== INITIAL LOAD ==========
    fetch('/admin/api/stats').then(r => r.json()).then(stats => {
      document.getElementById('statTotalAccounts').textContent = stats.totalAccounts;
      document.getElementById('statActiveSessions').textContent = stats.activeAccounts;
      document.getElementById('statExpired').textContent = stats.expiredAccounts;
      document.getElementById('statOnlineProxies').textContent = stats.onlineProxies;
      document.getElementById('statTotalCredits').textContent = stats.totalCredits;
      document.getElementById('statActiveTasks').textContent = stats.activeTasks;
    }).catch(()=>{});

    addLog('Dashboard initialized');
    addLog('Waiting for WebSocket connection...');
  </script>
</body>
</html>`;
}

module.exports = router;