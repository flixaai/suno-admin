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

    if (session.cookies) {
      headers['Cookie'] = session.cookies;
    }

    const config = {
      headers,
      timeout: 60000
    };

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
      throw new Error(`Tidak ada sesi aktif untuk ${accountId}.`);
    }

    return { account, session };
  }

  async checkCredits(accountId) {
    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.get(`${this.apiBase}/api/billing/info/`, config);
      const credits = res.data?.total_credits_left !== undefined 
        ? res.data.total_credits_left 
        : (res.data?.credits_left || 0);

      this.accountManager.updateAccount(accountId, {
        creditsLeft: credits,
        lastChecked: new Date().toISOString()
      });

      return credits;
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
      logger.error(`Credit check error: ${errMsg}`);
      throw new Error(errMsg);
    }
  }

  async generateSong(accountIdOrNull, options = {}) {
    const taskId = uuidv4();
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;

    if (!accountId) {
      throw new Error('Tidak ada akun aktif yang tersedia dengan saldo kredit.');
    }

    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    const {
      prompt = '',
      lyrics = '',
      style = '',
      title = '',
      instrumental = false
    } = options;

    // PAYLOAD RESMI SUNO UNTUK AKUN KREDIT (MODEL v3.5 STABIL)
    let payload = {
      make_instrumental: !!instrumental,
      mv: 'chirp-v3-5'
    };

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
      logger.info(`Membuat lagu dengan akun ${accountId}, task ${taskId}`);
      logger.info(`Payload: ${JSON.stringify(payload)}`);

      // Kirim langsung ke jalur resmi Suno Production
      const res = await axios.post(`${this.apiBase}/api/generate/v2/`, payload, config);

      if (res.data && res.data.clips) {
        const clips = res.data.clips;
        const clipIds = clips.map(c => c.id);

        this.queueManager.addTask({
          taskId,
          accountId,
          clipIds,
          status: 'processing',
          options,
          createdAt: new Date().toISOString(),
          result: null
        });

        // Update sisa kredit
        setTimeout(async () => {
          try {
            const newCredits = await this.checkCredits(accountId);
            global.io.emit('account:credits', { id: accountId, credits: newCredits });
          } catch (e) {}
        }, 3000);

        // Polling hasil audio
        this.pollTaskStatus(taskId, accountId, clipIds);

        return {
          taskId,
          clipIds,
          status: 'processing',
          accountUsed: accountId
        };
      }

      throw new Error('Respon tidak valid dari Suno API');
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
      logger.error(`Generate song error: ${JSON.stringify(err.response?.data || err.message)}`);
      throw new Error(errMsg);
    }
  }

  async getTaskStatus(taskId) {
    return this.queueManager.getTask(taskId);
  }

  async getClipStatus(clipIds, accountId) {
    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    try {
      const ids = clipIds.join(',');
      const res = await axios.get(`${this.apiBase}/api/feed/?ids=${ids}`, config);
      return res.data || [];
    } catch (err) {
      logger.error(`Clip status error: ${err.message}`);
      throw err;
    }
  }

  async pollTaskStatus(taskId, accountId, clipIds) {
    const maxAttempts = 120;
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        this.queueManager.updateTask(taskId, {
          status: 'timeout',
          error: 'Pembuatan lagu memakan waktu lebih dari 10 menit'
        });
        global.io.emit('task:updated', this.queueManager.getTask(taskId));
        return;
      }

      try {
        const clips = await this.getClipStatus(clipIds, accountId);

        const allComplete = clips.every(c =>
          c.status === 'complete' || c.status === 'streaming' || c.status === 'error'
        );

        if (allComplete) {
          const result = clips.map(c => ({
            id: c.id,
            title: c.title,
            status: c.status,
            audioUrl: c.audio_url,
            videoUrl: c.video_url,
            imageUrl: c.image_url || c.image_large_url,
            tags: c.metadata?.tags,
            duration: c.metadata?.duration
          }));

          this.queueManager.updateTask(taskId, {
            status: 'completed',
            result,
            completedAt: new Date().toISOString()
          });

          global.io.emit('task:completed', { taskId, result });
          logger.info(`Task ${taskId} selesai!`);
          return;
        }

        attempts++;
        setTimeout(poll, 5000);
      } catch (err) {
        attempts++;
        setTimeout(poll, 5000);
      }
    };

    setTimeout(poll, 4000);
  }
}

module.exports = SunoService;