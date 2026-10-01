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
      
      logger.info(`Menghubungi Suno (Mode Agresif)...`);
      
      // Gunakan timeout 60 detik (60000ms) karena IP Railway lambat
      await page.goto('https://suno.com/create', { 
        waitUntil: 'commit', // Segera eksekusi setelah data pertama masuk
        timeout: 60000 
      });

      // Tunggu Clerk muncul tanpa peduli tampilan web (max 60 detik)
      await page.waitForFunction(() => {
        return typeof window.Clerk !== 'undefined' && window.Clerk.client;
      }, { timeout: 60000 });

      logger.info(`Sistem Login Siap. Mengirim OTP ke ${account.email}...`);

      const initAuth = await page.evaluate(async (email) => {
        try {
          const client = window.Clerk.client;
          try {
            const signIn = await client.signIn.create({ identifier: email });
            const factor = signIn.supportedFirstFactors.find(f => f.strategy === 'email_code');
            await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
            return { success: true };
          } catch (e) {
            const signUp = await client.signUp.create({ emailAddress: email });
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            return { success: true, isSignUp: true };
          }
        } catch (err) { return { success: false, error: err.message }; }
      }, account.email);

      if (!initAuth.success) throw new Error(initAuth.error);

      // Minta Kode OTP di Dashboard
      global.io.emit('otp:required', { accountId, email: account.email });
      
      const otpCode = await this.waitForOTP(accountId);
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
        const token = await page.evaluate(async () => await window.Clerk.session.getToken());
        this.saveSession(accountId, { bearerToken: token });
        this.accountManager.updateAccount(accountId, { statusCookie: 'active', bearerToken: token });
        global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
        logger.info(`Login Berhasil untuk ${account.email}`);
      }
      
      await this.browserManager.close(accountId);
      return { success: true };
    } catch (err) {
      logger.error(`Error: ${err.message}`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      await this.browserManager.close(accountId);
      return { success: false, error: err.message };
    }
  }

  waitForOTP(accountId) {
    return new Promise(resolve => {
      this.otpCallbacks.set(accountId, (code) => resolve(code));
      setTimeout(() => resolve(null), 300000);
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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${accountId}.json`), JSON.stringify(data));
  }
}
module.exports = SessionManager;