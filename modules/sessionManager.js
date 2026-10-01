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

  // Helper untuk membaca isi token & tanggal kadaluarsa
  decodeJwt(token) {
    try {
      const base64Payload = token.split('.')[1];
      const payload = Buffer.from(base64Payload, 'base64').toString('utf8');
      return JSON.parse(payload);
    } catch (e) {
      return null;
    }
  }

  // Cek apakah token tinggal kurang dari 5 menit sebelum kadaluarsa
  isTokenExpiring(token) {
    const payload = this.decodeJwt(token);
    if (!payload || !payload.exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp - now < 300; // kurang dari 5 menit
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

  // =========================================================================
  // MESIN AUTO-REFRESH 24/7 (MEMPERPANJANG TOKEN TANPA INPUT COOKIE LAGI)
  // =========================================================================
  async refreshToken(accountId) {
    try {
      const session = this.loadSession(accountId);
      if (!session || !session.cookies || !session.bearerToken) return false;

      const payload = this.decodeJwt(session.bearerToken);
      const sessionId = payload?.sid;

      logger.info(`[Auto-Pilot] Memperbarui sesi Suno secara mandiri untuk ${accountId}...`);

      const headers = {
        'Cookie': session.cookies,
        'Origin': 'https://suno.com',
        'Referer': 'https://suno.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      };

      let newToken = null;

      // Jalur 1: Minting Token Baru via Session ID Resmi Clerk
      if (sessionId) {
        try {
          const res = await axios.post(
            `https://clerk.suno.com/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=5.0.0`,
            {},
            { headers, timeout: 15000 }
          );
          newToken = res.data?.jwt || res.data?.response?.jwt;
        } catch (e) {}
      }

      // Jalur 2: Ambil Token Aktif via Client State
      if (!newToken) {
        try {
          const res = await axios.get('https://clerk.suno.com/v1/client?_clerk_js_version=5.0.0', {
            headers,
            timeout: 15000
          });
          const client = res.data?.response;
          if (client && client.sessions && client.sessions.length > 0) {
            const active = client.sessions.find(s => s.status === 'active') || client.sessions[0];
            newToken = active.last_active_token?.jwt;
          }
        } catch (e) {}
      }

      if (newToken) {
        session.bearerToken = newToken;
        this.saveSession(accountId, session);
        this.accountManager.updateAccount(accountId, {
          bearerToken: newToken,
          statusCookie: 'active',
          lastLogin: new Date().toISOString()
        });
        logger.info(`[Auto-Pilot SUCCESS] Token berhasil diperpanjang 1 jam ke depan!`);
        return true;
      }
    } catch (err) {
      logger.warn(`[Auto-Pilot Warning] Gagal refresh: ${err.message}`);
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