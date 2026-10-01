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

      logger.info(`Starting Pure Email+OTP Engine for: ${account.email}`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      // Launch Browser Stealth via Proxy
      const { page } = await this.browserManager.launch(accountId, account.proxy);
      const sunoUrl = process.env.SUNO_BASE_URL || 'https://suno.com';

      // 1. Load Suno untuk bypass Cloudflare & dapatkan session awal
      await page.goto(sunoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.randomDelay(2000, 3000);

      if (await this.detectCloudflare(page)) {
        await this.handleCloudflare(page);
        await this.randomDelay(3000, 5000);
      }

      // 2. PROSES CLERK AUTH API: Request OTP ke Email
      logger.info(`Sending OTP Request to Suno Clerk API for ${account.email}...`);

      const initAuth = await page.evaluate(async (email) => {
        try {
          // A. Coba Sign-In Terlebih Dahulu
          const signInBody = new URLSearchParams();
          signInBody.append('identifier', email);

          let res = await fetch('https://clerk.suno.com/v1/client/sign_ins?_clerk_js_version=5.0.0', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: signInBody.toString(),
            credentials: 'include'
          });

          let data = await res.json();

          // B. Jika Email Belum Terdaftar -> Lakukan Auto Sign-Up (Daftar Akun Baru)
          if (data.errors && data.errors[0]?.code === 'form_identifier_not_found') {
            const signUpBody = new URLSearchParams();
            signUpBody.append('email_address', email);

            res = await fetch('https://clerk.suno.com/v1/client/sign_ups?_clerk_js_version=5.0.0', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: signUpBody.toString(),
              credentials: 'include'
            });

            data = await res.json();

            if (data.errors) {
              return { success: false, error: data.errors[0]?.long_message || data.errors[0]?.message };
            }

            const signUpId = data.response.id;

            // Trigger Kirim OTP untuk Sign Up
            await fetch(`https://clerk.suno.com/v1/client/sign_ups/${signUpId}/prepare_verification?_clerk_js_version=5.0.0`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ strategy: 'email_code' }).toString(),
              credentials: 'include'
            });

            return { success: true, isSignUp: true, authId: signUpId };
          }

          if (data.errors) {
            return { success: false, error: data.errors[0]?.long_message || data.errors[0]?.message };
          }

          // C. Jika Email Sudah Ada -> Trigger Kirim OTP untuk Sign In
          const signInObj = data.response;
          const factors = signInObj.supported_first_factors || [];
          const emailFactor = factors.find(f => f.strategy === 'email_code');

          if (emailFactor) {
            await fetch(`https://clerk.suno.com/v1/client/sign_ins/${signInObj.id}/prepare_first_factor?_clerk_js_version=5.0.0`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                strategy: 'email_code',
                email_address_id: emailFactor.email_address_id
              }).toString(),
              credentials: 'include'
            });

            return { success: true, isSignUp: false, authId: signInObj.id };
          }

          return { success: false, error: 'Email OTP strategy not supported by this account' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }, account.email);

      if (!initAuth.success) {
        throw new Error(`OTP Request Failed: ${initAuth.error}`);
      }

      // 3. SUNO TELAH MENGIRIM KODE OTP KE EMAIL -> MINTA INPUT OTP DI WEB ADMIN
      logger.info(`OTP Code sent to ${account.email}! Waiting for user input on Dashboard...`);

      this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });
      global.io.emit('otp:required', {
        accountId,
        email: account.email,
        timestamp: new Date().toISOString()
      });

      // Tunggu Pengguna Memasukkan Kode 6-Digit di Web Admin
      const otpCode = await this.waitForOTP(accountId, 300000); // Timeout 5 Menit
      if (!otpCode) throw new Error('OTP Timeout - No code entered within 5 minutes');

      logger.info(`Submitting OTP Code (${otpCode}) to Suno Clerk API...`);

      // 4. VERIFIKASI KODE OTP
      const verifyResult = await page.evaluate(async (authId, isSignUp, code) => {
        try {
          const endpoint = isSignUp
            ? `https://clerk.suno.com/v1/client/sign_ups/${authId}/attempt_verification?_clerk_js_version=5.0.0`
            : `https://clerk.suno.com/v1/client/sign_ins/${authId}/attempt_first_factor?_clerk_js_version=5.0.0`;

          const body = new URLSearchParams();
          if (isSignUp) {
            body.append('strategy', 'email_code');
            body.append('code', code);
          } else {
            body.append('strategy', 'email_code');
            body.append('code', code);
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            credentials: 'include'
          });

          const data = await res.json();
          if (data.errors) return { success: false, error: data.errors[0]?.message };

          return {
            success: data.response?.status === 'complete',
            token: data.response?.last_active_token?.jwt
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, initAuth.authId, initAuth.isSignUp, otpCode);

      if (!verifyResult.success) {
        throw new Error(`Verification Failed: ${verifyResult.error}`);
      }

      // 5. AMBIL SESSION COOKIES & BEARER TOKEN
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
      global.io.emit('notification', { type: 'success', message: `Login & Verifikasi Sukses untuk ${account.email}` });

      logger.info(`SUCCESS: Account ${accountId} fully activated!`);
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