const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browsers = new Map(); // accountId -> { browser, page }
    this.maxConcurrent = parseInt(process.env.BROWSER_POOL_SIZE) || 3;
  }

  parseProxy(proxyString) {
    if (!proxyString) return null;
    try {
      // Format: http://username:password@ip:port
      const url = new URL(proxyString);
      return {
        host: url.hostname,
        port: url.port,
        username: url.username || null,
        password: url.password || null,
        protocol: url.protocol.replace(':', ''),
        server: `${url.protocol}//${url.hostname}:${url.port}`
      };
    } catch (err) {
      logger.error('Failed to parse proxy:', err);
      return null;
    }
  }

  async launch(accountId, proxy = null) {
    // Close existing browser for this account if any
    await this.close(accountId);

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1920,1080',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ];

    const proxyConfig = this.parseProxy(proxy);
    if (proxyConfig) {
      args.push(`--proxy-server=${proxyConfig.server}`);
    }

    const launchOptions = {
      headless: process.env.PUPPETEER_HEADLESS !== 'false' ? 'new' : false,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args,
      defaultViewport: { width: 1920, height: 1080 },
      timeout: parseInt(process.env.PUPPETEER_TIMEOUT) || 60000,
      ignoreHTTPSErrors: true
    };

    try {
      const browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();

      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      });

      // Proxy authentication
      if (proxyConfig && proxyConfig.username) {
        await page.authenticate({
          username: proxyConfig.username,
          password: proxyConfig.password
        });
      }

      // Evade detection
      await page.evaluateOnNewDocument(() => {
        // Override WebDriver
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' }
          ]
        });

        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });

        // Chrome runtime
        window.chrome = {
          runtime: {},
          loadTimes: function () { },
          csi: function () { },
          app: {}
        };

        // Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);

        // WebGL
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          return getParameter.call(this, parameter);
        };
      });

      // Intercept requests for API monitoring
      const interceptedTokens = { bearer: null, cookies: null };

      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const headers = request.headers();
        if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
          interceptedTokens.bearer = headers['authorization'].replace('Bearer ', '');
        }
        request.continue();
      });

      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('studio-api.suno.ai') || url.includes('clerk')) {
          try {
            const headers = response.headers();
            if (headers['set-cookie']) {
              interceptedTokens.cookies = headers['set-cookie'];
            }
          } catch (e) { }
        }
      });

      this.browsers.set(accountId, { browser, page, interceptedTokens });
      logger.info(`Browser launched for account: ${accountId}`);
      return { browser, page, interceptedTokens };
    } catch (err) {
      logger.error(`Failed to launch browser for ${accountId}:`, err);
      throw err;
    }
  }

  async getPage(accountId) {
    const instance = this.browsers.get(accountId);
    if (!instance) return null;
    return instance.page;
  }

  async getInterceptedTokens(accountId) {
    const instance = this.browsers.get(accountId);
    if (!instance) return null;
    return instance.interceptedTokens;
  }

  async close(accountId) {
    const instance = this.browsers.get(accountId);
    if (instance) {
      try {
        await instance.browser.close();
      } catch (err) {
        logger.error(`Error closing browser for ${accountId}:`, err);
      }
      this.browsers.delete(accountId);
      logger.info(`Browser closed for account: ${accountId}`);
    }
  }

  async closeAll() {
    for (const [accountId] of this.browsers) {
      await this.close(accountId);
    }
  }

  isRunning(accountId) {
    return this.browsers.has(accountId);
  }

  getActiveBrowserCount() {
    return this.browsers.size;
  }
}

module.exports = BrowserManager;