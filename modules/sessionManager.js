const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
  }

  // Fungsi Instan: Import Cookie JSON dari Kiwi Browser / Cookie-Editor
  importCookieData(accountId, cookieJsonString) {
    try {
      let cookiesArray = [];
      if (typeof cookieJsonString === 'string') {
        cookiesArray = JSON.parse(cookieJsonString);
      } else {
        cookiesArray = cookieJsonString;
      }

      if (!Array.isArray(cookiesArray)) {
        throw new Error('Format cookie harus berupa JSON Array [ ... ]');
      }

      // 1. Cari Bearer Token (__session)
      const sessionCookie = cookiesArray.find(c => c.name === '__session' || c.name.startsWith('__session_'));
      if (!sessionCookie || !sessionCookie.value) {
        throw new Error('Cookie "__session" tidak ditemukan di dalam JSON!');
      }

      const bearerToken = sessionCookie.value;

      // 2. Format ulang seluruh cookies menjadi header string
      const cookiesHeader = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');

      // 3. Simpan permanen ke disk
      this.saveSession(accountId, {
        bearerToken,
        cookies: cookiesHeader
      });

      // 4. Update status akun menjadi Aktif
      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken,
        lastLogin: new Date().toISOString()
      });

      logger.info(`[Cookie Import] Akun ${accountId} berhasil diaktifkan lewat Cookie!`);
      return { success: true, bearerToken };
    } catch (err) {
      logger.error(`Cookie Import Error: ${err.message}`);
      throw err;
    }
  }

  saveSession(accountId, data) {
    const dir = path.join(__dirname, '..', 'sessions');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${accountId}.json`), JSON.stringify(data, null, 2));
  }

  loadSession(accountId) {
    const filePath = path.join(__dirname, '..', 'sessions', `${accountId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  async healthCheck(accountId) {
    const session = this.loadSession(accountId);
    if (!session || !session.bearerToken) {
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      return false;
    }
    return true;
  }
}

module.exports = SessionManager;