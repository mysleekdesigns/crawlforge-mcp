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
// Change Tracking Tool - commented out due to import issue
// import { TrackChangesTool } from "./src/tools/tracking/trackChanges.js";
// LLMs.txt Generator Tool (Phase 2.5)
import { GenerateLLMsTxtTool } from "./src/tools/llmstxt/generateLLMsTxt.js";
// Wave 3-4 Core Managers
import { StealthBrowserManager } from "./src/core/StealthBrowserManager.js";
import { LocalizationManager } from "./src/core/LocalizationManager.js";
import { memoryMonitor } from "./src/utils/MemoryMonitor.js";
import { config, validateConfig, isSearchConfigured, getToolConfig, getActiveSearchProvider } from "./src/constants/config.js";
// Authentication Manager
import AuthManager from "./src/core/AuthManager.js";

// Initialize Authentication Manager
await AuthManager.initialize();

// Check if first time setup is needed (skip in creator mode)
if (!AuthManager.isAuthenticated() && !AuthManager.isCreatorMode()) {
  const apiKey = process.env.CRAWLFORGE_API_KEY;
  if (apiKey) {
    // Auto-setup if API key is provided via environment
    console.log('🔧 Auto-configuring CrawlForge with provided API key...');
    const success = await AuthManager.runSetup(apiKey);
    if (!success) {
      console.error('❌ Failed to authenticate with provided API key');
      console.error('Please check your API key or run: npm run setup');
      process.exit(1);
    }
  } else {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║        CrawlForge MCP Server - Setup Required         ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Welcome! This appears to be your first time using CrawlForge.');
    console.log('');
    console.log('To get started, please run:');
    console.log('  npm run setup');
    console.log('');
    console.log('Or set your API key via environment variable:');
    console.log('  export CRAWLFORGE_API_KEY="your_api_key_here"');
    console.log('');
    console.log('Get your free API key at: https://crawlforge.com/signup');
    console.log('(Includes 1,000 free credits!)');
    console.log('');
    process.exit(0);
  }
}

// Validate configuration
const configErrors = validateConfig();
if (configErrors.length > 0 && config.server.nodeEnv === 'production') {
  console.error('Configuration errors:', configErrors);
  process.exit(1);
}

// Create the server
const server = new McpServer({ name: "crawlforge", version: "3.0.0" });

// Helper function to wrap tool handlers with authentication and credit tracking
function withAuth(toolName, handler) {
  return async (params) => {
    const startTime = Date.now();
    
    try {
      // Skip credit checks in creator mode
      if (!AuthManager.isCreatorMode()) {
        // Check credits before executing
        const creditCost = AuthManager.getToolCost(toolName);
        const hasCredits = await AuthManager.checkCredits(creditCost);
        
        if (!hasCredits) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Insufficient credits",
                message: `This operation requires ${creditCost} credits. Please upgrade your plan at https://crawlforge.com/pricing`,
                creditsRequired: creditCost
              }, null, 2)
            }]
          };
        }
      }
      
      // Execute the tool
      const result = await handler(params);
      
      // Report usage for successful execution (skip in creator mode)
      const processingTime = Date.now() - startTime;
      if (!AuthManager.isCreatorMode()) {
        const creditCost = AuthManager.getToolCost(toolName);
        await AuthManager.reportUsage(
          toolName,
          creditCost,
          params,
          200,
          processingTime
        );
      }
      
      return result;
    } catch (error) {
      // Report usage even for errors (reduced credit cost) - skip in creator mode
      const processingTime = Date.now() - startTime;
      if (!AuthManager.isCreatorMode()) {
        await AuthManager.reportUsage(
          toolName,
          Math.max(1, Math.floor(AuthManager.getToolCost(toolName) * 0.5)), // Half credits for errors
          params,
          500,
          processingTime
        );
      }
      
      throw error;
    }
  };
}

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

// Initialize Change Tracking Tool - temporarily disabled due to import issue
// const trackChangesTool = new TrackChangesTool();

// Initialize LLMs.txt Generator Tool (Phase 2.5)
const generateLLMsTxtTool = new GenerateLLMsTxtTool();

// Initialize Wave 3-4 Core Managers
const stealthBrowserManager = new StealthBrowserManager();
const localizationManager = new LocalizationManager();

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
  llmConfig: z.object({
    provider: z.enum(['auto', 'openai', 'anthropic']).optional().default('auto'),
    openai: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional().default('gpt-3.5-turbo'),
      embeddingModel: z.string().optional().default('text-embedding-ada-002')
    }).optional(),
    anthropic: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional().default('claude-3-haiku-20240307')
    }).optional(),
    enableSemanticAnalysis: z.boolean().optional().default(true),
    enableIntelligentSynthesis: z.boolean().optional().default(true)
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

// LLMs.txt Generator Tool Schema (Phase 2.5)
const GenerateLLMsTxtSchema = z.object({
  url: z.string().url(),
  analysisOptions: z.object({
    maxDepth: z.number().min(1).max(5).optional().default(3),
    maxPages: z.number().min(10).max(500).optional().default(100),
    detectAPIs: z.boolean().optional().default(true),
    analyzeContent: z.boolean().optional().default(true),
    checkSecurity: z.boolean().optional().default(true),
    respectRobots: z.boolean().optional().default(true)
  }).optional(),
  outputOptions: z.object({
    includeDetailed: z.boolean().optional().default(true),
    includeAnalysis: z.boolean().optional().default(false),
    contactEmail: z.string().email().optional(),
    organizationName: z.string().optional(),
    customGuidelines: z.array(z.string()).optional(),
    customRestrictions: z.array(z.string()).optional()
  }).optional(),
  complianceLevel: z.enum(['basic', 'standard', 'strict']).optional().default('standard'),
  format: z.enum(['both', 'llms-txt', 'llms-full-txt']).optional().default('both')
});

// Stealth Mode Tool Schema (Wave 3)
const StealthModeSchema = z.object({
  operation: z.enum(['configure', 'enable', 'disable', 'create_context', 'create_page', 'get_stats', 'cleanup']).default('configure'),
  stealthConfig: z.object({
    level: z.enum(['basic', 'medium', 'advanced']).default('medium'),
    randomizeFingerprint: z.boolean().default(true),
    hideWebDriver: z.boolean().default(true),
    blockWebRTC: z.boolean().default(true),
    spoofTimezone: z.boolean().default(true),
    randomizeHeaders: z.boolean().default(true),
    useRandomUserAgent: z.boolean().default(true),
    simulateHumanBehavior: z.boolean().default(true),
    customUserAgent: z.string().optional(),
    customViewport: z.object({
      width: z.number().min(800).max(1920),
      height: z.number().min(600).max(1080)
    }).optional(),
    locale: z.string().default('en-US'),
    timezone: z.string().optional(),
    webRTCPublicIP: z.string().optional(),
    webRTCLocalIPs: z.array(z.string()).optional(),
    proxyRotation: z.object({
      enabled: z.boolean().default(false),
      proxies: z.array(z.string()).optional(),
      rotationInterval: z.number().default(300000)
    }).optional(),
    antiDetection: z.object({
      cloudflareBypass: z.boolean().default(true),
      recaptchaHandling: z.boolean().default(true),
      hideAutomation: z.boolean().default(true),
      spoofMediaDevices: z.boolean().default(true),
      spoofBatteryAPI: z.boolean().default(true)
    }).optional(),
    fingerprinting: z.object({
      canvasNoise: z.boolean().default(true),
      webglSpoofing: z.boolean().default(true),
      audioContextSpoofing: z.boolean().default(true),
      fontSpoofing: z.boolean().default(true),
      hardwareSpoofing: z.boolean().default(true)
    }).optional()
  }).optional(),
  contextId: z.string().optional(),
  urlToTest: z.string().url().optional()
});

// Localization Tool Schema (Wave 3)
const LocalizationSchema = z.object({
  operation: z.enum(['configure_country', 'localize_search', 'localize_browser', 'generate_timezone_spoof', 'handle_geo_blocking', 'auto_detect', 'get_stats', 'get_supported_countries']).default('configure_country'),
  countryCode: z.string().length(2).optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
  customHeaders: z.record(z.string()).optional(),
  userAgent: z.string().optional(),
  acceptLanguage: z.string().optional(),
  geoLocation: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(1).max(100).optional()
  }).optional(),
  proxySettings: z.object({
    enabled: z.boolean().default(false),
    region: z.string().optional(),
    type: z.enum(['http', 'https', 'socks4', 'socks5']).default('https'),
    server: z.string().optional(),
    port: z.number().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    rotation: z.object({
      enabled: z.boolean().default(false),
      interval: z.number().default(300000),
      strategy: z.enum(['round-robin', 'random', 'failover']).default('round-robin')
    }).optional(),
    fallback: z.object({
      enabled: z.boolean().default(true),
      maxRetries: z.number().default(3),
      timeout: z.number().default(10000)
    }).optional()
  }).optional(),
  searchParams: z.object({
    query: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    headers: z.record(z.string()).optional()
  }).optional(),
  browserOptions: z.object({
    locale: z.string().optional(),
    timezoneId: z.string().optional(),
    extraHTTPHeaders: z.record(z.string()).optional(),
    userAgent: z.string().optional()
  }).optional(),
  content: z.string().optional(),
  url: z.string().url().optional(),
  response: z.object({
    status: z.number(),
    body: z.string().optional(),
    statusText: z.string().optional()
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
        'User-Agent': 'CrawlForge/1.0.0',
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
}, withAuth("fetch_url", async ({ url, headers, timeout }) => {
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
}));

// Tool: extract_text - Extract clean text content from HTML
server.registerTool("extract_text", {
  description: "Extract clean text content from a webpage",
  inputSchema: {
    url: z.string().url(),
    remove_scripts: z.boolean().optional().default(true),
    remove_styles: z.boolean().optional().default(true)
  }
}, withAuth("extract_text", async ({ url, remove_scripts, remove_styles }) => {
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
}));

// Tool: extract_links - Extract all links from a webpage with optional filtering
server.registerTool("extract_links", {
  description: "Extract all links from a webpage with optional filtering",
  inputSchema: {
    url: z.string().url(),
    filter_external: z.boolean().optional().default(false),
    base_url: z.string().url().optional()
  }
}, withAuth("extract_links", async ({ url, filter_external, base_url }) => {
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
}));

// Tool: extract_metadata - Extract page metadata
server.registerTool("extract_metadata", {
  description: "Extract metadata from a webpage (title, description, keywords, etc.)",
  inputSchema: {
    url: z.string().url()
  }
}, withAuth("extract_metadata", async ({ url }) => {
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
}));

// Tool: scrape_structured - Extract structured data using CSS selectors
server.registerTool("scrape_structured", {
  description: "Extract structured data from a webpage using CSS selectors",
  inputSchema: {
    url: z.string().url(),
    selectors: z.record(z.string())
  }
}, withAuth("scrape_structured", async ({ url, selectors }) => {
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
}));

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
    llmConfig: z.object({
      provider: z.enum(['auto', 'openai', 'anthropic']).optional().default('auto'),
      openai: z.object({
        apiKey: z.string().optional(),
        model: z.string().optional().default('gpt-3.5-turbo'),
        embeddingModel: z.string().optional().default('text-embedding-ada-002')
      }).optional(),
      anthropic: z.object({
        apiKey: z.string().optional(),
        model: z.string().optional().default('claude-3-haiku-20240307')
      }).optional(),
      enableSemanticAnalysis: z.boolean().optional().default(true),
      enableIntelligentSynthesis: z.boolean().optional().default(true)
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

// Tool: track_changes - Enhanced Content change tracking with baseline capture and monitoring (Phase 2.4)
// Temporarily disabled due to import issue
/*
server.registerTool("track_changes", {
  description: "Enhanced content change tracking with baseline capture, comparison, scheduled monitoring, advanced comparison engine, alert system, and historical analysis",
  inputSchema: {
    url: z.string().url(),
    operation: z.enum([
      'create_baseline', 
      'compare', 
      'monitor', 
      'get_history', 
      'get_stats',
      'create_scheduled_monitor',
      'stop_scheduled_monitor',
      'get_dashboard',
      'export_history',
      'create_alert_rule',
      'generate_trend_report',
      'get_monitoring_templates'
    ]).default('compare'),
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
    }).optional(),
    // Enhanced Phase 2.4 options
    scheduledMonitorOptions: z.object({
      schedule: z.string().optional(), // Cron expression
      templateId: z.string().optional(), // Monitoring template ID
      enabled: z.boolean().default(true)
    }).optional(),
    alertRuleOptions: z.object({
      ruleId: z.string().optional(),
      condition: z.string().optional(), // Condition description
      actions: z.array(z.enum(['webhook', 'email', 'slack'])).optional(),
      throttle: z.number().min(0).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional()
    }).optional(),
    exportOptions: z.object({
      format: z.enum(['json', 'csv']).default('json'),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      includeContent: z.boolean().default(false),
      includeSnapshots: z.boolean().default(false)
    }).optional(),
    dashboardOptions: z.object({
      includeRecentAlerts: z.boolean().default(true),
      includeTrends: z.boolean().default(true),
      includeMonitorStatus: z.boolean().default(true)
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

// Tool: generate_llms_txt - Generate LLMs.txt and LLMs-full.txt files (Phase 2.5)
server.registerTool("generate_llms_txt", {
  description: "Analyze websites and generate standard-compliant LLMs.txt and LLMs-full.txt files defining AI model interaction guidelines",
  inputSchema: {
    url: z.string().url(),
    analysisOptions: z.object({
      maxDepth: z.number().min(1).max(5).optional().default(3),
      maxPages: z.number().min(10).max(500).optional().default(100),
      detectAPIs: z.boolean().optional().default(true),
      analyzeContent: z.boolean().optional().default(true),
      checkSecurity: z.boolean().optional().default(true),
      respectRobots: z.boolean().optional().default(true)
    }).optional(),
    outputOptions: z.object({
      includeDetailed: z.boolean().optional().default(true),
      includeAnalysis: z.boolean().optional().default(false),
      contactEmail: z.string().email().optional(),
      organizationName: z.string().optional(),
      customGuidelines: z.array(z.string()).optional(),
      customRestrictions: z.array(z.string()).optional()
    }).optional(),
    complianceLevel: z.enum(['basic', 'standard', 'strict']).optional().default('standard'),
    format: z.enum(['both', 'llms-txt', 'llms-full-txt']).optional().default('both')
  }
}, async (params) => {
  try {
    const result = await generateLLMsTxtTool.execute(params);
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
        text: `LLMs.txt generation failed: ${error.message}`
      }],
      isError: true
    };
  }
});
*/

// Tool: stealth_mode - Advanced anti-detection browser management (Wave 3)
server.registerTool("stealth_mode", {
  description: "Advanced anti-detection browser management with stealth features, fingerprint randomization, and human behavior simulation",
  inputSchema: {
    operation: z.enum(['configure', 'enable', 'disable', 'create_context', 'create_page', 'get_stats', 'cleanup']).default('configure'),
    stealthConfig: z.object({
      level: z.enum(['basic', 'medium', 'advanced']).default('medium'),
      randomizeFingerprint: z.boolean().default(true),
      hideWebDriver: z.boolean().default(true),
      blockWebRTC: z.boolean().default(true),
      spoofTimezone: z.boolean().default(true),
      randomizeHeaders: z.boolean().default(true),
      useRandomUserAgent: z.boolean().default(true),
      simulateHumanBehavior: z.boolean().default(true),
      customUserAgent: z.string().optional(),
      customViewport: z.object({
        width: z.number().min(800).max(1920),
        height: z.number().min(600).max(1080)
      }).optional(),
      locale: z.string().default('en-US'),
      timezone: z.string().optional(),
      webRTCPublicIP: z.string().optional(),
      webRTCLocalIPs: z.array(z.string()).optional(),
      proxyRotation: z.object({
        enabled: z.boolean().default(false),
        proxies: z.array(z.string()).optional(),
        rotationInterval: z.number().default(300000)
      }).optional(),
      antiDetection: z.object({
        cloudflareBypass: z.boolean().default(true),
        recaptchaHandling: z.boolean().default(true),
        hideAutomation: z.boolean().default(true),
        spoofMediaDevices: z.boolean().default(true),
        spoofBatteryAPI: z.boolean().default(true)
      }).optional(),
      fingerprinting: z.object({
        canvasNoise: z.boolean().default(true),
        webglSpoofing: z.boolean().default(true),
        audioContextSpoofing: z.boolean().default(true),
        fontSpoofing: z.boolean().default(true),
        hardwareSpoofing: z.boolean().default(true)
      }).optional()
    }).optional(),
    contextId: z.string().optional(),
    urlToTest: z.string().url().optional()
  }
}, async ({ operation, stealthConfig, contextId, urlToTest }) => {
  try {
    let result;
    
    switch (operation) {
      case 'configure':
        if (stealthConfig) {
          const validated = stealthBrowserManager.validateConfig(stealthConfig);
          result = { configured: true, config: validated };
        } else {
          result = { error: 'stealthConfig is required for configure operation' };
        }
        break;
        
      case 'enable':
        stealthBrowserManager.enableStealthMode(stealthConfig?.level || 'medium');
        result = { enabled: true, level: stealthConfig?.level || 'medium' };
        break;
        
      case 'disable':
        stealthBrowserManager.disableStealthMode();
        result = { disabled: true };
        break;
        
      case 'create_context':
        const contextData = await stealthBrowserManager.createStealthContext(stealthConfig);
        result = {
          contextId: contextData.contextId,
          fingerprint: contextData.fingerprint,
          created: true
        };
        break;
        
      case 'create_page':
        if (!contextId) {
          throw new Error('contextId is required for create_page operation');
        }
        const page = await stealthBrowserManager.createStealthPage(contextId);
        result = {
          pageCreated: true,
          contextId: contextId,
          url: urlToTest ? await page.goto(urlToTest) : null
        };
        break;
        
      case 'get_stats':
        result = stealthBrowserManager.getStats();
        break;
        
      case 'cleanup':
        await stealthBrowserManager.cleanup();
        result = { cleaned: true };
        break;
        
      default:
        result = { error: `Unknown operation: ${operation}` };
    }
    
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
        text: `Stealth mode operation failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Tool: localization - Multi-language and geo-location management (Wave 3)
server.registerTool("localization", {
  description: "Multi-language and geo-location management with country-specific settings, browser locale emulation, timezone spoofing, and geo-blocked content handling",
  inputSchema: {
    operation: z.enum(['configure_country', 'localize_search', 'localize_browser', 'generate_timezone_spoof', 'handle_geo_blocking', 'auto_detect', 'get_stats', 'get_supported_countries']).default('configure_country'),
    countryCode: z.string().length(2).optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    currency: z.string().length(3).optional(),
    customHeaders: z.record(z.string()).optional(),
    userAgent: z.string().optional(),
    acceptLanguage: z.string().optional(),
    geoLocation: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(1).max(100).optional()
    }).optional(),
    proxySettings: z.object({
      enabled: z.boolean().default(false),
      region: z.string().optional(),
      type: z.enum(['http', 'https', 'socks4', 'socks5']).default('https'),
      server: z.string().optional(),
      port: z.number().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      rotation: z.object({
        enabled: z.boolean().default(false),
        interval: z.number().default(300000),
        strategy: z.enum(['round-robin', 'random', 'failover']).default('round-robin')
      }).optional(),
      fallback: z.object({
        enabled: z.boolean().default(true),
        maxRetries: z.number().default(3),
        timeout: z.number().default(10000)
      }).optional()
    }).optional(),
    searchParams: z.object({
      query: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      headers: z.record(z.string()).optional()
    }).optional(),
    browserOptions: z.object({
      locale: z.string().optional(),
      timezoneId: z.string().optional(),
      extraHTTPHeaders: z.record(z.string()).optional(),
      userAgent: z.string().optional()
    }).optional(),
    content: z.string().optional(),
    url: z.string().url().optional(),
    response: z.object({
      status: z.number(),
      body: z.string().optional(),
      statusText: z.string().optional()
    }).optional()
  }
}, async (params) => {
  try {
    const { operation } = params;
    let result;
    
    switch (operation) {
      case 'configure_country':
        if (!params.countryCode) {
          throw new Error('countryCode is required for configure_country operation');
        }
        result = await localizationManager.configureCountry(params.countryCode, params);
        break;
        
      case 'localize_search':
        if (!params.searchParams) {
          throw new Error('searchParams is required for localize_search operation');
        }
        result = await localizationManager.localizeSearchQuery(params.searchParams, params.countryCode);
        break;
        
      case 'localize_browser':
        if (!params.browserOptions) {
          throw new Error('browserOptions is required for localize_browser operation');
        }
        result = await localizationManager.localizeBrowserContext(params.browserOptions, params.countryCode);
        break;
        
      case 'generate_timezone_spoof':
        result = {
          timezoneScript: await localizationManager.generateTimezoneSpoof(params.countryCode),
          countryCode: params.countryCode || localizationManager.getCurrentSettings().countryCode
        };
        break;
        
      case 'handle_geo_blocking':
        if (!params.url || !params.response) {
          throw new Error('url and response are required for handle_geo_blocking operation');
        }
        result = await localizationManager.handleGeoBlocking(params.url, params.response);
        break;
        
      case 'auto_detect':
        if (!params.content || !params.url) {
          throw new Error('content and url are required for auto_detect operation');
        }
        result = await localizationManager.autoDetectLocalization(params.content, params.url);
        break;
        
      case 'get_stats':
        result = localizationManager.getStats();
        break;
        
      case 'get_supported_countries':
        result = {
          supportedCountries: localizationManager.getSupportedCountries(),
          totalCount: localizationManager.getSupportedCountries().length
        };
        break;
        
      default:
        result = { error: `Unknown operation: ${operation}` };
    }
    
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
        text: `Localization operation failed: ${error.message}`
      }],
      isError: true
    };
  }
});

// Set up the stdio transport and start the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CrawlForge MCP Server v3.0 running on stdio");
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
  const trackingTools = ''; // track_changes temporarily disabled
  const llmsTxtTools = ', generate_llms_txt';
  const wave3Tools = ', stealth_mode, localization';
  console.error(`Tools available: ${baseTools}${searchTool}${phase3Tools}${wave2Tools}${researchTools}${trackingTools}${llmsTxtTools}${wave3Tools}`);

  // Start memory monitoring in development
  if (config.server.nodeEnv === "development") {
    memoryMonitor.start();
    console.error("Memory monitoring started");
  }
}

runServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
// === MEMORY LEAK PREVENTION ===
// Add graceful shutdown handling to prevent memory leaks

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.error("Force shutdown...");
    process.exit(1);
  }
  
  isShuttingDown = true;
  console.error(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Cleanup tools that have destroy methods
    const toolsToCleanup = [
      batchScrapeTool,
      scrapeWithActionsTool,
      deepResearchTool,
      // trackChangesTool, // temporarily disabled
      generateLLMsTxtTool,
      stealthBrowserManager,
      localizationManager
    ].filter(tool => tool && (typeof tool.destroy === 'function' || typeof tool.cleanup === 'function'));
    
    console.error(`Cleaning up ${toolsToCleanup.length} tools...`);
    
    // Cleanup tools with timeout
    await Promise.race([
      Promise.all(toolsToCleanup.map(async (tool) => {
        try {
          if (typeof tool.destroy === 'function') {
            await tool.destroy();
          } else if (typeof tool.cleanup === 'function') {
            await tool.cleanup();
          }
          console.error(`Cleaned up ${tool.constructor.name}`);
        } catch (error) {
          console.error(`Error cleaning up ${tool.constructor.name}:`, error.message);
        }
      })),
      new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
    ]);
    
    // Stop memory monitoring
    if (memoryMonitor.isMonitoring) {
      memoryMonitor.stop();
      console.error("Memory monitoring stopped");
    }

    // Force garbage collection if available
    if (global.gc) {
      console.error("Running final garbage collection...");
      global.gc();
    }
    
    console.error("Graceful shutdown completed");
    process.exit(0);
    
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
}

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Memory monitoring (development only)
if (config.server.nodeEnv === 'development') {
  setInterval(() => {
    const usage = process.memoryUsage();
    const memoryMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
    if (memoryMB > 200) { // Alert if over 200MB
      console.error(`Memory usage: ${memoryMB}MB (high usage detected)`);
    }
  }, 60000); // Check every minute
}
