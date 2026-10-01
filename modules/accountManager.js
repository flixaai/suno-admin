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
    } catch (err) {
      logger.error('Failed to load accounts:', err);
      this.accounts = [];
    }
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

  // FUNGSI INI YANG TADI HILANG (SUDAH DIPULIHKAN 100%)
  updateAccount(id, updates) {
    const index = this.accounts.findIndex(a => a.id === id);
    if (index === -1) return null;

    this.accounts[index] = { ...this.accounts[index], ...updates };
    this.save();
    return this.accounts[index];
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
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    this.accounts.unshift(account);
    this.save();
    return account;
  }

  addOrUpdateAccount({ email, password, proxy }) {
    let account = this.accounts.find(a => a.email === email);
    if (!account) {
      const id = `acc_${uuidv4().split('-')[0]}`;
      account = {
        id,
        email,
        password: password || '123456',
        proxy: proxy || null,
        cookiesPath: `./sessions/${id}.json`,
        creditsLeft: 0,
        statusProxy: proxy ? 'online' : 'none',
        statusCookie: 'active',
        bearerToken: null,
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      this.accounts.unshift(account);
    } else {
      account.lastLogin = new Date().toISOString();
      account.statusCookie = 'active';
    }

    this.save();
    return account;
  }

  deleteAccount(id) {
    this.accounts = this.accounts.filter(a => a.id !== id);
    this.save();
    try {
      const sessionFile = path.join(this.sessionsDir, `${id}.json`);
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    } catch (e) {}
    return true;
  }

  getAccount(id) {
    return this.accounts.find(a => a.id === id) || null;
  }

  getAllAccounts() {
    return this.accounts.map(a => ({ ...a, password: '••••••••' }));
  }

  getAccountRaw(id) {
    return this.accounts.find(a => a.id === id) || null;
  }

  getAccountCount() {
    return this.accounts.length;
  }

  getOptimalAccount() {
    const eligible = this.accounts.filter(a => a.statusCookie === 'active');
    if (!eligible.length) return null;
    return eligible.sort((a, b) => new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0))[0];
  }
}

module.exports = AccountManager;