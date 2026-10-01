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
        this.accounts = JSON.parse(raw);
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
      fs.writeFileSync(this.dataPath, JSON.stringify(this.accounts, null, 2));
    } catch (err) {
      logger.error('Failed to save accounts:', err);
    }
  }

  addAccount({ email, password, proxy }) {
    const id = `acc_${uuidv4().split('-')[0]}`;
    const account = {
      id,
      email,
      password,
      proxy: proxy || null,
      cookiesPath: `./sessions/${id}.json`,
      creditsLeft: 0,
      statusProxy: proxy ? 'unknown' : 'none',
      statusCookie: 'expired',
      bearerToken: null,
      lastLogin: null,
      lastChecked: null,
      createdAt: new Date().toISOString()
    };

    this.accounts.push(account);
    this.save();
    logger.info(`Account added: ${id} (${email})`);
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
    const account = this.getAccount(id);
    if (!account) return false;

    // Delete session file
    const sessionPath = path.join(__dirname, '..', 'sessions', `${id}.json`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }

    this.accounts = this.accounts.filter(a => a.id !== id);
    this.save();
    logger.info(`Account deleted: ${id}`);
    return true;
  }

  getAccount(id) {
    return this.accounts.find(a => a.id === id) || null;
  }

  getAllAccounts() {
    return this.accounts.map(a => ({
      ...a,
      password: '••••••••' // Mask password in responses
    }));
  }

  getAccountRaw(id) {
    return this.accounts.find(a => a.id === id) || null;
  }

  getAccountCount() {
    return this.accounts.length;
  }

  getOptimalAccount() {
    const eligible = this.accounts.filter(a =>
      a.statusCookie === 'active' &&
      a.statusProxy !== 'offline' &&
      a.creditsLeft > 10
    );

    if (eligible.length === 0) return null;

    // Sort by lastUsed (LRU) then by credits (most first)
    eligible.sort((a, b) => {
      const aTime = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
      const bTime = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
      if (aTime !== bTime) return aTime - bTime; // LRU first
      return b.creditsLeft - a.creditsLeft; // Then most credits
    });

    const selected = eligible[0];
    this.updateAccount(selected.id, { lastUsed: new Date().toISOString() });
    return selected;
  }

  getAccountsNeedingLogin() {
    return this.accounts.filter(a => a.statusCookie === 'expired');
  }
}

module.exports = AccountManager;