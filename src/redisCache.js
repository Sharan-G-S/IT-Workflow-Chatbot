const redis = require('redis');

/**
 * Redis Cache Service - Persistent caching with Redis
 * Replaces in-memory cache with distributed Redis storage
 */
class RedisCache {
  constructor(options = {}) {
    this.options = {
      host: options.host || process.env.REDIS_HOST || 'localhost',
      port: options.port || process.env.REDIS_PORT || 6379,
      password: options.password || process.env.REDIS_PASSWORD,
      db: options.db || 0,
      keyPrefix: options.keyPrefix || 'itworkflow:',
      defaultTTL: options.defaultTTL || 3600, // 1 hour default
      ...options
    };
    
    this.client = null;
    this.connected = false;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  async connect() {
    if (this.connected) return true;
    
    try {
      this.client = redis.createClient({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password,
        db: this.options.db
      });

      this.client.on('error', (err) => {
        console.error('[REDIS] Connection error:', err.message);
        this.stats.errors++;
      });

      this.client.on('connect', () => {
        console.log('[REDIS] Connected successfully');
        this.connected = true;
      });

      this.client.on('ready', () => {
        console.log('[REDIS] Ready for operations');
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error('[REDIS] Failed to connect:', error.message);
      this.connected = false;
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.connected) {
      await this.client.quit();
      this.connected = false;
      console.log('[REDIS] Disconnected');
    }
  }

  _getKey(key) {
    return `${this.options.keyPrefix}${key}`;
  }

  async get(key) {
    if (!this.connected) {
      console.warn('[REDIS] Not connected, skipping cache get');
      this.stats.misses++;
      return null;
    }

    try {
      const redisKey = this._getKey(key);
      const value = await this.client.get(redisKey);
      
      if (value === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return JSON.parse(value);
    } catch (error) {
      console.error('[REDIS] Get error:', error.message);
      this.stats.errors++;
      this.stats.misses++;
      return null;
    }
  }

  async set(key, value, ttl = null) {
    if (!this.connected) {
      console.warn('[REDIS] Not connected, skipping cache set');
      return false;
    }

    try {
      const redisKey = this._getKey(key);
      const serializedValue = JSON.stringify(value);
      const expiry = ttl || this.options.defaultTTL;
      
      await this.client.setEx(redisKey, expiry, serializedValue);
      this.stats.sets++;
      return true;
    } catch (error) {
      console.error('[REDIS] Set error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  async del(key) {
    if (!this.connected) {
      console.warn('[REDIS] Not connected, skipping cache delete');
      return false;
    }

    try {
      const redisKey = this._getKey(key);
      const result = await this.client.del(redisKey);
      this.stats.deletes++;
      return result > 0;
    } catch (error) {
      console.error('[REDIS] Delete error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  async exists(key) {
    if (!this.connected) return false;

    try {
      const redisKey = this._getKey(key);
      const result = await this.client.exists(redisKey);
      return result === 1;
    } catch (error) {
      console.error('[REDIS] Exists error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  async clear(pattern = '*') {
    if (!this.connected) {
      console.warn('[REDIS] Not connected, skipping cache clear');
      return false;
    }

    try {
      const searchPattern = this._getKey(pattern);
      const keys = await this.client.keys(searchPattern);
      
      if (keys.length > 0) {
        await this.client.del(keys);
        console.log(`[REDIS] Cleared ${keys.length} cache entries`);
      }
      
      return true;
    } catch (error) {
      console.error('[REDIS] Clear error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  async setMultiple(items, ttl = null) {
    if (!this.connected || !Array.isArray(items)) return false;

    try {
      const pipeline = this.client.multi();
      const expiry = ttl || this.options.defaultTTL;

      items.forEach(({ key, value }) => {
        const redisKey = this._getKey(key);
        const serializedValue = JSON.stringify(value);
        pipeline.setEx(redisKey, expiry, serializedValue);
      });

      await pipeline.exec();
      this.stats.sets += items.length;
      return true;
    } catch (error) {
      console.error('[REDIS] SetMultiple error:', error.message);
      this.stats.errors++;
      return false;
    }
  }

  async getMultiple(keys) {
    if (!this.connected || !Array.isArray(keys)) return {};

    try {
      const redisKeys = keys.map(key => this._getKey(key));
      const values = await this.client.mGet(redisKeys);
      
      const result = {};
      keys.forEach((key, index) => {
        if (values[index] !== null) {
          try {
            result[key] = JSON.parse(values[index]);
            this.stats.hits++;
          } catch (parseError) {
            console.error('[REDIS] Parse error for key:', key);
            this.stats.misses++;
          }
        } else {
          this.stats.misses++;
        }
      });

      return result;
    } catch (error) {
      console.error('[REDIS] GetMultiple error:', error.message);
      this.stats.errors++;
      return {};
    }
  }

  async increment(key, amount = 1, ttl = null) {
    if (!this.connected) return null;

    try {
      const redisKey = this._getKey(key);
      const result = await this.client.incrBy(redisKey, amount);
      
      if (ttl) {
        await this.client.expire(redisKey, ttl);
      }
      
      return result;
    } catch (error) {
      console.error('[REDIS] Increment error:', error.message);
      this.stats.errors++;
      return null;
    }
  }

  async getStats() {
    const cacheStats = { ...this.stats };
    
    if (this.connected) {
      try {
        const info = await this.client.info('memory');
        const memoryLines = info.split('\r\n');
        
        cacheStats.redisMemory = {};
        memoryLines.forEach(line => {
          if (line.includes(':')) {
            const [key, value] = line.split(':');
            if (key.includes('memory')) {
              cacheStats.redisMemory[key] = value;
            }
          }
        });
      } catch (error) {
        console.error('[REDIS] Stats error:', error.message);
      }
    }
    
    cacheStats.connected = this.connected;
    cacheStats.hitRate = cacheStats.hits + cacheStats.misses > 0 
      ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(2) + '%'
      : '0%';
    
    return cacheStats;
  }

  // Session store compatibility
  async getSession(sessionId) {
    return await this.get(`session:${sessionId}`);
  }

  async setSession(sessionId, session, ttl = 86400) { // 24 hours default
    return await this.set(`session:${sessionId}`, session, ttl);
  }

  async deleteSession(sessionId) {
    return await this.del(`session:${sessionId}`);
  }

  // Distributed locking
  async acquireLock(resource, ttl = 30) {
    const lockKey = `lock:${resource}`;
    const lockValue = `${Date.now()}-${Math.random()}`;
    
    try {
      const result = await this.client.set(this._getKey(lockKey), lockValue, {
        PX: ttl * 1000, // Convert to milliseconds
        NX: true // Only set if not exists
      });
      
      return result === 'OK' ? lockValue : null;
    } catch (error) {
      console.error('[REDIS] Acquire lock error:', error.message);
      return null;
    }
  }

  async releaseLock(resource, lockValue) {
    const lockKey = `lock:${resource}`;
    
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.client.eval(script, {
        keys: [this._getKey(lockKey)],
        arguments: [lockValue]
      });
      
      return result === 1;
    } catch (error) {
      console.error('[REDIS] Release lock error:', error.message);
      return false;
    }
  }
}

module.exports = { RedisCache };