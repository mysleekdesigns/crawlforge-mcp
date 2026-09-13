/**
 * ResourceRegistry — MCP Resources for CrawlForge
 * URI scheme: crawlforge://<type>/<id>
 * Exposes long-lived artifacts produced by tools as MCP Resources.
 */

import { createHash } from 'crypto';

/**
 * The stdio transport frames one JSON-RPC message at a time, and since SDK
 * 1.30 its ReadBuffer CLOSES the transport when a message runs past
 * STDIO_MESSAGE_CEILING_BYTES: the whole session dies, every tool with it, and
 * the overflow is not recoverable (modelcontextprotocol/typescript-sdk#2793).
 * A full-page PNG of a long article is 17.4 MB — en.wikipedia.org/wiki/World_War_II
 * is 61,341px tall — and JPEG only brings it to 11.3 MB, so neither format saves
 * a caller who passes full_page (R23, 2026-09-13).
 *
 * Hence a budget on the blob a read may emit: base64 costs four bytes per three,
 * and a tenth of the ceiling is left for the JSON-RPC envelope around it.
 */
const STDIO_MESSAGE_CEILING_BYTES = 10 * 1024 * 1024;
export const MAX_RESOURCE_BLOB_BYTES =
  Number(process.env.CRAWLFORGE_MAX_RESOURCE_BLOB_BYTES) ||
  Math.floor(STDIO_MESSAGE_CEILING_BYTES * 0.9 * 3 / 4);

/**
 * Supported resource types and their MIME types.
 */
const RESOURCE_MIME = {
  research: 'application/json',
  snapshot: 'text/html',
  job: 'application/json',
  crawl: 'application/json',
  screenshot: 'image/png',
};

/**
 * Parse a crawlforge:// URI into its components.
 * @param {string} uri
 * @returns {{ type: string, parts: string[] } | null}
 */
export function parseResourceUri(uri) {
  if (!uri || !uri.startsWith('crawlforge://')) return null;
  const rest = uri.slice('crawlforge://'.length);
  const [type, ...parts] = rest.split('/');
  if (!type || !RESOURCE_MIME[type]) return null;
  return { type, parts };
}

/**
 * Generate a URL hash for snapshot URIs.
 * @param {string} url
 * @returns {string}
 */
export function hashUrl(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export class ResourceRegistry {
  constructor({ researchOrchestrator, snapshotManager, jobManager, mapSiteTool, scrapeWithActionsTool } = {}) {
    this.researchOrchestrator = researchOrchestrator || null;
    this.snapshotManager = snapshotManager || null;
    this.jobManager = jobManager || null;
    this.mapSiteTool = mapSiteTool || null;
    this.scrapeWithActionsTool = scrapeWithActionsTool || null;

    // In-memory stores for lightweight resource tracking
    /** @type {Map<string, { data: any, createdAt: number, ttl: number }>} */
    this._crawlSitemaps = new Map(); // sessionId -> sitemap
    /** @type {Map<string, { data: Buffer, createdAt: number, ttl: number }>} */
    this._screenshots = new Map(); // actionId -> PNG buffer

    // Default TTL: 1 hour
    this.defaultTtl = 60 * 60 * 1000;
  }

  /**
   * Store a crawl sitemap result for later retrieval.
   * @param {string} sessionId
   * @param {object} sitemapData
   */
  storeCrawlSitemap(sessionId, sitemapData) {
    this._crawlSitemaps.set(sessionId, {
      data: sitemapData,
      createdAt: Date.now(),
      ttl: this.defaultTtl,
    });
  }

  /**
   * Store a screenshot for later retrieval.
   * @param {string} actionId
   * @param {Buffer|string} screenshotData - PNG buffer or base64 string
   */
  storeScreenshot(actionId, screenshotData) {
    const buf = Buffer.isBuffer(screenshotData)
      ? screenshotData
      : Buffer.from(screenshotData, 'base64');
    this._screenshots.set(actionId, {
      data: buf,
      createdAt: Date.now(),
      ttl: this.defaultTtl,
    });
    // Handed back so the tool that took the shot can say, in the same result
    // that carries the URI, whether that URI is readable over stdio at all.
    return {
      bytes: buf.length,
      withinInlineBudget: buf.length <= MAX_RESOURCE_BLOB_BYTES,
    };
  }

  /**
   * List all available resources.
   * @returns {Array<{ uri: string, name: string, description: string, mimeType: string }>}
   */
  listResources() {
    const resources = [];
    const now = Date.now();

    // Research sessions
    if (this.researchOrchestrator?.activeSessions) {
      for (const [sessionId] of this.researchOrchestrator.activeSessions) {
        resources.push({
          uri: `crawlforge://research/${sessionId}`,
          name: `Research Session ${sessionId}`,
          description: 'Completed deep_research report',
          mimeType: RESOURCE_MIME.research,
        });
      }
    }

    // Snapshots — list recent ones from SnapshotManager if available
    if (this.snapshotManager?.snapshots) {
      for (const [id, snap] of this.snapshotManager.snapshots) {
        const urlHash = hashUrl(snap.url || id);
        const ts = snap.metadata?.timestamp || snap.createdAt || now;
        resources.push({
          uri: `crawlforge://snapshot/${urlHash}/${ts}`,
          name: `Snapshot ${urlHash}`,
          description: `Snapshot of ${snap.url || id}`,
          mimeType: RESOURCE_MIME.snapshot,
        });
      }
    }

    // Jobs — completed/failed only
    if (this.jobManager?.jobs) {
      for (const [jobId, job] of this.jobManager.jobs) {
        if (job.status === 'completed' || job.status === 'failed') {
          resources.push({
            uri: `crawlforge://job/${jobId}`,
            name: `Job ${jobId}`,
            description: `Batch scrape job (${job.status})`,
            mimeType: RESOURCE_MIME.job,
          });
        }
      }
    }

    // Crawl sitemaps
    for (const [sessionId, entry] of this._crawlSitemaps) {
      if (now - entry.createdAt < entry.ttl) {
        resources.push({
          uri: `crawlforge://crawl/${sessionId}/sitemap`,
          name: `Crawl Sitemap ${sessionId}`,
          description: 'map_site output for a crawl session',
          mimeType: RESOURCE_MIME.crawl,
        });
      }
    }

    // Screenshots
    for (const [actionId, entry] of this._screenshots) {
      if (now - entry.createdAt < entry.ttl) {
        resources.push({
          uri: `crawlforge://screenshot/${actionId}`,
          name: `Screenshot ${actionId}`,
          description: 'Screenshot from a CrawlForge browser tool',
          mimeType: RESOURCE_MIME.screenshot,
        });
      }
    }

    return resources;
  }

  /**
   * Read a specific resource by URI.
   * @param {string} uri
   * @returns {{ contents: Array<{ uri: string, mimeType: string, text?: string, blob?: string }> }}
   */
  async readResource(uri) {
    // The MCP SDK hands the read callback a URL object, not a string; coerce so
    // the sub-readers and parseResourceUri (which calls String#startsWith) work.
    uri = typeof uri === 'string' ? uri : (uri?.href ?? String(uri));
    const parsed = parseResourceUri(uri);
    if (!parsed) {
      throw new Error(`Unknown resource URI: ${uri}`);
    }

    const { type, parts } = parsed;

    if (type === 'research') {
      return this._readResearch(uri, parts[0]);
    }
    if (type === 'snapshot') {
      return this._readSnapshot(uri, parts[0], parts[1]);
    }
    if (type === 'job') {
      return this._readJob(uri, parts[0]);
    }
    if (type === 'crawl') {
      // parts: [sessionId, 'sitemap']
      return this._readCrawlSitemap(uri, parts[0]);
    }
    if (type === 'screenshot') {
      return this._readScreenshot(uri, parts[0]);
    }

    throw new Error(`Resource type not implemented: ${type}`);
  }

  async _readResearch(uri, sessionId) {
    const session = this.researchOrchestrator?.activeSessions?.get(sessionId);
    if (!session) {
      throw new Error(`Research session not found: ${sessionId}`);
    }
    return {
      contents: [{
        uri,
        mimeType: RESOURCE_MIME.research,
        text: JSON.stringify(session, null, 2),
      }],
    };
  }

  async _readSnapshot(uri, urlHash, timestamp) {
    if (!this.snapshotManager?.snapshots) {
      throw new Error('SnapshotManager not available');
    }
    // Find snapshot by matching urlHash and timestamp
    for (const [id, snap] of this.snapshotManager.snapshots) {
      const sh = hashUrl(snap.url || id);
      const ts = String(snap.metadata?.timestamp || snap.createdAt || '');
      if (sh === urlHash && ts === timestamp) {
        return {
          contents: [{
            uri,
            mimeType: RESOURCE_MIME.snapshot,
            text: snap.content || JSON.stringify(snap, null, 2),
          }],
        };
      }
    }
    throw new Error(`Snapshot not found: ${uri}`);
  }

  async _readJob(uri, jobId) {
    const job = this.jobManager?.jobs?.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return {
      contents: [{
        uri,
        mimeType: RESOURCE_MIME.job,
        text: JSON.stringify(job, null, 2),
      }],
    };
  }

  async _readCrawlSitemap(uri, sessionId) {
    const entry = this._crawlSitemaps.get(sessionId);
    if (!entry || Date.now() - entry.createdAt >= entry.ttl) {
      throw new Error(`Crawl sitemap not found or expired: ${sessionId}`);
    }
    return {
      contents: [{
        uri,
        mimeType: RESOURCE_MIME.crawl,
        text: JSON.stringify(entry.data, null, 2),
      }],
    };
  }

  async _readScreenshot(uri, actionId) {
    const entry = this._screenshots.get(actionId);
    if (!entry || Date.now() - entry.createdAt >= entry.ttl) {
      throw new Error(`Screenshot not found or expired: ${actionId}`);
    }
    // Refuse rather than emit: an oversized message costs the caller their
    // whole session, and this error costs them one read they can act on.
    if (entry.data.length > MAX_RESOURCE_BLOB_BYTES) {
      throw new Error(
        `Screenshot ${actionId} is ${entry.data.length} bytes, over the ` +
        `${MAX_RESOURCE_BLOB_BYTES}-byte limit for one MCP message. Returning it would ` +
        `close the connection instead of failing this read, so it is refused. Take the ` +
        `shot again without full_page, or as format:"jpeg" with a lower quality, or ` +
        `scoped to one element with selector.`
      );
    }
    return {
      contents: [{
        uri,
        mimeType: RESOURCE_MIME.screenshot,
        blob: entry.data.toString('base64'),
      }],
    };
  }
}
