/**
 * BrowserSessionTool — `browser_session`: one browser page the caller keeps
 * across several tool calls, driven by an `operation` enum.
 *
 * `scrape_with_actions` is one-shot and blind: the agent has to name up to 20
 * actions up front, guessing selectors for a page it has never seen, and the
 * browser closes when the call returns. A session inverts that loop — open,
 * look (`snapshot`), act on the refs the snapshot handed back, look again —
 * and one login is paid for once instead of once per call.
 *
 * Everything here is assembled from parts that already exist, deliberately:
 *   - `ActionExecutor.initializePage()` is the `open` primitive, SSRF guard and
 *     robots gate included, and `executeActionsOnPage()` runs actions against a
 *     page it does not own (the `navigate` action re-gates every hop itself).
 *   - Element refs live in a page-scoped WeakMap in core/browser/snapshot.js, so
 *     a session that keeps its page keeps its refs across calls for free, and
 *     loses them exactly when it should — on navigation.
 *   - `BrowserSessionStore` holds the sessions, the two TTL clocks and the caps.
 *   - `ExtractContentTool` turns the live DOM into the requested formats.
 *
 * Ownership is a tenant boundary, not a nicety — see ownerId() for what that
 * means for the hosted REST path, which this tool refuses.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

import ActionExecutor from '../../core/ActionExecutor.js';
import ExtractContentTool from '../extract/extractContent.js';
import BrowserSessionStore, {
  TTL_MIN_MS,
  TTL_MAX_MS,
  ACTIVITY_TTL_MIN_MS,
  ACTIVITY_TTL_MAX_MS
} from '../../core/browser/SessionStore.js';
import { captureSnapshot } from '../../core/browser/snapshot.js';
import authManager from '../../core/AuthManager.js';
import { isCreatorModeVerified } from '../../core/creatorMode.js';
import { isInternalRequest } from '../../server/requestContext.js';
import { isRemoteTransport } from '../../utils/remoteMode.js';
import { htmlToMarkdown } from '../../utils/htmlToMarkdown.js';

const SECOND = 1000;

/**
 * The action array is `scrape_with_actions`' own, passed through untouched:
 * ActionExecutor validates each action against its own union as it runs it, and
 * a fourth copy of that union here could only drift from the three that exist.
 *
 * The two fields below are not decoration. ActionExecutor parses each action but
 * discards the parsed value, so an action that arrives without them keeps the
 * undefined it came with — and `action.retries > 0` is the gate on error
 * recovery, `action.continueOnError` the per-action failure policy. These are
 * the same defaults ScrapeWithActionsTool's schema stamps.
 */
const SessionActionSchema = z.object({
  type: z.string(),
  continueOnError: z.boolean().default(false),
  retries: z.number().min(0).max(5).default(1)
}).passthrough();

const BrowserSessionSchema = z.object({
  operation: z.enum(['open', 'snapshot', 'act', 'read', 'screenshot', 'close', 'list']),
  session_id: z.string().optional(),

  // open. ttl/activity_ttl are seconds, as Firecrawl's are, so anyone arriving
  // from their docs reads the same numbers; the store works in milliseconds.
  url: z.string().url().optional(),
  stealth: z.boolean().default(false),
  ttl: z.number().min(TTL_MIN_MS / SECOND).max(TTL_MAX_MS / SECOND).optional(),
  activity_ttl: z.number().min(ACTIVITY_TTL_MIN_MS / SECOND).max(ACTIVITY_TTL_MAX_MS / SECOND).optional(),
  viewport: z.object({
    width: z.number().min(800).max(1920),
    height: z.number().min(600).max(1080)
  }).optional(),
  timeout: z.number().min(10000).max(120000).default(30000),

  // Applies to the call it is sent on: on `open` to the first load, on `act` to
  // every navigate in that call. It is never remembered by the session, so an
  // override has to be repeated as deliberately as it was made.
  respect_robots: z.boolean().optional(),

  // snapshot
  interactive_only: z.boolean().default(true),
  max_nodes: z.number().min(1).max(1000).optional(),

  // act
  actions: z.array(SessionActionSchema).min(1).max(20).optional(),
  continue_on_error: z.boolean().default(false),

  // read
  formats: z.array(z.enum(['markdown', 'html', 'text', 'json'])).default(['markdown']),

  // screenshot
  full_page: z.boolean().default(false),
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().min(0).max(100).default(80),
  selector: z.string().optional()
});

/** A refusal a caller (and a test) can match on by code rather than by prose. */
function refuse(code, message) {
  const error = new Error(message);
  error.name = 'BrowserSessionRefusal';
  error.code = code;
  return error;
}

/**
 * The session fields every operation echoes back, in the same shape a store
 * list row carries. Read it after touch() so the idle clock is the fresh one.
 */
function sessionInfo(session) {
  return {
    sessionId: session.id,
    url: session.url,
    stealth: session.stealth,
    expiresAt: session.createdAt + session.ttlMs,
    idleExpiresAt: session.lastUsedAt + session.activityTtlMs
  };
}

export class BrowserSessionTool {
  constructor(options = {}) {
    const {
      actionExecutor = null,
      extractContentTool = null,
      store = null,
      storeOptions = {},
      enableLogging = true
    } = options;

    // An injected executor belongs to whoever built it (server.js hands us
    // scrape_with_actions'), and destroying it would take that tool's browser
    // down with ours. Only an executor we made ourselves is ours to destroy.
    this._ownsExecutor = !actionExecutor;
    this.actionExecutor = actionExecutor || new ActionExecutor({ enableLogging });
    this.extractContentTool = extractContentTool || new ExtractContentTool();
    this.storeOptions = storeOptions;
    this.store = store || new BrowserSessionStore(storeOptions);
  }

  async execute(params) {
    const validated = BrowserSessionSchema.parse(params);
    const ownerId = this.ownerId();

    switch (validated.operation) {
      case 'open': return await this.openSession(validated, ownerId);
      case 'snapshot': return await this.snapshotSession(validated, ownerId);
      case 'act': return await this.actOnSession(validated, ownerId);
      case 'read': return await this.readSession(validated, ownerId);
      case 'screenshot': return await this.screenshotSession(validated, ownerId);
      case 'close': return await this.closeSession(validated, ownerId);
      case 'list': return this.listSessions(ownerId);
    }
  }

  /**
   * Who the caller is — the identity every session is bound to and every
   * lookup is scoped by.
   *
   * THE HOSTED REST PATH IS REFUSED HERE, DELIBERATELY. Do not delete this as
   * over-caution. The website's REST proxy authenticates to this server with a
   * single shared X-Internal-Secret (`authenticateRequest` in
   * src/server/transports/streamableHttp.js) and forwards no end-user identity
   * (crawlforge-website/src/lib/tools/mcp-proxy.ts), so every REST customer
   * arrives as the same internal caller. Binding a session to that identity
   * would put all of them inside one tenant: any customer could name any other
   * customer's session id and be handed their logged-in browser. There is no
   * owner to derive, so there is no session — and saying so is honest, where
   * pretending would be a cross-tenant hole. Phase 3 of the browser-session
   * plan adds a per-user owner token before the REST route ships.
   *
   * Everywhere else the install is the tenant: over stdio, and over self-hosted
   * HTTP authenticated with the install's API key or an OAuth token, the same
   * configured key stands behind every request. Its digest is the owner id; the
   * key itself never leaves this method.
   */
  ownerId() {
    if (isInternalRequest()) {
      throw refuse(
        'SESSIONS_NOT_AVAILABLE_OVER_REST',
        'browser_session is not available over the CrawlForge REST API yet. The API proxy ' +
        'authenticates as a single shared internal caller and cannot yet identify which ' +
        'customer a request belongs to, so a session id could not be bound to the account ' +
        'that opened it. Use scrape_with_actions for a one-shot interaction chain, or run ' +
        'the CrawlForge MCP server locally (stdio) where sessions work normally.'
      );
    }

    const apiKey = authManager.getConfig()?.apiKey;
    return apiKey
      ? `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`
      : 'local';
  }

  /**
   * The session this operation names, or the same "session not found" an
   * unknown id gets. The store raises one error for unknown, wrong-owner and
   * expired alike, which is what keeps ids non-enumerable — never answer a
   * wrong owner with "forbidden".
   */
  requireSession(params, ownerId) {
    if (!params.session_id) {
      throw new Error(
        `operation "${params.operation}" requires session_id — the id returned by operation:"open".`
      );
    }
    return this.store.get(params.session_id, ownerId);
  }

  async openSession(params, ownerId) {
    if (!params.url) {
      throw new Error('operation "open" requires a url to load the session on.');
    }

    const browserOptions = {
      headless: true,
      viewportWidth: params.viewport?.width,
      viewportHeight: params.viewport?.height,
      timeout: params.timeout,
      respectRobots: params.respect_robots
    };
    if (params.stealth) {
      browserOptions.stealthMode = { enabled: true };
    }

    // initializePage runs the SSRF guard, then the blocklist/robots gate, and
    // only then creates a page and navigates — closing the page itself if any
    // of that fails. That is the whole of 2.5's gating on `open`, which is why
    // this is not page.goto() behind a gate written here.
    const page = await this.actionExecutor.initializePage(params.url, browserOptions);
    const releasePage = this.releaser(page, params.stealth);

    let session;
    try {
      session = this.store.create({
        ownerId,
        page,
        releasePage,
        url: page.url(),
        stealth: params.stealth,
        ttlMs: params.ttl === undefined ? undefined : params.ttl * SECOND,
        activityTtlMs: params.activity_ttl === undefined ? undefined : params.activity_ttl * SECOND
      });
    } catch (error) {
      // A cap refusal arrives with a live page in hand. Give it back before
      // rethrowing, or the refused call leaks the context it just pinned.
      await releasePage();
      throw error;
    }

    return { success: true, operation: 'open', ...sessionInfo(session) };
  }

  async snapshotSession(params, ownerId) {
    const session = this.requireSession(params, ownerId);

    const snapshot = await captureSnapshot(session.page, {
      interactiveOnly: params.interactive_only,
      maxNodes: params.max_nodes
    });

    this.store.touch(session, session.page.url());
    return { success: true, operation: 'snapshot', ...sessionInfo(session), snapshot };
  }

  async actOnSession(params, ownerId) {
    if (!params.actions?.length) {
      throw new Error('operation "act" requires an actions array.');
    }
    const session = this.requireSession(params, ownerId);

    // D6: arbitrary JavaScript in a browser on OUR infrastructure is a
    // materially different act from the same JavaScript in a browser on the
    // caller's own laptop. Over stdio or loopback the caller is the local user
    // and executeJavaScriptAction's own ALLOW_JAVASCRIPT_EXECUTION flag is the
    // control; served to a network, it is refused outright. Creator mode is the
    // maintainer's own box, so it keeps the local answer.
    if (params.actions.some((action) => action.type === 'executeJavaScript') &&
        isRemoteTransport() && !isCreatorModeVerified()) {
      throw refuse(
        'JS_EXECUTION_REFUSED_REMOTE',
        'executeJavaScript is refused in a browser session on a remotely-served CrawlForge ' +
        'instance: the script would run in a browser on the server, not on your machine. ' +
        'Use the click / type / select / press actions, or run the MCP server locally over stdio.'
      );
    }

    // Every `navigate` in here re-runs the SSRF guard and the blocklist/robots
    // gate inside executeNavigateAction — verified, and the reason the gate is
    // not repeated here. A long-lived session is a repeatable navigation
    // primitive, so that per-hop check is what stops it becoming an SSRF hop.
    const result = await this.actionExecutor.executeActionsOnPage(session.page, params.actions, {
      continueOnError: params.continue_on_error,
      timeout: params.timeout,
      browserOptions: { respectRobots: params.respect_robots }
    });

    this.store.touch(session, result.finalUrl);
    return {
      success: result.success,
      operation: 'act',
      ...sessionInfo(session),
      error: result.error,
      actionResults: result.results,
      screenshots: result.screenshots,
      ...(result.capturedStates.length > 0 ? { capturedStates: result.capturedStates } : {}),
      stats: result.stats
    };
  }

  async readSession(params, ownerId) {
    const session = this.requireSession(params, ownerId);
    const url = session.page.url();
    const html = await session.page.content();

    const options = {};
    if (params.formats.includes('markdown')) options.outputFormat = 'markdown';
    if (params.formats.includes('html')) options.includeRawHTML = true;

    // The live post-action DOM is already in hand, so extract_content is handed
    // that rather than the url: a re-fetch would arrive without the session's
    // cookies and before everything the session has clicked, which is the whole
    // point of having one.
    const extracted = await this.extractContentTool.execute({ url, html, options });

    const content = {};
    if (params.formats.includes('text')) {
      content.text = extracted.content?.text || '';
    }
    if (params.formats.includes('html')) {
      content.html = extracted.content?.html || html;
    }
    if (params.formats.includes('markdown')) {
      // Readability finds no article on most app pages, and then no markdown is
      // produced at all (R20, 2026-09-07). Convert the DOM we hold instead of
      // handing back a placeholder.
      content.markdown = extracted.content?.markdown || htmlToMarkdown(html);
    }
    if (params.formats.includes('json')) {
      content.json = {
        title: extracted.title ?? null,
        metadata: extracted.metadata || {},
        structuredData: extracted.structuredData
      };
    }

    this.store.touch(session, url);
    return {
      success: true,
      operation: 'read',
      ...sessionInfo(session),
      title: extracted.title ?? null,
      extractionMethod: extracted.extractionMethod,
      content
    };
  }

  async screenshotSession(params, ownerId) {
    const session = this.requireSession(params, ownerId);

    const shot = await this.actionExecutor.captureScreenshot(session.page, {
      fullPage: params.full_page,
      format: params.format,
      quality: params.quality,
      selector: params.selector
    });

    this.store.touch(session, session.page.url());
    // The actionId is what lets the server publish the image as a
    // crawlforge://screenshot/{actionId} resource and drop the base64 from the
    // result — a full-page PNG inline is megabytes (R21, 2026-09-09).
    return {
      success: true,
      operation: 'screenshot',
      ...sessionInfo(session),
      screenshot: { actionId: this.actionExecutor.generateActionId(), ...shot }
    };
  }

  async closeSession(params, ownerId) {
    if (!params.session_id) {
      throw new Error('operation "close" requires session_id.');
    }
    await this.store.close(params.session_id, ownerId);
    return { success: true, operation: 'close', sessionId: params.session_id, closed: true };
  }

  listSessions(ownerId) {
    const sessions = this.store.list(ownerId).map(({ id, ...rest }) => ({ sessionId: id, ...rest }));
    return { success: true, operation: 'list', count: sessions.length, sessions };
  }

  /**
   * How a page goes back: the closure the store calls on close, on expiry and
   * at shutdown.
   *
   * Copied from executeActionChain's `finally`, and the halves are not
   * interchangeable. A stealth page goes through the manager so its pooled
   * context slot is freed as well as the renderer; a standard page must also
   * close the BrowserContext createPage() gave it, because nothing else tracks
   * that one. Getting this wrong pins a context until the process dies, which
   * on the 2 GB Render box is an outage rather than a leak.
   */
  releaser(page, stealth) {
    return async () => {
      if (stealth) {
        await this.actionExecutor.browserProcessor.releaseStealthPage(page);
        return;
      }
      const context = page.context();
      try { await page.close(); } catch (_) { /* ignore close errors */ }
      try { await context.close(); } catch (_) { /* ignore close errors */ }
    };
  }

  /**
   * Close every live session, leaving the tool able to open more.
   *
   * This is the half the stealth-cleanup lever needs: `stealth_mode`
   * operation:"cleanup" tears down the stealth browser, so every page a stealth
   * session is holding dies with it and those sessions have to go too — but the
   * tool itself must still work afterwards. The store is replaced rather than
   * reused because destroy() also stops its sweep timer, and an injected store
   * is replaced along with the rest.
   */
  async cleanup() {
    await this.store.destroy();
    this.store = new BrowserSessionStore(this.storeOptions);
  }

  /**
   * Process exit: close the sessions, then the browser — but only if the
   * executor is ours. Sessions always close here; that is why this tool is in
   * server.js's shutdown list even when it shares another tool's executor.
   */
  async destroy() {
    await this.store.destroy();
    if (this._ownsExecutor) await this.actionExecutor.destroy();
  }
}

export default BrowserSessionTool;
