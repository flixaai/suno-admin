const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { v4: uuidv4 } = require('uuid');

class SunoService {
  constructor(accountManager, browserManager, sessionManager, queueManager) {
    this.accountManager = accountManager;
    this.browserManager = browserManager;
    this.sessionManager = sessionManager;
    this.queueManager = queueManager;
    this.apiBase = 'https://studio-api.prod.suno.com';
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

  // AUTO-GUARD: Cek masa aktif token sebelum melakukan aktivitas apa pun
  async ensureValidSession(accountId) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) throw new Error(`Akun tidak ditemukan: ${accountId}`);

    let session = this.sessionManager.loadSession(accountId);
    if (!session || !session.bearerToken) {
      throw new Error(`Tidak ada sesi aktif untuk ${accountId}.`);
    }

    // Jika token sudah mau habis (kurang dari 5 menit), perpanjang saat ini juga!
    if (this.sessionManager.isTokenExpiring(session.bearerToken)) {
      await this.sessionManager.refreshToken(accountId);
      session = this.sessionManager.loadSession(accountId);
    }

    return { account, session };
  }

  async getMyFeed(accountIdOrNull = null) {
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;
    if (!accountId) return [];

    let { account, session } = await this.ensureValidSession(accountId);
    let config = this.getAxiosConfig(account, session);

    try {
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
      if (err.response?.status === 401) {
        const refreshed = await this.sessionManager.refreshToken(accountId);
        if (refreshed) return this.getMyFeed(accountId);
      }
      return [];
    }
  }

  async checkCredits(accountId) {
    let { account, session } = await this.ensureValidSession(accountId);
    let config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.get(`${this.apiBase}/api/billing/info/`, config);
      const credits = res.data?.total_credits_left !== undefined ? res.data.total_credits_left : (res.data?.credits_left || 0);
      this.accountManager.updateAccount(accountId, { creditsLeft: credits, lastChecked: new Date().toISOString() });
      return credits;
    } catch (err) {
      if (err.response?.status === 401) {
        const refreshed = await this.sessionManager.refreshToken(accountId);
        if (refreshed) return this.checkCredits(accountId);
      }
      throw new Error(err.response?.data?.detail || err.message);
    }
  }

  async generateSong(accountIdOrNull, options = {}) {
    const taskId = uuidv4();
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;
    if (!accountId) throw new Error('Tidak ada akun aktif yang tersedia');

    let { account, session } = await this.ensureValidSession(accountId);
    let config = this.getAxiosConfig(account, session);

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

    try {
      let res;
      try {
        res = await axios.post(`${this.apiBase}/api/generate/v2/`, payload, config);
      } catch (errPost) {
        if (errPost.response?.status === 401) {
          // Token expired, perpanjang otomatis detik itu juga lalu ulangi request!
          const refreshed = await this.sessionManager.refreshToken(accountId);
          if (refreshed) {
            session = this.sessionManager.loadSession(accountId);
            config = this.getAxiosConfig(account, session);
            res = await axios.post(`${this.apiBase}/api/generate/v2/`, payload, config);
          } else {
            throw errPost;
          }
        } else {
          payload.mv = 'chirp-v3-5';
          res = await axios.post(`${this.apiBase}/api/generate/v2/`, payload, config);
        }
      }

      if (res.data && res.data.clips) {
        const clips = res.data.clips;
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
      throw new Error('Respon tidak valid dari Suno API');
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
      throw new Error(errMsg);
    }
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