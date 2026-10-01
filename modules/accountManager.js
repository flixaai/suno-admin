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

      // Bersihkan akun duplikat atau pulihkan dengan token baru yang fresh!
      this.ensureFreshPrimaryAccount();
    } catch (err) {
      logger.error('Failed to load accounts:', err);
      this.accounts = [];
      this.ensureFreshPrimaryAccount();
    }
  }

  ensureFreshPrimaryAccount() {
    const defaultId = 'acc_keisya_main';
    const defaultEmail = 'keisyaoktaviani86441@habisuno.my.id';
    
    // TOKEN BARU FRESH DARI KIWI BROWSER ANDA
    const freshToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6InN1bm8tYXBpLXJzMjU2LWtleS0xIiwidHlwIjoiSldUIiwieC1hYmx5LXRva2VuIjoibnYzNlZ3LklxUm0yUU9qaVN1bzVBY3phT0ZTUXlmNGk0bmUtZF9Zdy04NXpaY1BkcFE5QmQzeHd4WEdHWVk0d01fUS1pdWtXSUN0TV9yTW11dDJHYTFjT0FPaUF3ZEU5cUN3NmlPSjFBcDUzaTRzd2Z5LVZXZV9ZSkhuZk5nNnJDbE8tMTAxclpsZ2FuaHFtdEZ4SkNlUjJucERzemRXVkpCQ1JUdmNDUW9MX01GMkZSTUJNVndkdkdxYWg0WVcyZzc0VWhJOFdHelJtcDBobmV4X0h1VHNuRzVPTE5qODIyWkRaXzhVb0dlZDlxVGxSTjVjIn0.eyJzdW5vLmNvbS9jbGFpbXMvdXNlcl9pZCI6ImJhZGUyOGIwLTNjNmMtNDVhZi04M2ZlLTg1NTIyZjBkOWY5OSIsImh0dHBzOi8vc3Vuby5haS9jbGFpbXMvY2xlcmtfaWQiOiJiYWRlMjhiMC0zYzZjLTQ1YWYtODNmZS04NTUyMmYwZDlmOTkiLCJzdW5vLmNvbS9jbGFpbXMvdG9rZW5fdHlwZSI6ImFjY2VzcyIsInN1bm8vZGlkIjoxNTQ2NzAzODksImV4cCI6MTc5MDg0OTkyMiwiYXVkIjoic3Vuby1hcGkiLCJzdWIiOiJiYWRlMjhiMC0zYzZjLTQ1YWYtODNmZS04NTUyMmYwZDlmOTkiLCJhenAiOiJodHRwczovL3N1bm8uY29tIiwiZnZhIjpbMCwtMV0sImlhdCI6MTc5MDg0NjMyMiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnN1bm8uY29tIiwiaml0IjoiNWZmZTkwOTctY2MxOS00YTE1LTkyYmEtMGYyNzUzMmY0MzZiIiwicGxhbiI6Ijo6Iiwic3Vuby9qb2luZWQiOjE3OTA4NDIxMzUsInNpZCI6InNlc3Npb25fOWU1YjkyNDU1MzFmYWE5YjMyZjZmMSIsInN1bm8uY29tL2NsYWltcy9lbWFpbCI6ImtlaXN5YW9rdGF2aWFuaTg2NDQxQGhhYmlzdW5vLm15LmlkIiwiaHR0cHM6Ly9zdW5vLmFpL2NsYWltcy9lbWFpbCI6ImtlaXN5YW9rdGF2aWFuaTg2NDQxQGhhYmlzdW5vLm15LmlkIiwic3Vuby9oYW5kbGUiOiJrZWlzeWFva3Rhdmlhbmk4NjQ0MSIsInN1bm8vdXNlcl9pZCI6IjE5NTI0NTUyMCJ9.dFWX7fIGDf9NoemSpGUZ2OrLXZPjKUbBynO6lyJBuHQRtEVUnv_sUWDKrPyklYHt1_PraVcC9eHpAH1GUWULspAnvtCAZDG9qDTG7_Mrq4uPf-gLjqw3lmY-nVpw7FTjK6jSgU0c7bjZcCbAee2wb1vuOqvwgAxWZaMnlvorNiaU6O_enc-WAa3ycX_-DTqsXC-DHpBrTPgPpSA-C-hY1OWQuvNc7eqdMivNxzVo3zY9wF-fDjkU_IpXwxd_2fh0dNp2ElJ261AGCuLInvHmdeR78TvySQthj7lXObkFg5kym_3ZHbbjSLsW6BJ4293R3_Shl6ehvsXjjHLfmpyJqg";
    const freshCookies = `__session=${freshToken}; __client_uat=1790842135`;

    // Buang semua akun lama yang duplikat
    this.accounts = this.accounts.filter(a => a.email !== defaultEmail && a.id !== defaultId);

    const primaryAccount = {
      id: defaultId,
      email: defaultEmail,
      password: '••••••••',
      proxy: null,
      cookiesPath: `./sessions/${defaultId}.json`,
      creditsLeft: 260,
      statusProxy: 'none',
      statusCookie: 'active',
      bearerToken: freshToken,
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    this.accounts.unshift(primaryAccount); // Jadikan akun nomor 1 utama
    this.save();

    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(this.sessionsDir, `${defaultId}.json`), JSON.stringify({
      bearerToken: freshToken,
      cookies: freshCookies
    }, null, 2));

    logger.info(`[AccountManager] Akun utama ${defaultEmail} diperbarui dengan token segar!`);
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

  addOrUpdateAccount({ email, password, proxy }) {
    // Jika email sudah ada, update akun lama (tidak membuat duplikat)
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

  // Selalu pilih akun aktif dengan login paling baru!
  getOptimalAccount() {
    const eligible = this.accounts.filter(a => a.statusCookie === 'active');
    if (!eligible.length) return null;
    return eligible.sort((a, b) => new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0))[0];
  }
}

module.exports = AccountManager;