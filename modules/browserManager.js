const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() { this.browsers = new Map(); }

  async launch(accountId, proxy = null) {
    await this.close(accountId);
    const args = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
      '--disable-gpu', '--window-size=800,600' // Ukuran kecil agar ringan
    ];
    
    if (proxy) args.push(`--proxy-server=${proxy}`);

    const browser = await puppeteer.launch({
      headless: "new",
      args,
      protocolTimeout: 120000 // Naikkan batas timeout internal
    });

    const page = await browser.newPage();
    
    // BLOKIR SEMUA BEBAN BERAT (CSS, IMAGE, MEDIA, FONT)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'stylesheet', 'other'].includes(type)) {
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
      try { await instance.browser.close(); } catch (e) {}
      this.browsers.delete(accountId);
    }
  }
}
module.exports = BrowserManager;