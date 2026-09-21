/**
 * report.js — the run as markdown, in the shape of section 2 of the review.
 *
 * The wall table keeps the review's five columns and its cell words so the two
 * can be read side by side, and the deltas list under it names every cell that
 * moved since 2026-09-21. That list is the verification gate ("reproduces the
 * section 2 matrix within one run's noise") in one place.
 */

const ENGINE_COLUMNS = [
  ['plain', 'Plain fetch'],
  ['chromium', 'Chromium stealth'],
  ['camoufox', 'Camoufox']
];

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|');
const shortUrl = (url) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

function environmentBlock(env) {
  const net = env.network || {};
  const browsers = Object.entries(env.browsers || {})
    .map(([engine, version]) => `${engine} ${version}`)
    .join(', ') || 'none launched';
  return [
    '## Environment',
    '',
    `- Run: ${env.timestamp} (UTC), CrawlForge ${env.crawlforgeVersion}, commit \`${env.gitCommit}\``,
    `- Host: ${env.host.platform} ${env.host.arch} ${env.host.release}, ${env.host.cpus} cores, ${env.host.memoryGB} GB`,
    `- Network: ${net.type}${net.asn ? ` — ${net.asn}` : ''}${net.location ? `, ${net.location}` : ''}${net.ip ? ` (${net.ip})` : ''}`,
    `- Browsers: ${browsers}`,
    `- Playwright ${env.playwrightVersion}, camoufox npm ${env.camoufoxVersion || 'not installed'}`,
    ''
  ];
}

function wallsBlock(rows) {
  // Header built from the same list the cells are, so the two cannot drift.
  const headers = ['Target', 'Vendor', ...ENGINE_COLUMNS.map(([, label]) => label)];
  const lines = ['## Bot walls', '', `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) {
    const cells = ENGINE_COLUMNS.map(([key]) => cell(row.results[key]?.cell || 'n/a'));
    lines.push(`| ${shortUrl(row.url)} | ${cell(row.vendor)} | ${cells.join(' | ')} |`);
  }

  lines.push('', '### Detail', '');
  for (const row of rows) {
    for (const [key, label] of ENGINE_COLUMNS) {
      const result = row.results[key];
      if (!result?.detail) continue;
      lines.push(`- ${row.id} / ${label}: **${result.cell}** — ${result.detail}`);
    }
  }

  const deltas = [];
  for (const row of rows) {
    for (const [key, label] of ENGINE_COLUMNS) {
      const now = row.results[key]?.cell;
      const then = row.recorded?.[key];
      // An engine that was not selected or not installed measured nothing;
      // listing that as a change would bury the cells that really moved.
      if (now === 'skipped (engine)') continue;
      if (then && now && then !== now) deltas.push(`- ${row.id} / ${label}: review recorded **${then}**, this run **${now}**`);
    }
  }
  lines.push('', '### Deltas vs the 2026-09-21 review', '');
  lines.push(...(deltas.length ? deltas : ['- None. Every cell matches section 2.2.']));
  lines.push('');
  return lines;
}

function detectorBlock(runs) {
  const lines = ['## Detectors', ''];
  for (const run of runs) {
    lines.push(`### ${[run.engine, run.browserVersion].filter(Boolean).join(' ')} — ${run.name}`, '');
    if (run.error) {
      lines.push(`- Not run: ${run.error}`, '');
      continue;
    }
    if (!run.checks.length) {
      lines.push('- No checks returned.', '');
      continue;
    }
    lines.push('| Check | Result | Expected | Actual | Detail |', '| --- | --- | --- | --- | --- |');
    for (const check of run.checks) {
      lines.push(`| ${cell(check.id)} | ${cell(check.status)} | ${cell(check.expected)} | ${cell(check.actual)} | ${cell(check.detail || '')} |`);
    }
    lines.push('');
  }
  return lines;
}

function ciBlock(gate) {
  const lines = ['## CI gate', ''];
  lines.push(gate.regressions.length
    ? `**${gate.regressions.length} regression(s)** — failing and not in ci-baseline.json:`
    : 'No regressions: every failing check is listed in ci-baseline.json.');
  for (const check of gate.regressions) lines.push(`- \`${check.id}\` on ${check.engine}: expected ${check.expected}, got ${check.actual}`);
  if (gate.baselined.length) {
    lines.push('', 'Known failing (reported, not gated — Phase 1 of the review owns these):');
    for (const check of gate.baselined) lines.push(`- \`${check.id}\` on ${check.engine}: ${check.actual}`);
  }
  if (gate.stale.length) {
    lines.push('', 'Baselined but not failing any more — remove from ci-baseline.json:');
    for (const id of gate.stale) lines.push(`- \`${id}\``);
  }
  lines.push('');
  return lines;
}

function summaryBlock(result) {
  const lines = ['## Summary', ''];
  if (result.walls) {
    const tally = {};
    for (const row of result.walls) {
      for (const [key] of ENGINE_COLUMNS) {
        const value = row.results[key]?.cell || 'n/a';
        tally[value] = (tally[value] || 0) + 1;
      }
    }
    lines.push(`- Walls: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  }
  if (result.detectors?.length) {
    const checks = result.detectors.flatMap((run) => run.checks || []);
    const count = (status) => checks.filter((check) => check.status === status).length;
    lines.push(`- Detector checks: ${count('pass')} pass, ${count('fail')} fail, ${count('skip')} skip`);
  }
  lines.push('');
  return lines;
}

/**
 * @param {{mode:string, environment:object, walls?:Array, detectors?:Array, gate?:object}} result
 * @returns {string} markdown
 */
export function renderMarkdown(result) {
  const lines = [
    '# CrawlForge stealth benchmark',
    '',
    `Mode: ${result.mode}. Produced by \`scripts/stealth-bench.mjs\` against the matrix in section 2 of \`docs/STEALTH_REVIEW_2026-09.md\`.`,
    ''
  ];
  lines.push(...environmentBlock(result.environment));
  if (result.walls?.length) lines.push(...wallsBlock(result.walls));
  if (result.detectors?.length) lines.push(...detectorBlock(result.detectors));
  if (result.gate) lines.push(...ciBlock(result.gate));
  lines.push(...summaryBlock(result));
  return lines.join('\n');
}
