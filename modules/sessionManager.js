const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
    this.settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
  }

  getBrightDataWS() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const s = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        if (s.brightDataWS) return s.brightDataWS;
      }
    } catch (e) {}
    return process.env.BRIGHT_DATA_WS || 'wss://brd-customer-hl_c154ff17-zone-suno_browser:ar1oslh5xtvr@brd.superproxy.io:9222';
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

      const wsUrl = this.getBrightDataWS();
      browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
      const page = await browser.newPage();

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
        logger.info(`[Bright Data SUCCESS] Token berhasil diperpanjang otomatis!`);
        return true;
      }
    } catch (err) {
      logger.warn(`[Bright Data Keep-Alive Error] ${err.message}`);
    } finally {
      if (browser) try { await browser.close(); } catch(e) {}
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