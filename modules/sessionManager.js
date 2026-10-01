const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
  }

  async login(accountId) {
    if (this.loginLocks.has(accountId)) {
      return { success: false, error: 'Login already in progress' };
    }

    this.loginLocks.add(accountId);
    let browserInstance = null;

    try {
      const account = this.accountManager.getAccountRaw(accountId);
      if (!account) throw new Error(`Account not found: ${accountId}`);

      logger.info(`[Puppeteer Hybrid Engine] Starting real browser for ${account.email}...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      // 1. Buka Browser (Bypass Cloudflare & Anti-Bot)
      browserInstance = await this.browserManager.launch(accountId, account.proxy);
      const page = browserInstance.page;

      // 2. Akses halaman Suno agar script Clerk milik Suno ter-load
      logger.info('Loading Suno.com to inject SDK...');
      await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Tunggu sampai sistem keamanan & objek Clerk siap di browser
      await page.waitForFunction(() => window.Clerk && window.Clerk.isReady, { timeout: 30000 });

      // 3. Eksekusi Login langsung ke Otak Website Suno (Mencegah Error 422)
      logger.info('Executing Clerk SDK Sign-In / Sign-Up...');
      const authResult = await page.evaluate(async (email) => {
        try {
          // Coba Sign-In (Akun Lama)
          const signInRes = await window.Clerk.client.signIn.create({ identifier: email });
          const factor = signInRes.supportedFirstFactors.find(f => f.strategy === 'email_code');
          if (!factor) throw new Error("Metode email_code tidak tersedia di akun ini.");

          await window.Clerk.client.signIn.prepareFirstFactor({
            strategy: 'email_code',
            emailAddressId: factor.emailAddressId
          });
          return { mode: 'signin', success: true };
        } catch (err) {
          const isNotFound = err.errors && err.errors.some(e => e.code === 'form_identifier_not_found');
          if (isNotFound) {
            // Jika akun tidak ditemukan, otomatis Sign-Up (Akun Baru)
            const signUpRes = await window.Clerk.client.signUp.create({ emailAddress: email });
            await window.Clerk.client.signUp.prepareVerification({ strategy: 'email_code' });
            return { mode: 'signup', success: true };
          }
          // Kembalikan error asli jika diblokir
          return { success: false, error: JSON.stringify(err.errors || err.message) };
        }
      }, account.email);

      // Jika SDK di dalam browser tetap diblokir
      if (!authResult.success) {
        throw new Error(`Clerk SDK Blocked: ${authResult.error}`);
      }

      // 4. Minta OTP ke User di Dashboard
      logger.info(`[SUCCESS] OTP sent to ${account.email}. Waiting for input...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });
      global.io.emit('otp:required', {
        accountId,
        email: account.email,
        timestamp: new Date().toISOString()
      });

      // Tunggu input 6 angka (Max 5 Menit)
      const otpCode = await this.waitForOTP(accountId, 300000);
      if (!otpCode) throw new Error('OTP Timeout - Kode tidak dimasukkan dalam 5 menit');

      logger.info(`Verifying OTP Code (${otpCode}) via Puppeteer...`);

      // 5. Verifikasi OTP di dalam Browser
      const verifyResult = await page.evaluate(async (code, mode) => {
        try {
          let completeRes;
          if (mode === 'signup') {
            completeRes = await window.Clerk.client.signUp.attemptVerification({ strategy: 'email_code', code });
          } else {
            completeRes = await window.Clerk.client.signIn.attemptFirstFactor({ strategy: 'email_code', code });
          }

          if (completeRes.status === 'complete') {
            // Set session aktif & ambil Bearer Token
            await window.Clerk.setActive({ session: completeRes.createdSessionId });
            const token = await window.Clerk.session.getToken();
            return { success: true, token };
          }
          return { success: false, error: 'Status OTP tidak valid: ' + completeRes.status };
        } catch (err) {
          return { success: false, error: JSON.stringify(err.errors || err.message) };
        }
      }, otpCode, authResult.mode);

      if (!verifyResult.success) {
        throw new Error(`OTP Salah / Verifikasi Gagal: ${verifyResult.error}`);
      }

      // 6. Ambil Cookies dan Token dari Browser
      const bearerToken = verifyResult.token;
      const cookies = await page.cookies();
      const cookiesString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (!bearerToken) throw new Error('Berhasil login, tetapi gagal menarik Bearer Token.');

      // 7. Simpan Session & Selesai
      this.saveSession(accountId, { bearerToken, cookies: cookiesString });

      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken,
        lastLogin: new Date().toISOString()
      });

      global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
      global.io.emit('notification', { type: 'success', message: `Verifikasi Berhasil! Akun ${account.email} AKTIF!` });

      logger.info(`[SUCCESS] Account ${accountId} is Active and Ready!`);
      return { success: true };

    } catch (err) {
      const fullErrorLog = err.message;
      logger.error(`Login Error for ${accountId}: ${fullErrorLog}`);

      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'expired' });
      global.io.emit('notification', { type: 'error', message: `GAGAL: ${fullErrorLog}` });

      return { success: false, error: fullErrorLog };
    } finally {
      // Tutup browser setelah selesai ambil token agar RAM server lega
      try {
        if (browserInstance) {
          await this.browserManager.close(accountId);
        }
      } catch (e) {}
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

  async healthCheck(accountId) {
    const session = this.loadSession(accountId);
    if (!session || !session.bearerToken) {
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      return false;
    }
    return true;
  }
}

module.exports = SessionManager;