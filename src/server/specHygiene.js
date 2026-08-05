/**
 * specHygiene — Phase 6 protocol-hygiene wrapper.
 *
 * Applies three MCP wire-level upgrades to an already-registered McpServer
 * without changing how tools/prompts are declared anywhere else:
 *
 *   1. JSON Schema 2020-12 dialect stamping on every tool's inputSchema /
 *      outputSchema (the SDK's zod-to-json-schema conversion still emits
 *      draft-07-style `definitions` / `#/definitions/...` refs).
 *   2. Deterministic (alphabetical) tool ordering in tools/list, so clients
 *      that prompt-cache tools/list get stable hits across restarts.
 *   3. SEP-973 icons metadata on every tool/prompt lacking one.
 *   4. SEP-2549-style cache hints on tools/call results for a fixed
 *      allowlist of read-only, idempotent tools (see note below).
 *
 * Wiring: SDK 1.30 has no plugin hook for this, so applySpecHygiene() must be
 * called once, after all server.registerTool()/registerPrompt() calls and
 * before transport.connect(). It reaches into `server.server` (the
 * underlying Protocol), captures the ListTools/CallTool/ListPrompts handlers
 * McpServer already installed in `_requestHandlers`, and re-registers wrapped
 * versions via `setRequestHandler` — which silently replaces an existing
 * handler for the same method (confirmed from the SDK source: only
 * `assertCanSetRequestHandler`, called by McpServer's own registration path,
 * throws on a pre-existing handler; `setRequestHandler` itself does not).
 *
 * SEP-2549 note: as specified (2026-07-28 RC), `ttlMs` / `cacheScope`
 * ("public"|"private") are defined on tools/list, prompts/list,
 * resources/list, resources/read and resources/templates/list results —
 * there is no CacheableResult for tools/call. Since this deliverable asks
 * for tools/call cache hints, the same two field names are carried into a
 * namespaced `_meta` key following the SDK's own
 * `io.modelcontextprotocol/<name>` convention (see RELATED_TASK_META_KEY in
 * @modelcontextprotocol/sdk/types.js):
 *   result._meta["io.modelcontextprotocol/cacheable"] = { ttlMs, cacheScope }
 * This is a documented adaptation, not a key confirmed by the spec text for
 * tools/call — revisit if/when a SEP defines call-result caching explicitly.
 */

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const APPLIED = Symbol('crawlforge.specHygiene.applied');

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const CACHE_META_KEY = 'io.modelcontextprotocol/cacheable';

const DEFAULT_ICON = Object.freeze({
  src: 'https://www.crawlforge.dev/icon.png',
  mimeType: 'image/png',
  sizes: ['any']
});

// Read-only, idempotent tools whose tools/call results get a SEP-2549-style
// cache hint (see note above). ttlMs mirrors CACHE_TTL's 5-minute default;
// cacheScope 'private' because scraped content may reflect the caller's own
// request context (headers, auth) and should not be shared across clients.
const DEFAULT_CACHEABLE_TOOLS = Object.freeze({
  fetch_url: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  extract_text: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  extract_links: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  extract_metadata: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  scrape_structured: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  map_site: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  search_web: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  serp_rank: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  extract_content: Object.freeze({ ttlMs: 300000, cacheScope: 'private' }),
  scrape: Object.freeze({ ttlMs: 300000, cacheScope: 'private' })
});

/**
 * Deep-copies a JSON-schema-like tree, renaming `definitions` -> `$defs` and
 * rewriting `"#/definitions/..."` refs to `"#/$defs/..."` anywhere in the
 * tree. Never mutates the input (some schemas, e.g. the SDK's shared
 * "no params" constant, are frozen and reused across tools).
 */
function rewriteDefs(node) {
  if (Array.isArray(node)) return node.map(rewriteDefs);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'definitions') {
        out.$defs = rewriteDefs(value);
      } else if (key === '$ref' && typeof value === 'string' && value.startsWith('#/definitions/')) {
        out.$ref = `#/$defs/${value.slice('#/definitions/'.length)}`;
      } else {
        out[key] = rewriteDefs(value);
      }
    }
    return out;
  }
  return node;
}

function stamp2020_12(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  return { ...rewriteDefs(schema), $schema: JSON_SCHEMA_2020_12 };
}

function withDefaultIcon(entry, icon) {
  if (Array.isArray(entry.icons) && entry.icons.length > 0) return entry;
  return { ...entry, icons: [icon] };
}

function wrapToolsList(innerHandler, icon) {
  return async (request, extra) => {
    const result = await innerHandler(request, extra);
    if (!result || !Array.isArray(result.tools)) return result;

    const tools = result.tools
      .map((tool) => {
        let next = { ...tool };
        if (next.inputSchema) next.inputSchema = stamp2020_12(next.inputSchema);
        if (next.outputSchema) next.outputSchema = stamp2020_12(next.outputSchema);
        next = withDefaultIcon(next, icon);
        return next;
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return { ...result, tools };
  };
}

function wrapPromptsList(innerHandler, icon) {
  return async (request, extra) => {
    const result = await innerHandler(request, extra);
    if (!result || !Array.isArray(result.prompts)) return result;

    const prompts = result.prompts.map((prompt) => withDefaultIcon(prompt, icon));
    return { ...result, prompts };
  };
}

function wrapToolsCall(innerHandler, cacheableTools) {
  return async (request, extra) => {
    const result = await innerHandler(request, extra);
    if (!result || typeof result !== 'object') return result;
    if (result.isError) return result;
    if (!Array.isArray(result.content)) return result; // task-augmented / content-less results pass through untouched

    const hint = cacheableTools[request?.params?.name];
    if (!hint) return result;

    return {
      ...result,
      _meta: {
        ...(result._meta ?? {}),
        [CACHE_META_KEY]: { ttlMs: hint.ttlMs, cacheScope: hint.cacheScope }
      }
    };
  };
}

/**
 * Applies the protocol-hygiene wrappers to `server`. Call once, after all
 * tools/prompts are registered and before transport.connect(). Idempotent:
 * a second call on the same server is a no-op.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} [overrides]
 * @param {{src:string,mimeType?:string,sizes?:string[]}} [overrides.icon] — default icon injected into tools/prompts lacking one
 * @param {Record<string,{ttlMs:number,cacheScope:'public'|'private'}>} [overrides.cacheableTools] — tool-name -> cache hint map for tools/call
 */
export function applySpecHygiene(server, overrides = {}) {
  const protocol = server?.server;
  if (!protocol || typeof protocol.setRequestHandler !== 'function' || !(protocol._requestHandlers instanceof Map)) {
    throw new TypeError('applySpecHygiene requires a connected McpServer instance');
  }

  if (protocol[APPLIED]) return;
  protocol[APPLIED] = true;

  const icon = overrides.icon ?? DEFAULT_ICON;
  const cacheableTools = overrides.cacheableTools ?? DEFAULT_CACHEABLE_TOOLS;

  const innerToolsList = protocol._requestHandlers.get('tools/list');
  if (innerToolsList) {
    protocol.setRequestHandler(ListToolsRequestSchema, wrapToolsList(innerToolsList, icon));
  }

  const innerToolsCall = protocol._requestHandlers.get('tools/call');
  if (innerToolsCall) {
    protocol.setRequestHandler(CallToolRequestSchema, wrapToolsCall(innerToolsCall, cacheableTools));
  }

  const innerPromptsList = protocol._requestHandlers.get('prompts/list');
  if (innerPromptsList) {
    protocol.setRequestHandler(ListPromptsRequestSchema, wrapPromptsList(innerPromptsList, icon));
  }
}
