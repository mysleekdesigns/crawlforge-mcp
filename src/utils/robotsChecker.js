import robotsParser from 'robots-parser';

export class RobotsChecker {
  constructor(userAgent = 'CrawlForge/1.0') {
    this.userAgent = userAgent;
    this.robotsCache = new Map();
  }

  async canFetch(url) {
    try {
      const urlObj = new URL(url);
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
      
      let robots = this.robotsCache.get(robotsUrl);
      
      if (!robots) {
        const robotsTxt = await this.fetchRobotsTxt(robotsUrl);
        robots = robotsParser(robotsUrl, robotsTxt);
        this.robotsCache.set(robotsUrl, robots);
      }
      
      return robots.isAllowed(url, this.userAgent);
    } catch (error) {
      // If we can't fetch robots.txt, assume we can crawl
      console.warn(`Failed to check robots.txt for ${url}:`, error.message);
      return true;
    }
  }

  async fetchRobotsTxt(robotsUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return ''; // Empty robots.txt means everything is allowed
      }
      
      return await response.text();
    } catch (error) {
      return ''; // If we can't fetch, assume no restrictions
    }
  }

  getCrawlDelay(url) {
    try {
      const urlObj = new URL(url);
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
      const robots = this.robotsCache.get(robotsUrl);
      
      if (robots) {
        return robots.getCrawlDelay(this.userAgent) || 0;
      }
      
      return 0;
    } catch {
      return 0;
    }
  }

  getSitemaps(url) {
    try {
      const urlObj = new URL(url);
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
      const robots = this.robotsCache.get(robotsUrl);
      
      if (robots) {
        return robots.getSitemaps() || [];
      }
      
      return [];
    } catch {
      return [];
    }
  }

  clearCache() {
    this.robotsCache.clear();
  }
}

export default RobotsChecker;