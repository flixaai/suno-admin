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
      return { success: false, error: 'Login sedang diproses...' };
    }

    this.loginLocks.add(accountId);
    let browserInstance = null;

    try {
      const account = this.accountManager.getAccountRaw(accountId);
      if (!account) throw new Error(`Akun tidak ditemukan: ${accountId}`);

      logger.info(`[Ultra-Lite Browser] Membuka browser untuk ${account.email}...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      // 1. Buka Browser
      browserInstance = await this.browserManager.launch(accountId, account.proxy);
      const page = browserInstance.page;

      // ========================================================
      // OPTIMASI RAM RAILWAY EXTREME: Blokir semua kecuali Script
      // ========================================================
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        // Blokir gambar, CSS, video, font agar browser sangat ringan dan tidak crash
        if (['image', 'stylesheet', 'media', 'font', 'websocket'].includes(type) || req.url().endsWith('.mp4')) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // 2. Akses halaman Suno
      logger.info('Memuat Suno.com dalam mode ringan...');
      try {
        // Cukup tunggu sampai DOM selesai (tidak perlu tunggu gambar loading)
        await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (navErr) {
        logger.warn('Timeout saat memuat halaman, mencoba melanjutkan eksekusi script...');
      }

      // Tunggu Clerk API siap
      logger.info('Menunggu sistem keamanan siap...');
      await page.waitForFunction(() => window.Clerk && window.Clerk.isReady, { timeout: 40000 });

      // 3. Eksekusi Login
      logger.info('Mengeksekusi proses Sign-In...');
      const authResult = await page.evaluate(async (email) => {
        try {
          const signInRes = await window.Clerk.client.signIn.create({ identifier: email });
          const factor = signInRes.supportedFirstFactors.find(f => f.strategy === 'email_code');
          if (!factor) throw new Error("Metode email_code tidak tersedia.");

          await window.Clerk.client.signIn.prepareFirstFactor({
            strategy: 'email_code',
            emailAddressId: factor.emailAddressId
          });
          return { mode: 'signin', success: true };
        } catch (err) {
          const isNotFound = err.errors && err.errors.some(e => e.code === 'form_identifier_not_found');
          if (isNotFound) {
            try {
              const signUpRes = await window.Clerk.client.signUp.create({ emailAddress: email });
              await window.Clerk.client.signUp.prepareVerification({ strategy: 'email_code' });
              return { mode: 'signup', success: true };
            } catch (signupErr) {
               return { success: false, error: JSON.stringify(signupErr.errors || signupErr.message) };
            }
          }
          return { success: false, error: JSON.stringify(err.errors || err.message) };
        }
      }, account.email);

      if (!authResult.success) {
        // Jika error mengandung kata "phone", berarti IP Proxy ditolak.
        if (authResult.error.includes('phone')) {
             throw new Error("DITOLAK: IP Proxy ini meminta verifikasi Nomor HP. Ganti Proxy Anda!");
        }
        throw new Error(`Sistem Menolak: ${authResult.error}`);
      }

      // 4. Minta OTP di Dashboard
      logger.info(`[SUCCESS] Kode OTP dikirim ke ${account.email}. Menunggu input...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });
      global.io.emit('otp:required', { accountId, email: account.email, timestamp: new Date().toISOString() });

      // Tunggu input 6 angka (Max 5 Menit)
      const otpCode = await this.waitForOTP(accountId, 300000);
      if (!otpCode) throw new Error('Timeout: OTP tidak dimasukkan.');

      logger.info(`Memverifikasi OTP (${otpCode})...`);

      // 5. Verifikasi OTP
      const verifyResult = await page.evaluate(async (code, mode) => {
        try {
          let completeRes;
          if (mode === 'signup') {
            completeRes = await window.Clerk.client.signUp.attemptVerification({ strategy: 'email_code', code });
          } else {
            completeRes = await window.Clerk.client.signIn.attemptFirstFactor({ strategy: 'email_code', code });
          }

          if (completeRes.status === 'complete') {
            await window.Clerk.setActive({ session: completeRes.createdSessionId });
            const token = await window.Clerk.session.getToken();
            return { success: true, token };
          }
          return { success: false, error: 'Status tidak valid: ' + completeRes.status };
        } catch (err) {
          return { success: false, error: JSON.stringify(err.errors || err.message) };
        }
      }, otpCode, authResult.mode);

      if (!verifyResult.success) {
        throw new Error(`OTP Salah / Gagal: ${verifyResult.error}`);
      }

      // 6. Ambil Cookies & Token
      const bearerToken = verifyResult.token;
      const cookies = await page.cookies();
      const cookiesString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (!bearerToken) throw new Error('Berhasil tapi gagal mendapat token.');

      // 7. Selesai
      this.saveSession(accountId, { bearerToken, cookies: cookiesString });

      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken,
        lastLogin: new Date().toISOString()
      });

      global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
      global.io.emit('notification', { type: 'success', message: `Verifikasi Berhasil! Akun AKTIF!` });

      return { success: true };

    } catch (err) {
      let errorMsg = err.message;
      
      // Jika terjadi error target closed, beri penjelasan bahasa Indonesia
      if (errorMsg.includes('Target closed') || errorMsg.includes('Session closed')) {
          errorMsg = "Server Railway Kehabisan RAM / Browser Crash. Coba tekan login lagi.";
      }

      logger.error(`Login Error: ${errorMsg}`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'expired' });
      global.io.emit('notification', { type: 'error', message: `GAGAL: ${errorMsg}` });

      return { success: false, error: errorMsg };
    } finally {
      // Wajib tutup browser agar RAM kembali kosong
      try {
        if (browserInstance) await this.browserManager.close(accountId);
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