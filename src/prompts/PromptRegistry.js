/**
 * PromptRegistry — MCP Prompts for CrawlForge
 * Pre-defined workflows as MCP prompts the client can list and invoke.
 */

export const PROMPTS = [
  {
    name: 'competitive-analysis',
    description: 'Analyze competitor websites against your own to surface positioning, feature gaps, and SEO differences.',
    arguments: [
      { name: 'competitor_urls', description: 'Comma-separated list of competitor URLs to analyze', required: true },
      { name: 'our_url', description: 'Your website URL for comparison', required: true },
    ],
  },
  {
    name: 'monitor-changes',
    description: 'Set up continuous monitoring for content changes on a URL with webhook notifications.',
    arguments: [
      { name: 'url', description: 'URL to monitor for changes', required: true },
      { name: 'interval', description: 'Check interval in seconds (default: 3600)', required: false },
      { name: 'webhook', description: 'Webhook URL for change notifications', required: false },
    ],
  },
  {
    name: 'rag-ingest',
    description: 'Scrape and convert one or more URLs into clean markdown suitable for RAG ingestion pipelines.',
    arguments: [
      { name: 'urls', description: 'Comma-separated list of URLs to ingest', required: true },
      { name: 'output_format', description: 'Output format: markdown (default) or text', required: false },
    ],
  },
  {
    name: 'site-audit',
    description: 'Comprehensive site audit: discovers all pages, extracts metadata, and generates an llms.txt summary.',
    arguments: [
      { name: 'url', description: 'Website URL to audit', required: true },
    ],
  },
  {
    name: 'research-deep-dive',
    description: 'Conduct exhaustive multi-source research on a topic with synthesis, conflict detection, and citations.',
    arguments: [
      { name: 'topic', description: 'Research topic or question', required: true },
      { name: 'depth', description: 'Research depth: shallow | medium | deep (default: medium)', required: false },
    ],
  },
];

/**
 * Generate the prompt messages for a given prompt name and arguments.
 * @param {string} name
 * @param {Record<string, string>} args
 * @returns {{ messages: Array<{ role: string, content: { type: string, text: string } }> }}
 */
export function getPromptMessages(name, args = {}) {
  switch (name) {
    case 'competitive-analysis': {
      const competitors = args.competitor_urls || '';
      const ourUrl = args.our_url || '';
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Conduct a comprehensive competitive analysis.

Our website: ${ourUrl}
Competitors: ${competitors}

Steps to follow:
1. Use fetch_url or extract_content on each competitor URL and our URL.
2. Use extract_metadata on all URLs to compare titles, descriptions, and keywords.
3. Use analyze_content to surface content quality, topics, and tone differences.
4. Use map_site on each domain to compare site structure and depth.
5. Summarize: positioning gaps, feature differences, SEO opportunities, and recommended actions.

Return a structured report with sections: Overview, Competitor Profiles, Gap Analysis, Recommendations.`,
          },
        }],
      };
    }

    case 'monitor-changes': {
      const url = args.url || '';
      const interval = args.interval || '3600';
      const webhook = args.webhook || '';
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Set up change monitoring for: ${url}

Configuration:
- Check interval: ${interval} seconds
- Webhook URL: ${webhook || '(none — report changes inline)'}

Steps:
1. Use track_changes with the URL to establish a baseline snapshot.
2. Configure the check interval and webhook if provided.
3. Report back the monitoring session ID and confirm setup.
4. If no webhook is provided, describe how to retrieve changes later using track_changes.`,
          },
        }],
      };
    }

    case 'rag-ingest': {
      const urls = args.urls || '';
      const outputFormat = args.output_format || 'markdown';
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Ingest the following URLs for RAG (Retrieval-Augmented Generation):

URLs: ${urls}
Output format: ${outputFormat}

Steps:
1. Use batch_scrape with the URL list to fetch all pages in parallel.
2. Use extract_content on each result to extract clean, readable content.
3. Convert content to ${outputFormat} format — remove navigation, ads, and boilerplate.
4. Return each document with: URL, title, word count, and clean ${outputFormat} body.
5. Flag any URLs that failed to load.

The output should be ready for chunking and embedding.`,
          },
        }],
      };
    }

    case 'site-audit': {
      const url = args.url || '';
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Perform a comprehensive site audit for: ${url}

Steps:
1. Use map_site to discover all pages and site structure.
2. Use extract_metadata on the homepage and top-level pages.
3. Use generate_llms_txt to produce the site's AI-readable summary.
4. Use analyze_content on the homepage to assess content quality and topics.
5. Report:
   - Total pages discovered
   - Site structure overview
   - Metadata completeness (missing titles, descriptions)
   - Content quality assessment
   - llms.txt summary
   - Recommendations for improvement`,
          },
        }],
      };
    }

    case 'research-deep-dive': {
      const topic = args.topic || '';
      const depth = args.depth || 'medium';
      const depthConfig = {
        shallow: { maxUrls: 20, maxDepth: 3 },
        medium: { maxUrls: 50, maxDepth: 5 },
        deep: { maxUrls: 150, maxDepth: 8 },
      };
      const cfg = depthConfig[depth] || depthConfig.medium;
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Conduct a deep research investigation on the following topic:

Topic: ${topic}
Depth: ${depth} (max ${cfg.maxUrls} sources, depth ${cfg.maxDepth})

Steps:
1. Use deep_research with topic="${topic}", maxUrls=${cfg.maxUrls}, maxDepth=${cfg.maxDepth}.
2. If deep_research returns raw evidence (no synthesis), synthesize it yourself:
   - Group findings by sub-topic
   - Identify agreements and conflicts between sources
   - Rank sources by credibility
3. Return a structured report with:
   - Executive Summary
   - Key Findings (with citations)
   - Conflicting Information (if any)
   - Source Quality Assessment
   - Confidence Level and Gaps`,
          },
        }],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
