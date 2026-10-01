const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class SessionManager {
  constructor(browserManager, accountManager) {
    this.browserManager = browserManager;
    this.accountManager = accountManager;
    this.otpCallbacks = new Map();
    this.loginLocks = new Set();
  }

  // Helper untuk membuat Axios client dengan Proxy Webshare
  getAxiosClient(proxyUrl) {
    const config = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://suno.com',
        'Referer': 'https://suno.com/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 20000,
      withCredentials: true
    };

    if (proxyUrl) {
      try {
        let p = proxyUrl.trim();
        if (!p.startsWith('http://') && !p.startsWith('https://')) p = 'http://' + p;
        const agent = new HttpsProxyAgent(p);
        config.httpsAgent = agent;
        config.httpAgent = agent;
      } catch (e) {
        logger.error('Proxy Agent Error:', e.message);
      }
    }

    return axios.create(config);
  }

  async login(accountId) {
    if (this.loginLocks.has(accountId)) {
      return { success: false, error: 'Login already in progress' };
    }

    this.loginLocks.add(accountId);

    try {
      const account = this.accountManager.getAccountRaw(accountId);
      if (!account) throw new Error(`Account not found: ${accountId}`);

      logger.info(`[Pure REST API Engine] Requesting OTP for: ${account.email}...`);
      this.accountManager.updateAccount(accountId, { statusCookie: 'logging_in' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'logging_in' });

      const client = this.getAxiosClient(account.proxy);
      let cookiesHeader = '';

      // 1. Inisialisasi Session Clerk (Dapatkan Cookie Client)
      try {
        const initRes = await client.get('https://clerk.suno.com/v1/client?_clerk_js_version=5.0.0');
        if (initRes.headers['set-cookie']) {
          cookiesHeader = initRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        }
      } catch (e) {}

      // Update headers dengan Cookie jika ada
      if (cookiesHeader) {
        client.defaults.headers['Cookie'] = cookiesHeader;
      }

      // 2. Coba Sign-In via Clerk REST API
      let authId = null;
      let isSignUp = false;

      try {
        const signInParams = new URLSearchParams();
        signInParams.append('identifier', account.email);

        const signInRes = await client.post(
          'https://clerk.suno.com/v1/client/sign_ins?_clerk_js_version=5.0.0',
          signInParams.toString()
        );

        if (signInRes.headers['set-cookie']) {
          const newCookies = signInRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
          cookiesHeader = cookiesHeader ? `${cookiesHeader}; ${newCookies}` : newCookies;
          client.defaults.headers['Cookie'] = cookiesHeader;
        }

        const responseObj = signInRes.data.response;
        authId = responseObj.id;

        // Trigger Kirim Kode OTP Sign-In
        const factors = responseObj.supported_first_factors || [];
        const emailFactor = factors.find(f => f.strategy === 'email_code');

        if (emailFactor) {
          const prepParams = new URLSearchParams();
          prepParams.append('strategy', 'email_code');
          prepParams.append('email_address_id', emailFactor.email_address_id);

          await client.post(
            `https://clerk.suno.com/v1/client/sign_ins/${authId}/prepare_first_factor?_clerk_js_version=5.0.0`,
            prepParams.toString()
          );
        }

      } catch (signInErr) {
        // Jika Email Belum Terdaftar -> Sign-Up (Daftar Akun Baru)
        const errData = signInErr.response?.data?.errors || [];
        const isNotFound = errData.some(e => e.code === 'form_identifier_not_found' || e.message?.includes('not found'));

        if (isNotFound) {
          isSignUp = true;
          const signUpParams = new URLSearchParams();
          signUpParams.append('email_address', account.email);

          const signUpRes = await client.post(
            'https://clerk.suno.com/v1/client/sign_ups?_clerk_js_version=5.0.0',
            signUpParams.toString()
          );

          if (signUpRes.headers['set-cookie']) {
            const newCookies = signUpRes.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
            cookiesHeader = cookiesHeader ? `${cookiesHeader}; ${newCookies}` : newCookies;
            client.defaults.headers['Cookie'] = cookiesHeader;
          }

          authId = signUpRes.data.response.id;

          // Trigger Kirim Kode OTP Sign-Up
          const prepParams = new URLSearchParams();
          prepParams.append('strategy', 'email_code');

          await client.post(
            `https://clerk.suno.com/v1/client/sign_ups/${authId}/prepare_verification?_clerk_js_version=5.0.0`,
            prepParams.toString()
          );
        } else {
          throw new Error(errData[0]?.long_message || errData[0]?.message || signInErr.message);
        }
      }

      // 3. OTP BERHASIL DIKIRIM DALAM 1 DETIK! -> BUKA POP-UP DI DASHBOARD
      logger.info(`[SUCCESS] OTP Code sent to ${account.email}! Opening Dashboard Popup...`);

      this.accountManager.updateAccount(accountId, { statusCookie: 'need_otp' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'need_otp' });
      global.io.emit('otp:required', {
        accountId,
        email: account.email,
        timestamp: new Date().toISOString()
      });

      // Tunggu Anda Input OTP 6-Digit di Dashboard (Timeout 5 Menit)
      const otpCode = await this.waitForOTP(accountId, 300000);
      if (!otpCode) throw new Error('OTP Timeout - Kode tidak dimasukkan dalam 5 menit');

      logger.info(`Verifying OTP Code (${otpCode}) via REST API...`);

      // 4. Submit & Verifikasi OTP via REST API
      let bearerToken = null;

      if (isSignUp) {
        const verifyParams = new URLSearchParams();
        verifyParams.append('strategy', 'email_code');
        verifyParams.append('code', otpCode);

        const verifyRes = await client.post(
          `https://clerk.suno.com/v1/client/sign_ups/${authId}/attempt_verification?_clerk_js_version=5.0.0`,
          verifyParams.toString()
        );

        const resp = verifyRes.data.response;
        if (resp.status === 'complete') {
          bearerToken = resp.last_active_token?.jwt;
        } else {
          throw new Error(`SignUp Status: ${resp.status}`);
        }

      } else {
        const verifyParams = new URLSearchParams();
        verifyParams.append('strategy', 'email_code');
        verifyParams.append('code', otpCode);

        const verifyRes = await client.post(
          `https://clerk.suno.com/v1/client/sign_ins/${authId}/attempt_first_factor?_clerk_js_version=5.0.0`,
          verifyParams.toString()
        );

        const resp = verifyRes.data.response;
        if (resp.status === 'complete') {
          bearerToken = resp.last_active_token?.jwt;
        } else {
          throw new Error(`SignIn Status: ${resp.status}`);
        }
      }

      if (!bearerToken) {
        throw new Error('Gagal mendapatkan Bearer Token setelah verifikasi OTP');
      }

      // 5. Simpan Session & Aktifkan Akun
      this.saveSession(accountId, { bearerToken, cookies: cookiesHeader });

      this.accountManager.updateAccount(accountId, {
        statusCookie: 'active',
        bearerToken,
        lastLogin: new Date().toISOString()
      });

      global.io.emit('account:status', { id: accountId, statusCookie: 'active' });
      global.io.emit('notification', { type: 'success', message: `Verifikasi Berhasil! Akun ${account.email} AKTIF!` });

      logger.info(`[SUCCESS] Account ${accountId} is Active and Ready to Generate Songs!`);
      return { success: true };

    } catch (err) {
      // Menganalisis error asli (Cloudflare, Timeout, atau Axios Error)
      let errMsg = err.message;
      let rawDetail = "";

      if (err.response) {
        if (typeof err.response.data === 'string' && err.response.data.toLowerCase().includes('cloudflare')) {
          errMsg = `Akses Ditolak Cloudflare (Status ${err.response.status}).`;
        } else if (err.response.data?.errors) {
          errMsg = err.response.data.errors[0]?.long_message || err.response.data.errors[0]?.message || errMsg;
        }
        // Ambil maksimal 150 karakter data asli agar popup tidak terlalu penuh
        rawDetail = typeof err.response.data === 'string' ? err.response.data.substring(0, 150) : JSON.stringify(err.response.data);
      }

      const fullErrorLog = `GAGAL: ${errMsg} | DATA ASLI: ${rawDetail}`;
      logger.error(`Login Error for ${accountId}: ${fullErrorLog}`);

      this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
      global.io.emit('account:status', { id: accountId, statusCookie: 'expired' });
      global.io.emit('notification', { type: 'error', message: fullErrorLog });

      return { success: false, error: fullErrorLog };
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