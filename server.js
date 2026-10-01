require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const winston = require('winston');

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

global.logger = logger;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

global.io = io;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Import modules
const AccountManager = require('./modules/accountManager');
const BrowserManager = require('./modules/browserManager');
const SessionManager = require('./modules/sessionManager');
const ProxyChecker = require('./modules/proxyChecker');
const QueueManager = require('./modules/queueManager');
const SunoService = require('./modules/sunoService');
const SocketHandler = require('./modules/socketHandler');

// Initialize modules
const accountManager = new AccountManager();
const browserManager = new BrowserManager();
const sessionManager = new SessionManager(browserManager, accountManager);
const proxyChecker = new ProxyChecker();
const queueManager = new QueueManager();
const sunoService = new SunoService(accountManager, browserManager, sessionManager, queueManager);

// Make modules globally available
app.locals.accountManager = accountManager;
app.locals.browserManager = browserManager;
app.locals.sessionManager = sessionManager;
app.locals.proxyChecker = proxyChecker;
app.locals.queueManager = queueManager;
app.locals.sunoService = sunoService;

// Socket.io handler
const socketHandler = new SocketHandler(io, {
  accountManager,
  browserManager,
  sessionManager,
  proxyChecker,
  sunoService,
  queueManager
});

// Routes
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    accounts: accountManager.getAccountCount(),
    activeJobs: queueManager.getActiveJobCount()
  });
});

app.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

// =========================================================================
// FITUR AUTOPILOT 24/7: REFRESH TOKEN TIAP 15 MENIT SEKALI SECARA OTOMATIS!
// =========================================================================
cron.schedule('*/15 * * * *', async () => {
  logger.info('Running Auto-Pilot token keep-alive...');
  try {
    const accounts = accountManager.getAllAccounts();
    for (const account of accounts) {
      if (account.statusCookie === 'active') {
        await sessionManager.refreshToken(account.id);
        const credits = await sunoService.checkCredits(account.id);
        io.emit('account:credits', { id: account.id, credits });
      }
    }
  } catch (err) {
    logger.error('Keep-alive token error:', err.message);
  }
});

// Scheduled task: Credit check berkala
cron.schedule('*/10 * * * *', async () => {
  try {
    const accounts = accountManager.getAllAccounts();
    for (const account of accounts) {
      if (account.statusCookie === 'active') {
        const credits = await sunoService.checkCredits(account.id);
        accountManager.updateAccount(account.id, { creditsLeft: credits });
      }
    }
    io.emit('accounts:updated', accountManager.getAllAccounts());
  } catch (err) {}
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

process.on('uncaughtException', (err) => { logger.error('Uncaught Exception:', err); });
process.on('unhandledRejection', (err) => { logger.error('Unhandled Rejection:', err); });

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  logger.info(`🚀 Suno Engine running on http://${HOST}:${PORT}`);
});