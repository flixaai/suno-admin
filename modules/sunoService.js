const axios = require('axios');
const puppeteer = require('puppeteer');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class SunoService {
  constructor(accountManager, browserManager, sessionManager, queueManager) {
    this.accountManager = accountManager;
    this.browserManager = browserManager;
    this.sessionManager = sessionManager;
    this.queueManager = queueManager;
    this.apiBase = 'https://studio-api.prod.suno.com';
    this.settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
  }

  getBrightDataWS() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const s = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        if (s.brightDataWS) return s.brightDataWS;
      }
    } catch (e) {}
    return process.env.BRIGHT_DATA_WS || 'wss://brd-customer-hl_c154ff17-zone-suno_browser:ar1oslh5xtvr@brd.superproxy.io:9222';
  }

  getAxiosConfig(account, session) {
    const headers = {
      'Authorization': `Bearer ${session.bearerToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://suno.com',
      'Referer': 'https://suno.com/',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    };

    if (session.cookies) headers['Cookie'] = session.cookies;

    const config = { headers, timeout: 60000 };
    if (account && account.proxy) {
      const agent = new HttpsProxyAgent(account.proxy);
      config.httpsAgent = agent;
      config.httpAgent = agent;
    }
    return config;
  }

  async ensureValidSession(accountId) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) throw new Error(`Akun tidak ditemukan: ${accountId}`);

    const session = this.sessionManager.loadSession(accountId);
    if (!session || !session.bearerToken) {
      throw new Error(`Tidak ada sesi aktif. Silakan import cookie.`);
    }

    return { account, session };
  }

  async getMyFeed(accountIdOrNull = null) {
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;
    if (!accountId) return [];

    try {
      const { account, session } = await this.ensureValidSession(accountId);
      const config = this.getAxiosConfig(account, session);
      const res = await axios.get(`${this.apiBase}/api/feed/`, config);
      const clips = res.data || [];
      return clips.map(c => {
        const durationSec = Math.floor(c.metadata?.duration || 0);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        return {
          id: c.id,
          audioId: c.id,
          title: c.title || 'Untitled Song',
          status: c.status,
          audioUrl: c.audio_url || `https://cdn1.suno.ai/${c.id}.mp3`,
          imageUrl: c.image_url || c.image_large_url || `https://cdn1.suno.ai/image_${c.id}.png`,
          tags: c.metadata?.tags || 'Music',
          model: c.model_name || 'V6-MINI',
          duration: durationSec > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : '3:00'
        };
      });
    } catch (err) {
      return [];
    }
  }

  async checkCredits(accountId) {
    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.get(`${this.apiBase}/api/billing/info/`, config);
      const credits = res.data?.total_credits_left !== undefined ? res.data.total_credits_left : (res.data?.credits_left || 0);
      this.accountManager.updateAccount(accountId, { creditsLeft: credits, lastChecked: new Date().toISOString() });
      return credits;
    } catch (err) {
      throw new Error(err.response?.data?.detail || err.message);
    }
  }

  async generateSong(accountIdOrNull, options = {}) {
    const taskId = uuidv4();
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;
    if (!accountId) throw new Error('Tidak ada akun aktif yang tersedia');

    let { account, session } = await this.ensureValidSession(accountId);

    const { prompt = '', lyrics = '', style = '', title = '', instrumental = false, modelVersion = 'v6-mini' } = options;
    const modelMap = { 'v6-mini': 'chirp-v6-mini', 'v6': 'chirp-v6-0', 'v6-wild': 'chirp-v6-wild', 'v4': 'chirp-v4', 'v3.5': 'chirp-v3-5' };
    const selectedMv = modelMap[modelVersion] || 'chirp-v6-mini';

    let payload = { make_instrumental: !!instrumental, mv: selectedMv };
    if (instrumental) {
      payload.prompt = '';
      payload.tags = style || prompt || 'Instrumental';
      payload.title = title || 'Untitled Instrumental';
    } else if (lyrics || style || title) {
      payload.prompt = lyrics || prompt;
      payload.tags = style || '';
      payload.title = title || 'Untitled Song';
    } else {
      payload.gpt_description_prompt = prompt || title || style || 'Pop song';
    }

    let clips = null;

    // JALUR 1: Coba Axios Cepat
    try {
      const config = this.getAxiosConfig(account, session);
      const res = await axios.post(`${this.apiBase}/api/generate/v2/`, payload, config);
      if (res.data && res.data.clips) clips = res.data.clips;
    } catch (errAxios) {
      logger.warn(`Axios ditolak Suno. Mengalihkan ke Bright Data Unlocker...`);
    }

    // JALUR 2: Bright Data Unlocker (Bypass Page.navigate Forbidden Error)
    if (!clips) {
      let browser = null;
      try {
        const wsUrl = this.getBrightDataWS();
        logger.info(`[Bright Data Unlocker] Menghubungkan ke ${wsUrl.slice(0, 30)}...`);
        browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
        const page = await browser.newPage();

        // Buka Suno secara bersih tanpa header cookie di level navigasi (Aman dari error Page.navigate)
        await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 35000 });

        // Eksekusi generate langsung lewat fetch di dalam browser dengan token
        const genResult = await page.evaluate(async (pl, token, cookiesStr) => {
          try {
            const response = await fetch('https://studio-api.prod.suno.com/api/generate/v2/', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify(pl)
            });
            return await response.json();
          } catch (e) {
            return { error: e.message };
          }
        }, payload, session.bearerToken, session.cookies);

        if (genResult && genResult.clips) {
          clips = genResult.clips;
          logger.info(`[Bright Data SUCCESS] 2 Lagu berhasil dibuat!`);
        } else {
          throw new Error(genResult.detail || genResult.error || 'Respon klip tidak ditemukan');
        }
      } catch (errBD) {
        logger.error(`Bright Data Runner Error: ${errBD.message}`);
        throw new Error(errBD.message);
      } finally {
        if (browser) try { await browser.close(); } catch (e) {}
      }
    }

    if (clips) {
      const clipIds = clips.map(c => c.id);

      this.queueManager.addTask({
        taskId, accountId, clipIds, title: title || payload.title || 'Untitled',
        status: 'processing', options, createdAt: new Date().toISOString(), result: null
      });

      setTimeout(async () => {
        try {
          const newCredits = await this.checkCredits(accountId);
          global.io.emit('account:credits', { id: accountId, credits: newCredits });
        } catch (e) {}
      }, 3000);

      this.pollTaskStatus(taskId, accountId, clipIds);
      return { taskId, clipIds, status: 'processing', accountUsed: accountId };
    }

    throw new Error('Gagal memproses lagu');
  }

  async pollTaskStatus(taskId, accountId, clipIds) {
    const maxAttempts = 120;
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) return;
      try {
        const { account, session } = await this.ensureValidSession(accountId);
        const config = this.getAxiosConfig(account, session);
        const ids = clipIds.join(',');
        const res = await axios.get(`${this.apiBase}/api/feed/?ids=${ids}`, config);
        const clips = res.data || [];

        const allComplete = clips.every(c => c.status === 'complete' || (c.status === 'streaming' && c.audio_url));
        if (allComplete) {
          const result = clips.map(c => {
            const durationSec = Math.floor(c.metadata?.duration || 0);
            const mins = Math.floor(durationSec / 60);
            const secs = durationSec % 60;
            return {
              id: c.id,
              audioId: c.id,
              taskId: taskId,
              title: c.title || 'Untitled Song',
              status: c.status,
              audioUrl: c.audio_url || `https://cdn1.suno.ai/${c.id}.mp3`,
              imageUrl: c.image_url || c.image_large_url || `https://cdn1.suno.ai/image_${c.id}.png`,
              tags: c.metadata?.tags || 'Music',
              model: c.model_name || 'V6-MINI',
              duration: durationSec > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : '3:00'
            };
          });

          this.queueManager.updateTask(taskId, { status: 'completed', result, completedAt: new Date().toISOString() });
          global.io.emit('task:completed', { taskId, result });
          global.io.emit('tasks:updated', this.queueManager.getAllTasks().slice(0, 50));
          return;
        }
        attempts++;
        setTimeout(poll, 4000);
      } catch (err) {
        attempts++;
        setTimeout(poll, 5000);
      }
    };
    setTimeout(poll, 3000);
  }
}

module.exports = SunoService;