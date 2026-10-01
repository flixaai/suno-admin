const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browsers = new Map();
  }

  // Fungsi Parser Proxy Khusus Chrome
  parseProxy(proxyStr) {
    if (!proxyStr) return null;
    try {
      let str = proxyStr.trim();
      if (!str.startsWith('http://') && !str.startsWith('https://')) {
        str = 'http://' + str;
      }
      const parsed = new URL(str);
      return {
        // PERBAIKAN: Murni hanya host:port (Tanpa User & Pass!)
        server: `http://${parsed.hostname}:${parsed.port || '80'}`,
        username: parsed.username ? decodeURIComponent(parsed.username) : null,
        password: parsed.password ? decodeURIComponent(parsed.password) : null
      };
    } catch (e) {
      logger.error('Proxy format error:', e.message);
      return null;
    }
  }

  async launch(accountId, proxy = null) {
    await this.close(accountId);

    const proxyConfig = this.parseProxy(proxy);
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--window-size=1280,720'
    ];

    // Masukkan HANYA server IP:Port ke Chrome flag
    if (proxyConfig && proxyConfig.server) {
      args.push(`--proxy-server=${proxyConfig.server}`);
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args,
      protocolTimeout: 120000
    });

    const page = await browser.newPage();

    // Autentikasi Username & Password Proxy secara terpisah
    if (proxyConfig && proxyConfig.username && proxyConfig.password) {
      await page.authenticate({
        username: proxyConfig.username,
        password: proxyConfig.password
      });
      logger.info(`[Proxy Auth] Authenticated for ${accountId}`);
    }

    // Filter beban berat agar ringan
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'other'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    this.browsers.set(accountId, { browser, page });
    return { browser, page };
  }

  async close(accountId) {
    const instance = this.browsers.get(accountId);
    if (instance) {
      try {
        await instance.browser.close();
      } catch (e) {}
      this.browsers.delete(accountId);
    }
  }
}

module.exports = BrowserManager;