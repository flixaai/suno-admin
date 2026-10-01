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

  async syncAllSongs() {
    try {
      const cloudSongs = await this.sunoService.getMyFeed();
      return cloudSongs;
    } catch (e) {
      return [];
    }
  }

  init() {
    this.io.on('connection', async (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      socket.emit('accounts:updated', this.accountManager.getAllAccounts());
      socket.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));

      const songs = await this.syncAllSongs();
      socket.emit('songs:loaded', songs);

      // IMPORT COOKIE: Update akun yang ada tanpa menduplikasi
      socket.on('account:importCookie', async (data, callback) => {
        try {
          const { email, cookieJson } = data;
          const account = this.accountManager.addOrUpdateAccount({ email, password: 'imported_cookie', proxy: null });
          this.sessionManager.importCookieData(account.id, cookieJson);

          let credits = 260;
          try { credits = await this.sunoService.checkCredits(account.id); } catch (e) {}

          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('account:credits', { id: account.id, credits });
          this.io.emit('notification', { type: 'success', message: `Akun ${email} aktif dengan token segar!` });

          const newSongs = await this.syncAllSongs();
          this.io.emit('songs:loaded', newSongs);

          if (callback) callback({ success: true, account, credits });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // GENERATE LAGU (MENGGUNAKAN AKUN AKTIF TERBAIK)
      socket.on('song:generate', async (data, callback) => {
        try {
          this.io.emit('notification', { type: 'info', message: 'Memulai proses pembuatan lagu...' });
          const result = await this.sunoService.generateSong(null, {
            prompt: data.prompt, lyrics: data.lyrics, style: data.style,
            title: data.title, isCustom: !!(data.lyrics || data.style || data.title),
            instrumental: !!data.instrumental, modelVersion: data.modelVersion || 'v6-mini'
          });

          this.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
          if (callback) callback({ success: true, result });
        } catch (err) {
          this.io.emit('notification', { type: 'error', message: `Gagal bikin lagu: ${err.message}` });
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // DELETE AKUN (LANGSUNG HAPUS TANPA MACET)
      socket.on('account:delete', async (data, callback) => {
        try {
          this.accountManager.deleteAccount(data.id);
          this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
          this.io.emit('notification', { type: 'info', message: `Akun ${data.id} berhasil dihapus` });
          if (callback) callback({ success: true });
        } catch (err) {
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // REFRESH ALL
      socket.on('refresh:all', async (data, callback) => {
        const accounts = this.accountManager.getAllAccounts();
        for (const acc of accounts) {
          try { await this.sunoService.checkCredits(acc.id); } catch(e) {}
        }
        const songs = await this.syncAllSongs();
        this.io.emit('accounts:updated', this.accountManager.getAllAccounts());
        this.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
        this.io.emit('songs:loaded', songs);
        this.io.emit('notification', { type: 'success', message: 'Data dan lagu berhasil diperbarui!' });
        if (callback) callback({ success: true });
      });

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

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });
  }
}

module.exports = SocketHandler;