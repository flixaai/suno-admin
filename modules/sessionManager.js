const fs = require('fs');
const path = require('path');
const CaptchaSolver = require('./captchaSolver');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.captchaSolver = new CaptchaSolver();
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
  }

  async login(accountId) {
    if (this.loginLocks.has(accountId)) {
      logger.warn(`Login in progress for ${accountId}`);
      return { success: false, error: 'Login in progress' };
    }

    this.loginLocks.add(accountId);

    try {
      const account = this.accountManager.getAccountRaw(accountId);
      if (!account) throw new Error(`Account not found: ${accountId}`);

      logger.info(`[Clerk SDK Engine] Starting login for: ${account.email}`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      // Launch Browser Stealth via Proxy
      const { page } = await this.browserManager.launch(accountId, account.proxy);
      const sunoUrl = process.env.SUNO_BASE_URL || 'https://suno.com';

      // 1. Buka Suno.com & Tunggu Clerk SDK Ter-load
      logger.info(`Navigating to ${sunoUrl}...`);
      await page.goto(sunoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(2000, 3000);

      // Tangani Cloudflare jika muncul
      if (await this.detectCloudflare(page)) {
        await this.handleCloudflare(page);
        await this.randomDelay(3000, 5000);
      }

      // Tunggu hingga SDK window.Clerk siap di browser
      logger.info('Waiting for Suno Clerk SDK to initialize...');
      await page.waitForFunction(() => window.Clerk && window.Clerk.isReady && window.Clerk.isReady(), { timeout: 30000 });

      // 2. REQUEST KODE OTP VIA CLERK JS SDK NATIVE
      logger.info(`Requesting OTP for ${account.email} via window.Clerk SDK...`);

      const initAuth = await page.evaluate(async (email) => {
        try {
          if (!window.Clerk || !window.Clerk.client) {
            return { success: false, error: 'Clerk SDK not loaded on Suno page' };
          }

          // A. Coba Sign-In Terlebih Dahulu
          try {
            const signIn = await window.Clerk.client.signIn.create({
              identifier: email
            });

            const emailFactor = signIn.supportedFirstFactors?.find(f => f.strategy === 'email_code');
            if (emailFactor) {
              await signIn.prepareFirstFactor({
                strategy: 'email_code',
                emailAddressId: emailFactor.emailAddressId
              });
              return { success: true, isSignUp: false };
            } else {
              return { success: false, error: 'Email OTP strategy not available for this account' };
            }
          } catch (signInErr) {
            // B. Jika Email Belum Terdaftar -> Lakukan Sign-Up (Daftar Akun Baru)
            const isNotFound = signInErr.errors?.some(e => e.code === 'form_identifier_not_found');
            
            if (isNotFound) {
              const signUp = await window.Clerk.client.signUp.create({
                emailAddress: email
              });

              await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
              return { success: true, isSignUp: true };
            }

            return {
              success: false,
              error: signInErr.errors?.[0]?.longMessage || signInErr.errors?.[0]?.message || signInErr.message
            };
          }
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, account.email);

      if (!initAuth.success) {
        throw new Error(`Clerk SDK OTP Request Error: ${initAuth.error}`);
      }

      // 3. SUNO SUCESS MEMPROSES OTP -> BUKA POP-UP AT DASHBOARD ADMIN
      logger.info(`OTP Code successfully sent to ${account.email}! Waiting for input...`);

      this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });
      global.io.emit('otp:required', {
        accountId,
        email: account.email,
        timestamp: new Date().toISOString()
      });

      // Tunggu Pengguna Input Kode 6-Digit dari Inbox Email
      const otpCode = await this.waitForOTP(accountId, 300000);
      if (!otpCode) throw new Error('OTP Timeout - No code entered within 5 minutes');

      logger.info(`Verifying OTP Code (${otpCode}) via window.Clerk SDK...`);

      // 4. SUBMIT & VERIFIKASI OTP VIA CLERK SDK
      const verifyResult = await page.evaluate(async (isSignUp, code) => {
        try {
          if (isSignUp) {
            const signUp = window.Clerk.client.signUp;
            const res = await signUp.attemptEmailAddressVerification({ code });
            if (res.status === 'complete') {
              await window.Clerk.setActive({ session: res.createdSessionId });
              return { success: true };
            }
            return { success: false, error: `SignUp status: ${res.status}` };
          } else {
            const signIn = window.Clerk.client.signIn;
            const res = await signIn.attemptFirstFactor({ strategy: 'email_code', code });
            if (res.status === 'complete') {
              await window.Clerk.setActive({ session: res.createdSessionId });
              return { success: true };
            }
            return { success: false, error: `SignIn status: ${res.status}` };
          }
        } catch (err) {
          return {
            success: false,
            error: err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message
          };
        }
      }, initAuth.isSignUp, otpCode);

      if (!verifyResult.success) {
        throw new Error(`OTP Verification Failed: ${verifyResult.error}`);
      }

      // 5. AMBIL BEARER TOKEN & Dapatkan Session Aktif
      await page.goto(`${sunoUrl}/create`, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.randomDelay(2000, 3000);

      const sessionData = await this.extractSession(page, accountId);
      if (!sessionData.bearerToken) {
        throw new Error('Failed to capture Bearer Token after login');
      }

      await this.saveSession(accountId, sessionData);

      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken: sessionData.bearerToken,
        lastLogin: new Date().toISOString()
      });

      global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
      global.io.emit('notification', { type: 'success', message: `Verifikasi OTP Berhasil untuk ${account.email}` });

      logger.info(`SUCCESS: Account ${accountId} is Active and Ready!`);
      await this.browserManager.close(accountId);
      return { success: true };

    } catch (err) {
      logger.error(`Login failed for ${accountId}:`, err.message);
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'expired' });
      global.io.emit('notification', { type: 'error', message: `Login gagal: ${err.message}` });

      await this.browserManager.close(accountId);
      return { success: false, error: err.message };
    } finally {
      this.loginLocks.delete(accountId);
    }
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
      return content.includes('cf-turnstile') || content.includes('Checking your browser');
    } catch {
      return false;
    }
  }

  async handleCloudflare(page) {
    try {
      const siteKey = await page.evaluate(() => {
        const div = document.querySelector('[data-sitekey]');
        return div ? div.getAttribute('data-sitekey') : null;
      });

      if (siteKey) {
        const token = await this.captchaSolver.solveTurnstile(siteKey, page.url());
        await this.captchaSolver.injectCaptchaSolution(page, token);
      } else {
        await this.randomDelay(5000, 8000);
      }
    } catch (err) {
      logger.error('Cloudflare error:', err.message);
    }
  }

  async extractSession(page, accountId) {
    const cookies = await page.cookies();

    const bearerToken = await page.evaluate(async () => {
      try {
        if (window.Clerk && window.Clerk.session) {
          return await window.Clerk.session.getToken();
        }
      } catch (e) {}

      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        const val = window.localStorage.getItem(key);
        if (val && val.includes('eyJ')) {
          try {
            const parsed = JSON.parse(val);
            if (parsed.jwt) return parsed.jwt;
            if (typeof parsed === 'string') return parsed;
          } catch (e) {
            if (val.startsWith('eyJ')) return val;
          }
        }
      }
      return null;
    });

    return {
      accountId,
      cookies,
      bearerToken,
      extractedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
  }

  async saveSession(accountId, sessionData) {
    const dir = path.join(__dirname, '..', 'sessions');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${accountId}.json`), JSON.stringify(sessionData, null, 2));
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

  async healthCheck(accountId) {
    const session = this.loadSession(accountId);
    if (!session || !session.bearerToken) {
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      return false;
    }
    return true;
  }

  async refreshToken(accountId) {
    return this.login(accountId);
  }

  randomDelay(min, max) {
    return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
  }
}

module.exports = SessionManager;