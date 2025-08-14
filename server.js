#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { load } from "cheerio";
import { SearchWebTool } from "./src/tools/search/searchWeb.js";
import { CrawlDeepTool } from "./src/tools/crawl/crawlDeep.js";
import { MapSiteTool } from "./src/tools/crawl/mapSite.js";
import { ExtractContentTool } from "./src/tools/extract/extractContent.js";
import { ProcessDocumentTool } from "./src/tools/extract/processDocument.js";
import { SummarizeContentTool } from "./src/tools/extract/summarizeContent.js";
import { AnalyzeContentTool } from "./src/tools/extract/analyzeContent.js";
// Wave 2 Advanced Tools
import { BatchScrapeTool } from "./src/tools/advanced/BatchScrapeTool.js";
import { ScrapeWithActionsTool } from "./src/tools/advanced/ScrapeWithActionsTool.js";
// Deep Research Tool
import { DeepResearchTool } from "./src/tools/research/deepResearch.js";
// Change Tracking Tool
import { TrackChangesTool } from "./src/tools/tracking/trackChanges.js";
import { config, validateConfig, isSearchConfigured, getToolConfig, getActiveSearchProvider } from "./src/constants/config.js";

// Validate configuration
const configErrors = validateConfig();
if (configErrors.length > 0 && config.server.nodeEnv === 'production') {
  console.error('Configuration errors:', configErrors);
  process.exit(1);
}

// Create the server
const server = new McpServer({ name: "mcp_webScraper", version: "3.0.0" });

// Initialize tools
let searchWebTool = null;
if (isSearchConfigured()) {
  searchWebTool = new SearchWebTool(getToolConfig('search_web'));
}
const crawlDeepTool = new CrawlDeepTool(getToolConfig('crawl_deep'));
const mapSiteTool = new MapSiteTool(getToolConfig('map_site'));

// Initialize Phase 3 tools
const extractContentTool = new ExtractContentTool();
const processDocumentTool = new ProcessDocumentTool();
const summarizeContentTool = new SummarizeContentTool();
const analyzeContentTool = new AnalyzeContentTool();

// Initialize Wave 2 Advanced Tools
const batchScrapeTool = new BatchScrapeTool();
const scrapeWithActionsTool = new ScrapeWithActionsTool();

// Initialize Deep Research Tool
const deepResearchTool = new DeepResearchTool();

// Initialize Change Tracking Tool
const trackChangesTool = new TrackChangesTool();

// Zod schemas for tool parameters and responses
const FetchUrlSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().min(1000).max(30000).optional().default(10000)
});

const ExtractTextSchema = z.object({
  url: z.string().url(),
  remove_scripts: z.boolean().optional().default(true),
  remove_styles: z.boolean().optional().default(true)
});

const ExtractLinksSchema = z.object({
  url: z.string().url(),
  filter_external: z.boolean().optional().default(false),
  base_url: z.string().url().optional()
});

const ExtractMetadataSchema = z.object({
  url: z.string().url()
});

const ScrapeStructuredSchema = z.object({
  url: z.string().url(),
  selectors: z.record(z.string())
});

const SearchWebSchema = z.object({
  query: z.string(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
  lang: z.string().optional(),
  safe_search: z.boolean().optional(),
  time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional(),
  site: z.string().optional(),
  file_type: z.string().optional()
});

const CrawlDeepSchema = z.object({
  url: z.string().url(),
  max_depth: z.number().min(1).max(5).optional(),
  max_pages: z.number().min(1).max(1000).optional(),
  include_patterns: z.array(z.string()).optional(),
  exclude_patterns: z.array(z.string()).optional(),
  follow_external: z.boolean().optional(),
  respect_robots: z.boolean().optional(),
  extract_content: z.boolean().optional(),
  concurrency: z.number().min(1).max(20).optional()
});

const MapSiteSchema = z.object({
  url: z.string().url(),
  include_sitemap: z.boolean().optional(),
  max_urls: z.number().min(1).max(10000).optional(),
  group_by_path: z.boolean().optional(),
  include_metadata: z.boolean().optional()
});

const ExtractContentSchema = z.object({
  url: z.string().url(),
  options: z.object({}).optional()
});

const ProcessDocumentSchema = z.object({
  source: z.string(),
  sourceType: z.enum(['url', 'pdf_url', 'file', 'pdf_file']).optional(),
  options: z.object({}).optional()
});

const SummarizeContentSchema = z.object({
  text: z.string(),
  options: z.object({}).optional()
});

const AnalyzeContentSchema = z.object({
  text: z.string(),
  options: z.object({}).optional()
});

// Wave 2 Advanced Tools Schemas
const BatchScrapeSchema = z.object({
  urls: z.array(z.union([
    z.string().url(),
    z.object({
      url: z.string().url(),
      selectors: z.record(z.string()).optional(),
      headers: z.record(z.string()).optional(),
      timeout: z.number().min(1000).max(30000).optional(),
      metadata: z.record(z.any()).optional()
    })
  ])).min(1).max(50),
  
  formats: z.array(z.enum(['markdown', 'html', 'json', 'text'])).default(['json']),
  mode: z.enum(['sync', 'async']).default('sync'),
  
  webhook: z.object({
    url: z.string().url(),
    events: z.array(z.string()).optional().default(['batch_completed', 'batch_failed']),
    headers: z.record(z.string()).optional(),
    signingSecret: z.string().optional()
  }).optional(),
  
  extractionSchema: z.record(z.string()).optional(),
  maxConcurrency: z.number().min(1).max(20).default(10),
  delayBetweenRequests: z.number().min(0).max(10000).default(100),
  includeMetadata: z.boolean().default(true),
  includeFailed: z.boolean().default(true),
  pageSize: z.number().min(1).max(100).default(25),
  
  jobOptions: z.object({
    priority: z.number().default(0),
    ttl: z.number().min(60000).default(24 * 60 * 60 * 1000),
    maxRetries: z.number().min(0).max(5).default(1),
    tags: z.array(z.string()).default([])
  }).optional()
});

const ScrapeWithActionsSchema = z.object({
  url: z.string().url(),
  actions: z.array(z.object({
    type: z.enum(['wait', 'click', 'type', 'press', 'scroll', 'screenshot', 'executeJavaScript']),
    selector: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    script: z.string().optional(),
    timeout: z.number().optional(),
    description: z.string().optional(),
    continueOnError: z.boolean().default(false),
    retries: z.number().min(0).max(5).default(0)
  })).min(1).max(20),
  
  formats: z.array(z.enum(['markdown', 'html', 'json', 'text', 'screenshots'])).default(['json']),
  captureIntermediateStates: z.boolean().default(false),
  captureScreenshots: z.boolean().default(true),
  
  formAutoFill: z.object({
    fields: z.array(z.object({
      selector: z.string(),
      value: z.string(),
      type: z.enum(['text', 'select', 'checkbox', 'radio', 'file']).default('text'),
      waitAfter: z.number().min(0).max(5000).default(100)
    })),
    submitSelector: z.string().optional(),
    waitAfterSubmit: z.number().min(0).max(30000).default(2000)
  }).optional(),
  
  browserOptions: z.object({
    headless: z.boolean().default(true),
    userAgent: z.string().optional(),
    viewportWidth: z.number().min(800).max(1920).default(1280),
    viewportHeight: z.number().min(600).max(1080).default(720),
    timeout: z.number().min(10000).max(120000).default(30000)
  }).optional(),
  
  extractionOptions: z.object({
    selectors: z.record(z.string()).optional(),
    includeMetadata: z.boolean().default(true),
    includeLinks: z.boolean().default(true),
    includeImages: z.boolean().default(true)
  }).optional(),
  
  continueOnActionError: z.boolean().default(false),
  maxRetries: z.number().min(0).max(3).default(1),
  screenshotOnError: z.boolean().default(true)
});

// Deep Research Tool Schema
const DeepResearchSchema = z.object({
  topic: z.string().min(3).max(500),
  maxDepth: z.number().min(1).max(10).optional().default(5),
  maxUrls: z.number().min(1).max(1000).optional().default(50),
  timeLimit: z.number().min(30000).max(300000).optional().default(120000),
  researchApproach: z.enum(['broad', 'focused', 'academic', 'current_events', 'comparative']).optional().default('broad'),
  sourceTypes: z.array(z.enum(['academic', 'news', 'government', 'commercial', 'blog', 'wiki', 'any'])).optional().default(['any']),
  credibilityThreshold: z.number().min(0).max(1).optional().default(0.3),
  includeRecentOnly: z.boolean().optional().default(false),
  enableConflictDetection: z.boolean().optional().default(true),
  enableSourceVerification: z.boolean().optional().default(true),
  enableSynthesis: z.boolean().optional().default(true),
  outputFormat: z.enum(['comprehensive', 'summary', 'citations_only', 'conflicts_focus']).optional().default('comprehensive'),
  includeRawData: z.boolean().optional().default(false),
  includeActivityLog: z.boolean().optional().default(false),
  queryExpansion: z.object({
    enableSynonyms: z.boolean().optional().default(true),
    enableSpellCheck: z.boolean().optional().default(true),
    enableContextual: z.boolean().optional().default(true),
    maxVariations: z.number().min(1).max(20).optional().default(8)
  }).optional(),
  concurrency: z.number().min(1).max(20).optional().default(5),
  cacheResults: z.boolean().optional().default(true),
  webhook: z.object({
    url: z.string().url(),
    events: z.array(z.enum(['started', 'progress', 'completed', 'failed'])).optional().default(['completed']),
    headers: z.record(z.string()).optional()
  }).optional()
});

// Change Tracking Tool Schema
const TrackChangesSchema = z.object({
  url: z.string().url(),
  operation: z.enum(['create_baseline', 'compare', 'monitor', 'get_history', 'get_stats']).default('compare'),
  content: z.string().optional(),
  html: z.string().optional(),
  trackingOptions: z.object({
    granularity: z.enum(['page', 'section', 'element', 'text']).default('section'),
    trackText: z.boolean().default(true),
    trackStructure: z.boolean().default(true),
    trackAttributes: z.boolean().default(false),
    trackImages: z.boolean().default(false),
    trackLinks: z.boolean().default(true),
    ignoreWhitespace: z.boolean().default(true),
    ignoreCase: z.boolean().default(false),
    customSelectors: z.array(z.string()).optional(),
    excludeSelectors: z.array(z.string()).optional(),
    significanceThresholds: z.object({
      minor: z.number().min(0).max(1).default(0.1),
      moderate: z.number().min(0).max(1).default(0.3),
      major: z.number().min(0).max(1).default(0.7)
    }).optional()
  }).optional(),
  monitoringOptions: z.object({
    enabled: z.boolean().default(false),
    interval: z.number().min(60000).max(24 * 60 * 60 * 1000).default(300000),
    maxRetries: z.number().min(0).max(5).default(3),
    retryDelay: z.number().min(1000).max(60000).default(5000),
    notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).default('moderate'),
    enableWebhook: z.boolean().default(false),
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().optional()
  }).optional(),
  storageOptions: z.object({
    enableSnapshots: z.boolean().default(true),
    retainHistory: z.boolean().default(true),
    maxHistoryEntries: z.number().min(1).max(1000).default(100),
    compressionEnabled: z.boolean().default(true),
    deltaStorageEnabled: z.boolean().default(true)
  }).optional(),
  queryOptions: z.object({
    limit: z.number().min(1).max(500).default(50),
    offset: z.number().min(0).default(0),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    includeContent: z.boolean().default(false),
    significanceFilter: z.enum(['all', 'minor', 'moderate', 'major', 'critical']).optional()
  }).optional(),
  notificationOptions: z.object({
    webhook: z.object({
      enabled: z.boolean().default(false),
      url: z.string().url().optional(),
      method: z.enum(['POST', 'PUT']).default('POST'),
      headers: z.record(z.string()).optional(),
      signingSecret: z.string().optional(),
      includeContent: z.boolean().default(false)
    }).optional(),
    slack: z.object({
      enabled: z.boolean().default(false),
      webhookUrl: z.string().url().optional(),
      channel: z.string().optional(),
      username: z.string().optional()
    }).optional()
  }).optional()
});


// Utility function to fetch URL with error handling
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, headers = {} } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MCP-WebScraper/1.0.0',
        ...headers
      }
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

// Tool: fetch_url - Basic URL fetching with headers and response handling
server.registerTool("fetch_url", {
  description: "Fetch content from a URL with optional headers and timeout",
  inputSchema: {
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().min(1000).max(30000).optional().default(10000)
  }
}, async ({ url, headers, timeout }) => {
  try {
    const response = await fetchWithTimeout(url, {
      timeout: timeout || 10000,
      headers: headers || {}
    });
    
    const body = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: body,
          contentType: response.headers.get('content-type') || 'unknown',
          size: body.length,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to fetch URL: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: extract_text - Extract clean text content from HTML
server.registerTool("extract_text", {
  description: "Extract clean text content from a webpage",
  inputSchema: {
    url: z.string().url(),
    remove_scripts: z.boolean().optional().default(true),
    remove_styles: z.boolean().optional().default(true)
  }
}, async ({ url, remove_scripts, remove_styles }) => {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    // Remove unwanted elements
    if (remove_scripts !== false) {
      $('script').remove();
    }
    if (remove_styles !== false) {
      $('style').remove();
    }
    
    // Remove common non-content elements
    $('nav, header, footer, aside, .advertisement, .ad, .sidebar').remove();
    
    // Extract text content
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          text: text,
          word_count: text.split(/\s+/).filter(word => word.length > 0).length,
          char_count: text.length,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to extract text: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: extract_links - Extract all links from a webpage with optional filtering
server.registerTool("extract_links", {
  description: "Extract all links from a webpage with optional filtering",
  inputSchema: {
    url: z.string().url(),
    filter_external: z.boolean().optional().default(false),
    base_url: z.string().url().optional()
  }
}, async ({ url, filter_external, base_url }) => {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    const baseUrl = base_url || new URL(url).origin;
    const pageUrl = new URL(url);
    const links = [];
    
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (!href) return;
      
      let absoluteUrl;
      let isExternal = false;
      
      try {
        if (href.startsWith('http://') || href.startsWith('https://')) {
          absoluteUrl = href;
          isExternal = new URL(href).origin !== pageUrl.origin;
        } else {
          absoluteUrl = new URL(href, baseUrl).toString();
          isExternal = false;
        }
        
        // Apply filtering
        if (filter_external && isExternal) {
          return;
        }
        
        links.push({
          href: absoluteUrl,
          text: text,
          is_external: isExternal,
          original_href: href
        });
      } catch (urlError) {
        // Skip invalid URLs
      }
    });
    
    // Remove duplicates
    const uniqueLinks = links.filter((link, index, arr) => 
      arr.findIndex(l => l.href === link.href) === index
    );
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          links: uniqueLinks,
          total_count: uniqueLinks.length,
          internal_count: uniqueLinks.filter(l => !l.is_external).length,
          external_count: uniqueLinks.filter(l => l.is_external).length,
          base_url: baseUrl
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to extract links: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: extract_metadata - Extract page metadata
server.registerTool("extract_metadata", {
  description: "Extract metadata from a webpage (title, description, keywords, etc.)",
  inputSchema: {
    url: z.string().url()
  }
}, async ({ url }) => {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    // Extract basic metadata
    const title = $('title').text().trim() || $('h1').first().text().trim();
    const description = $('meta[name="description"]').attr('content') || 
                      $('meta[property="og:description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    const canonical = $('link[rel="canonical"]').attr('href') || '';
    
    // Extract Open Graph tags
    const ogTags = {};
    $('meta[property^="og:"]').each((_, element) => {
      const property = $(element).attr('property');
      const content = $(element).attr('content');
      if (property && content) {
        ogTags[property.replace('og:', '')] = content;
      }
    });
    
    // Extract Twitter Card tags
    const twitterTags = {};
    $('meta[name^="twitter:"]').each((_, element) => {
      const name = $(element).attr('name');
      const content = $(element).attr('content');
      if (name && content) {
        twitterTags[name.replace('twitter:', '')] = content;
      }
    });
    
    // Extract additional metadata
    const author = $('meta[name="author"]').attr('content') || '';
    const robots = $('meta[name="robots"]').attr('content') || '';
    const viewport = $('meta[name="viewport"]').attr('content') || '';
    const charset = $('meta[charset]').attr('charset') || 
                   $('meta[http-equiv="Content-Type"]').attr('content') || '';
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          title: title,
          description: description,
          keywords: keywords.split(',').map(k => k.trim()).filter(k => k),
          canonical_url: canonical,
          author: author,
          robots: robots,
          viewport: viewport,
          charset: charset,
          og_tags: ogTags,
          twitter_tags: twitterTags,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to extract metadata: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: scrape_structured - Extract structured data using CSS selectors
server.registerTool("scrape_structured", {
  description: "Extract structured data from a webpage using CSS selectors",
  inputSchema: {
    url: z.string().url(),
    selectors: z.record(z.string())
  }
}, async ({ url, selectors }) => {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    const results = {};
    
    for (const [fieldName, selector] of Object.entries(selectors)) {
      try {
        const elements = $(selector);
        
        if (elements.length === 0) {
          results[fieldName] = null;
        } else if (elements.length === 1) {
          // Single element - return text content
          results[fieldName] = elements.text().trim();
        } else {
          // Multiple elements - return array of text content
          results[fieldName] = elements.map((_, el) => $(el).text().trim()).get();
        }
      } catch (selectorError) {
        results[fieldName] = {
          error: `Invalid selector: ${selector}`,
          message: selectorError.message
        };
      }
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          data: results,
          selectors_used: selectors,
          elements_found: Object.keys(results).length,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to scrape structured data: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: search_web - Web search with configurable providers
if (searchWebTool) {
  const activeProvider = getActiveSearchProvider();
  const providerName = activeProvider === 'google' ? 'Google Custom Search API' : 
                      activeProvider === 'duckduckgo' ? 'DuckDuckGo' : 'Auto-selected provider';
  
  server.registerTool("search_web", {
    description: `Search the web using ${providerName}`,
    inputSchema: {
      query: z.string(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
      lang: z.string().optional(),
      safe_search: z.boolean().optional(),
      time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional(),
      site: z.string().optional(),
      file_type: z.string().optional()
    }
  }, async ({ query, limit, offset, lang, safe_search, time_range, site, file_type }) => {
    try {
      if (!query) {
        return {
          content: [{
            type: "text",
            text: "Query parameter is required"
          }],
          isError: true
        };
      }
      
      const result = await searchWebTool.execute({ query, limit, offset, lang, safe_search, time_range, site, file_type });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Search failed: ${error.message}`
        }],
        isError: true
      };
    }
  });
} else {
  const activeProvider = getActiveSearchProvider();
  if (activeProvider === 'google') {
    console.error("Warning: search_web tool not configured. Set GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID to enable Google search.");
  } else {
    console.error("Warning: search_web tool initialization failed. Check your SEARCH_PROVIDER configuration.");
  }
}

// Tool: crawl_deep - Deep crawl websites with BFS algorithm
server.registerTool("crawl_deep", {
  description: "Crawl websites deeply using breadth-first search",
  inputSchema: {
    url: z.string().url(),
    max_depth: z.number().min(1).max(5).optional(),
    max_pages: z.number().min(1).max(1000).optional(),
    include_patterns: z.array(z.string()).optional(),
    exclude_patterns: z.array(z.string()).optional(),
    follow_external: z.boolean().optional(),
    respect_robots: z.boolean().optional(),
    extract_content: z.boolean().optional(),
    concurrency: z.number().min(1).max(20).optional()
  }
}, async ({ url, max_depth, max_pages, include_patterns, exclude_patterns, follow_external, respect_robots, extract_content, concurrency }) => {
  try {
    if (!url) {
      return {
        content: [{
          type: "text",
          text: "URL parameter is required"
        }],
        isError: true
      };
    }
    
    const result = await crawlDeepTool.execute({ url, max_depth, max_pages, include_patterns, exclude_patterns, follow_external, respect_robots, extract_content, concurrency });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Crawl failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: map_site - Discover and map website structure
server.registerTool("map_site", {
  description: "Discover and map website structure",
  inputSchema: {
    url: z.string().url(),
    include_sitemap: z.boolean().optional(),
    max_urls: z.number().min(1).max(10000).optional(),
    group_by_path: z.boolean().optional(),
    include_metadata: z.boolean().optional()
  }
}, async ({ url, include_sitemap, max_urls, group_by_path, include_metadata }) => {
  try {
    if (!url) {
      return {
        content: [{
          type: "text",
          text: "URL parameter is required"
        }],
        isError: true
      };
    }
    
    const result = await mapSiteTool.execute({ url, include_sitemap, max_urls, group_by_path, include_metadata });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Site mapping failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Phase 3 Tools: Enhanced Content Processing

// Tool: extract_content - Enhanced content extraction with readability detection
server.registerTool("extract_content", {
  description: "Extract and analyze main content from web pages with enhanced readability detection",
  inputSchema: {
    url: z.string().url(),
    options: z.object({}).optional()
  }
}, async ({ url, options }) => {
  try {
    if (!url) {
      return {
        content: [{
          type: "text",
          text: "URL parameter is required"
        }],
        isError: true
      };
    }
    
    const result = await extractContentTool.execute({ url, options });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Content extraction failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: process_document - Multi-format document processing
server.registerTool("process_document", {
  description: "Process documents from multiple sources and formats including PDFs and web pages",
  inputSchema: {
    source: z.string(),
    sourceType: z.enum(['url', 'pdf_url', 'file', 'pdf_file']).optional(),
    options: z.object({}).optional()
  }
}, async ({ source, sourceType, options }) => {
  try {
    if (!source) {
      return {
        content: [{
          type: "text",
          text: "Source parameter is required"
        }],
        isError: true
      };
    }
    
    const result = await processDocumentTool.execute({ source, sourceType, options });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Document processing failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: summarize_content - Intelligent content summarization
server.registerTool("summarize_content", {
  description: "Generate intelligent summaries of text content with configurable options",
  inputSchema: {
    text: z.string(),
    options: z.object({}).optional()
  }
}, async ({ text, options }) => {
  try {
    if (!text) {
      return {
        content: [{
          type: "text",
          text: "Text parameter is required"
        }],
        isError: true
      };
    }
    
    const result = await summarizeContentTool.execute({ text, options });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Content summarization failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: analyze_content - Comprehensive content analysis
server.registerTool("analyze_content", {
  description: "Perform comprehensive content analysis including language detection and topic extraction",
  inputSchema: {
    text: z.string(),
    options: z.object({}).optional()
  }
}, async ({ text, options }) => {
  try {
    if (!text) {
      return {
        content: [{
          type: "text",
          text: "Text parameter is required"
        }],
        isError: true
      };
    }
    
    const result = await analyzeContentTool.execute({ text, options });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Content analysis failed: ${error.message}`
      }],
      isError: true
    };
  }
});


// Wave 2 Advanced Tools

// Tool: batch_scrape - Process multiple URLs simultaneously with job management
server.registerTool("batch_scrape", {
  description: "Process multiple URLs simultaneously with support for async job management and webhook notifications",
  inputSchema: {
    urls: z.array(z.union([
      z.string().url(),
      z.object({
        url: z.string().url(),
        selectors: z.record(z.string()).optional(),
        headers: z.record(z.string()).optional(),
        timeout: z.number().min(1000).max(30000).optional(),
        metadata: z.record(z.any()).optional()
      })
    ])).min(1).max(50),
    formats: z.array(z.enum(['markdown', 'html', 'json', 'text'])).default(['json']),
    mode: z.enum(['sync', 'async']).default('sync'),
    webhook: z.object({
      url: z.string().url(),
      events: z.array(z.string()).optional().default(['batch_completed', 'batch_failed']),
      headers: z.record(z.string()).optional(),
      signingSecret: z.string().optional()
    }).optional(),
    extractionSchema: z.record(z.string()).optional(),
    maxConcurrency: z.number().min(1).max(20).default(10),
    delayBetweenRequests: z.number().min(0).max(10000).default(100),
    includeMetadata: z.boolean().default(true),
    includeFailed: z.boolean().default(true),
    pageSize: z.number().min(1).max(100).default(25),
    jobOptions: z.object({
      priority: z.number().default(0),
      ttl: z.number().min(60000).default(24 * 60 * 60 * 1000),
      maxRetries: z.number().min(0).max(5).default(1),
      tags: z.array(z.string()).default([])
    }).optional()
  }
}, async (params) => {
  try {
    const result = await batchScrapeTool.execute(params);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Batch scrape failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: scrape_with_actions - Execute action chains before scraping
server.registerTool("scrape_with_actions", {
  description: "Execute browser action chains before scraping content, with form auto-fill and intermediate state capture",
  inputSchema: {
    url: z.string().url(),
    actions: z.array(z.object({
      type: z.enum(['wait', 'click', 'type', 'press', 'scroll', 'screenshot', 'executeJavaScript']),
      selector: z.string().optional(),
      text: z.string().optional(),
      key: z.string().optional(),
      script: z.string().optional(),
      timeout: z.number().optional(),
      description: z.string().optional(),
      continueOnError: z.boolean().default(false),
      retries: z.number().min(0).max(5).default(0)
    })).min(1).max(20),
    formats: z.array(z.enum(['markdown', 'html', 'json', 'text', 'screenshots'])).default(['json']),
    captureIntermediateStates: z.boolean().default(false),
    captureScreenshots: z.boolean().default(true),
    formAutoFill: z.object({
      fields: z.array(z.object({
        selector: z.string(),
        value: z.string(),
        type: z.enum(['text', 'select', 'checkbox', 'radio', 'file']).default('text'),
        waitAfter: z.number().min(0).max(5000).default(100)
      })),
      submitSelector: z.string().optional(),
      waitAfterSubmit: z.number().min(0).max(30000).default(2000)
    }).optional(),
    browserOptions: z.object({
      headless: z.boolean().default(true),
      userAgent: z.string().optional(),
      viewportWidth: z.number().min(800).max(1920).default(1280),
      viewportHeight: z.number().min(600).max(1080).default(720),
      timeout: z.number().min(10000).max(120000).default(30000)
    }).optional(),
    extractionOptions: z.object({
      selectors: z.record(z.string()).optional(),
      includeMetadata: z.boolean().default(true),
      includeLinks: z.boolean().default(true),
      includeImages: z.boolean().default(true)
    }).optional(),
    continueOnActionError: z.boolean().default(false),
    maxRetries: z.number().min(0).max(3).default(1),
    screenshotOnError: z.boolean().default(true)
  }
}, async (params) => {
  try {
    const result = await scrapeWithActionsTool.execute(params);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Scrape with actions failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: deep_research - Comprehensive multi-stage research with source verification
server.registerTool("deep_research", {
  description: "Conduct comprehensive multi-stage research with intelligent query expansion, source verification, and conflict detection",
  inputSchema: {
    topic: z.string().min(3).max(500),
    maxDepth: z.number().min(1).max(10).optional().default(5),
    maxUrls: z.number().min(1).max(1000).optional().default(50),
    timeLimit: z.number().min(30000).max(300000).optional().default(120000),
    researchApproach: z.enum(['broad', 'focused', 'academic', 'current_events', 'comparative']).optional().default('broad'),
    sourceTypes: z.array(z.enum(['academic', 'news', 'government', 'commercial', 'blog', 'wiki', 'any'])).optional().default(['any']),
    credibilityThreshold: z.number().min(0).max(1).optional().default(0.3),
    includeRecentOnly: z.boolean().optional().default(false),
    enableConflictDetection: z.boolean().optional().default(true),
    enableSourceVerification: z.boolean().optional().default(true),
    enableSynthesis: z.boolean().optional().default(true),
    outputFormat: z.enum(['comprehensive', 'summary', 'citations_only', 'conflicts_focus']).optional().default('comprehensive'),
    includeRawData: z.boolean().optional().default(false),
    includeActivityLog: z.boolean().optional().default(false),
    queryExpansion: z.object({
      enableSynonyms: z.boolean().optional().default(true),
      enableSpellCheck: z.boolean().optional().default(true),
      enableContextual: z.boolean().optional().default(true),
      maxVariations: z.number().min(1).max(20).optional().default(8)
    }).optional(),
    concurrency: z.number().min(1).max(20).optional().default(5),
    cacheResults: z.boolean().optional().default(true),
    webhook: z.object({
      url: z.string().url(),
      events: z.array(z.enum(['started', 'progress', 'completed', 'failed'])).optional().default(['completed']),
      headers: z.record(z.string()).optional()
    }).optional()
  }
}, async (params) => {
  try {
    const result = await deepResearchTool.execute(params);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Deep research failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: track_changes - Content change tracking with baseline capture and monitoring
server.registerTool("track_changes", {
  description: "Track content changes with baseline capture, comparison, scheduled monitoring, and change notification system",
  inputSchema: {
    url: z.string().url(),
    operation: z.enum(['create_baseline', 'compare', 'monitor', 'get_history', 'get_stats']).default('compare'),
    content: z.string().optional(),
    html: z.string().optional(),
    trackingOptions: z.object({
      granularity: z.enum(['page', 'section', 'element', 'text']).default('section'),
      trackText: z.boolean().default(true),
      trackStructure: z.boolean().default(true),
      trackAttributes: z.boolean().default(false),
      trackImages: z.boolean().default(false),
      trackLinks: z.boolean().default(true),
      ignoreWhitespace: z.boolean().default(true),
      ignoreCase: z.boolean().default(false),
      customSelectors: z.array(z.string()).optional(),
      excludeSelectors: z.array(z.string()).optional(),
      significanceThresholds: z.object({
        minor: z.number().min(0).max(1).default(0.1),
        moderate: z.number().min(0).max(1).default(0.3),
        major: z.number().min(0).max(1).default(0.7)
      }).optional()
    }).optional(),
    monitoringOptions: z.object({
      enabled: z.boolean().default(false),
      interval: z.number().min(60000).max(24 * 60 * 60 * 1000).default(300000),
      maxRetries: z.number().min(0).max(5).default(3),
      retryDelay: z.number().min(1000).max(60000).default(5000),
      notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).default('moderate'),
      enableWebhook: z.boolean().default(false),
      webhookUrl: z.string().url().optional(),
      webhookSecret: z.string().optional()
    }).optional(),
    storageOptions: z.object({
      enableSnapshots: z.boolean().default(true),
      retainHistory: z.boolean().default(true),
      maxHistoryEntries: z.number().min(1).max(1000).default(100),
      compressionEnabled: z.boolean().default(true),
      deltaStorageEnabled: z.boolean().default(true)
    }).optional(),
    queryOptions: z.object({
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      includeContent: z.boolean().default(false),
      significanceFilter: z.enum(['all', 'minor', 'moderate', 'major', 'critical']).optional()
    }).optional(),
    notificationOptions: z.object({
      webhook: z.object({
        enabled: z.boolean().default(false),
        url: z.string().url().optional(),
        method: z.enum(['POST', 'PUT']).default('POST'),
        headers: z.record(z.string()).optional(),
        signingSecret: z.string().optional(),
        includeContent: z.boolean().default(false)
      }).optional(),
      slack: z.object({
        enabled: z.boolean().default(false),
        webhookUrl: z.string().url().optional(),
        channel: z.string().optional(),
        username: z.string().optional()
      }).optional()
    }).optional()
  }
}, async (params) => {
  try {
    const result = await trackChangesTool.execute(params);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Change tracking failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Set up the stdio transport and start the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP WebScraper server v3.0 running on stdio");
  console.error(`Environment: ${config.server.nodeEnv}`);
  
  if (isSearchConfigured()) {
    const activeProvider = getActiveSearchProvider();
    console.error(`Search enabled: ${isSearchConfigured()} (provider: ${activeProvider})`);
  } else {
    console.error(`Search enabled: ${isSearchConfigured()}`);
  }
  
  const baseTools = 'fetch_url, extract_text, extract_links, extract_metadata, scrape_structured, crawl_deep, map_site';
  const searchTool = isSearchConfigured() ? ', search_web' : '';
  const phase3Tools = ', extract_content, process_document, summarize_content, analyze_content';
  const wave2Tools = ', batch_scrape, scrape_with_actions';
  const researchTools = ', deep_research';
  const trackingTools = ', track_changes';
  console.error(`Tools available: ${baseTools}${searchTool}${phase3Tools}${wave2Tools}${researchTools}${trackingTools}`);
}

runServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});