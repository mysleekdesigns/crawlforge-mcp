/**
 * Domain Filter Usage Examples
 * 
 * This file demonstrates how to use the advanced domain filtering
 * capabilities in the MCP WebScraper project.
 */

import { DomainFilter } from '../src/utils/domainFilter.js';
import { BFSCrawler } from '../src/core/crawlers/BFSCrawler.js';
import { CrawlDeepTool } from '../src/tools/crawl/crawlDeep.js';

// Example 1: Basic Domain Filter Setup
console.log('=== Example 1: Basic Domain Filter Setup ===');

const filter = new DomainFilter({
  allowSubdomains: true,
  defaultMaxDepth: 3,
  defaultRateLimit: 10
});

// Whitelist specific domains
filter.addWhitelistDomain('example.com', { 
  includeSubdomains: true,
  maxDepth: 5,
  rateLimit: 20 
});

filter.addWhitelistDomain('trusted-site.org', {
  includeSubdomains: false,
  customHeaders: { 'X-API-Key': 'secret123' }
});

// Blacklist problematic domains
filter.addBlacklistDomain('malicious.com', {
  includeSubdomains: true,
  reason: 'Known malware distributor'
});

// Add pattern-based filtering
filter.addPattern('\\.pdf$', 'exclude', { description: 'Skip PDF files' });
filter.addPattern('/api/', 'include', { description: 'Include API endpoints' });

console.log('Filter configured with whitelist, blacklist, and patterns');

// Example 2: Using Domain Filter with BFSCrawler
console.log('\n=== Example 2: BFSCrawler Integration ===');

const crawler = new BFSCrawler({
  maxDepth: 3,
  maxPages: 100,
  domainFilter: filter
});

// Or configure inline
crawler.configureDomainFilter({
  whitelist: ['news.example.com'],
  blacklist: ['ads.badsite.com'],
  domainRules: {
    'api.example.com': {
      rateLimit: 30,
      respectRobots: false,
      maxDepth: 2
    }
  }
});

console.log('Crawler configured with domain filter');

// Example 3: Using with CrawlDeep Tool
console.log('\n=== Example 3: CrawlDeep Tool Usage ===');

const crawlTool = new CrawlDeepTool();

const crawlParams = {
  url: 'https://example.com',
  max_depth: 2,
  max_pages: 50,
  domain_filter: {
    whitelist: ['example.com', 'subdomain.example.com'],
    blacklist: ['spam.example.com'],
    domain_rules: {
      'api.example.com': {
        rateLimit: 15,
        maxDepth: 3,
        customHeaders: {
          'Authorization': 'Bearer token123'
        }
      }
    }
  }
};

console.log('CrawlDeep tool parameters configured');

// Example 4: Export/Import Configuration
console.log('\n=== Example 4: Export/Import Configuration ===');

// Export current configuration
const exportedConfig = filter.exportConfig();
console.log('Configuration exported:', Object.keys(exportedConfig));

// Create new filter and import
const newFilter = new DomainFilter();
newFilter.importConfig(exportedConfig);
console.log('Configuration imported to new filter');

// Example 5: Advanced Domain Rules
console.log('\n=== Example 5: Advanced Domain Rules ===');

filter.setDomainRules('high-volume.example.com', {
  maxDepth: 1,
  rateLimit: 5,
  respectRobots: true,
  allowedPaths: ['/public/', '/api/'],
  blockedPaths: ['/admin/', '/private/'],
  timeout: 10000,
  maxPages: 20,
  concurrency: 3
});

const domainRules = filter.getDomainRules('high-volume.example.com');
console.log('Domain-specific rules configured:', Object.keys(domainRules));

// Example 6: Real-time Filtering Decisions
console.log('\n=== Example 6: Real-time Filtering ===');

const testUrls = [
  'https://example.com/page1',
  'https://api.example.com/users',
  'https://malicious.com/bad-page',
  'https://example.com/document.pdf',
  'https://subdomain.example.com/content'
];

testUrls.forEach(url => {
  const decision = filter.isAllowed(url);
  console.log(`${url}: ${decision.allowed ? 'ALLOWED' : 'BLOCKED'} (${decision.reason})`);
});

// Example 7: Performance Monitoring
console.log('\n=== Example 7: Performance Statistics ===');

const stats = filter.getStats();
console.log('Filter Statistics:');
console.log(`- Whitelist domains: ${stats.whitelist.domains}`);
console.log(`- Blacklist domains: ${stats.blacklist.domains}`);
console.log(`- Include patterns: ${stats.patterns.include}`);
console.log(`- Exclude patterns: ${stats.patterns.exclude}`);
console.log(`- Cache hit rate: ${(stats.cache.hitRate * 100).toFixed(1)}%`);

console.log('\n✅ All examples completed!');

export {
  filter,
  crawler,
  crawlTool,
  exportedConfig
};