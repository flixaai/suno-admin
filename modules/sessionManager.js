const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
  }

  async login(accountId) {
    try {
      const account = this.accountManager.getAccountRaw(accountId);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      const { page } = await this.browserManager.launch(accountId, account.proxy);
      
      // Buka halaman studio langsung agar Clerk SDK aktif
      logger.info(`Memuat halaman login Suno untuk ${account.email}...`);
      await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Tunggu Clerk SDK (Kecil & Cepat)
      await page.waitForFunction(() => window.Clerk && window.Clerk.isReady && window.Clerk.isReady(), { timeout: 20000 });

      // Request OTP via SDK
      const initAuth = await page.evaluate(async (email) => {
        try {
          // Coba Sign In (Otomatis kirim OTP jika email terdaftar Google/Email)
          const signIn = await window.Clerk.client.signIn.create({ identifier: email });
          const factor = signIn.supportedFirstFactors.find(f => f.strategy === 'email_code');
          await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
          return { success: true };
        } catch (e) {
          // Jika belum terdaftar, otomatis Sign Up
          try {
            const signUp = await window.Clerk.client.signUp.create({ emailAddress: email });
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            return { success: true, isSignUp: true };
          } catch (e2) { return { success: false, error: e2.message }; }
        }
      }, account.email);

      if (!initAuth.success) throw new Error(initAuth.error);

      // Pemicu Pop-up di Dashboard Admin
      global.io.emit('otp:required', { accountId, email: account.email });
      
      const otpCode = await this.waitForOTP(accountId); // Tunggu Anda masukkan kode
      if (!otpCode) throw new Error('OTP Timeout');

      // Verifikasi OTP
      const verify = await page.evaluate(async (code) => {
        const client = window.Clerk.client;
        const action = client.signIn.status === 'needs_first_factor' ? client.signIn : client.signUp;
        const res = await (client.signIn.status === 'needs_first_factor' 
          ? action.attemptFirstFactor({ strategy: 'email_code', code })
          : action.attemptEmailAddressVerification({ code }));
        
        if (res.status === 'complete') {
          await window.Clerk.setActive({ session: res.createdSessionId });
          return { success: true };
        }
        return { success: false };
      }, otpCode);

      if (verify.success) {
        // Ambil Token Terakhir
        const token = await page.evaluate(async () => await window.Clerk.session.getToken());
        const cookies = await page.cookies();
        
        this.saveSession(accountId, { bearerToken: token, cookies });
        this.accountManager.updateAccount(accountId, { statusCookie: 'active', bearerToken: token });
        
        global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
        await this.browserManager.close(accountId);
        return { success: true };
      }
    } catch (err) {
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      await this.browserManager.close(accountId);
      return { success: false, error: err.message };
    }
  }

  waitForOTP(accountId) {
    return new Promise(resolve => {
      this.otpCallbacks.set(accountId, (code) => resolve(code));
      setTimeout(() => resolve(null), 300000); // 5 menit
    });
  }

  submitOTP(accountId, code) {
    if (this.otpCallbacks.has(accountId)) {
      this.otpCallbacks.get(accountId)(code);
      return true;
    }
    return false;
  }

  saveSession(accountId, data) {
    const dir = path.join(__dirname, '..', 'sessions');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${accountId}.json`), JSON.stringify(data));
  }
}
module.exports = SessionManager;