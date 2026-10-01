const fs = require('fs');
const path = require('path');
const CaptchaSolver = require('./captchaSolver');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.captchaSolver = new CaptchaSolver();
    this.otpCallbacks = new Map(); // accountId -> resolve function
    this.loginLocks = new Set(); // prevent concurrent logins
  }

  async login(accountId) {
    if (this.loginLocks.has(accountId)) {
      logger.warn(`Login already in progress for ${accountId}`);
      return { success: false, error: 'Login already in progress' };
    }

    this.loginLocks.add(accountId);

    try {
      const account = this.accountManager.getAccountRaw(accountId);
      if (!account) {
        throw new Error(`Account not found: ${accountId}`);
      }

      logger.info(`Starting login for ${accountId} (${account.email})`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      // Launch browser with proxy
      const { browser, page, interceptedTokens } = await this.browserManager.launch(accountId, account.proxy);

      const sunoUrl = process.env.SUNO_BASE_URL || 'https://suno.com';

      // Navigate to Suno
      await page.goto(sunoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(2000, 4000);

      // Check for Cloudflare challenge
      const hasCloudflareCaptcha = await this.detectCloudflare(page);
      if (hasCloudflareCaptcha) {
        logger.info(`Cloudflare detected for ${accountId}, attempting to solve...`);
        await this.handleCloudflare(page);
        await this.randomDelay(3000, 5000);
      }

      // Click Sign In button
      try {
        await page.waitForSelector('button:has-text("Sign In"), button:has-text("Sign in"), a:has-text("Sign In"), [data-testid="sign-in-button"]', { timeout: 15000 });
        const signInBtn = await page.$('button:has-text("Sign In")') ||
          await page.$('button:has-text("Sign in")') ||
          await page.$('a:has-text("Sign In")') ||
          await page.$('[data-testid="sign-in-button"]');
        if (signInBtn) {
          await signInBtn.click();
          await this.randomDelay(2000, 4000);
        }
      } catch (err) {
        logger.info('Sign in button not found, trying direct navigation...');
        // Try Clerk sign-in URL directly
        await page.goto(`${sunoUrl}/sign-in`, { waitUntil: 'networkidle2', timeout: 30000 });
        await this.randomDelay(2000, 3000);
      }

      // Look for email input (Clerk auth)
      await page.waitForSelector('input[name="identifier"], input[type="email"], input[name="emailAddress"]', { timeout: 20000 });

      // Type email
      const emailInput = await page.$('input[name="identifier"]') ||
        await page.$('input[type="email"]') ||
        await page.$('input[name="emailAddress"]');

      if (!emailInput) {
        throw new Error('Email input not found');
      }

      await emailInput.click({ clickCount: 3 });
      await this.randomDelay(300, 600);
      await emailInput.type(account.email, { delay: this.randomInt(50, 150) });
      await this.randomDelay(500, 1000);

      // Click continue/next
      const continueBtn = await page.$('button[type="submit"]') ||
        await page.$('button:has-text("Continue")') ||
        await page.$('button:has-text("Next")');

      if (continueBtn) {
        await continueBtn.click();
        await this.randomDelay(2000, 4000);
      }

      // Check if password field appears or OTP is requested
      const passwordField = await page.$('input[name="password"], input[type="password"]');
      const otpField = await page.$('input[name="code"], input[data-testid="otp-input"]');

      if (passwordField) {
        // Password-based login
        await passwordField.click({ clickCount: 3 });
        await this.randomDelay(300, 600);
        await passwordField.type(account.password, { delay: this.randomInt(50, 150) });
        await this.randomDelay(500, 1000);

        const submitBtn = await page.$('button[type="submit"]') ||
          await page.$('button:has-text("Sign in")') ||
          await page.$('button:has-text("Continue")');

        if (submitBtn) {
          await submitBtn.click();
          await this.randomDelay(3000, 5000);
        }

        // Check if OTP is needed after password
        const postLoginOtp = await page.$('input[name="code"]');
        if (postLoginOtp) {
          await this.handleOTP(accountId, page);
        }
      } else if (otpField) {
        // OTP-only login (no password)
        await this.handleOTP(accountId, page);
      } else {
        // Maybe email link or other auth - try OTP approach
        logger.info(`Checking for email code verification for ${accountId}...`);
        await this.randomDelay(2000, 4000);

        // Check if there's an OTP input that appeared
        const codeInput = await page.$('input[name="code"]') ||
          await page.$('input[data-testid="otp-input"]') ||
          await page.$('.cl-otpCodeFieldInput');

        if (codeInput) {
          await this.handleOTP(accountId, page);
        } else {
          // Try to detect the strategy text on page
          const pageContent = await page.content();
          if (pageContent.includes('email_code') || pageContent.includes('verification code') ||
            pageContent.includes('Enter the code')) {
            await this.handleOTP(accountId, page);
          }
        }
      }

      // Wait for successful login / navigation
      await this.randomDelay(3000, 5000);

      // Check if we're logged in
      const isLoggedIn = await this.verifyLogin(page);

      if (isLoggedIn) {
        // Extract session data
        const sessionData = await this.extractSession(page, accountId);
        await this.saveSession(accountId, sessionData);

        this.accountManager.updateAccount(accountId, {
          statusCookie: 'active',
          bearerToken: sessionData.bearerToken,
          lastLogin: new Date().toISOString()
        });

        global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
        global.io.emit('notification', {
          type: 'success',
          message: `Login successful for ${account.email}`
        });

        logger.info(`Login successful for ${accountId}`);

        // Close browser after extracting tokens (we use API from now on)
        await this.browserManager.close(accountId);

        return { success: true };
      } else {
        throw new Error('Login verification failed - not logged in after authentication');
      }
    } catch (err) {
      logger.error(`Login failed for ${accountId}:`, err.message);

      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'expired' });
      global.io.emit('notification', {
        type: 'error',
        message: `Login failed for ${accountId}: ${err.message}`
      });

      await this.browserManager.close(accountId);
      return { success: false, error: err.message };
    } finally {
      this.loginLocks.delete(accountId);
    }
  }

  async handleOTP(accountId, page) {
    const account = this.accountManager.getAccountRaw(accountId);
    logger.info(`OTP required for ${accountId} (${account.email})`);

    this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
    global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });

    // Emit OTP request to admin dashboard
    global.io.emit('otp:required', {
      accountId,
      email: account.email,
      timestamp: new Date().toISOString()
    });

    // Wait for OTP from admin
    const otpCode = await this.waitForOTP(accountId, 300000); // 5 min timeout

    if (!otpCode) {
      throw new Error('OTP timeout - no code provided within 5 minutes');
    }

    logger.info(`OTP received for ${accountId}: ${otpCode}`);

    // Find and fill OTP inputs
    const otpInputs = await page.$$('input[name="code"], input.cl-otpCodeFieldInput, input[data-testid*="otp"]');

    if (otpInputs.length >= 6) {
      // Individual digit inputs
      for (let i = 0; i < 6 && i < otpInputs.length; i++) {
        await otpInputs[i].click();
        await this.randomDelay(100, 200);
        await otpInputs[i].type(otpCode[i], { delay: 50 });
        await this.randomDelay(100, 200);
      }
    } else if (otpInputs.length === 1) {
      // Single input for all digits
      await otpInputs[0].click({ clickCount: 3 });
      await this.randomDelay(200, 400);
      await otpInputs[0].type(otpCode, { delay: 100 });
    } else {
      // Try to find any input that looks like OTP
      const anyInput = await page.$('input[type="text"], input[type="number"]');
      if (anyInput) {
        await anyInput.click({ clickCount: 3 });
        await anyInput.type(otpCode, { delay: 100 });
      }
    }

    await this.randomDelay(1000, 2000);

    // Try to submit
    const verifyBtn = await page.$('button[type="submit"]') ||
      await page.$('button:has-text("Verify")') ||
      await page.$('button:has-text("Continue")');

    if (verifyBtn) {
      await verifyBtn.click();
    }

    await this.randomDelay(3000, 5000);
  }

  waitForOTP(accountId, timeout = 300000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.otpCallbacks.delete(accountId);
        resolve(null);
      }, timeout);

      this.otpCallbacks.set(accountId, (code) => {
        clearTimeout(timer);
        this.otpCallbacks.delete(accountId);
        resolve(code);
      });
    });
  }

  submitOTP(accountId, code) {
    const callback = this.otpCallbacks.get(accountId);
    if (callback) {
      callback(code);
      return true;
    }
    return false;
  }

  async detectCloudflare(page) {
    try {
      const content = await page.content();
      return content.includes('challenge-platform') ||
        content.includes('cf-turnstile') ||
        content.includes('Checking your browser') ||
        content.includes('cf-challenge');
    } catch (err) {
      return false;
    }
  }

  async handleCloudflare(page) {
    try {
      // Try to find turnstile sitekey
      const siteKey = await page.evaluate(() => {
        const turnstileDiv = document.querySelector('[data-sitekey]');
        return turnstileDiv ? turnstileDiv.getAttribute('data-sitekey') : null;
      });

      if (siteKey) {
        const token = await this.captchaSolver.solveTurnstile(siteKey, page.url());
        await this.captchaSolver.injectCaptchaSolution(page, token);
        await this.randomDelay(3000, 5000);
      } else {
        // Wait for Cloudflare to clear automatically with stealth plugin
        logger.info('Waiting for Cloudflare auto-clear...');
        await this.randomDelay(5000, 10000);

        // Try clicking any challenge button
        const challengeBtn = await page.$('#challenge-stage button') ||
          await page.$('.challenge-form button');
        if (challengeBtn) {
          await challengeBtn.click();
          await this.randomDelay(5000, 8000);
        }
      }
    } catch (err) {
      logger.error('Cloudflare handling error:', err.message);
    }
  }

  async verifyLogin(page) {
    try {
      // Check URL - should be on main page or create page
      const currentUrl = page.url();
      if (currentUrl.includes('/create') || currentUrl.includes('/feed') ||
        currentUrl.includes('/library') || currentUrl === 'https://suno.com/') {

        // Try to find user avatar or profile element
        const userElement = await page.$('[data-testid="user-button"], .cl-userButton, img[alt*="avatar"]');
        if (userElement) return true;

        // Check for session cookies
        const cookies = await page.cookies();
        const hasSession = cookies.some(c =>
          c.name.includes('__session') ||
          c.name.includes('__clerk') ||
          c.name.includes('__client')
        );
        if (hasSession) return true;
      }

      // Also check by trying to access API
      const apiCheck = await page.evaluate(async () => {
        try {
          const res = await fetch('https://studio-api.suno.ai/api/billing/info/', {
            credentials: 'include'
          });
          return res.ok;
        } catch {
          return false;
        }
      });

      return apiCheck;
    } catch (err) {
      return false;
    }
  }

  async extractSession(page, accountId) {
    try {
      // Get cookies
      const cookies = await page.cookies();

      // Get localStorage
      const localStorage = await page.evaluate(() => {
        const data = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          data[key] = window.localStorage.getItem(key);
        }
        return data;
      });

      // Get sessionStorage
      const sessionStorage = await page.evaluate(() => {
        const data = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          data[key] = window.sessionStorage.getItem(key);
        }
        return data;
      });

      // Extract bearer token from intercepted requests
      const intercepted = await this.browserManager.getInterceptedTokens(accountId);
      let bearerToken = intercepted?.bearer || null;

      // Try to get token from Clerk
      if (!bearerToken) {
        bearerToken = await page.evaluate(async () => {
          try {
            // Clerk provides a getToken method
            if (window.Clerk && window.Clerk.session) {
              const token = await window.Clerk.session.getToken();
              return token;
            }
          } catch (e) { }

          // Try from localStorage
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            const value = window.localStorage.getItem(key);
            if (key.includes('clerk') && value && value.includes('eyJ')) {
              try {
                const parsed = JSON.parse(value);
                if (typeof parsed === 'string' && parsed.startsWith('eyJ')) return parsed;
                if (parsed.jwt) return parsed.jwt;
                if (parsed.token) return parsed.token;
              } catch (e) {
                if (value.startsWith('eyJ')) return value;
              }
            }
          }
          return null;
        });
      }

      // Attempt to get a fresh token by calling Clerk's session token endpoint
      if (!bearerToken) {
        try {
          const clerkCookies = cookies.filter(c => c.name.includes('__clerk') || c.name.includes('__client'));
          if (clerkCookies.length > 0) {
            bearerToken = await page.evaluate(async () => {
              try {
                const res = await fetch('https://clerk.suno.com/v1/client?_clerk_js_version=5', {
                  credentials: 'include'
                });
                const data = await res.json();
                if (data.response && data.response.sessions && data.response.sessions.length > 0) {
                  return data.response.sessions[0].last_active_token?.jwt;
                }
              } catch (e) { }
              return null;
            });
          }
        } catch (e) { }
      }

      const sessionData = {
        accountId,
        cookies,
        localStorage,
        sessionStorage,
        bearerToken,
        extractedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
      };

      logger.info(`Session extracted for ${accountId}, bearer token: ${bearerToken ? 'YES' : 'NO'}`);
      return sessionData;
    } catch (err) {
      logger.error(`Session extraction failed for ${accountId}:`, err.message);
      throw err;
    }
  }

  async saveSession(accountId, sessionData) {
    const sessionsDir = path.join(__dirname, '..', 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    const filePath = path.join(sessionsDir, `${accountId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
    logger.info(`Session saved: ${filePath}`);
  }

  loadSession(accountId) {
    const filePath = path.join(__dirname, '..', 'sessions', `${accountId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      logger.error(`Failed to load session for ${accountId}:`, err);
      return null;
    }
  }

  async healthCheck(accountId) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) return false;

    const session = this.loadSession(accountId);
    if (!session) {
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      return false;
    }

    // Check expiry
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      return false;
    }

    // Check bearer token validity
    if (session.bearerToken) {
      try {
        const axios = require('axios');
        const { HttpsProxyAgent } = require('https-proxy-agent');

        const config = {
          headers: {
            'Authorization': `Bearer ${session.bearerToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 15000
        };

        if (account.proxy) {
          const agent = new HttpsProxyAgent(account.proxy);
          config.httpsAgent = agent;
          config.httpAgent = agent;
        }

        const res = await axios.get(
          `${process.env.SUNO_API_BASE || 'https://studio-api.suno.ai'}/api/billing/info/`,
          config
        );

        if (res.status === 200) {
          const credits = res.data?.total_credits_left || 0;
          this.accountManager.updateAccount(accountId, {
            statusCookie: 'active',
            creditsLeft: credits,
            lastChecked: new Date().toISOString()
          });
          return true;
        }
      } catch (err) {
        if (err.response && (err.response.status === 401 || err.response.status === 403)) {
          // Token expired - try to refresh
          const refreshed = await this.refreshToken(accountId);
          if (!refreshed) {
            this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
            return false;
          }
          return true;
        }
        logger.error(`Health check failed for ${accountId}:`, err.message);
      }
    }

    this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
    return false;
  }

  async refreshToken(accountId) {
    try {
      const account = this.accountManager.getAccountRaw(accountId);
      const session = this.loadSession(accountId);
      if (!session || !session.cookies) return false;

      // Try refreshing via Clerk
      const axios = require('axios');
      const { HttpsProxyAgent } = require('https-proxy-agent');

      const cookieString = session.cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      const config = {
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      };

      if (account.proxy) {
        const agent = new HttpsProxyAgent(account.proxy);
        config.httpsAgent = agent;
        config.httpAgent = agent;
      }

      const res = await axios.get('https://clerk.suno.com/v1/client?_clerk_js_version=5', config);

      if (res.data?.response?.sessions?.length > 0) {
        const newToken = res.data.response.sessions[0]?.last_active_token?.jwt;
        if (newToken) {
          session.bearerToken = newToken;
          session.extractedAt = new Date().toISOString();
          session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await this.saveSession(accountId, session);

          this.accountManager.updateAccount(accountId, {
            bearerToken: newToken,
            statusCookie: 'active'
          });

          logger.info(`Token refreshed for ${accountId}`);
          return true;
        }
      }

      return false;
    } catch (err) {
      logger.error(`Token refresh failed for ${accountId}:`, err.message);
      return false;
    }
  }

  randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(r => setTimeout(r, delay));
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

module.exports = SessionManager;