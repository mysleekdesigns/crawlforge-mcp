/**
 * ScrapeTemplateTool — wraps TemplateRegistry to expose the `scrape_template` MCP tool.
 *
 * Usage pattern (D3.3):
 *   const tool = new ScrapeTemplateTool();
 *   const result = await tool.execute({ template: "github-repo", url: "https://github.com/user/repo" });
 */

import { TemplateRegistry } from './TemplateRegistry.js';

export class ScrapeTemplateTool {
  constructor() {
    this.registry = new TemplateRegistry();
  }

  /**
   * Execute the scrape_template tool.
   * @param {{ template: string, url: string, timeout?: number }} params
   * @returns {Promise<object>}
   */
  async execute({ template, url, timeout = 15000 }) {
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

    // Fetch the page
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    let html;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CrawlForge-TemplateScraper/4.0)'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
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
    const result = await this.registry.run(template, html, url);
    return result;
  }
}

export default ScrapeTemplateTool;
