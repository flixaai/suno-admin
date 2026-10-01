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
      '--disable-gpu', '--window-size=1280,720'
    ];
    
    if (proxy) args.push(`--proxy-server=${proxy}`);

    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args
    });

    const page = await browser.newPage();
    
    // --- FITUR BARU: BLOKIR BEBAN BERAT ---
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      // Blokir gambar, media (audio/video), fonts, dan stylesheet agar Suno terbuka dalam 3 detik
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
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