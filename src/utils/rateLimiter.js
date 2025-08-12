export class RateLimiter {
  constructor(options = {}) {
    const {
      requestsPerSecond = 10,
      requestsPerMinute = 100,
      perDomain = true
    } = options;

    this.requestsPerSecond = requestsPerSecond;
    this.requestsPerMinute = requestsPerMinute;
    this.perDomain = perDomain;
    this.windowMs = 1000; // 1 second window
    this.limits = new Map(); // domain -> { count, resetTime }
  }

  async checkLimit(urlOrDomain) {
    const domain = this.extractDomain(urlOrDomain);
    const now = Date.now();
    
    const key = this.perDomain ? domain : 'global';
    let limit = this.limits.get(key);
    
    if (!limit) {
      limit = {
        secondCount: 0,
        secondReset: now + 1000,
        minuteCount: 0,
        minuteReset: now + 60000
      };
      this.limits.set(key, limit);
    }

    // Reset counters if windows have passed
    if (now > limit.secondReset) {
      limit.secondCount = 0;
      limit.secondReset = now + 1000;
    }
    
    if (now > limit.minuteReset) {
      limit.minuteCount = 0;
      limit.minuteReset = now + 60000;
    }

    // Check rate limits
    if (limit.secondCount >= this.requestsPerSecond) {
      const waitTime = limit.secondReset - now;
      await this.delay(waitTime);
      return this.checkLimit(urlOrDomain);
    }
    
    if (limit.minuteCount >= this.requestsPerMinute) {
      const waitTime = limit.minuteReset - now;
      await this.delay(waitTime);
      return this.checkLimit(urlOrDomain);
    }

    // Increment counters
    limit.secondCount++;
    limit.minuteCount++;
    
    return true;
  }

  extractDomain(urlOrDomain) {
    try {
      if (urlOrDomain.startsWith('http://') || urlOrDomain.startsWith('https://')) {
        const url = new URL(urlOrDomain);
        return url.hostname;
      }
      return urlOrDomain;
    } catch {
      return urlOrDomain;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reset(domain) {
    if (domain) {
      this.limits.delete(domain);
    } else {
      this.limits.clear();
    }
  }

  getStats() {
    const stats = {};
    for (const [domain, limit] of this.limits.entries()) {
      stats[domain] = {
        secondCount: limit.secondCount,
        minuteCount: limit.minuteCount,
        secondsUntilReset: Math.max(0, Math.ceil((limit.secondReset - Date.now()) / 1000)),
        minutesUntilReset: Math.max(0, Math.ceil((limit.minuteReset - Date.now()) / 60000))
      };
    }
    return stats;
  }
}

export class CircuitBreaker {
  constructor(options = {}) {
    const {
      threshold = 5,
      timeout = 60000,
      resetTimeout = 120000
    } = options;

    this.threshold = threshold;
    this.timeout = timeout;
    this.resetTimeout = resetTimeout;
    this.failures = new Map(); // domain -> { count, state, nextAttempt }
  }

  async execute(domain, fn) {
    const breaker = this.getBreaker(domain);
    
    if (breaker.state === 'OPEN') {
      if (Date.now() < breaker.nextAttempt) {
        throw new Error(`Circuit breaker is OPEN for ${domain}`);
      }
      breaker.state = 'HALF_OPEN';
    }

    try {
      const result = await Promise.race([
        fn(),
        this.timeoutPromise()
      ]);
      
      this.onSuccess(domain);
      return result;
    } catch (error) {
      this.onFailure(domain);
      throw error;
    }
  }

  getBreaker(domain) {
    if (!this.failures.has(domain)) {
      this.failures.set(domain, {
        count: 0,
        state: 'CLOSED',
        nextAttempt: Date.now()
      });
    }
    return this.failures.get(domain);
  }

  onSuccess(domain) {
    const breaker = this.getBreaker(domain);
    breaker.count = 0;
    breaker.state = 'CLOSED';
  }

  onFailure(domain) {
    const breaker = this.getBreaker(domain);
    breaker.count++;
    
    if (breaker.count >= this.threshold) {
      breaker.state = 'OPEN';
      breaker.nextAttempt = Date.now() + this.resetTimeout;
    }
  }

  timeoutPromise() {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), this.timeout);
    });
  }

  reset(domain) {
    if (domain) {
      this.failures.delete(domain);
    } else {
      this.failures.clear();
    }
  }

  getStats() {
    const stats = {};
    for (const [domain, breaker] of this.failures.entries()) {
      stats[domain] = {
        failureCount: breaker.count,
        state: breaker.state,
        nextAttemptIn: breaker.state === 'OPEN' 
          ? Math.max(0, Math.ceil((breaker.nextAttempt - Date.now()) / 1000))
          : 0
      };
    }
    return stats;
  }
}

export default RateLimiter;