const axios = require('axios');

class CaptchaSolver {
  constructor() {
    this.provider = process.env.CAPTCHA_PROVIDER || 'capsolver';
    this.capsolverKey = process.env.CAPSOLVER_API_KEY || '';
    this.twocaptchaKey = process.env.TWOCAPTCHA_API_KEY || '';
  }

  async solveTurnstile(siteKey, pageUrl) {
    if (this.provider === 'capsolver') {
      return this.solveTurnstileCapsolver(siteKey, pageUrl);
    } else if (this.provider === '2captcha') {
      return this.solveTurnstile2Captcha(siteKey, pageUrl);
    }
    throw new Error(`Unknown CAPTCHA provider: ${this.provider}`);
  }

  async solveTurnstileCapsolver(siteKey, pageUrl) {
    try {
      logger.info('Solving Turnstile CAPTCHA via CapSolver...');

      // Create task
      const createRes = await axios.post('https://api.capsolver.com/createTask', {
        appId: '9E1A5528-D09E-4B46-AB67-83A8B1EA2B45',
        clientKey: this.capsolverKey,
        task: {
          type: 'AntiTurnstileTaskProxyLess',
          websiteURL: pageUrl,
          websiteKey: siteKey,
          metadata: { action: 'managed' }
        }
      });

      if (createRes.data.errorId !== 0) {
        throw new Error(`CapSolver create task error: ${createRes.data.errorDescription}`);
      }

      const taskId = createRes.data.taskId;
      logger.info(`CapSolver task created: ${taskId}`);

      // Poll for result
      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 3000));

        const resultRes = await axios.post('https://api.capsolver.com/getTaskResult', {
          clientKey: this.capsolverKey,
          taskId
        });

        if (resultRes.data.status === 'ready') {
          logger.info('Turnstile CAPTCHA solved successfully');
          return resultRes.data.solution.token;
        }

        if (resultRes.data.errorId !== 0) {
          throw new Error(`CapSolver error: ${resultRes.data.errorDescription}`);
        }

        attempts++;
      }

      throw new Error('CAPTCHA solving timed out');
    } catch (err) {
      logger.error('CapSolver error:', err.message);
      throw err;
    }
  }

  async solveTurnstile2Captcha(siteKey, pageUrl) {
    try {
      logger.info('Solving Turnstile CAPTCHA via 2Captcha...');

      const createRes = await axios.get('https://2captcha.com/in.php', {
        params: {
          key: this.twocaptchaKey,
          method: 'turnstile',
          sitekey: siteKey,
          pageurl: pageUrl,
          json: 1
        }
      });

      if (createRes.data.status !== 1) {
        throw new Error(`2Captcha error: ${createRes.data.request}`);
      }

      const requestId = createRes.data.request;
      logger.info(`2Captcha request: ${requestId}`);

      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 5000));

        const resultRes = await axios.get('https://2captcha.com/res.php', {
          params: {
            key: this.twocaptchaKey,
            action: 'get',
            id: requestId,
            json: 1
          }
        });

        if (resultRes.data.status === 1) {
          logger.info('Turnstile CAPTCHA solved successfully');
          return resultRes.data.request;
        }

        if (resultRes.data.request !== 'CAPCHA_NOT_READY') {
          throw new Error(`2Captcha error: ${resultRes.data.request}`);
        }

        attempts++;
      }

      throw new Error('CAPTCHA solving timed out');
    } catch (err) {
      logger.error('2Captcha error:', err.message);
      throw err;
    }
  }

  async solveHCaptcha(siteKey, pageUrl) {
    if (this.provider === 'capsolver') {
      try {
        const createRes = await axios.post('https://api.capsolver.com/createTask', {
          clientKey: this.capsolverKey,
          task: {
            type: 'HCaptchaTaskProxyLess',
            websiteURL: pageUrl,
            websiteKey: siteKey
          }
        });

        if (createRes.data.errorId !== 0) {
          throw new Error(`CapSolver error: ${createRes.data.errorDescription}`);
        }

        const taskId = createRes.data.taskId;
        let attempts = 0;

        while (attempts < 60) {
          await new Promise(r => setTimeout(r, 3000));
          const resultRes = await axios.post('https://api.capsolver.com/getTaskResult', {
            clientKey: this.capsolverKey,
            taskId
          });

          if (resultRes.data.status === 'ready') {
            return resultRes.data.solution.gRecaptchaResponse;
          }
          attempts++;
        }

        throw new Error('hCaptcha solving timed out');
      } catch (err) {
        logger.error('hCaptcha solving error:', err.message);
        throw err;
      }
    }
    throw new Error('Provider not supported for hCaptcha');
  }

  async injectCaptchaSolution(page, token) {
    try {
      await page.evaluate((t) => {
        // Turnstile callback
        const iframes = document.querySelectorAll('iframe[src*="turnstile"]');
        if (iframes.length > 0) {
          const input = document.querySelector('[name="cf-turnstile-response"]');
          if (input) {
            input.value = t;
          }
          // Try calling the callback
          if (window.turnstileCallback) {
            window.turnstileCallback(t);
          }
        }

        // Generic hidden input
        const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
        hiddenInputs.forEach(input => {
          if (input.name && input.name.includes('captcha')) {
            input.value = t;
          }
        });
      }, token);

      logger.info('CAPTCHA solution injected into page');
    } catch (err) {
      logger.error('Failed to inject CAPTCHA solution:', err.message);
    }
  }
}

module.exports = CaptchaSolver;