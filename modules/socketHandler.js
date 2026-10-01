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

  getAllGeneratedSongs() {
    const tasks = this.queueManager.getAllTasks();
    const songs = [];
    tasks.forEach(t => {
      if (t.result && Array.isArray(t.result)) {
        t.result.forEach(r => songs.push({ ...r, taskId: t.taskId }));
      }
    });
    return songs;
  }

  init() {
    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      // Kirim data akun, tasks, dan semua lagu yang tersimpan permanen
      socket.emit('accounts:updated', this.accountManager.getAllAccounts());
      socket.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
      socket.emit('songs:loaded', this.getAllGeneratedSongs());

      // Tarik Lagu Permanen
      socket.on('songs:get', (data, callback) => {
        if (callback) callback(this.getAllGeneratedSongs());
      });

      // Tambah Akun / Import Cookie
      socket.on('account:importCookie', async (data, callback) => {
        try {
          const { email, cookieJson } = data;
          const account = this.accountManager.addAccount({ email, password: 'imported_cookie', proxy: null });
          
          this.sessionManager.importCookieData(account.id, cookieJson);

          let credits = 0;
          try {
            credits = await this.sunoService.checkCredits(account.id);
          } catch (e) {}

          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('account:credits', { id: account.id, credits });
          this.io.emit('notification', { type: 'success', message: `Akun ${email} AKTIF! Kredit: ${credits}` });

          if (callback) callback({ success: true, account, credits });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Generate Musik
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
            modelVersion: data.modelVersion || 'v6-mini'
          });

          this.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
          if (callback) callback({ success: true, result });
        } catch (err) {
          this.io.emit('notification', { type: 'error', message: `Gagal bikin lagu: ${err.message}` });
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Cek Saldo
      socket.on('account:checkCredits', async (data, callback) => {
        try {
          const credits = await this.sunoService.checkCredits(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('account:credits', { id: data.id, credits });
          this.io.emit('notification', { type: 'info', message: `Saldo Kredit: ${credits}` });
          if (callback) callback({ success: true, credits });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Delete Akun
      socket.on('account:delete', async (data, callback) => {
        try {
          this.accountManager.deleteAccount(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          if (callback) callback({ success: true });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // Refresh All
      socket.on('refresh:all', async (data, callback) => {
        const accounts = this.accountManager.getAllAccounts();
        for (const acc of accounts) {
          try {
            await this.sunoService.checkCredits(acc.id);
          } catch(e) {}
        }
        this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
        this.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
        this.io.emit('songs:loaded', this.getAllGeneratedSongs());
        this.io.emit('notification', { type: 'success', message: 'Semua data & saldo berhasil di-refresh!' });
        if (callback) callback({ success: true });
      });

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });
  }
}

module.exports = SocketHandler;