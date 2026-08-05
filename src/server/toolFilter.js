/**
 * toolFilter — client-side tool selection (Phase 6).
 *
 * Lets an MCP client load a subset of the 27 registered tools via env vars,
 * cutting context bloat (mirrors Bright Data / Exa's TOOLS / GROUPS pattern).
 *
 * Pure module: no I/O, no logging; process.env is only read via
 * createToolFilter's default parameter so callers can inject a fake env in
 * tests.
 */

// The full set of tool names server.js registers, grouped by category.
export const TOOL_GROUPS = {
  basic: ['fetch_url', 'extract_text', 'extract_links', 'extract_metadata', 'scrape_structured'],
  search: ['search_web', 'serp_rank'],
  crawl: ['crawl_deep', 'map_site'],
  extract: ['extract_content', 'process_document', 'summarize_content', 'analyze_content', 'extract_structured', 'extract_with_llm', 'list_ollama_models'],
  batch: ['batch_scrape', 'get_batch_results', 'scrape_with_actions'],
  research: ['deep_research'],
  tracking: ['track_changes'],
  llmstxt: ['generate_llms_txt'],
  stealth: ['stealth_mode', 'localization'],
  templates: ['scrape_template'],
  scrape: ['scrape'],
  agent: ['agent']
};

const ALL_TOOL_NAMES = Object.values(TOOL_GROUPS).flat();

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * @param {object} [env=process.env] — source of CRAWLFORGE_TOOLS / CRAWLFORGE_TOOL_GROUPS
 * @returns {{ isEnabled(toolName: string): boolean, summary(): { mode: 'all'|'filtered', enabled: string[], unknown: string[] } }}
 */
export function createToolFilter(env = process.env) {
  const requestedTools = parseCsv(env.CRAWLFORGE_TOOLS);
  const requestedGroups = parseCsv(env.CRAWLFORGE_TOOL_GROUPS);

  if (requestedTools.length === 0 && requestedGroups.length === 0) {
    const allEnabled = ALL_TOOL_NAMES.slice();
    return {
      isEnabled() {
        return true;
      },
      summary() {
        return { mode: 'all', enabled: allEnabled, unknown: [] };
      }
    };
  }

  const toolLookup = new Map(ALL_TOOL_NAMES.map((name) => [name.toLowerCase(), name]));
  const groupLookup = new Map(Object.keys(TOOL_GROUPS).map((name) => [name.toLowerCase(), name]));

  const enabled = new Set();
  const unknown = [];

  for (const entry of requestedTools) {
    const match = toolLookup.get(entry.toLowerCase());
    if (match) {
      enabled.add(match);
    } else {
      unknown.push(entry);
    }
  }

  for (const entry of requestedGroups) {
    const match = groupLookup.get(entry.toLowerCase());
    if (match) {
      for (const toolName of TOOL_GROUPS[match]) enabled.add(toolName);
    } else {
      unknown.push(entry);
    }
  }

  // Dependency rule: batch_scrape's results are retrieved via get_batch_results,
  // so enabling one without the other would leave a dead-end tool exposed.
  if (enabled.has('batch_scrape')) {
    enabled.add('get_batch_results');
  }

  return {
    isEnabled(toolName) {
      return enabled.has(toolName);
    },
    summary() {
      return { mode: 'filtered', enabled: Array.from(enabled), unknown };
    }
  };
}

export default createToolFilter;
