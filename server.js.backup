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

// Utility function to normalize and parse MCP parameters
function normalizeParams(params) {
  // If params is already an object, return as-is
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    return params;
  }
  
  // If params is a string, try to parse as JSON
  if (typeof params === 'string') {
    try {
      return JSON.parse(params);
    } catch (error) {
      // If it's not valid JSON, treat as a single string parameter
      return { value: params };
    }
  }
  
  // Return empty object for null/undefined
  return {};
}

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
server.tool("fetch_url", "Fetch content from a URL with optional headers and timeout", {
  url: {
    type: "string",
    description: "The URL to fetch"
  },
  headers: {
    type: "object",
    description: "Optional HTTP headers to include",
    optional: true
  },
  timeout: {
    type: "number",
    description: "Request timeout in milliseconds (1000-30000)",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    const params = FetchUrlSchema.parse(normalizeParams(rawParams));
    
    const response = await fetchWithTimeout(params.url, {
      timeout: params.timeout,
      headers: params.headers
    });
    
    const body = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: body,
      contentType: response.headers.get('content-type') || 'unknown',
      size: body.length,
      url: response.url
    };
  } catch (error) {
    throw new Error(`Failed to fetch URL: ${error.message}`);
  }
});

// Tool: extract_text - Extract clean text content from HTML
server.tool("extract_text", "Extract clean text content from a webpage", {
  url: {
    type: "string",
    description: "The URL to extract text from"
  },
  remove_scripts: {
    type: "boolean",
    description: "Remove script tags before extracting text",
    optional: true
  },
  remove_styles: {
    type: "boolean",
    description: "Remove style tags before extracting text",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    const params = ExtractTextSchema.parse(normalizeParams(rawParams));
    
    const response = await fetchWithTimeout(params.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    // Remove unwanted elements
    if (params.remove_scripts) {
      $('script').remove();
    }
    if (params.remove_styles) {
      $('style').remove();
    }
    
    // Remove common non-content elements
    $('nav, header, footer, aside, .advertisement, .ad, .sidebar').remove();
    
    // Extract text content
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    
    return {
      text: text,
      word_count: text.split(/\s+/).filter(word => word.length > 0).length,
      char_count: text.length,
      url: response.url
    };
  } catch (error) {
    throw new Error(`Failed to extract text: ${error.message}`);
  }
});

// Tool: extract_links - Extract all links from a webpage with optional filtering
server.tool("extract_links", "Extract all links from a webpage with optional filtering", {
  url: {
    type: "string",
    description: "The URL to extract links from"
  },
  filter_external: {
    type: "boolean",
    description: "Filter out external links (keep only internal links)",
    optional: true
  },
  base_url: {
    type: "string",
    description: "Base URL for resolving relative links",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    const params = ExtractLinksSchema.parse(normalizeParams(rawParams));
    
    const response = await fetchWithTimeout(params.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    const baseUrl = params.base_url || new URL(params.url).origin;
    const pageUrl = new URL(params.url);
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
        if (params.filter_external && isExternal) {
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
      links: uniqueLinks,
      total_count: uniqueLinks.length,
      internal_count: uniqueLinks.filter(l => !l.is_external).length,
      external_count: uniqueLinks.filter(l => l.is_external).length,
      base_url: baseUrl
    };
  } catch (error) {
    throw new Error(`Failed to extract links: ${error.message}`);
  }
});

// Tool: extract_metadata - Extract page metadata
server.tool("extract_metadata", "Extract metadata from a webpage (title, description, keywords, etc.)", {
  url: {
    type: "string",
    description: "The URL to extract metadata from"
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    const params = ExtractMetadataSchema.parse(normalizeParams(rawParams));
    
    const response = await fetchWithTimeout(params.url);
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
    };
  } catch (error) {
    throw new Error(`Failed to extract metadata: ${error.message}`);
  }
});

// Tool: scrape_structured - Extract structured data using CSS selectors
server.tool("scrape_structured", "Extract structured data from a webpage using CSS selectors", {
  url: {
    type: "string",
    description: "The URL to scrape"
  },
  selectors: {
    type: "object",
    description: "Object mapping field names to CSS selectors"
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    const params = ScrapeStructuredSchema.parse(normalizeParams(rawParams));
    
    const response = await fetchWithTimeout(params.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = load(html);
    
    const results = {};
    
    for (const [fieldName, selector] of Object.entries(params.selectors)) {
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
      data: results,
      selectors_used: params.selectors,
      elements_found: Object.keys(results).length,
      url: response.url
    };
  } catch (error) {
    throw new Error(`Failed to scrape structured data: ${error.message}`);
  }
});

// Tool: search_web - Web search with configurable providers
if (searchWebTool) {
  const activeProvider = getActiveSearchProvider();
  const providerName = activeProvider === 'google' ? 'Google Custom Search API' : 
                      activeProvider === 'duckduckgo' ? 'DuckDuckGo' : 'Auto-selected provider';
  
  server.tool("search_web", `Search the web using ${providerName}`, {
    query: {
      type: "string",
      description: "Search query"
    },
    limit: {
      type: "number",
      description: "Maximum number of results (1-100)",
      optional: true
    },
    offset: {
      type: "number",
      description: "Result offset for pagination",
      optional: true
    },
    lang: {
      type: "string",
      description: "Language code (e.g., 'en', 'fr', 'de')",
      optional: true
    },
    safe_search: {
      type: "boolean",
      description: "Enable safe search filtering",
      optional: true
    },
    time_range: {
      type: "string",
      description: "Time range: 'day', 'week', 'month', 'year', or 'all'",
      optional: true
    },
    site: {
      type: "string",
      description: "Restrict search to specific site",
      optional: true
    },
    file_type: {
      type: "string",
      description: "Filter by file type (e.g., 'pdf', 'doc')",
      optional: true
    }
  }, async (request) => {
    try {
      // Extract parameters from MCP protocol structure
      const rawParams = request?.params?.arguments || request || {};
      return await searchWebTool.execute(normalizeParams(rawParams));
    } catch (error) {
      throw new Error(`Search failed: ${error.message}`);
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
server.tool("crawl_deep", "Crawl websites deeply using breadth-first search", {
  url: {
    type: "string",
    description: "Starting URL to crawl"
  },
  max_depth: {
    type: "number",
    description: "Maximum crawl depth (1-5)",
    optional: true
  },
  max_pages: {
    type: "number",
    description: "Maximum pages to crawl (1-1000)",
    optional: true
  },
  include_patterns: {
    type: "array",
    description: "Regex patterns for URLs to include",
    optional: true
  },
  exclude_patterns: {
    type: "array",
    description: "Regex patterns for URLs to exclude",
    optional: true
  },
  follow_external: {
    type: "boolean",
    description: "Follow external links",
    optional: true
  },
  respect_robots: {
    type: "boolean",
    description: "Respect robots.txt rules",
    optional: true
  },
  extract_content: {
    type: "boolean",
    description: "Extract page content",
    optional: true
  },
  concurrency: {
    type: "number",
    description: "Number of concurrent requests (1-20)",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    return await crawlDeepTool.execute(normalizeParams(rawParams));
  } catch (error) {
    throw new Error(`Crawl failed: ${error.message}`);
  }
});

// Tool: map_site - Discover and map website structure
server.tool("map_site", "Discover and map website structure", {
  url: {
    type: "string",
    description: "Website URL to map"
  },
  include_sitemap: {
    type: "boolean",
    description: "Include sitemap.xml URLs",
    optional: true
  },
  max_urls: {
    type: "number",
    description: "Maximum URLs to discover (1-10000)",
    optional: true
  },
  group_by_path: {
    type: "boolean",
    description: "Group URLs by path segments",
    optional: true
  },
  include_metadata: {
    type: "boolean",
    description: "Fetch metadata for discovered URLs",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    return await mapSiteTool.execute(normalizeParams(rawParams));
  } catch (error) {
    throw new Error(`Site mapping failed: ${error.message}`);
  }
});

// Phase 3 Tools: Enhanced Content Processing

// Tool: extract_content - Enhanced content extraction with readability detection
server.tool("extract_content", "Extract and analyze main content from web pages with enhanced readability detection", {
  url: {
    type: "string",
    description: "URL to extract content from"
  },
  options: {
    type: "object",
    description: "Content extraction options",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    return await extractContentTool.execute(normalizeParams(rawParams));
  } catch (error) {
    throw new Error(`Content extraction failed: ${error.message}`);
  }
});

// Tool: process_document - Multi-format document processing
server.tool("process_document", "Process documents from multiple sources and formats including PDFs and web pages", {
  source: {
    type: "string",
    description: "Document source (URL, file path, etc.)"
  },
  sourceType: {
    type: "string",
    description: "Source type: url, pdf_url, file, pdf_file",
    optional: true
  },
  options: {
    type: "object",
    description: "Processing options",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    return await processDocumentTool.execute(normalizeParams(rawParams));
  } catch (error) {
    throw new Error(`Document processing failed: ${error.message}`);
  }
});

// Tool: summarize_content - Intelligent content summarization
server.tool("summarize_content", "Generate intelligent summaries of text content with configurable options", {
  text: {
    type: "string",
    description: "Text content to summarize"
  },
  options: {
    type: "object",
    description: "Summarization options",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    return await summarizeContentTool.execute(normalizeParams(rawParams));
  } catch (error) {
    throw new Error(`Content summarization failed: ${error.message}`);
  }
});

// Tool: analyze_content - Comprehensive content analysis
server.tool("analyze_content", "Perform comprehensive content analysis including language detection and topic extraction", {
  text: {
    type: "string",
    description: "Text content to analyze"
  },
  options: {
    type: "object",
    description: "Analysis options",
    optional: true
  }
}, async (request) => {
  try {
    // Extract parameters from MCP protocol structure
    const rawParams = request?.params?.arguments || request || {};
    return await analyzeContentTool.execute(normalizeParams(rawParams));
  } catch (error) {
    throw new Error(`Content analysis failed: ${error.message}`);
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
  console.error(`Tools available: ${baseTools}${searchTool}${phase3Tools}`);
}

runServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});