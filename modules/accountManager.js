const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class AccountManager {
  constructor() {
    this.dataPath = path.join(__dirname, '..', 'data', 'accounts.json');
    this.sessionsDir = path.join(__dirname, '..', 'sessions');
    this.accounts = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        this.accounts = JSON.parse(raw || '[]');
      } else {
        this.accounts = [];
      }

      // FITUR SAKTI: Jika setelah deploy data akun kosong, otomatis kembalikan Akun Anda!
      if (this.accounts.length === 0) {
        this.autoRestoreDefaultAccount();
      }
    } catch (err) {
      logger.error('Failed to load accounts:', err);
      this.accounts = [];
      this.autoRestoreDefaultAccount();
    }
  }

  autoRestoreDefaultAccount() {
    const defaultId = 'acc_keisya_main';
    const defaultEmail = 'keisyaoktaviani86441@habisuno.my.id';
    const defaultToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6InN1bm8tYXBpLXJzMjU2LWtleS0xIiwidHlwIjoiSldUIiwieC1hYmx5LXRva2VuIjoibnYzNlZ3LkloNTBXbUlSaVdoUDBmcXNBQmg0NVBqXzhnd2c3akpManU3YXU1RUFndzJwX3d2cU9xUnByNUh4Q0l6NENfMURpaFdFeEkxTS10ZmJVMUNsejNJV01KcEZRWUxhY3A0MjcyQklvYkhxc0JHaFljNjBXdWEtQ0hGNWxHemVTMS1SQ3hNTW42R01QZFJOYS0ta0QtVU1tcmg5VFNYMHFKZk1UN25GUU5WNEZ2VmxGeUtZR2R5TjFtTVVWb2h0dlhiZFEzSHRQdXFEY1VDbzVoQWRGQ2JxX2hlZ1R4ZVIxRTdISm1CYm0wVnhFVE53In0.eyJzdW5vLmNvbS9jbGFpbXMvdXNlcl9pZCI6ImJhZGUyOGIwLTNjNmMtNDVhZi04M2ZlLTg1NTIyZjBkOWY5OSIsImh0dHBzOi8vc3Vuby5haS9jbGFpbXMvY2xlcmtfaWQiOiJiYWRlMjhiMC0zYzZjLTQ1YWYtODNmZS04NTUyMmYwZDlmOTkiLCJzdW5vLmNvbS9jbGFpbXMvdG9rZW5fdHlwZSI6ImFjY2VzcyIsInN1bm8vZGlkIjoxNTQ2NzAzODksImV4cCI6MTc5MDg0NTczOCwiYXVkIjoic3Vuby1hcGkiLCJzdWIiOiJiYWRlMjhiMC0zYzZjLTQ1YWYtODNmZS04NTUyMmYwZDlmOTkiLCJhenAiOiJodHRwczovL3N1bm8uY29tIiwiZnZhIjpbMCwtMV0sImlhdCI6MTc5MDg0MjEzOCwiaXNzIjoiaHR0cHM6Ly9hdXRoLnN1bm8uY29tIiwiaml0IjoiZWI4YjM2ZDItOWZhNS00MDA0LTgzMjMtZTA3OTE1NTQ4NTZiIiwicGxhbiI6Ijo6Iiwic3Vuby9qb2luZWQiOjE3OTA4NDIxMzUsInNpZCI6InNlc3Npb25fOWU1YjkyNDU1MzFmYWE5YjMyZjZmMSIsInN1bm8uY29tL2NsYWltcy9lbWFpbCI6ImtlaXN5YW9rdGF2aWFuaTg2NDQxQGhhYmlzdW5vLm15LmlkIiwiaHR0cHM6Ly9zdW5vLmFpL2NsYWltcy9lbWFpbCI6ImtlaXN5YW9rdGF2aWFuaTg2NDQxQGhhYmlzdW5vLm15LmlkIiwic3Vuby9oYW5kbGUiOiJrZWlzeWFva3Rhdmlhbmk4NjQ0MSIsInN1bm8vdXNlcl9pZCI6IjE5NTI0NTUyMCJ9.l2wGZo6KZP2sIjHUaO4iAm5iRf0P24XhfnLLxdMrWlfdYWzI-ZeX9v4VeQHLj6GDJdkZxYF-NQZRLkRgpO3nw7E55OASl1ud_6VD_EH0Fp-6qZcSNg-Dyaeg-UDUn4Mv8dAuNvo_-Dd3vOS_pHSHZaiYktuvYmRbblpM29PJcrWuerGR-KEUJDSUGDnB_pNs36IfJgWR_TOJ4xC7tYoCHNebGICLs7I8q5gb9_r6VbFbCLZ2kajaf2NSTlUkn2tPboW-sbeS9rngNWtpvPLnHqpsng5efG8xjIGj8nvqBlAo-wrS3YMTbQ0iNI2p9ZdRqaaRb2Jya0YqkCfnEtcqKQ";
    const defaultCookies = `__session=${defaultToken}; __client_uat=1790842135`;

    const account = {
      id: defaultId,
      email: defaultEmail,
      password: '••••••••',
      proxy: null,
      cookiesPath: `./sessions/${defaultId}.json`,
      creditsLeft: 290,
      statusProxy: 'none',
      statusCookie: 'active',
      bearerToken: defaultToken,
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    this.accounts.push(account);
    this.save();

    // Pastikan folder sessions ada dan file sesi tersimpan
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(this.sessionsDir, `${defaultId}.json`), JSON.stringify({
      bearerToken: defaultToken,
      cookies: defaultCookies
    }, null, 2));

    logger.info('Akun Utama Keisya berhasil di-restore permanen!');
  }

  save() {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataPath, JSON.stringify(this.accounts, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to save accounts:', err);
    }
  }

  addAccount({ email, password, proxy }) {
    const id = `acc_${uuidv4().split('-')[0]}`;
    const account = {
      id,
      email,
      password: password || '123456',
      proxy: proxy || null,
      cookiesPath: `./sessions/${id}.json`,
      creditsLeft: 0,
      statusProxy: proxy ? 'online' : 'none',
      statusCookie: 'active',
      bearerToken: null,
      lastLogin: null,
      createdAt: new Date().toISOString()
    };

    this.accounts.push(account);
    this.save();
    return account;
  }

  updateAccount(id, updates) {
    const index = this.accounts.findIndex(a => a.id === id);
    if (index === -1) return null;

    this.accounts[index] = { ...this.accounts[index], ...updates };
    this.save();
    return this.accounts[index];
  }

  deleteAccount(id) {
    this.accounts = this.accounts.filter(a => a.id !== id);
    this.save();
    return true;
  }

  getAccount(id) {
    return this.accounts.find(a => a.id === id) || null;
  }

  getAllAccounts() {
    return this.accounts.map(a => ({
      ...a,
      password: '••••••••'
    }));
  }

  getAccountRaw(id) {
    return this.accounts.find(a => a.id === id) || null;
  }

  getAccountCount() {
    return this.accounts.length;
  }

  getOptimalAccount() {
    const eligible = this.accounts.filter(a => a.statusCookie === 'active');
    return eligible.length > 0 ? eligible[0] : null;
  }
}

module.exports = AccountManager;