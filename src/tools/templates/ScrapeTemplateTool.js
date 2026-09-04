/**
 * ScrapeTemplateTool — wraps TemplateRegistry to expose the `scrape_template` MCP tool.
 *
 * Usage pattern (D3.3):
 *   const tool = new ScrapeTemplateTool();
 *   const result = await tool.execute({ template: "github-repo", url: "https://github.com/user/repo" });
 *
 * Three ways in: a template id, `"auto"` (the registry picks the template from
 * the URL and the response names the one it chose), and `"list"`. A list
 * connector is driven by `params` rather than a URL and returns N entities from
 * one call — the registry builds the URL, this tool fetches it.
 */

import { TemplateRegistry, retiredTemplate, shopifyProductFromJsonLd } from 'crawlforge-extractors';
import { safeFetch } from '../../utils/ssrfGuard.js';
import { preflightFetch } from '../../utils/robotsGate.js';
import { noteRetryAfter } from '../../utils/hostRateLimiter.js';
import { markPreflightRefusal } from '../../server/requestContext.js';

/**
 * A caller mistake caught before anything is fetched: no template matches the
 * URL, a required list parameter is missing, a key-based connector has no key.
 * We fetched nothing, so — like a robots refusal — it costs the caller nothing.
 */
function badRequest(message) {
  markPreflightRefusal('BAD_REQUEST');
  return new Error(message);
}

export class ScrapeTemplateTool {
  /**
   * @param {{ templates?: object[] }} [config] `templates` replaces the shipped
   *   set; tests use it to exercise a connector shape nothing ships yet.
   */
  constructor(config = {}) {
    this.registry = new TemplateRegistry(config?.templates);
  }

  /** The catalogue — no network. */
  listTemplates() {
    const templates = this.registry.list();
    return { templates, count: templates.length };
  }

  /**
   * Execute the scrape_template tool.
   * @param {{ template: string, url?: string, params?: object, timeout?: number,
   *          user_agent?: string, respect_robots?: boolean }} request
   * @returns {Promise<object>}
   */
  async execute({ template, url, params, timeout = 15000, user_agent, respect_robots }) {
    if (template === 'list') return this.listTemplates();

    let templateId = template;
    if (template === 'auto') {
      if (!url) {
        throw badRequest(
          'template "auto" needs a url to detect from. Pass a url, or template:"list" to see every template.'
        );
      }
      const detected = this.registry.detect(url);
      if (!detected) {
        // A URL a withdrawn template used to handle gets the reason it is
        // gone, not "no template matches".
        const retired = retiredTemplate(url);
        if (retired) {
          throw badRequest(`The "${retired.id}" template that handled ${url} was retired: ${retired.reason}`);
        }
        throw badRequest(
          `No template matches ${url}. Pass template:"list" to see every template and the URLs ` +
          'each one handles, or name a template explicitly.'
        );
      }
      templateId = detected.id;
    } else if (!url && !params) {
      // A template named with nothing to run it against still lists, as before.
      return this.listTemplates();
    }

    // Validate template exists before making network call
    const tpl = this.registry.get(templateId);
    if (!tpl) {
      const retired = retiredTemplate(templateId);
      if (retired) {
        throw badRequest(`Template "${templateId}" was retired: ${retired.reason}`);
      }
      const available = this.registry.list().map(t => t.id).join(', ');
      throw new Error(`Unknown template "${templateId}". Available templates: ${available}`);
    }

    // A key-based connector is answered here or not at all: the registry never
    // reads process.env, and a missing key must not reach the target as a 401.
    let apiKey;
    if (tpl.requiresApiKey) {
      apiKey = process.env[tpl.credentialRef];
      if (!apiKey) {
        throw badRequest(
          `Template "${templateId}" reads an API-keyed endpoint. Set ${tpl.credentialRef} in the ` +
          'server environment and try again.'
        );
      }
    }

    // The URL actually fetched comes from one of three places. The robots gate
    // below runs against that URL, never the caller's input — listUrl in
    // particular reaches a host the caller never named.
    let fetchUrl;
    if (params && tpl.listUrl) {
      try {
        fetchUrl = tpl.listUrl(apiKey ? { ...params, apiKey } : params);
      } catch (error) {
        // listUrl throws naming the parameter it wanted: a caller mistake, not
        // a fetch that failed.
        throw badRequest(error.message);
      }
    } else if (!url) {
      throw badRequest(`Template "${templateId}" is reached by url, not params. Pass a url.`);
    } else {
      // A template may redirect its own fetch to a machine-readable endpoint
      // (shopify-product reads /products/<handle>.json). Same host either way,
      // so the SSRF guard below still applies.
      fetchUrl = tpl.resolveUrl ? tpl.resolveUrl(url) : url;
    }

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
        // shopify-product reads /products/<handle>.json; a store that refuses
        // that endpoint (gymshark.com: 403) or a handle that no longer exists
        // (allbirds.com: 404 after a redirect to a collection) still has the
        // public product page, whose JSON-LD carries the price (R18).
        if (templateId === 'shopify-product' && url && fetchUrl !== url && [401, 403, 404, 410].includes(response.status)) {
          return await this.shopifyPageFallback({ url, tpl, status: response.status, gate, respect_robots, user_agent, timeout });
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

    // What the response reports. A params-driven call named no URL, so the one
    // we built is the one to report — and the one the extractor quotes in its
    // own error messages. Except on a key-based connector, where that URL
    // carries the key: it goes into listUrl and nowhere else.
    const keyed = Boolean(tpl.requiresApiKey);
    const reportedUrl = url ?? (keyed ? undefined : fetchUrl);
    const reportedFetchUrl = keyed ? reportedUrl : fetchUrl;

    let echoParams;
    if (params) {
      echoParams = { ...params };
      delete echoParams.apiKey;
    }

    // Run the template extractor
    const result = tpl.extractList
      ? await this.registry.runList(templateId, html, { url: reportedUrl, params: echoParams })
      : await this.registry.run(templateId, html, reportedUrl, reportedFetchUrl);

    // run() stamps fetchedUrl itself; runList() does not.
    if (tpl.extractList && reportedFetchUrl !== reportedUrl) result.fetchedUrl = reportedFetchUrl;

    return gate.warnings.length > 0 ? { ...result, warnings: gate.warnings } : result;
  }
  /**
   * Read the product page itself when the .json endpoint was refused. The
   * page goes through the same robots gate and SSRF guard as any fetch.
   */
  async shopifyPageFallback({ url, tpl, status, respect_robots, user_agent, timeout }) {
    const pageGate = await preflightFetch(url, {
      respectRobots: respect_robots,
      userAgent: user_agent,
      tool: 'scrape_template'
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await safeFetch(url, { signal: controller.signal, headers: { ...pageGate.headers } });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      throw new Error(
        `HTTP ${status} from the products.json endpoint, and the product page ${url} answered HTTP ${response.status} too.`
      );
    }
    const finalUrl = response.url || url;
    const html = await response.text();
    const parsed = shopifyProductFromJsonLd(html, finalUrl);
    if (!parsed.found) {
      throw new Error(
        `HTTP ${status} from the products.json endpoint, and ${parsed.reason}` +
        (finalUrl !== url ? ` (the page redirected to ${finalUrl})` : '') + '.'
      );
    }
    const warnings = [
      `The store answered /products/<handle>.json with HTTP ${status}; this record was read from the product page's schema.org JSON-LD instead. ` +
      'Per-variant inventory, compare-at prices and option names are not in JSON-LD, so those fields are null.',
      ...pageGate.warnings
    ];
    return {
      template: tpl.id,
      template_name: tpl.name,
      url,
      fetchedUrl: finalUrl,
      data: parsed.data,
      extractedAt: new Date().toISOString(),
      warnings
    };
  }

}

export default ScrapeTemplateTool;
