const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class SunoService {
  constructor(accountManager, browserManager, sessionManager, queueManager) {
    this.accountManager = accountManager;
    this.browserManager = browserManager;
    this.sessionManager = sessionManager;
    this.queueManager = queueManager;
    // Jalur Resmi Terbaru Suno AI (Production)
    this.apiBase = 'https://studio-api.prod.suno.com';
    this.fallbackApiBase = 'https://studio-api.suno.ai';
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

    // WAJIB: Masukkan Cookie lengkap agar tidak kena 503 dari Cloudflare
    if (session.cookies) {
      headers['Cookie'] = session.cookies;
    }

    const config = {
      headers,
      timeout: 45000
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
      throw new Error(`Tidak ada sesi aktif untuk ${accountId}. Silakan import cookie ulang.`);
    }

    return { account, session };
  }

  async checkCredits(accountId) {
    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    try {
      // Coba jalur utama prod
      let res;
      try {
        res = await axios.get(`${this.apiBase}/api/billing/info/`, config);
      } catch (e) {
        // Fallback jalur alternatif
        res = await axios.get(`${this.fallbackApiBase}/api/billing/info/`, config);
      }

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
      logger.error(`Credit check error untuk ${accountId}: ${errMsg}`);
      throw new Error(errMsg);
    }
  }

  async generateSong(accountIdOrNull, options = {}) {
    const taskId = uuidv4();
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;

    if (!accountId) {
      throw new Error('Tidak ada akun aktif yang tersedia dengan sesi valid');
    }

    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    const {
      prompt = '',
      lyrics = '',
      style = '',
      title = '',
      isCustom = false,
      instrumental = false,
      modelVersion = 'chirp-v4'
    } = options;

    let payload = {};

    if (instrumental) {
      // Mode Instrumental Tanpa Vokal
      payload = {
        prompt: '',
        tags: style || prompt || 'Instrumental',
        title: title || 'Untitled Instrumental',
        make_instrumental: true,
        mv: 'chirp-v4',
        generation_type: 'TEXT'
      };
    } else if (isCustom || lyrics) {
      // Mode Custom dengan Lirik
      payload = {
        prompt: lyrics || prompt,
        tags: style || '',
        title: title || 'Untitled Song',
        make_instrumental: false,
        mv: 'chirp-v4',
        generation_type: 'TEXT'
      };
    } else {
      // Mode Simple Prompt
      payload = {
        gpt_description_prompt: prompt || title || style,
        make_instrumental: false,
        mv: 'chirp-v4',
        generation_type: 'TEXT'
      };
    }

    try {
      logger.info(`Membuat lagu dengan akun ${accountId}, task ${taskId}`);

      let res;
      try {
        res = await axios.post(`${this.apiBase}/api/generate/v2/`, payload, config);
      } catch (errProd) {
        logger.warn('Jalur utama gagal, mencoba jalur fallback...');
        res = await axios.post(`${this.fallbackApiBase}/api/generate/v2/`, payload, config);
      }

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
        try {
          const newCredits = await this.checkCredits(accountId);
          global.io.emit('account:credits', { id: accountId, credits: newCredits });
        } catch (e) {}

        // Mulai polling audio hasil
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
      logger.error(`Generate song error untuk ${accountId}: ${errMsg}`);
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
      let res;
      try {
        res = await axios.get(`${this.apiBase}/api/feed/?ids=${ids}`, config);
      } catch (e) {
        res = await axios.get(`${this.fallbackApiBase}/api/feed/?ids=${ids}`, config);
      }
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