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
    this.apiBase = process.env.SUNO_API_BASE || 'https://studio-api.suno.ai';
  }

  getAxiosConfig(account, session) {
    const config = {
      headers: {
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
        'sec-fetch-site': 'cross-site'
      },
      timeout: 30000
    };

    if (account.proxy) {
      const agent = new HttpsProxyAgent(account.proxy);
      config.httpsAgent = agent;
      config.httpAgent = agent;
    }

    return config;
  }

  async ensureValidSession(accountId) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    let session = this.sessionManager.loadSession(accountId);

    if (!session || !session.bearerToken) {
      throw new Error(`No valid session for ${accountId}. Please login first.`);
    }

    // Try token refresh if expired
    try {
      const config = this.getAxiosConfig(account, session);
      await axios.get(`${this.apiBase}/api/billing/info/`, config);
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        const refreshed = await this.sessionManager.refreshToken(accountId);
        if (!refreshed) {
          this.accountManager.updateAccount(accountId, { statusCookie: 'expired' });
          throw new Error(`Session expired for ${accountId}. Re-login required.`);
        }
        session = this.sessionManager.loadSession(accountId);
      }
    }

    return { account, session };
  }

  async checkCredits(accountId) {
    const { account, session } = await this.ensureValidSession(accountId);
    const config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.get(`${this.apiBase}/api/billing/info/`, config);
      const credits = res.data?.total_credits_left || 0;
      this.accountManager.updateAccount(accountId, {
        creditsLeft: credits,
        lastChecked: new Date().toISOString()
      });
      return credits;
    } catch (err) {
      logger.error(`Credit check error for ${accountId}:`, err.message);
      throw err;
    }
  }

  async generateSong(accountIdOrNull, options = {}) {
    const taskId = uuidv4();
    const accountId = accountIdOrNull || this.accountManager.getOptimalAccount()?.id;

    if (!accountId) {
      throw new Error('No available account with active session and credits');
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
      modelVersion = 'chirp-v4',
      vocalGender = null,
      personaId = null,
      voiceId = null,
      continueClipId = null,
      continueAt = null,
      infill = false
    } = options;

    // Map model version strings to Suno's internal model names
    const modelMap = {
      'v3': 'chirp-v3-0',
      'v3.5': 'chirp-v3-5',
      'v4': 'chirp-v4',
      'v4.5': 'chirp-v4-5',
      'v5': 'chirp-v5',
      'v6': 'chirp-v6'
    };

    const mvKey = modelVersion.toLowerCase().replace('chirp-', '').replace('v', 'v');
    const mv = modelMap[mvKey] || modelVersion;

    let payload;

    if (isCustom || lyrics) {
      // Custom mode
      payload = {
        prompt: lyrics || prompt,
        tags: style || '',
        title: title || '',
        make_instrumental: instrumental,
        mv: mv,
        generation_type: 'TEXT'
      };
    } else {
      // Simple prompt mode
      payload = {
        gpt_description_prompt: prompt,
        make_instrumental: instrumental,
        mv: mv,
        generation_type: 'TEXT'
      };
    }

    if (continueClipId) {
      payload.continue_clip_id = continueClipId;
      if (continueAt !== null) {
        payload.continue_at = continueAt;
      }
    }

    if (infill) {
      payload.infill = true;
    }

    if (personaId) {
      payload.persona_id = personaId;
    }

    if (voiceId) {
      payload.voice_id = voiceId;
    }

    if (vocalGender) {
      payload.vocal_gender = vocalGender;
    }

    try {
      logger.info(`Generating song with account ${accountId}, task ${taskId}`);

      const endpoint = isCustom || lyrics
        ? `${this.apiBase}/api/generate/v2/`
        : `${this.apiBase}/api/generate/v2/`;

      const res = await axios.post(endpoint, payload, config);

      if (res.data && res.data.clips) {
        const clips = res.data.clips;
        const clipIds = clips.map(c => c.id);

        // Store task
        this.queueManager.addTask({
          taskId,
          accountId,
          clipIds,
          status: 'processing',
          options,
          createdAt: new Date().toISOString(),
          result: null
        });

        // Update credits
        try {
          const newCredits = await this.checkCredits(accountId);
          global.io.emit('account:credits', { id: accountId, credits: newCredits });
        } catch (e) { }

        // Start polling for status
        this.pollTaskStatus(taskId, accountId, clipIds);

        return {
          taskId,
          clipIds,
          status: 'processing',
          accountUsed: accountId
        };
      }

      throw new Error('Unexpected response from Suno API');
    } catch (err) {
      logger.error(`Generate song error for ${accountId}:`, err.response?.data || err.message);

      if (err.response?.status === 402 || err.response?.data?.detail?.includes('credit')) {
        this.accountManager.updateAccount(accountId, { creditsLeft: 0 });
        // Retry with another account
        const nextAccount = this.accountManager.getOptimalAccount();
        if (nextAccount && nextAccount.id !== accountId) {
          logger.info(`Retrying with account ${nextAccount.id}...`);
          return this.generateSong(nextAccount.id, options);
        }
      }

      throw err;
    }
  }

  async extendTrack(audioId, prompt = '', continueAt = null, accountId = null) {
    const accId = accountId || this.accountManager.getOptimalAccount()?.id;
    if (!accId) throw new Error('No available account');

    return this.generateSong(accId, {
      prompt,
      continueClipId: audioId,
      continueAt,
      isCustom: true
    });
  }

  async createRemixOrCover(audioId, newStyle, accountId = null) {
    const accId = accountId || this.accountManager.getOptimalAccount()?.id;
    if (!accId) throw new Error('No available account');

    const { account, session } = await this.ensureValidSession(accId);
    const config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.post(`${this.apiBase}/api/generate/v2/`, {
        continue_clip_id: audioId,
        tags: newStyle,
        generation_type: 'REMIX',
        mv: 'chirp-v4'
      }, config);

      const taskId = uuidv4();
      const clips = res.data?.clips || [];
      const clipIds = clips.map(c => c.id);

      this.queueManager.addTask({
        taskId,
        accountId: accId,
        clipIds,
        status: 'processing',
        options: { type: 'remix', audioId, newStyle },
        createdAt: new Date().toISOString()
      });

      this.pollTaskStatus(taskId, accId, clipIds);
      return { taskId, clipIds, status: 'processing' };
    } catch (err) {
      logger.error(`Remix error:`, err.response?.data || err.message);
      throw err;
    }
  }

  async separateStems(audioId, accountId = null) {
    const accId = accountId || this.accountManager.getOptimalAccount()?.id;
    if (!accId) throw new Error('No available account');

    const { account, session } = await this.ensureValidSession(accId);
    const config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.post(`${this.apiBase}/api/stem/`, {
        clip_id: audioId
      }, config);

      const taskId = uuidv4();

      this.queueManager.addTask({
        taskId,
        accountId: accId,
        clipIds: [audioId],
        status: 'processing',
        options: { type: 'stem_separate', audioId },
        createdAt: new Date().toISOString()
      });

      this.pollStemStatus(taskId, accId, audioId);
      return { taskId, status: 'processing' };
    } catch (err) {
      logger.error(`Stem separation error:`, err.response?.data || err.message);
      throw err;
    }
  }

  async uploadAudioAndInfill(filePath, options = {}, accountId = null) {
    const accId = accountId || this.accountManager.getOptimalAccount()?.id;
    if (!accId) throw new Error('No available account');

    const { account, session } = await this.ensureValidSession(accId);

    try {
      // First upload the audio
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));

      const uploadConfig = {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${session.bearerToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 60000
      };

      if (account.proxy) {
        const agent = new HttpsProxyAgent(account.proxy);
        uploadConfig.httpsAgent = agent;
        uploadConfig.httpAgent = agent;
      }

      const uploadRes = await axios.post(
        `${this.apiBase}/api/uploads/audio/`,
        form,
        uploadConfig
      );

      const uploadId = uploadRes.data?.id;
      if (!uploadId) throw new Error('Upload failed - no ID returned');

      // Now generate with the uploaded audio
      return this.generateSong(accId, {
        ...options,
        uploadedAudioId: uploadId,
        infill: true
      });
    } catch (err) {
      logger.error(`Upload and infill error:`, err.response?.data || err.message);
      throw err;
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
      logger.error(`Clip status error:`, err.response?.data || err.message);
      throw err;
    }
  }

  async pollTaskStatus(taskId, accountId, clipIds) {
    const maxAttempts = 120; // 10 minutes at 5s intervals
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        this.queueManager.updateTask(taskId, {
          status: 'timeout',
          error: 'Generation timed out after 10 minutes'
        });
        global.io.emit('task:updated', this.queueManager.getTask(taskId));
        return;
      }

      try {
        const clips = await this.getClipStatus(clipIds, accountId);

        const allComplete = clips.every(c =>
          c.status === 'complete' || c.status === 'streaming' || c.status === 'error'
        );
        const anyError = clips.some(c => c.status === 'error');

        if (allComplete) {
          const result = clips.map(c => ({
            id: c.id,
            title: c.title,
            status: c.status,
            audioUrl: c.audio_url,
            videoUrl: c.video_url,
            imageUrl: c.image_url || c.image_large_url,
            lyrics: c.metadata?.prompt,
            tags: c.metadata?.tags,
            duration: c.metadata?.duration,
            stems: c.stems_url ? {
              vocals: c.stems_url?.vocals,
              instrumental: c.stems_url?.instrumental,
              bass: c.stems_url?.bass,
              drums: c.stems_url?.drums,
              other: c.stems_url?.other
            } : null,
            modelName: c.model_name,
            createdAt: c.created_at
          }));

          this.queueManager.updateTask(taskId, {
            status: anyError ? 'partial_error' : 'completed',
            result,
            completedAt: new Date().toISOString()
          });

          global.io.emit('task:completed', {
            taskId,
            result
          });

          logger.info(`Task ${taskId} completed with ${result.length} clips`);
          return;
        }

        // Update progress
        const progress = clips.map(c => ({ id: c.id, status: c.status }));
        this.queueManager.updateTask(taskId, { progress });
        global.io.emit('task:progress', { taskId, progress });

        attempts++;
        setTimeout(poll, 5000);
      } catch (err) {
        logger.error(`Poll error for task ${taskId}:`, err.message);
        attempts++;
        setTimeout(poll, 5000);
      }
    };

    // Start polling after a small delay
    setTimeout(poll, 3000);
  }

  async pollStemStatus(taskId, accountId, audioId) {
    const maxAttempts = 60;
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        this.queueManager.updateTask(taskId, { status: 'timeout' });
        return;
      }

      try {
        const clips = await this.getClipStatus([audioId], accountId);
        const clip = clips[0];

        if (clip && clip.stems_url) {
          this.queueManager.updateTask(taskId, {
            status: 'completed',
            result: {
              id: audioId,
              stems: clip.stems_url
            },
            completedAt: new Date().toISOString()
          });

          global.io.emit('task:completed', {
            taskId,
            result: { stems: clip.stems_url }
          });
          return;
        }

        attempts++;
        setTimeout(poll, 5000);
      } catch (err) {
        attempts++;
        setTimeout(poll, 5000);
      }
    };

    setTimeout(poll, 3000);
  }

  // Concatenate/extend song
  async concatSong(clipId, options = {}, accountId = null) {
    const accId = accountId || this.accountManager.getOptimalAccount()?.id;
    if (!accId) throw new Error('No available account');

    const { account, session } = await this.ensureValidSession(accId);
    const config = this.getAxiosConfig(account, session);

    try {
      const res = await axios.post(`${this.apiBase}/api/generate/concat/v2/`, {
        clip_id: clipId,
        ...options
      }, config);

      const taskId = uuidv4();
      const clips = res.data?.clips || [];
      const clipIds = clips.map(c => c.id);

      this.queueManager.addTask({
        taskId,
        accountId: accId,
        clipIds,
        status: 'processing',
        options: { type: 'concat', clipId },
        createdAt: new Date().toISOString()
      });

      this.pollTaskStatus(taskId, accId, clipIds);
      return { taskId, clipIds, status: 'processing' };
    } catch (err) {
      logger.error(`Concat error:`, err.response?.data || err.message);
      throw err;
    }
  }
}

module.exports = SunoService;