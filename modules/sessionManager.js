const fs = require('fs');
const path = require('path');
const axios = require('axios');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
  }

  importCookieData(accountId, cookieJsonString) {
    try {
      let cookiesArray = typeof cookieJsonString === 'string' ? JSON.parse(cookieJsonString) : cookieJsonString;
      if (!Array.isArray(cookiesArray)) throw new Error('Format cookie harus berupa JSON Array [ ... ]');

      const sessionCookie = cookiesArray.find(c => c.name === '__session' || c.name.startsWith('__session_'));
      if (!sessionCookie || !sessionCookie.value) throw new Error('Cookie "__session" tidak ditemukan!');

      const bearerToken = sessionCookie.value;
      const cookiesHeader = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');

      this.saveSession(accountId, { bearerToken, cookies: cookiesHeader });
      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken,
        lastLogin: new Date().toISOString()
      });

      return { success: true, bearerToken };
    } catch (err) {
      logger.error(`Cookie Import Error: ${err.message}`);
      throw err;
    }
  }

  // FUNGSI SAKTI: Auto Refresh Token jika 1 jam kadaluarsa
  async refreshToken(accountId) {
    try {
      const session = this.loadSession(accountId);
      if (!session || !session.cookies) return false;

      logger.info(`[Auto-Refresh] Memperbarui token kadaluarsa untuk ${accountId}...`);

      const res = await axios.get('https://clerk.suno.com/v1/client?_clerk_js_version=5.0.0', {
        headers: {
          'Cookie': session.cookies,
          'Origin': 'https://suno.com',
          'Referer': 'https://suno.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });

      const client = res.data?.response;
      if (client && client.sessions && client.sessions.length > 0) {
        const active = client.sessions.find(s => s.status === 'active') || client.sessions[0];
        const newToken = active.last_active_token?.jwt;

        if (newToken) {
          session.bearerToken = newToken;
          this.saveSession(accountId, session);
          this.accountManager.updateAccount(accountId, { bearerToken: newToken, statusCookie: 'active' });
          logger.info(`[Auto-Refresh] Token berhasil diperpanjang otomatis!`);
          return true;
        }
      }
    } catch (err) {
      logger.warn(`[Auto-Refresh] Tidak dapat memperpanjang otomatis: ${err.message}`);
    }
    return false;
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
}

module.exports = SessionManager;