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

      // Kirim data awal
      socket.emit('accounts:updated', this.accountManager.getAllAccounts());
      socket.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));

      // Tambah Akun Biasa
      socket.on('account:add', async (data, callback) => {
        try {
          const account = this.accountManager.addAccount(data);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { type: 'success', message: `Akun ${data.email} berhasil ditambahkan` });
          if (callback) callback({ success: true, account });
        } catch (err) {
          logger.error('Add account error:', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // FITUR BARU: Tambah Akun + Import Cookie JSON Sekaligus!
      socket.on('account:importCookie', async (data, callback) => {
        try {
          const { email, cookieJson, proxy } = data;
          const account = this.accountManager.addAccount({ email, password: 'imported_cookie', proxy });
          
          this.sessionManager.importCookieData(account.id, cookieJson);

          // Otomatis cek credit akun
          let credits = 0;
          try {
            credits = await this.sunoService.checkCredits(account.id);
          } catch (e) {
            logger.warn('Initial credit check failed:', e.message);
          }

          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { 
            type: 'success', 
            message: `Akun ${email} AKTIF! Saldo Kredit: ${credits}` 
          });

          if (callback) callback({ success: true, account, credits });
        } catch (err) {
          logger.error('Import Cookie error:', err.message);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // FITUR BARU: Generate Musik Langsung dari Dashboard Admin!
      socket.on('song:generate', async (data, callback) => {
        try {
          this.io.emit('notification', { type: 'info', message: 'Memulai proses pembuatan lagu...' });
          const result = await this.sunoService.generateSong(data.accountId || null, {
            prompt: data.prompt,
            lyrics: data.lyrics,
            style: data.style,
            title: data.title,
            isCustom: !!(data.lyrics || data.style || data.title),
            instrumental: !!data.instrumental,
            modelVersion: data.modelVersion || 'v4'
          });

          this.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
          if (callback) callback({ success: true, result });
        } catch (err) {
          logger.error('Song Generate Error:', err.message);
          this.io.emit('notification', { type: 'error', message: `Gagal bikin lagu: ${err.message}` });
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Hapus Akun
      socket.on('account:delete', async (data, callback) => {
        try {
          this.accountManager.deleteAccount(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { type: 'success', message: `Akun ${data.id} dihapus` });
          if (callback) callback({ success: true });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Cek Kredit
      socket.on('account:checkCredits', async (data, callback) => {
        try {
          const credits = await this.sunoService.checkCredits(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { type: 'info', message: `Saldo Kredit ${data.id}: ${credits}` });
          if (callback) callback({ success: true, credits });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Refresh All
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