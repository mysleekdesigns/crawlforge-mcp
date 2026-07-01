/**
 * Live smoke test: serp_rank against the REAL DataForSEO SERP API.
 *
 * Reads DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD from the gitignored .env (never
 * from the command line, so the creds stay out of shell history / transcripts).
 * Makes ONE real Google-organic lookup (~US$0.002 billed to your DataForSEO
 * account) and prints the full normalized result so the wire format can be
 * eyeballed.
 *
 * Usage:
 *   node scripts/smoke-serp-rank.mjs                     # defaults: "github" / github.com
 *   node scripts/smoke-serp-rank.mjs "managed wordpress hosting" dashboardhosting.com
 */
import 'dotenv/config';
import { SerpRankTool } from '../src/tools/search/serpRank.js';

const keyword = process.argv[2] || 'github';
const target = process.argv[3] || 'github.com';

if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
  console.error('✖ DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not found in environment (.env).');
  console.error('  Add these two lines to the gitignored .env file, then re-run:');
  console.error('    DATAFORSEO_LOGIN=your_login');
  console.error('    DATAFORSEO_PASSWORD=your_password');
  console.error('  Get credentials at https://app.dataforseo.com/api-access');
  process.exit(1);
}

console.error(`→ Live DataForSEO lookup: keyword="${keyword}" target="${target}" (this bills ~US$0.002)`);

const tool = new SerpRankTool(); // reads DATAFORSEO_* from env
try {
  const result = await tool.execute({ keyword, target, location_name: 'United States', depth: 20 });
  console.log(JSON.stringify(result, null, 2));

  if (result.configured === false) {
    console.error('\n✖ Tool reports unconfigured — creds not picked up. Check .env.');
    process.exit(1);
  }
  console.error(`\n✅ Wire format OK. cost=$${result.cost} organicResults=${result.organicResults} found=${result.found} position=${result.position}`);
} catch (err) {
  console.error(`\n✖ Live lookup failed: ${err.message}`);
  process.exit(1);
}
