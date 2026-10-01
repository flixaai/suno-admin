const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browsers = new Map();
  }

  // Fungsi untuk memecah string proxy (http://user:pass@host:port)
  parseProxy(proxyString) {
    if (!proxyString) return null;
    try {
      const url = new URL(proxyString.includes('://') ? proxyString : `http://${proxyString}`);
      return {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username || null,
        password: url.password || null
      };
    } catch (e) {
      // Jika format simple host:port
      return { server: `http://${proxyString}`, username: null, password: null };
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

    if (proxyConfig) {
      args.push(`--proxy-server=${proxyConfig.server}`);
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args,
      protocolTimeout: 120000
    });

    const page = await browser.newPage();

    // --- PENTING: TANGANI USERNAME & PASSWORD PROXY DI SINI ---
    if (proxyConfig && proxyConfig.username && proxyConfig.password) {
      await page.authenticate({
        username: proxyConfig.username,
        password: proxyConfig.password
      });
      console.log(`[Proxy] Terautentikasi untuk akun: ${accountId}`);
    }

    // Blokir beban berat agar Railway tetap ringan
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