const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyChecker {
  constructor() {
    this.timeout = 10000;
  }

  async check(proxyString) {
    if (!proxyString) return false;

    try {
      const agent = new HttpsProxyAgent(proxyString);

      const start = Date.now();
      const response = await axios.get('https://httpbin.org/ip', {
        httpsAgent: agent,
        httpAgent: agent,
        timeout: this.timeout,
        validateStatus: () => true
      });

      const latency = Date.now() - start;

      if (response.status === 200 && response.data && response.data.origin) {
        logger.info(`Proxy check OK: ${proxyString} -> IP: ${response.data.origin} (${latency}ms)`);
        return {
          online: true,
          ip: response.data.origin,
          latency
        };
      }

      return { online: false, error: 'Invalid response' };
    } catch (err) {
      logger.error(`Proxy check FAILED: ${proxyString} -> ${err.message}`);
      return { online: false, error: err.message };
    }
  }

  async checkAll(accounts) {
    const results = [];
    for (const account of accounts) {
      if (account.proxy) {
        const result = await this.check(account.proxy);
        results.push({
          accountId: account.id,
          proxy: account.proxy,
          ...result
        });
      }
    }
    return results;
  }
}

module.exports = ProxyChecker;