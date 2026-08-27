import robotsParser from 'robots-parser';
import { safeFetch } from './ssrfGuard.js';
import { identityHeaders, CRAWLFORGE_USER_AGENT } from './fetchIdentity.js';

/** How long a parsed robots.txt stays good for. */
const DEFAULT_TTL_MS = parseInt(process.env.ROBOTS_CACHE_TTL_MS || '3600000', 10); // 1h

export class RobotsChecker {
  /**
   * @param {string} [userAgent] identity the robots rules are evaluated against
   * @param {{ ttlMs?: number }} [options]
   */
  constructor(userAgent = CRAWLFORGE_USER_AGENT, options = {}) {
    this.userAgent = userAgent;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    /** @type {Map<string, { robots: unknown, fetchedAt: number }>} */
    this.robotsCache = new Map();
    /** In-flight fetches, so N concurrent requests to one host fetch robots once. */
    this.inflight = new Map();
    /** Diagnostic: how many robots.txt requests this checker has actually made. */
    this.fetchCount = 0;
  }

  static robotsUrlFor(url) {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}/robots.txt`;
  }

  /**
   * Parsed robots.txt for a URL's host, served from cache while it is fresh.
   * Concurrent callers share one in-flight fetch rather than each starting one.
   */
  async getRobots(url) {
    const robotsUrl = RobotsChecker.robotsUrlFor(url);

    const cached = this.robotsCache.get(robotsUrl);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) return cached.robots;

    const pending = this.inflight.get(robotsUrl);
    if (pending) return pending;

    const promise = (async () => {
      const robotsTxt = await this.fetchRobotsTxt(robotsUrl);
      const robots = robotsParser(robotsUrl, robotsTxt);
      this.robotsCache.set(robotsUrl, { robots, fetchedAt: Date.now() });
      return robots;
    })().finally(() => this.inflight.delete(robotsUrl));

    this.inflight.set(robotsUrl, promise);
    return promise;
  }

  async canFetch(url) {
    try {
      const robots = await this.getRobots(url);
      // robots-parser returns undefined when it has no opinion — that is "allowed".
      return robots.isAllowed(url, this.userAgent) !== false;
    } catch (error) {
      // A robots.txt we cannot read is not a disallow. Standard practice, and
      // the alternative (fail closed on a network blip) blocks legitimate work.
      console.warn(`Failed to check robots.txt for ${url}:`, error.message);
      return true;
    }
  }

  async fetchRobotsTxt(robotsUrl) {
    this.fetchCount++;
    const controller = new AbortController();
    // The timeout must stay armed for the body read, not just until headers
    // arrive: a host that sends headers then trickles robots.txt forever would
    // otherwise pin every tool behind the gate. Now that the gate runs before
    // every fetching tool rather than only crawl_deep, one slow host would
    // hang all of them. clearTimeout moves to the finally accordingly.
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await safeFetch(robotsUrl, {
        signal: controller.signal,
        headers: identityHeaders({ userAgent: this.userAgent })
      });

      if (!response.ok) {
        return ''; // Empty robots.txt means everything is allowed
      }

      return await response.text();
    } catch (error) {
      return ''; // If we can't fetch, assume no restrictions
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Crawl-delay in seconds from an already-cached robots.txt (0 if unknown). */
  getCrawlDelay(url) {
    try {
      const cached = this.robotsCache.get(RobotsChecker.robotsUrlFor(url));
      return cached ? cached.robots.getCrawlDelay(this.userAgent) || 0 : 0;
    } catch {
      return 0;
    }
  }

  /** Crawl-delay in seconds, fetching robots.txt if it is not cached yet. */
  async fetchCrawlDelay(url) {
    try {
      const robots = await this.getRobots(url);
      return robots.getCrawlDelay(this.userAgent) || 0;
    } catch {
      return 0;
    }
  }

  getSitemaps(url) {
    try {
      const cached = this.robotsCache.get(RobotsChecker.robotsUrlFor(url));
      return cached ? cached.robots.getSitemaps() || [] : [];
    } catch {
      return [];
    }
  }

  clearCache() {
    this.robotsCache.clear();
    this.inflight.clear();
  }
}
