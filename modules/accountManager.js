const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class AccountManager {
  constructor() {
    this.dataPath = path.join(__dirname, '..', 'data', 'accounts.json');
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
        this.save();
      }
    } catch (err) {
      logger.error('Failed to load accounts:', err);
      this.accounts = [];
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Simpan langsung ke file secara sinkron
      fs.writeFileSync(this.dataPath, JSON.stringify(this.accounts, null, 2), 'utf-8');
      logger.info('Accounts saved permanently to disk.');
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
      statusCookie: 'expired',
      bearerToken: null,
      lastLogin: null,
      createdAt: new Date().toISOString()
    };

    this.accounts.push(account);
    this.save(); // PENTING: Langsung tulis ke file
    return account;
  }

  updateAccount(id, updates) {
    const index = this.accounts.findIndex(a => a.id === id);
    if (index === -1) return null;

    this.accounts[index] = { ...this.accounts[index], ...updates };
    this.save(); // PENTING: Langsung tulis ke file setiap ada perubahan
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