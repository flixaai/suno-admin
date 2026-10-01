const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
    this.brightDataWS = process.env.BRIGHT_DATA_WS || 'wss://brd-customer-hl_c154ff17-zone-suno_browser:ar1oslh5xtvr@brd.superproxy.io:9222';
  }

  // DEKODER BASE64URL RESMI (MENCEGAH ERROR SALAH BACA TOKEN)
  decodeJwt(token) {
    try {
      let base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) { base64 += '='; }
      const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
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

  async refreshToken(accountId) {
    let browser = null;
    try {
      const session = this.loadSession(accountId);
      if (!session || !session.cookies) return false;

      logger.info(`[Bright Data Keep-Alive] Menjalankan Penjaga Sesi Cloud untuk ${accountId}...`);

      browser = await puppeteer.connect({ browserWSEndpoint: this.brightDataWS });
      const page = await browser.newPage();

      const cookieObjects = session.cookies.split('; ').map(c => {
        const [name, ...val] = c.split('=');
        return { name: name.trim(), value: val.join('=').trim(), domain: '.suno.com', path: '/' };
      });

      await page.setCookie(...cookieObjects);
      await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => window.Clerk && window.Clerk.isReady, { timeout: 20000 });

      const newToken = await page.evaluate(async () => {
        if (window.Clerk && window.Clerk.session) {
          return await window.Clerk.session.getToken();
        }
        return null;
      });

      if (newToken) {
        session.bearerToken = newToken;
        this.saveSession(accountId, session);
        this.accountManager.updateAccount(accountId, {
          bearerToken: newToken,
          statusCookie: 'active',
          lastLogin: new Date().toISOString()
        });
        logger.info(`[Bright Data SUCCESS] Token berhasil diperpanjang 1 jam ke depan secara otomatis!`);
        return true;
      }
    } catch (err) {
      logger.warn(`[Bright Data Keep-Alive Error] ${err.message}`);
    } finally {
      if (browser) {
        try { await browser.close(); } catch(e) {}
      }
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