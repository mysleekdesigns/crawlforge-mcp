/**
 * Open-core Phase 1 verification: client getToolCost() must equal the
 * backend TOOL_CREDIT_COSTS table for every tool (docs/tier-map.md).
 *
 * Usage: node scripts/verify-cost-parity.mjs [path-to-crawlforge-website]
 */
import AuthManager from '../src/core/AuthManager.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const websiteRepo = process.argv[2] ?? resolve(import.meta.dirname, '../../crawlforge-website');
const ts = readFileSync(resolve(websiteRepo, 'src/lib/credits.ts'), 'utf8');
const block = ts.match(/TOOL_CREDIT_COSTS = \{([\s\S]*?)\} as const/)[1];
const backend = {};
for (const m of block.matchAll(/^\s*(\w+):\s*(\d+)/gm)) backend[m[1]] = Number(m[2]);

const tools = [
  'fetch_url', 'extract_text', 'extract_links', 'extract_metadata', 'scrape_structured',
  'scrape_template', 'extract_content', 'scrape', 'summarize_content', 'analyze_content',
  'extract_with_llm', 'extract_structured', 'process_document', 'list_ollama_models',
  'get_batch_results', 'map_site', 'track_changes', 'generate_llms_txt', 'search_web',
  'crawl_deep', 'batch_scrape', 'scrape_with_actions', 'localization', 'agent',
  'deep_research', 'stealth_mode'
];

let mismatches = 0;
for (const t of tools) {
  const client = AuthManager.getToolCost(t);
  const server = backend[t];
  if (client !== server) {
    console.error(`MISMATCH ${t}: client=${client} backend=${server}`);
    mismatches++;
  }
}
for (const t of Object.keys(backend)) {
  if (!tools.includes(t)) {
    console.error(`Backend table has tool missing from checklist: ${t}`);
    mismatches++;
  }
}

console.log(`tools checked: ${tools.length}, backend table size: ${Object.keys(backend).length}, mismatches: ${mismatches}`);
console.log(`scrape+screenshot: ${AuthManager.getToolCost('scrape', { formats: ['markdown', 'screenshot'] })} (expect 2)`);
console.log(`unknown tool fallback: ${AuthManager.getToolCost('nonexistent')} (expect 1)`);
process.exit(mismatches === 0 ? 0 : 1);
