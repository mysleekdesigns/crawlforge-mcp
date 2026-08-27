/**
 * ScrapeTemplateTool — wraps TemplateRegistry to expose the `scrape_template` MCP tool.
 *
 * Usage pattern (D3.3):
 *   const tool = new ScrapeTemplateTool();
 *   const result = await tool.execute({ template: "github-repo", url: "https://github.com/user/repo" });
 */

import { TemplateRegistry } from 'crawlforge-extractors';
import { safeFetch } from '../../utils/ssrfGuard.js';
import { preflightFetch } from '../../utils/robotsGate.js';
import { noteRetryAfter } from '../../utils/hostRateLimiter.js';

export class ScrapeTemplateTool {
  constructor() {
    this.registry = new TemplateRegistry();
  }

  /**
   * Execute the scrape_template tool.
   * @param {{ template: string, url: string, timeout?: number,
   *          user_agent?: string, respect_robots?: boolean }} params
   * @returns {Promise<object>}
   */
  async execute({ template, url, timeout = 15000, user_agent, respect_robots }) {
    // list mode — return available templates without scraping
    if (template === 'list' || !url) {
      return {
        templates: this.registry.list(),
        count: this.registry.list().length
      };
    }

    // Validate template exists before making network call
    const tpl = this.registry.get(template);
    if (!tpl) {
      const available = this.registry.list().map(t => t.id).join(', ');
      throw new Error(`Unknown template "${template}". Available templates: ${available}`);
    }

    // A template may redirect its own fetch to a machine-readable endpoint
    // (shopify-product reads /products/<handle>.json). Same host either way,
    // so the SSRF guard below still applies.
    const fetchUrl = template === 'list' ? url : (tpl.resolveUrl ? tpl.resolveUrl(url) : url);

    // Robots gate + per-host politeness before any request to the target.
    const gate = await preflightFetch(fetchUrl, {
      respectRobots: respect_robots,
      userAgent: user_agent,
      tool: 'scrape_template'
    });

    // Fetch the page
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    let html;
    try {
      const response = await safeFetch(fetchUrl, {
        signal: controller.signal,
        headers: { ...gate.headers }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          noteRetryAfter(fetchUrl, response.headers.get('retry-after'));
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      html = await response.text();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }

    // Run the template extractor
    const result = await this.registry.run(template, html, url, fetchUrl);
    return gate.warnings.length > 0 ? { ...result, warnings: gate.warnings } : result;
  }
}

export default ScrapeTemplateTool;
