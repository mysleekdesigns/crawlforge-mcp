#!/usr/bin/env node

// Creator Mode Authentication — imported from src/core/creatorMode.js
// This MUST be the first import so the secret is verified before any tool code runs.
export { isCreatorModeVerified } from './src/core/creatorMode.js';

// Import everything else
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logger } from "./src/utils/Logger.js";
import { SearchWebTool } from "./src/tools/search/searchWeb.js";
import { CrawlDeepTool } from "./src/tools/crawl/crawlDeep.js";
import { MapSiteTool } from "./src/tools/crawl/mapSite.js";
import { ExtractContentTool } from "./src/tools/extract/extractContent.js";
import { ProcessDocumentTool } from "./src/tools/extract/processDocument.js";
import { SummarizeContentTool } from "./src/tools/extract/summarizeContent.js";
import { AnalyzeContentTool } from "./src/tools/extract/analyzeContent.js";
import { ExtractStructuredTool } from "./src/tools/extract/extractStructured.js";
import { ExtractWithLlm } from "./src/tools/extract/extractWithLlm.js";
import { ListOllamaModelsTool } from "./src/tools/extract/listOllamaModels.js";
import { BatchScrapeTool } from "./src/tools/advanced/BatchScrapeTool.js";
import { ScrapeWithActionsTool } from "./src/tools/advanced/ScrapeWithActionsTool.js";
import { DeepResearchTool } from "./src/tools/research/deepResearch.js";
import { TrackChangesTool } from "./src/tools/tracking/trackChanges/index.js";
import { GenerateLLMsTxtTool } from "./src/tools/llmstxt/generateLLMsTxt.js";
import { ScrapeTemplateTool } from "./src/tools/templates/ScrapeTemplateTool.js"; // D3.3
import { UnifiedScrapeTool } from "./src/tools/scrape/unifiedScrape.js"; // D4 D1
import { AgentTool } from "./src/tools/agent/agent.js"; // D4 D2
import { StealthBrowserManager } from "./src/core/StealthBrowserManager.js";
import { LocalizationManager } from "./src/core/LocalizationManager.js";
import { memoryMonitor } from "./src/utils/MemoryMonitor.js";
import { config, validateConfig, getToolConfig } from "./src/constants/config.js";
import AuthManager from "./src/core/AuthManager.js";
import { makeWithAuth } from "./src/server/withAuth.js";
// Transport helpers
import { connectStdio } from "./src/server/transports/stdio.js";
import { connectHttp } from "./src/server/transports/http.js";
import { connectStreamableHttp } from "./src/server/transports/streamableHttp.js";
// OAuth 2.1 (HTTP transport only — opt-in via CRAWLFORGE_OAUTH_ENABLED=true)
import { createOAuthProvider } from "./src/server/auth/oauth.js";
// Observability (no-op by default — enable via CRAWLFORGE_METRICS / OTEL_SDK_DISABLED)
import { createMetricsRegistry } from "./src/observability/metrics.js";
// Basic tool handlers (extracted from server.js)
import { fetchUrlHandler } from "./src/tools/basic/fetchUrl.js";
import { extractTextHandler } from "./src/tools/basic/extractText.js";
import { extractLinksHandler } from "./src/tools/basic/extractLinks.js";
import { extractMetadataHandler } from "./src/tools/basic/extractMetadata.js";
import { scrapeStructuredHandler } from "./src/tools/basic/scrapeStructured.js";
// D1.1 Resources + D1.2 Prompts + D1.4 Elicitation
import { ResourceRegistry } from "./src/resources/ResourceRegistry.js";
import { PROMPTS, getPromptMessages } from "./src/prompts/PromptRegistry.js";
import { ElicitationHelper } from "./src/core/ElicitationHelper.js";

// Initialize Authentication Manager
await AuthManager.initialize();

// Check if first time setup is needed (skip in creator mode)
if (!AuthManager.isAuthenticated() && !AuthManager.isCreatorMode()) {
  const apiKey = process.env.CRAWLFORGE_API_KEY;
  if (apiKey) {
    // Auto-setup if API key is provided via environment
    // Status → stderr; stdout is reserved for the MCP JSON-RPC stream.
    console.error('🔧 Auto-configuring CrawlForge with provided API key...');
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
    console.log('Get your free API key at: https://www.crawlforge.dev/signup');
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
const server = new McpServer({
  name: "crawlforge",
  version: "4.6.3",
  description: "Production-ready MCP server with 26 web scraping, crawling, and content processing tools. Features MCP Resources (crawlforge://), Prompts, Sampling fallback, Elicitation, stealth browsing, deep research, structured extraction, change tracking, local-LLM extraction via Ollama, unified multi-format scrape, and autonomous agent tool.",
  homepage: "https://www.crawlforge.dev",
  icon: "https://www.crawlforge.dev/icon.png"
});

// Register getting-started prompt
server.prompt("getting-started", {
  description: "Get started with CrawlForge MCP - learn available tools and best practices",
}, async () => {
  return {
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: "You have access to CrawlForge MCP with 26 web scraping tools. Key tools:\n\n" +
          "- fetch_url: Fetch raw HTML/content from any URL\n" +
          "- extract_text: Extract clean text from a webpage\n" +
          "- extract_content: Smart content extraction with readability\n" +
          "- search_web: Search the web and get structured results\n" +
          "- crawl_deep: Crawl a website following links to a specified depth\n" +
          "- map_site: Discover all pages on a website\n" +
          "- batch_scrape: Scrape multiple URLs in parallel\n" +
          "- scrape_with_actions: Automate browser actions then scrape\n" +
          "- deep_research: Multi-source research on any topic\n" +
          "- stealth_mode: Anti-detection browsing for protected sites\n" +
          "- extract_structured: LLM-powered structured data extraction\n" +
          "- extract_with_llm: Natural-language extraction — defaults to local Ollama (no API key); openai/anthropic available with key\n" +
          "- list_ollama_models: List installed Ollama models so you can pick one for extract_with_llm\n" +
          "- track_changes: Monitor website changes over time\n" +
          "- generate_llms_txt: Generate llms.txt for any website\n\n" +
          "Workflow: search_web -> fetch_url -> extract_content -> analyze_content\n\n" +
          "Get your API key at https://www.crawlforge.dev/signup (1,000 free credits)"
      }
    }]
  };
});

// Observability registry — only emit metrics in HTTP mode when explicitly enabled.
// Stdio mode stays silent to match MCP host expectations.
const metricsEnabled =
  (process.argv.includes('--http') || process.env.MCP_HTTP === 'true') &&
  process.env.CRAWLFORGE_METRICS === 'true';
const metrics = metricsEnabled ? createMetricsRegistry() : null;

// Tool-handler wrapper: auth + credit tracking + structured invocation logging + observability.
const withAuth = makeWithAuth({ authManager: AuthManager, logger, metrics });

// Initialize tools
const searchWebTool = new SearchWebTool(getToolConfig("search_web"));
const crawlDeepTool = new CrawlDeepTool(getToolConfig('crawl_deep'));
const mapSiteTool = new MapSiteTool(getToolConfig('map_site'));
const extractContentTool = new ExtractContentTool();
const processDocumentTool = new ProcessDocumentTool();
const summarizeContentTool = new SummarizeContentTool();
const analyzeContentTool = new AnalyzeContentTool();
const extractStructuredTool = new ExtractStructuredTool();
const extractWithLlmTool = new ExtractWithLlm();
const listOllamaModelsTool = new ListOllamaModelsTool();
const batchScrapeTool = new BatchScrapeTool();
const scrapeWithActionsTool = new ScrapeWithActionsTool();
const deepResearchTool = new DeepResearchTool();
const trackChangesTool = new TrackChangesTool();
const generateLLMsTxtTool = new GenerateLLMsTxtTool();
const scrapeTemplateTool = new ScrapeTemplateTool(); // D3.3
const unifiedScrapeTool = new UnifiedScrapeTool(); // D4 D1
const agentTool = new AgentTool(); // D4 D2
const stealthBrowserManager = new StealthBrowserManager();
const localizationManager = new LocalizationManager();

// D1.1: Resource Registry (wired to existing singletons)
const resourceRegistry = new ResourceRegistry({
  researchOrchestrator: deepResearchTool, // exposes activeSessions
  snapshotManager: null, // SnapshotManager not directly instantiated in server.js
  jobManager: batchScrapeTool.jobManager,
  mapSiteTool,
  scrapeWithActionsTool,
});

// D1.4: Elicitation helper (client may not support — fails open)
const elicitation = new ElicitationHelper({ mcpServer: server, logger });

// D1.4: Wire elicitation into tools and AuthManager
deepResearchTool.setMcpServer(server);
batchScrapeTool.setMcpServer(server);
crawlDeepTool.setMcpServer(server);
extractStructuredTool.setMcpServer(server);
agentTool.setMcpServer(server); // D4 D2: SamplingClient + Elicitation
AuthManager.setElicitation(elicitation);

// ─── D1.1 Resource Templates (MCP Resources) ─────────────────────────────────
// Resources use the MCP ResourceTemplate URI pattern for dynamic crawlforge:// URIs.
// The registry is populated at runtime as tools produce artifacts.

// Research sessions: crawlforge://research/{sessionId}
server.resource(
  "crawlforge-research",
  new ResourceTemplate("crawlforge://research/{sessionId}", {
    list: async () => ({
      resources: resourceRegistry.listResources().filter(r => r.uri.startsWith("crawlforge://research/"))
    })
  }),
  { description: "Completed deep_research report stored in the server session" },
  async (uri) => resourceRegistry.readResource(uri)
);

// Job results: crawlforge://job/{jobId}
server.resource(
  "crawlforge-job",
  new ResourceTemplate("crawlforge://job/{jobId}", {
    list: async () => ({
      resources: resourceRegistry.listResources().filter(r => r.uri.startsWith("crawlforge://job/"))
    })
  }),
  { description: "Completed batch_scrape job result" },
  async (uri) => resourceRegistry.readResource(uri)
);

// Crawl sitemaps: crawlforge://crawl/{sessionId}/sitemap
server.resource(
  "crawlforge-crawl-sitemap",
  new ResourceTemplate("crawlforge://crawl/{sessionId}/sitemap", {
    list: async () => ({
      resources: resourceRegistry.listResources().filter(r => r.uri.startsWith("crawlforge://crawl/"))
    })
  }),
  { description: "map_site output stored for a crawl session" },
  async (uri) => resourceRegistry.readResource(uri)
);

// Screenshots: crawlforge://screenshot/{actionId}
server.resource(
  "crawlforge-screenshot",
  new ResourceTemplate("crawlforge://screenshot/{actionId}", {
    list: async () => ({
      resources: resourceRegistry.listResources().filter(r => r.uri.startsWith("crawlforge://screenshot/"))
    })
  }),
  { description: "Screenshot from scrape_with_actions" },
  async (uri) => resourceRegistry.readResource(uri)
);

// ─── D1.2 Prompts (workflow templates) ────────────────────────────────────────
// Register the 5 CrawlForge workflow prompts from PromptRegistry.

for (const p of PROMPTS) {
  const argsShape = {};
  for (const arg of p.arguments) {
    argsShape[arg.name] = z.string().optional().describe(arg.description);
  }
  server.registerPrompt(p.name, { description: p.description, argsSchema: argsShape }, async (args) => {
    return getPromptMessages(p.name, args || {});
  });
}

// ─── Tool registrations ────────────────────────────────────────────────────────

// Tool: fetch_url
server.registerTool("fetch_url", {
  description: "Use this when you need raw HTTP content from a URL — HTML, JSON, XML, or plain text. Ideal as the first step before extract_text or extract_content. Supports custom headers (e.g. auth tokens) and configurable timeout. Example: fetch_url({url: \"https://example.com\", timeout: 15000})",
  annotations: { title: "Fetch URL", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to fetch content from"),
    headers: z.record(z.string()).optional().describe("Custom HTTP headers to include in the request"),
    timeout: z.number().min(1000).max(30000).optional().default(10000).describe("Request timeout in milliseconds (1000-30000)")
  }
}, withAuth("fetch_url", fetchUrlHandler));

// Tool: extract_text
server.registerTool("extract_text", {
  description: "Use this when you need a page's human-readable text or markdown stripped of HTML tags, scripts, and styles — e.g. for keyword search, summarization, RAG ingestion, or NLP. Use output_format:\"markdown\" for RAG workflows. Faster than extract_content but returns unstructured content. Example: extract_text({url: \"https://example.com/article\", output_format:\"markdown\"})",
  annotations: { title: "Extract Text", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to extract text from"),
    remove_scripts: z.boolean().optional().default(true).describe("Remove script tags before extraction"),
    remove_styles: z.boolean().optional().default(true).describe("Remove style tags before extraction"),
    output_format: z.enum(["text", "markdown"]).optional().default("text").describe("Output format: \"text\" (default) or \"markdown\" — use markdown for RAG workflows")
  }
}, withAuth("extract_text", extractTextHandler));

// Tool: extract_links
server.registerTool("extract_links", {
  description: "Use this when you need to discover all hyperlinks on a page — e.g. to build a crawl seed list, audit broken links, or find related resources. Use filter_external:true to get only outbound links. Example: extract_links({url: \"https://example.com\", filter_external: true})",
  annotations: { title: "Extract Links", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to extract links from"),
    filter_external: z.boolean().optional().default(false).describe("Only return external links"),
    base_url: z.string().url().optional().describe("Base URL for resolving relative links")
  }
}, withAuth("extract_links", extractLinksHandler));

// Tool: extract_metadata
server.registerTool("extract_metadata", {
  description: "Use this when you need a page's SEO metadata: title, meta description, Open Graph tags, canonical URL, schema.org data. Ideal for site audits and competitive SEO analysis. Example: extract_metadata({url: \"https://example.com\"})",
  annotations: { title: "Extract Metadata", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to extract metadata from")
  }
}, withAuth("extract_metadata", extractMetadataHandler));

// Tool: scrape_structured
server.registerTool("scrape_structured", {
  description: "Use this when you know the exact CSS selectors for the data you want — e.g. scraping a pricing table or product list with consistent markup. More reliable than LLM extraction for well-structured pages. Example: scrape_structured({url: \"https://shop.com/products\", selectors: {price: \".price\", name: \".product-title\"}})",
  annotations: { title: "Scrape Structured Data", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to scrape"),
    selectors: z.record(z.string()).describe("CSS selectors mapping field names to selectors. Append @attr to extract an attribute instead of text (e.g. \"a.link@href\", \"img@src\")"),
    max_results: z.number().int().min(1).optional().describe("Maximum number of matches to return per field when a selector matches multiple elements")
  }
}, withAuth("scrape_structured", scrapeStructuredHandler));

// Tool: search_web
server.registerTool("search_web", {
  description: "Use this when you need web search results for a query — returns titles, URLs, snippets, and optional metadata. Supports language, date range, and site filters. Start research workflows here before using fetch_url or deep_research. Example: search_web({query: \"best MCP servers 2025\", limit: 10, time_range: \"month\"})",
  annotations: { title: "Search the Web", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    query: z.string().describe("Search query string"),
    limit: z.number().min(1).max(100).optional().describe("Maximum number of results to return"),
    offset: z.number().min(0).optional().describe("Number of results to skip for pagination"),
    lang: z.string().optional().describe("Language code for results (e.g. 'en', 'fr')"),
    safe_search: z.boolean().optional().describe("Enable safe search filtering"),
    time_range: z.enum(["day", "week", "month", "year", "all"]).optional().describe("Filter results by time range"),
    site: z.string().optional().describe("Limit results to a specific domain"),
    file_type: z.string().optional().describe("Filter by file type (e.g. 'pdf', 'doc')"),
    provider: z.enum(["crawlforge", "searxng"]).optional().describe("Search backend to use"),
    expand_query: z.boolean().optional().describe("Expand the query with synonyms/stemming/etc."),
    expansion_options: z.object({
      enableSynonyms: z.boolean().optional(),
      enableSpellCheck: z.boolean().optional(),
      enableStemming: z.boolean().optional(),
      enablePhraseDetection: z.boolean().optional(),
      enableBooleanOperators: z.boolean().optional(),
      maxExpansions: z.number().min(1).max(10).optional()
    }).optional().describe("Query-expansion tuning"),
    enable_ranking: z.boolean().optional().describe("Re-rank results (BM25 + signals)"),
    ranking_weights: z.object({
      bm25: z.number().min(0).max(1).optional(),
      semantic: z.number().min(0).max(1).optional(),
      authority: z.number().min(0).max(1).optional(),
      freshness: z.number().min(0).max(1).optional()
    }).optional().describe("Relative weights for ranking signals"),
    enable_deduplication: z.boolean().optional().describe("Remove near-duplicate results"),
    deduplication_thresholds: z.object({
      url: z.number().min(0).max(1).optional(),
      title: z.number().min(0).max(1).optional(),
      content: z.number().min(0).max(1).optional(),
      combined: z.number().min(0).max(1).optional()
    }).optional().describe("Similarity thresholds for dedup"),
    include_ranking_details: z.boolean().optional().describe("Include per-result ranking breakdown"),
    include_deduplication_details: z.boolean().optional().describe("Include dedup decision details"),
    localization: z.object({
      countryCode: z.string().length(2).optional(),
      language: z.string().optional(),
      timezone: z.string().optional(),
      enableGeoTargeting: z.boolean().optional(),
      customLocation: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180)
      }).optional()
    }).optional().describe("Geo/locale targeting for results")
  }
}, withAuth("search_web", async ({ query, limit, offset, lang, safe_search, time_range, site, file_type, provider, expand_query, expansion_options, enable_ranking, ranking_weights, enable_deduplication, deduplication_thresholds, include_ranking_details, include_deduplication_details, localization }) => {
  try {
    if (!query) {
      return { content: [{ type: "text", text: "Query parameter is required" }], isError: true };
    }
    const result = await searchWebTool.execute({ query, limit, offset, lang, safe_search, time_range, site, file_type, provider, expand_query, expansion_options, enable_ranking, ranking_weights, enable_deduplication, deduplication_thresholds, include_ranking_details, include_deduplication_details, localization });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Search failed: ${error.message}` }], isError: true };
  }
}));

// Tool: crawl_deep
server.registerTool("crawl_deep", {
  description: "Use this when you need to discover and optionally extract content from many pages within a site — e.g. building a knowledge base, indexing docs, or auditing all pages. Use map_site first to estimate scope, then crawl_deep for content. Example: crawl_deep({url: \"https://docs.example.com\", max_depth: 3, max_pages: 200, extract_content: true})",
  annotations: { title: "Deep Crawl", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("Starting URL for the crawl"),
    max_depth: z.number().min(1).max(5).optional().describe("Maximum crawl depth from starting URL"),
    max_pages: z.number().min(1).max(1000).optional().describe("Maximum number of pages to crawl"),
    include_patterns: z.array(z.string()).optional().describe("URL patterns to include (regex)"),
    exclude_patterns: z.array(z.string()).optional().describe("URL patterns to exclude (regex)"),
    follow_external: z.boolean().optional().describe("Follow links to external domains"),
    respect_robots: z.boolean().optional().describe("Respect robots.txt directives"),
    extract_content: z.boolean().optional().describe("Extract page content during crawl"),
    content_max_length: z.number().min(1).max(100000).optional().describe("Maximum characters of page content to include per page (default 500); sets a truncated flag when trimmed"),
    concurrency: z.number().min(1).max(20).optional().describe("Number of concurrent requests"),
    enable_link_analysis: z.boolean().optional().describe("Compute PageRank/link-graph analysis over crawled pages"),
    link_analysis_options: z.object({
      dampingFactor: z.number().min(0).max(1).optional(),
      maxIterations: z.number().min(1).max(1000).optional(),
      enableCaching: z.boolean().optional()
    }).optional().describe("PageRank tuning options"),
    domain_filter: z.object({
      whitelist: z.array(z.any()).optional(),
      blacklist: z.array(z.any()).optional(),
      domain_rules: z.record(z.any()).optional()
    }).optional().describe("Per-domain allow/deny lists and crawl rules"),
    import_filter_config: z.string().optional().describe("JSON string of a previously exported domain-filter config"),
    session: z.object({
      enabled: z.boolean(),
      persistCookies: z.boolean().optional(),
      headers: z.record(z.string()).optional(),
      initialRequest: z.object({
        url: z.string().url(),
        method: z.string().optional(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional()
      }).optional()
    }).optional().describe("Shared cookie-jar/session for login-then-crawl workflows")
  }
}, withAuth("crawl_deep", async ({ url, max_depth, max_pages, include_patterns, exclude_patterns, follow_external, respect_robots, extract_content, content_max_length, concurrency, enable_link_analysis, link_analysis_options, domain_filter, import_filter_config, session }) => {
  try {
    if (!url) {
      return { content: [{ type: "text", text: "URL parameter is required" }], isError: true };
    }
    const result = await crawlDeepTool.execute({ url, max_depth, max_pages, include_patterns, exclude_patterns, follow_external, respect_robots, extract_content, content_max_length, concurrency, enable_link_analysis, link_analysis_options, domain_filter, import_filter_config, session });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Crawl failed: ${error.message}` }], isError: true };
  }
}));

// Tool: map_site
server.registerTool("map_site", {
  description: "Use this when you need to know all URLs on a domain without fetching full page content — e.g. before a crawl_deep, for a site audit, or to find specific section URLs. Reads sitemap.xml when available. Example: map_site({url: \"https://example.com\", include_sitemap: true, max_urls: 500})",
  annotations: { title: "Map Website", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The website URL to map"),
    include_sitemap: z.boolean().optional().describe("Include sitemap.xml data in results"),
    max_urls: z.number().min(1).max(10000).optional().describe("Maximum number of URLs to discover"),
    group_by_path: z.boolean().optional().describe("Group URLs by path segments"),
    include_metadata: z.boolean().optional().describe("Include page metadata for each URL"),
    domain_filter: z.object({
      whitelist: z.array(z.string()).optional(),
      blacklist: z.array(z.string()).optional(),
      include_patterns: z.array(z.string()).optional(),
      exclude_patterns: z.array(z.string()).optional()
    }).optional().describe("Per-domain allow/deny lists and URL include/exclude patterns"),
    import_filter_config: z.string().optional().describe("JSON string of a previously exported domain-filter config"),
    search: z.string().optional().describe("When set, rank discovered URLs by relevance to this string and emit ranked_urls:[{url,score}]")
  }
}, withAuth("map_site", async ({ url, include_sitemap, max_urls, group_by_path, include_metadata, domain_filter, import_filter_config, search }) => {
  try {
    if (!url) {
      return { content: [{ type: "text", text: "URL parameter is required" }], isError: true };
    }
    const result = await mapSiteTool.execute({ url, include_sitemap, max_urls, group_by_path, include_metadata, domain_filter, import_filter_config, search });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Site mapping failed: ${error.message}` }], isError: true };
  }
}));

// Tool: extract_content
server.registerTool("extract_content", {
  description: "Use this when you need a clean, readable version of a web article or page — removes ads, nav, footers, and boilerplate. Ideal for RAG ingestion, summarization, or LLM context. Prefer this over extract_text for article-style pages. Example: extract_content({url: \"https://blog.example.com/post-title\"})",
  annotations: { title: "Extract Content", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to extract content from"),
    options: z.object({}).optional().describe("Additional extraction options")
  }
}, withAuth("extract_content", async ({ url, options }) => {
  try {
    if (!url) {
      return { content: [{ type: "text", text: "URL parameter is required" }], isError: true };
    }
    const result = await extractContentTool.execute({ url, options });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Content extraction failed: ${error.message}` }], isError: true };
  }
}));

// Tool: process_document
server.registerTool("process_document", {
  description: "Use this when you need to extract text from a PDF URL or file — e.g. research papers, contracts, reports. Also handles HTML URLs. Returns structured sections, metadata, and word count. Example: process_document({source: \"https://example.com/report.pdf\", sourceType: \"pdf_url\"})",
  annotations: { title: "Process Document", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    source: z.string().describe("Document source - URL or file path"),
    sourceType: z.enum(['url', 'pdf_url', 'file', 'pdf_file']).optional().describe("Type of document source"),
    // C3: passthrough so granular options (maxPages, pageRange:{start,end},
    // extractText, outputFormat, etc.) reach the tool instead of being stripped.
    options: z.object({}).passthrough().optional().describe("Additional processing options (maxPages, pageRange:{start,end}, extractText, extractMetadata, password, outputFormat, ...)")
  }
}, withAuth("process_document", async ({ source, sourceType, options }) => {
  try {
    if (!source) {
      return { content: [{ type: "text", text: "Source parameter is required" }], isError: true };
    }
    const result = await processDocumentTool.execute({ source, sourceType, options });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Document processing failed: ${error.message}` }], isError: true };
  }
}));

// Tool: summarize_content
server.registerTool("summarize_content", {
  description: "Use this when you have text content (from extract_text or extract_content) and need a condensed version — e.g. for briefings, comparison tables, or LLM context reduction. Supports extractive (sentence selection) and abstractive (rewrite via Ollama/sampling) modes. Example: summarize_content({text: \"..long article..\", options: {summaryLength: \"short\", summaryType: \"abstractive\"}})",
  annotations: { title: "Summarize Content", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    text: z.string().describe("The text content to summarize"),
    options: z.object({}).optional().describe("Summarization options")
  }
}, withAuth("summarize_content", async ({ text, options }) => {
  try {
    if (!text) {
      return { content: [{ type: "text", text: "Text parameter is required" }], isError: true };
    }
    const result = await summarizeContentTool.execute({ text, options });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Content summarization failed: ${error.message}` }], isError: true };
  }
}));

// Tool: analyze_content
server.registerTool("analyze_content", {
  description: "Use this when you need NLP metrics for text — language detection, sentiment, topic extraction, entity recognition, readability score. Good for content auditing and classification. Example: analyze_content({text: \"..article text..\", options: {extractTopics: true, includeSentiment: true}})",
  annotations: { title: "Analyze Content", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    text: z.string().describe("The text content to analyze"),
    options: z.object({}).optional().describe("Analysis options")
  }
}, withAuth("analyze_content", async ({ text, options }) => {
  try {
    if (!text) {
      return { content: [{ type: "text", text: "Text parameter is required" }], isError: true };
    }
    const result = await analyzeContentTool.execute({ text, options });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Content analysis failed: ${error.message}` }], isError: true };
  }
}));

// Tool: extract_structured
server.registerTool("extract_structured", {
  description: "Use this when you need a specific data shape extracted from a page using a JSON schema — e.g. product details, job listings, event data. Uses LLM by default; falls back to CSS selectors when no LLM is configured. Example: extract_structured({url: \"https://jobs.example.com/post/123\", schema: {properties: {title: {type:\"string\"}, salary: {type:\"string\"}}, required:[\"title\"]}})",
  annotations: { title: "Extract Structured Data", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to extract structured data from"),
    schema: z.object({
      type: z.string().optional(),
      properties: z.record(z.any()),
      required: z.array(z.string()).optional()
    }).describe("JSON schema defining the data structure to extract"),
    prompt: z.string().optional().describe("Natural language instructions for extraction"),
    llmConfig: z.object({
      provider: z.string().optional(),
      apiKey: z.string().optional()
    }).optional().describe("LLM provider configuration for AI-powered extraction"),
    fallbackToSelectors: z.boolean().optional().default(true).describe("Fall back to CSS selector extraction if LLM is unavailable"),
    selectorHints: z.record(z.string()).optional().describe("CSS selector hints to guide extraction")
  }
}, withAuth("extract_structured", async ({ url, schema, prompt, llmConfig, fallbackToSelectors, selectorHints }) => {
  try {
    const result = await extractStructuredTool.execute({ url, schema, prompt, llmConfig, fallbackToSelectors, selectorHints });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Structured extraction failed: ${error.message}` }], isError: true };
  }
}));

// Tool: extract_with_llm
server.registerTool("extract_with_llm", {
  description: "Extract structured data from a URL or text using a natural-language prompt. Defaults to a local Ollama model (http://localhost:11434, no API key required) — call list_ollama_models first to see what's installed and pass the name via the `model` parameter. Pass provider: \"openai\" or \"anthropic\" with the matching API key to use a cloud model instead.",
  annotations: { title: "Extract With LLM", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    url: z.string().url().optional().describe("URL to fetch and extract from (one of url/content required)"),
    content: z.string().optional().describe("Pre-fetched text to extract from (one of url/content required)"),
    prompt: z.string().describe("Natural-language extraction instruction"),
    schema: z.record(z.unknown()).optional().describe("Optional JSON-schema for output shape (used as Ollama structured-outputs format when provider is 'ollama')"),
    provider: z.enum(["openai", "anthropic", "ollama", "auto"]).optional().default("auto").describe("LLM provider. Defaults to 'ollama' (local, no key, http://localhost:11434). Use 'openai' or 'anthropic' for cloud models (requires the matching API key)."),
    model: z.string().optional().describe("Override the model. For ollama, pass a name returned by list_ollama_models (e.g. 'llama3.2', 'qwen2.5:7b'). Defaults: openai='gpt-4o-mini', anthropic='claude-haiku-4-5-20251001', ollama='llama3.2' or $OLLAMA_DEFAULT_MODEL."),
    maxTokens: z.number().optional().default(4096).describe("Maximum output tokens")
  }
}, withAuth("extract_with_llm", async (params) => {
  try {
    const result = await extractWithLlmTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `LLM extraction failed: ${error.message}` }], isError: true };
  }
}));

// Tool: list_ollama_models
server.registerTool("list_ollama_models", {
  description: "List the Ollama models installed locally on this machine. Use this to discover which `model` values you can pass to extract_with_llm. Requires Ollama running on http://localhost:11434 (or $OLLAMA_BASE_URL).",
  annotations: { title: "List Ollama Models", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {}
}, withAuth("list_ollama_models", async () => {
  try {
    const result = await listOllamaModelsTool.execute();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.success
    };
  } catch (error) {
    return { content: [{ type: "text", text: `Listing Ollama models failed: ${error.message}` }], isError: true };
  }
}));

// Tool: batch_scrape
server.registerTool("batch_scrape", {
  description: "Use this when you need to scrape 2–50 URLs in parallel — e.g. batch-collecting product pages, news articles, or competitor pages. Use mode:\"async\" with a webhook for large batches; mode:\"sync\" for up to ~25 URLs when you need results immediately. Example: batch_scrape({urls: [\"https://a.com\",\"https://b.com\"], formats: [\"json\"], maxConcurrency: 5})",
  annotations: { title: "Batch Scrape", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
    ])).min(1).max(50).describe("Array of URLs or URL objects to scrape"),
    formats: z.array(z.enum(['markdown', 'html', 'json', 'text'])).default(['json']).describe("Output formats for scraped content"),
    mode: z.enum(['sync', 'async']).default('sync').describe("Processing mode: sync (wait) or async (background)"),
    webhook: z.object({
      url: z.string().url(),
      events: z.array(z.string()).optional().default(['batch_completed', 'batch_failed']),
      headers: z.record(z.string()).optional(),
      signingSecret: z.string().optional()
    }).optional().describe("Webhook configuration for async job notifications"),
    extractionSchema: z.record(z.string()).optional().describe("Schema for structured data extraction from each URL"),
    maxConcurrency: z.number().min(1).max(20).default(10).describe("Maximum concurrent scraping requests"),
    delayBetweenRequests: z.number().min(0).max(10000).default(100).describe("Delay in milliseconds between requests"),
    includeMetadata: z.boolean().default(true).describe("Include page metadata in results"),
    includeFailed: z.boolean().default(true).describe("Include failed URLs in results"),
    pageSize: z.number().min(1).max(100).default(25).describe("Number of results per page"),
    jobOptions: z.object({
      priority: z.number().default(0),
      ttl: z.number().min(60000).default(24 * 60 * 60 * 1000),
      maxRetries: z.number().min(0).max(5).default(1),
      tags: z.array(z.string()).default([])
    }).optional().describe("Job management options for async processing")
  }
}, withAuth("batch_scrape", async (params) => {
  try {
    const result = await batchScrapeTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Batch scrape failed: ${error.message}` }], isError: true };
  }
}));

// Tool: get_batch_results — C3: retrieve paginated results for a completed batch
server.registerTool("get_batch_results", {
  description: "Retrieve paginated results for a completed or in-progress batch_scrape job. Use the batchId returned by batch_scrape. Example: get_batch_results({batchId: \"batch_1234567890_abc\", page: 2, pageSize: 25})",
  annotations: { title: "Get Batch Results", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    batchId: z.string().describe("The batch ID returned by batch_scrape"),
    page: z.number().min(1).default(1).describe("Page number (1-based)"),
    pageSize: z.number().min(1).max(100).default(25).describe("Number of results per page")
  }
}, withAuth("get_batch_results", async ({ batchId, page = 1, pageSize = 25 }) => {
  try {
    if (!batchId) {
      return { content: [{ type: "text", text: "batchId parameter is required" }], isError: true };
    }
    const result = await batchScrapeTool.getBatchResults(batchId, page, pageSize);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `get_batch_results failed: ${error.message}` }], isError: true };
  }
}));

// Tool: scrape_with_actions
server.registerTool("scrape_with_actions", {
  description: "Use this when you need to interact with a page before scraping — login, click buttons, fill forms, scroll, or wait for dynamic content to load. Use for SPAs, login-gated content, or multi-step flows. Screenshots from this tool are stored as crawlforge://screenshot/{actionId} resources. Example: scrape_with_actions({url: \"https://app.com/dashboard\", actions: [{type:\"click\",selector:\"#login\"},{type:\"type\",selector:\"#email\",text:\"user@a.com\"}]})",
  annotations: { title: "Scrape with Browser Actions", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to scrape"),
    actions: z.array(z.object({
      type: z.enum(['wait', 'click', 'type', 'press', 'scroll', 'screenshot', 'executeJavaScript']),
      selector: z.string().optional(),
      text: z.string().optional(),
      key: z.string().optional(),
      script: z.string().optional(),
      timeout: z.number().optional(),
      description: z.string().optional(),
      continueOnError: z.boolean().optional(),
      retries: z.number().min(0).max(5).optional(),
      captureAfter: z.boolean().optional().describe("Capture page content after this action"),
      // wait
      duration: z.number().min(0).max(30000).optional().describe("wait: milliseconds to wait"),
      condition: z.enum(['visible', 'hidden', 'enabled', 'disabled', 'stable']).optional().describe("wait: condition on selector"),
      // click
      button: z.enum(['left', 'right', 'middle']).optional().describe("click: mouse button"),
      clickCount: z.number().min(1).max(3).optional().describe("click: number of clicks"),
      delay: z.number().min(0).max(1000).optional().describe("click/type: delay in ms"),
      force: z.boolean().optional().describe("click: bypass actionability checks"),
      position: z.object({ x: z.number(), y: z.number() }).optional().describe("click: relative position"),
      // type
      clear: z.boolean().optional().describe("type: clear field before typing"),
      // press
      modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional().describe("press: modifier keys"),
      // scroll
      direction: z.enum(['up', 'down', 'left', 'right']).optional().describe("scroll: direction"),
      distance: z.number().min(0).optional().describe("scroll: pixels to scroll"),
      smooth: z.boolean().optional().describe("scroll: smooth scrolling"),
      toElement: z.string().optional().describe("scroll: selector to scroll to"),
      // screenshot
      fullPage: z.boolean().optional().describe("screenshot: capture full page"),
      quality: z.number().min(0).max(100).optional().describe("screenshot: jpeg quality"),
      format: z.enum(['png', 'jpeg']).optional().describe("screenshot: image format"),
      // executeJavaScript
      args: z.array(z.any()).optional().describe("executeJavaScript: arguments passed to the script"),
      returnResult: z.boolean().optional().describe("executeJavaScript: return the script result")
    })).min(1).max(20).describe("Browser actions to perform before scraping"),
    formats: z.array(z.enum(['markdown', 'html', 'json', 'text', 'screenshots'])).default(['json']).describe("Output formats for scraped content"),
    captureIntermediateStates: z.boolean().default(false).describe("Capture page state after each action"),
    captureScreenshots: z.boolean().default(true).describe("Take screenshots during action execution"),
    formAutoFill: z.object({
      fields: z.array(z.object({
        selector: z.string(),
        value: z.string(),
        type: z.enum(['text', 'select', 'checkbox', 'radio', 'file']).default('text'),
        waitAfter: z.number().min(0).max(5000).default(100)
      })),
      submitSelector: z.string().optional(),
      waitAfterSubmit: z.number().min(0).max(30000).default(2000)
    }).optional().describe("Form auto-fill configuration"),
    browserOptions: z.object({
      headless: z.boolean().default(true),
      userAgent: z.string().optional(),
      viewportWidth: z.number().min(800).max(1920).default(1280),
      viewportHeight: z.number().min(600).max(1080).default(720),
      timeout: z.number().min(10000).max(120000).default(30000)
    }).optional().describe("Browser configuration options"),
    extractionOptions: z.object({
      selectors: z.record(z.string()).optional(),
      includeMetadata: z.boolean().default(true),
      includeLinks: z.boolean().default(true),
      includeImages: z.boolean().default(true)
    }).optional().describe("Content extraction options"),
    continueOnActionError: z.boolean().default(false).describe("Continue executing actions if one fails"),
    maxRetries: z.number().min(0).max(3).default(1).describe("Maximum retry attempts on failure"),
    screenshotOnError: z.boolean().default(true).describe("Capture screenshot when an error occurs")
  }
}, withAuth("scrape_with_actions", async (params) => {
  try {
    const result = await scrapeWithActionsTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Scrape with actions failed: ${error.message}` }], isError: true };
  }
}));

// Tool: deep_research
server.registerTool("deep_research", {
  description: "Use this when you need exhaustive multi-source research on a topic — it searches the web, fetches and analyses sources, detects conflicts, and (when LLM keys or Ollama are configured) synthesizes a report. Best for complex questions needing 10+ sources. Will request confirmation (elicitation) if maxUrls > 50. Results are stored as crawlforge://research/{sessionId} resources. Example: deep_research({topic: \"quantum computing NISQ devices 2025\", maxUrls: 30, researchApproach: \"academic\"})",
  annotations: { title: "Deep Research", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    topic: z.string().min(3).max(500).describe("Research topic or question"),
    maxDepth: z.number().min(1).max(10).optional().default(5).describe("Maximum research depth"),
    maxUrls: z.number().min(1).max(1000).optional().default(50).describe("Maximum URLs to analyze"),
    timeLimit: z.number().min(30000).max(300000).optional().default(120000).describe("Time limit in milliseconds for the research"),
    researchApproach: z.enum(['broad', 'focused', 'academic', 'current_events', 'comparative']).optional().default('broad').describe("Research methodology approach"),
    sourceTypes: z.array(z.enum(['academic', 'news', 'government', 'commercial', 'blog', 'wiki', 'any'])).optional().default(['any']).describe("Types of sources to include"),
    credibilityThreshold: z.number().min(0).max(1).optional().default(0.3).describe("Minimum credibility score for sources (0-1)"),
    includeRecentOnly: z.boolean().optional().default(false).describe("Only include recent sources"),
    enableConflictDetection: z.boolean().optional().default(true).describe("Detect conflicting information across sources"),
    enableSourceVerification: z.boolean().optional().default(true).describe("Verify source credibility"),
    enableSynthesis: z.boolean().optional().default(true).describe("Synthesize findings into a coherent report"),
    outputFormat: z.enum(['comprehensive', 'summary', 'citations_only', 'conflicts_focus']).optional().default('comprehensive').describe("Output format for the research report"),
    includeRawData: z.boolean().optional().default(false).describe("Include raw scraped data in output"),
    includeActivityLog: z.boolean().optional().default(false).describe("Include detailed activity log"),
    queryExpansion: z.object({
      enableSynonyms: z.boolean().optional().default(true),
      enableSpellCheck: z.boolean().optional().default(true),
      enableContextual: z.boolean().optional().default(true),
      maxVariations: z.number().min(1).max(20).optional().default(8)
    }).optional().describe("Query expansion settings for broader search coverage"),
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
    }).optional().describe("LLM provider configuration for AI-powered analysis"),
    concurrency: z.number().min(1).max(20).optional().default(5).describe("Number of concurrent research requests"),
    cacheResults: z.boolean().optional().default(true).describe("Cache research results for reuse"),
    webhook: z.object({
      url: z.string().url(),
      events: z.array(z.enum(['started', 'progress', 'completed', 'failed'])).optional().default(['completed']),
      headers: z.record(z.string()).optional()
    }).optional().describe("Webhook for progress and completion notifications")
  }
}, withAuth("deep_research", async (params) => {
  try {
    const result = await deepResearchTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Deep research failed: ${error.message}` }], isError: true };
  }
}));

// Tool: scrape (D4 D1 — unified multi-format single-fetch)
server.registerTool("scrape", {
  description: "Use this when you need multiple content formats from a single URL in one call — e.g. markdown + links + metadata together. One fetch, no N-request fan-out. Formats: \"markdown\", \"html\", \"rawHtml\", \"text\", \"links\", \"metadata\", or {type:\"json\",schema,prompt} for LLM-structured extraction. onlyMainContent:true (default) strips boilerplate via Readability. Partial success: per-format warnings never fail the whole call. Example: scrape({url:\"https://example.com\", formats:[\"markdown\",\"links\",\"metadata\"]})",
  annotations: { title: "Scrape (Multi-Format)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to scrape"),
    formats: z.array(z.union([
      z.enum(["markdown", "html", "rawHtml", "text", "links", "metadata", "screenshot"]),
      z.object({
        type: z.literal("json"),
        schema: z.record(z.any()).optional().describe("JSON schema for extraction"),
        prompt: z.string().optional().describe("Extraction instruction for the LLM")
      })
    ])).min(1).optional().default(["markdown"]).describe("Formats to return (default: [\"markdown\"])"),
    onlyMainContent: z.boolean().optional().default(true).describe("Strip boilerplate via Readability (default: true)"),
    timeoutMs: z.number().min(1000).max(60000).optional().default(15000).describe("Fetch timeout in ms")
  }
}, withAuth("scrape", async (params) => {
  try {
    const result = await unifiedScrapeTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Scrape failed: ${error.message}` }], isError: true };
  }
}));

// Tool: agent (D4 D2 — autonomous NL prompt → search/navigate/extract)
server.registerTool("agent", {
  description: "Use this when you need an autonomous agent to research, navigate, and synthesise an answer from the web — no URLs required. The agent plans search queries, fetches and filters relevant pages, and returns a prose or structured answer. model:\"pro\" uses deep multi-source research. Hard limits: maxSteps≤10, maxUrls≤20, 120s wall-clock. Confirms before pro runs. Degraded-but-useful output if no LLM keys/Ollama. Example: agent({prompt:\"What are the top 5 MCP servers in 2025?\", maxUrls:10})",
  annotations: { title: "Agent (Autonomous)", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    prompt: z.string().min(1).max(2000).describe("Natural-language task or question"),
    urls: z.array(z.string().url()).max(20).optional().describe("Optional seed URLs to include (max 20)"),
    schema: z.record(z.any()).optional().describe("Optional JSON schema for structured output"),
    model: z.enum(["default", "pro"]).optional().default("default").describe("\"default\" = SamplingClient loop (no keys needed); \"pro\" = full ResearchOrchestrator"),
    maxSteps: z.number().min(1).max(10).optional().default(5).describe("Max fetch iterations (hard cap: 10)"),
    maxUrls: z.number().min(1).max(20).optional().default(10).describe("Max URLs to fetch (hard cap: 20)")
  }
}, withAuth("agent", async (params) => {
  try {
    const result = await agentTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Agent failed: ${error.message}` }], isError: true };
  }
}));

// Tool: track_changes
server.registerTool("track_changes", {
  description: "Use this when you need to monitor a URL for content changes over time — e.g. competitor pricing, regulation updates, product availability. Start with operation:\"create_baseline\", then periodically use operation:\"compare\" to diff. Supports webhooks and scheduled monitoring. Example: track_changes({url: \"https://example.com/pricing\", operation: \"create_baseline\"})",
  annotations: { title: "Track Changes", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The URL to track changes for"),
    operation: z.enum([
      'create_baseline', 'compare', 'monitor', 'get_history', 'get_stats',
      'create_scheduled_monitor', 'stop_scheduled_monitor', 'get_dashboard',
      'export_history', 'create_alert_rule', 'generate_trend_report', 'get_monitoring_templates'
    ]).default('compare').describe("Tracking operation to perform"),
    content: z.string().optional().describe("Content to compare against baseline"),
    html: z.string().optional().describe("HTML content to compare against baseline"),
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
    }).optional().describe("Options for how changes are tracked and compared"),
    monitoringOptions: z.object({
      enabled: z.boolean().default(false),
      interval: z.number().min(60000).max(24 * 60 * 60 * 1000).default(300000),
      maxRetries: z.number().min(0).max(5).default(3),
      retryDelay: z.number().min(1000).max(60000).default(5000),
      notificationThreshold: z.enum(['minor', 'moderate', 'major', 'critical']).default('moderate'),
      enableWebhook: z.boolean().default(false),
      webhookUrl: z.string().url().optional(),
      webhookSecret: z.string().optional()
    }).optional().describe("Monitoring schedule and notification settings"),
    storageOptions: z.object({
      enableSnapshots: z.boolean().default(true),
      retainHistory: z.boolean().default(true),
      maxHistoryEntries: z.number().min(1).max(1000).default(100),
      compressionEnabled: z.boolean().default(true),
      deltaStorageEnabled: z.boolean().default(true)
    }).optional().describe("Storage and history retention settings"),
    queryOptions: z.object({
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      includeContent: z.boolean().default(false),
      significanceFilter: z.enum(['all', 'minor', 'moderate', 'major', 'critical']).optional()
    }).optional().describe("Query options for history and stats retrieval"),
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
    }).optional().describe("Notification configuration for webhooks and Slack"),
    scheduledMonitorOptions: z.object({
      schedule: z.string().optional(),
      templateId: z.string().optional(),
      enabled: z.boolean().default(true)
    }).optional().describe("Scheduled monitoring options with cron expressions"),
    alertRuleOptions: z.object({
      ruleId: z.string().optional(),
      condition: z.string().optional(),
      actions: z.array(z.enum(['webhook', 'email', 'slack'])).optional(),
      throttle: z.number().min(0).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional()
    }).optional().describe("Alert rule configuration for change notifications"),
    exportOptions: z.object({
      format: z.enum(['json', 'csv']).default('json'),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      includeContent: z.boolean().default(false),
      includeSnapshots: z.boolean().default(false)
    }).optional().describe("Export options for change history data"),
    dashboardOptions: z.object({
      includeRecentAlerts: z.boolean().default(true),
      includeTrends: z.boolean().default(true),
      includeMonitorStatus: z.boolean().default(true)
    }).optional().describe("Dashboard display options")
  }
}, withAuth("track_changes", async (params) => {
  try {
    const result = await trackChangesTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Change tracking failed: ${error.message}` }], isError: true };
  }
}));

// Tool: generate_llms_txt
server.registerTool("generate_llms_txt", {
  description: "Use this when you need to generate an llms.txt file for a website — the standard that tells AI models how to interact with a site's content. Useful for site owners preparing for AI discoverability, or for understanding a site's AI access policy. Example: generate_llms_txt({url: \"https://example.com\"})",
  annotations: { title: "Generate llms.txt", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    url: z.string().url().describe("The website URL to generate llms.txt for"),
    analysisOptions: z.object({
      maxDepth: z.number().min(1).max(5).optional().default(3),
      maxPages: z.number().min(10).max(500).optional().default(100),
      detectAPIs: z.boolean().optional().default(true),
      analyzeContent: z.boolean().optional().default(true),
      checkSecurity: z.boolean().optional().default(true),
      respectRobots: z.boolean().optional().default(true)
    }).optional().describe("Website analysis options for depth, scope, and detection"),
    outputOptions: z.object({
      includeDetailed: z.boolean().optional().default(true),
      includeAnalysis: z.boolean().optional().default(false),
      contactEmail: z.string().email().optional(),
      organizationName: z.string().optional(),
      customGuidelines: z.array(z.string()).optional(),
      customRestrictions: z.array(z.string()).optional()
    }).optional().describe("Output customization and organization details"),
    complianceLevel: z.enum(['basic', 'standard', 'strict']).optional().default('standard').describe("Compliance level for generated guidelines"),
    format: z.enum(['both', 'llms-txt', 'llms-full-txt']).optional().default('both').describe("Output format: llms.txt, llms-full.txt, or both")
  }
}, withAuth("generate_llms_txt", async (params) => {
  try {
    const result = await generateLLMsTxtTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `LLMs.txt generation failed: ${error.message}` }], isError: true };
  }
}));

// Tool: stealth_mode
server.registerTool("stealth_mode", {
  description: "Use this when a site blocks normal scraping — Cloudflare, Datadome, or other bot-detection systems. Manages a Playwright browser with randomized fingerprints, human behavior simulation, WebRTC/canvas spoofing. Start with operation:\"create_context\" then use the contextId. Example: stealth_mode({operation:\"create_context\", stealthConfig:{level:\"advanced\", simulateHumanBehavior:true}})",
  annotations: { title: "Stealth Mode", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    operation: z.enum(['configure', 'enable', 'disable', 'create_context', 'create_page', 'get_stats', 'cleanup']).default('configure').describe("Stealth operation to perform"),
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
    }).optional().describe("Stealth browser configuration with anti-detection settings"),
    engine: z.enum(["playwright", "camoufox"]).optional().default("playwright").describe("Browser engine: \"playwright\" (Chromium, default) or \"camoufox\" (Firefox-based, higher anti-detect score — install with npm install camoufox)"),
    contextId: z.string().optional().describe("Browser context ID for page operations"),
    urlToTest: z.string().url().optional().describe("URL to navigate to when creating a page")
  }
}, withAuth("stealth_mode", async ({ operation, stealthConfig, contextId, urlToTest }) => {
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
      case 'create_context': {
        const contextData = await stealthBrowserManager.createStealthContext(stealthConfig);
        result = { contextId: contextData.contextId, fingerprint: contextData.fingerprint, created: true };
        break;
      }
      case 'create_page': {
        if (!contextId) throw new Error('contextId is required for create_page operation');
        const page = await stealthBrowserManager.createStealthPage(contextId);
        let navigation = null;
        if (urlToTest) {
          // page.goto returns a Playwright Response handle, which is not
          // JSON-serializable — extract just the useful navigation details.
          const response = await page.goto(urlToTest);
          navigation = {
            requestedUrl: urlToTest,
            finalUrl: page.url(),
            status: response ? response.status() : null,
            ok: response ? response.ok() : null,
            title: await page.title().catch(() => null)
          };
        }
        result = { pageCreated: true, contextId, navigation };
        break;
      }
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Stealth mode operation failed: ${error.message}` }], isError: true };
  }
}));

// Tool: localization
server.registerTool("localization", {
  description: "Use this when you need to scrape geo-restricted content or emulate a specific locale/timezone — e.g. seeing region-specific pricing, bypassing geo-blocks, or searching in another language. Use operation:\"configure_country\" to set country context. Example: localization({operation:\"configure_country\", countryCode:\"DE\", language:\"de\"})",
  annotations: { title: "Localization", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    operation: z.enum(['configure_country', 'localize_search', 'localize_browser', 'generate_timezone_spoof', 'handle_geo_blocking', 'auto_detect', 'get_stats', 'get_supported_countries']).default('configure_country').describe("Localization operation to perform"),
    countryCode: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code"),
    language: z.string().optional().describe("Language code (e.g. 'en', 'fr', 'de')"),
    timezone: z.string().optional().describe("IANA timezone identifier (e.g. 'America/New_York')"),
    currency: z.string().length(3).optional().describe("ISO 4217 currency code (e.g. 'USD', 'EUR')"),
    customHeaders: z.record(z.string()).optional().describe("Custom HTTP headers for localized requests"),
    userAgent: z.string().optional().describe("Custom user agent string"),
    acceptLanguage: z.string().optional().describe("Accept-Language header value"),
    geoLocation: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(1).max(100).optional()
    }).optional().describe("GPS coordinates for geolocation emulation"),
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
    }).optional().describe("Proxy configuration for geo-targeted requests"),
    searchParams: z.object({
      query: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      headers: z.record(z.string()).optional()
    }).optional().describe("Search parameters for localized search queries"),
    browserOptions: z.object({
      locale: z.string().optional(),
      timezoneId: z.string().optional(),
      extraHTTPHeaders: z.record(z.string()).optional(),
      userAgent: z.string().optional()
    }).optional().describe("Browser context options for locale emulation"),
    content: z.string().optional().describe("Content for auto-detection of language and locale"),
    url: z.string().url().optional().describe("URL for geo-blocking detection or auto-detection"),
    response: z.object({
      status: z.number(),
      body: z.string().optional(),
      statusText: z.string().optional()
    }).optional().describe("HTTP response for geo-blocking analysis")
  }
}, withAuth("localization", async (params) => {
  try {
    const { operation } = params;
    let result;
    switch (operation) {
      case 'configure_country':
        if (!params.countryCode) throw new Error('countryCode is required for configure_country operation');
        result = await localizationManager.configureCountry(params.countryCode, params);
        break;
      case 'localize_search':
        if (!params.searchParams) throw new Error('searchParams is required for localize_search operation');
        result = await localizationManager.localizeSearchQuery(params.searchParams, params.countryCode);
        break;
      case 'localize_browser':
        if (!params.browserOptions) throw new Error('browserOptions is required for localize_browser operation');
        result = await localizationManager.localizeBrowserContext(params.browserOptions, params.countryCode);
        break;
      case 'generate_timezone_spoof':
        result = {
          timezoneScript: await localizationManager.generateTimezoneSpoof(params.countryCode),
          countryCode: params.countryCode || localizationManager.getCurrentSettings().countryCode
        };
        break;
      case 'handle_geo_blocking':
      case 'detect_geo_blocking':
        if (!params.url || !params.response) throw new Error('url and response are required for detect_geo_blocking operation');
        result = await localizationManager.detectGeoBlocking(params.url, params.response);
        break;
      case 'auto_detect':
        if (!params.content || !params.url) throw new Error('content and url are required for auto_detect operation');
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Localization operation failed: ${error.message}` }], isError: true };
  }
}));


// Tool: scrape_template (D3.3 — pre-built site templates)
server.registerTool("scrape_template", {
  description: "Use this when you want structured data from a well-known site without writing custom selectors. Pass template:\"list\" to see all available templates. Supports: amazon-product, linkedin-profile, github-repo, youtube-video, tweet, reddit-thread, hacker-news-front-page, producthunt-launch, stackoverflow-question, npm-package. Example: scrape_template({template:\"github-repo\", url:\"https://github.com/user/repo\"})",
  annotations: { title: "Scrape Template", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    template: z.string().describe("Template ID (e.g. github-repo) or list to enumerate available templates"),
    url: z.string().url().optional().describe("URL to scrape — required unless template is list"),
    timeout: z.number().min(5000).max(60000).optional().default(15000).describe("Request timeout in milliseconds")
  }
}, withAuth("scrape_template", async (params) => {
  try {
    const result = await scrapeTemplateTool.execute(params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Template scrape failed: ${error.message}` }], isError: true };
  }
}));

// ─── Transport + startup ───────────────────────────────────────────────────────

const useHttp = process.argv.includes('--http') || process.env.MCP_HTTP === 'true';
const useLegacyHttp = process.argv.includes('--legacy-http') || process.env.CRAWLFORGE_LEGACY_HTTP === 'true';

async function runServer() {
  if (useHttp) {
    // Default to 10000 to match Render's default port-scan target and the
    // Dockerfile `EXPOSE 10000`. Most PaaS providers inject $PORT — we honor it.
    const port = parseInt(process.env.PORT || '10000', 10);

    if (useLegacyHttp) {
      // One-release deprecation window for stateless legacy transport.
      console.error('WARNING: --legacy-http is deprecated and will be removed in v3.3.0. Use the default Streamable HTTP transport.');
      await connectHttp(server, AuthManager, logger, port);
    } else {
      // OAuth (opt-in)
      let oauthProvider = null;
      if (process.env.CRAWLFORGE_OAUTH_ENABLED === 'true') {
        const issuer = process.env.CRAWLFORGE_OAUTH_ISSUER || `http://localhost:${port}`;
        const apiKey = AuthManager.getConfig()?.apiKey;
        if (!apiKey) {
          console.error('OAuth enabled but no CrawlForge API key is configured — falling back to static-key auth.');
        } else {
          oauthProvider = createOAuthProvider({ issuer, apiKey, logger });
          console.error(`OAuth 2.1 enabled — discovery at ${issuer}/.well-known/oauth-authorization-server`);
        }
      }

      await connectStreamableHttp(server, AuthManager, logger, {
        port,
        legacy: false,
        oauth: oauthProvider,
        metrics
      });
    }
  } else {
    await connectStdio(server);
  }

  console.error(`Environment: ${config.server.nodeEnv}`);
  console.error("Search enabled: true (via CrawlForge proxy)");

  const allTools = [
    "fetch_url", "extract_text", "extract_links", "extract_metadata", "scrape_structured",
    "search_web", "crawl_deep", "map_site",
    "extract_content", "process_document", "summarize_content", "analyze_content",
    "batch_scrape", "get_batch_results", "scrape_with_actions",
    "deep_research", "track_changes", "generate_llms_txt",
    "stealth_mode", "localization", "extract_structured", "extract_with_llm",
    "list_ollama_models", "scrape_template", // D3.3
    "scrape", "agent"  // D4
  ];
  console.error(`Tools available (26): ${allTools.join(", ")}`);

  // Start memory monitoring in development
  if (config.server.nodeEnv === "development") {
    memoryMonitor.start();
    console.error("Memory monitoring started");
  }
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.error("Force shutdown...");
    process.exit(1);
  }

  isShuttingDown = true;
  console.error(`Received ${signal}. Starting graceful shutdown...`);

  try {
    const toolsToCleanup = [
      batchScrapeTool, scrapeWithActionsTool, deepResearchTool,
      trackChangesTool, generateLLMsTxtTool, stealthBrowserManager,
      localizationManager, extractStructuredTool,
      agentTool // D4 D2: may hold ResearchOrchestrator
    ].filter(tool => tool && (typeof tool.destroy === 'function' || typeof tool.cleanup === 'function'));

    console.error(`Cleaning up ${toolsToCleanup.length} tools...`);

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
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);

    if (memoryMonitor.isMonitoring) {
      memoryMonitor.stop();
      console.error("Memory monitoring stopped");
    }

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

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  // Keep the long-running stdio server alive: a single uncaught error in one
  // request path should not tear down the session for every other tool. We log
  // and continue rather than exiting. (Node considers the process state
  // technically undefined after this; acceptable trade-off for a resilient MCP
  // server, vs. disconnecting the client on any stray throw.)
  console.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
  // A stray rejection — typically background async work inside a single tool —
  // must NOT terminate the whole stdio MCP server, which would disconnect every
  // other tool mid-session. Log it and keep serving.
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Memory monitoring (development only)
if (config.server.nodeEnv === 'development') {
  setInterval(() => {
    const usage = process.memoryUsage();
    const memoryMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
    if (memoryMB > 200) {
      console.error(`Memory usage: ${memoryMB}MB (high usage detected)`);
    }
  }, 60000);
}

runServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
