const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
    
    // Kredensial Bright Data Scraping Browser Super Sakti
    this.brightDataWS = process.env.BRIGHT_DATA_WS || 'wss://brd-customer-hl_c154ff17-zone-suno_browser:ar1oslh5xtvr@brd.superproxy.io:9222';
  }

  async login(accountId) {
    if (this.loginLocks.has(accountId)) {
      return { success: false, error: 'Login sedang berlangsung...' };
    }

    this.loginLocks.add(accountId);
    let browser = null;

    try {
      const account = this.accountManager.getAccountRaw(accountId);
      if (!account) throw new Error(`Akun tidak ditemukan: ${accountId}`);

      logger.info(`[Bright Data Cloud Engine] Menghubungkan ke Super-Browser untuk ${account.email}...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      // 1. KONEKSI KE SUPER-BROWSER BRIGHT DATA (Bypass Cloudflare & Anti-Bot 100%)
      browser = await puppeteer.connect({
        browserWSEndpoint: this.brightDataWS
      });

      const page = await browser.newPage();

      // Atur viewport standar manusia
      await page.setViewport({ width: 1280, height: 720 });

      // 2. Buka Halaman Suno
      logger.info('Membuka Suno.com melalui Jaringan Residential Bright Data...');
      await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 90000 });

      // 3. Tunggu Sistem Keamanan Suno (Clerk) Terbuka Otomatis oleh Bright Data
      logger.info('Menunggu inisialisasi Clerk Auth (Cloudflare Turnstile ditembus otomatis)...');
      await page.waitForFunction(() => window.Clerk && window.Clerk.isReady, { timeout: 60000 });

      // 4. Eksekusi Login / Daftar
      logger.info('Memasukkan email ke Suno...');
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
        throw new Error(`Gagal memproses email: ${authResult.error}`);
      }

      // 5. Trigger Pop-up OTP di Dashboard Anda
      logger.info(`[BERHASIL] Kode OTP terkirim ke ${account.email}! Membuka pop-up di dashboard...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });
      global.io.emit('otp:required', {
        accountId,
        email: account.email,
        timestamp: new Date().toISOString()
      });

      // Tunggu Anda masukkan OTP 6-Digit di Dashboard (Waktu tunggu 5 Menit)
      const otpCode = await this.waitForOTP(accountId, 300000);
      if (!otpCode) throw new Error('Timeout: OTP tidak dimasukkan dalam 5 menit');

      logger.info(`Memverifikasi kode OTP (${otpCode}) ke Suno...`);

      // 6. Verifikasi Kode OTP
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
          return { success: false, error: 'Status OTP tidak valid: ' + completeRes.status };
        } catch (err) {
          return { success: false, error: JSON.stringify(err.errors || err.message) };
        }
      }, otpCode, authResult.mode);

      if (!verifyResult.success) {
        throw new Error(`Verifikasi OTP Gagal: ${verifyResult.error}`);
      }

      // 7. Ambil Bearer Token & Cookies
      const bearerToken = verifyResult.token;
      const cookies = await page.cookies();
      const cookiesString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (!bearerToken) throw new Error('Gagal mendapatkan Bearer Token login');

      // 8. Simpan Sesi Permanen
      this.saveSession(accountId, { bearerToken, cookies: cookiesString });

      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken,
        lastLogin: new Date().toISOString()
      });

      global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
      global.io.emit('notification', { type: 'success', message: `Verifikasi Berhasil! Akun ${account.email} AKTIF!` });

      logger.info(`[SELESAI] Akun ${accountId} berhasil LOGIN dan siap dipakai!`);
      return { success: true };

    } catch (err) {
      const fullErrorLog = err.message;
      logger.error(`Login Error: ${fullErrorLog}`);

      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'expired' });
      global.io.emit('notification', { type: 'error', message: `GAGAL: ${fullErrorLog}` });

      return { success: false, error: fullErrorLog };
    } finally {
      // Tutup browser remote Bright Data agar hemat kuota
      try {
        if (browser) await browser.close();
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