class SocketHandler {
  constructor(io, modules) {
    this.io = io;
    this.accountManager = modules.accountManager;
    this.browserManager = modules.browserManager;
    this.sessionManager = modules.sessionManager;
    this.proxyChecker = modules.proxyChecker;
    this.sunoService = modules.sunoService;
    this.queueManager = modules.queueManager;

    this.init();
  }

  init() {
    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      // Send initial data
      socket.emit('accounts:updated', this.accountManager.getAllAccounts());
      socket.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));

      // Account Management
      socket.on('account:add', async (data, callback) => {
        try {
          const account = this.accountManager.addAccount(data);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { type: 'success', message: `Account ${data.email} added successfully` });
          if (callback) callback({ success: true, account });
        } catch (err) {
          logger.error('Add account error:', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      socket.on('account:delete', async (data, callback) => {
        try {
          await this.browserManager.close(data.id);
          this.accountManager.deleteAccount(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { type: 'success', message: `Account ${data.id} deleted` });
          if (callback) callback({ success: true });
        } catch (err) {
          logger.error('Delete account error:', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Login
      socket.on('account:login', async (data, callback) => {
        try {
          this.io.emit('notification', { type: 'info', message: `Starting login for ${data.id}...` });
          const result = await this.sessionManager.login(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          if (callback) callback(result);
        } catch (err) {
          logger.error('Login error:', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // OTP Submit
      socket.on('otp:submit', async (data, callback) => {
        try {
          const { accountId, code } = data;
          const result = this.sessionManager.submitOTP(accountId, code);
          if (result) {
            this.io.emit('notification', { type: 'info', message: `OTP submitted for ${accountId}` });
          }
          if (callback) callback({ success: result });
        } catch (err) {
          logger.error('OTP submit error:', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Credit Check
      socket.on('account:checkCredits', async (data, callback) => {
        try {
          const credits = await this.sunoService.checkCredits(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          if (callback) callback({ success: true, credits });
        } catch (err) {
          logger.error('Credit check error:', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Proxy Check
      socket.on('proxy:check', async (data, callback) => {
        try {
          const account = this.accountManager.getAccountRaw(data.id);
          if (account && account.proxy) {
            const result = await this.proxyChecker.check(account.proxy);
            const status = result.online ? 'online' : 'offline';
            this.accountManager.updateAccount(data.id, { statusProxy: status });
            this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
            if (callback) callback({ success: true, result });
          } else {
            if (callback) callback({ success: false, error: 'No proxy configured' });
          }
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Check all proxies
      socket.on('proxy:checkAll', async (data, callback) => {
        try {
          const accounts = this.accountManager.getAllAccounts();
          for (const acc of accounts) {
            const rawAcc = this.accountManager.getAccountRaw(acc.id);
            if (rawAcc && rawAcc.proxy) {
              const result = await this.proxyChecker.check(rawAcc.proxy);
              this.accountManager.updateAccount(acc.id, {
                statusProxy: result.online ? 'online' : 'offline'
              });
            }
          }
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          if (callback) callback({ success: true });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Get tasks
      socket.on('tasks:get', (data, callback) => {
        if (callback) callback(this.queueManager.getAllTasks().slice(0, 100));
      });

      // Refresh all data
      socket.on('refresh:all', async (data, callback) => {
        this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
        this.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
        if (callback) callback({ success: true });
      });

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });
  }
}

module.exports = SocketHandler;