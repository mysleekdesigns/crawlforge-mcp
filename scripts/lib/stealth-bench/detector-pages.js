/**
 * Parsers for the five third-party detector pages used in
 * docs/STEALTH_REVIEW_2026-09.md section 2.3.
 *
 * These are somebody else's pages. They are slow, they rate-limit, and they
 * restyle their DOM without notice, so they are NOT wired into CI — the harness
 * excludes them from `--ci` and runs only the self-probes in ./detectors.js
 * there. A red build must mean CrawlForge changed, never that sannysoft shipped
 * a new stylesheet.
 *
 * They are still worth running by hand: they cover the checks a page can make
 * that a browser cannot make about itself (CreepJS's cross-scope comparison,
 * incolumitas's TCP/IP fingerprint, rebrowser's Playwright-specific probes).
 *
 * The caller owns navigation: `runDetectorPage()` receives a page already at
 * that detector's `url` and settled. Nothing here navigates or closes anything,
 * and nothing throws.
 *
 * Parsing is deliberately defensive and split into pure functions that take a
 * snapshot of the page's text or table structure. When the markers section 2.3
 * described are not found, a check reports `status:'skip'` with
 * "page layout not recognised — parser needs updating". These parsers never
 * guess a value: a wrong green here would be worse than no check at all.
 */

import { makeCheck, verdict, evaluateWithTimeout } from './detectors.js';

/** Detector pages are heavy; they get longer than a self-probe. */
const PAGE_TIMEOUT_MS = 15000;
const TEXT_LIMIT = 120000;
const LAYOUT_SKIP = 'page layout not recognised — parser needs updating';

/** The five pages section 2.3 was read off. */
export const DETECTOR_PAGES = [
  { id: 'sannysoft', name: 'bot.sannysoft.com', url: 'https://bot.sannysoft.com/' },
  { id: 'rebrowser', name: 'bot-detector.rebrowser.net', url: 'https://bot-detector.rebrowser.net/' },
  { id: 'creepjs', name: 'CreepJS', url: 'https://abrahamjuliot.github.io/creepjs/' },
  { id: 'browserscan', name: 'browserscan.net/bot-detection', url: 'https://www.browserscan.net/bot-detection' },
  { id: 'incolumitas', name: 'bot.incolumitas.com', url: 'https://bot.incolumitas.com/' }
];

// ─── In-page snapshots ────────────────────────────────────────────────────────
// Serialised into the page, so self-contained. They only read; every judgement
// is made by the pure parsers below.

/** Every table row as cells with their text, class and resolved background. */
const tableRowsSnapshot = () => {
  const colour = (el) => {
    try { return String(window.getComputedStyle(el).backgroundColor || ''); } catch (_) { return ''; }
  };
  const rows = [];
  const trs = document.querySelectorAll('tr');
  for (let i = 0; i < trs.length && rows.length < 400; i++) {
    const cells = [];
    const tds = trs[i].querySelectorAll('th,td');
    for (let j = 0; j < tds.length; j++) {
      cells.push({
        text: (tds[j].innerText || tds[j].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        className: String(tds[j].className || ''),
        background: colour(tds[j]),
        rowBackground: colour(trs[i])
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
};

/** Visible page text, capped. */
const textSnapshot = (limit) => {
  const body = document.body;
  if (!body) return '';
  return (body.innerText || body.textContent || '').slice(0, limit);
};

/**
 * CreepJS: the small blocks that carry a `userAgent:` line, the page text, and
 * the main thread's own navigator values.
 *
 * The worker side is read from what CreepJS rendered — its worker probe is the
 * thing being measured — but the main-thread side is read from `navigator`
 * here rather than from a second rendered block. CreepJS labels its sections
 * with generated hashes (`Workerbcbbaa77`) and does not put the main-thread
 * identity in a block that can be matched by name, so pairing two rendered
 * blocks was guesswork; `navigator` is the same value the page compares
 * against and cannot be mismatched.
 */
const creepjsSnapshot = (limit) => {
  const blocks = [];
  const seen = {};
  const nodes = document.querySelectorAll('div, section, li');
  for (let i = 0; i < nodes.length && blocks.length < 40; i++) {
    // textContent first: CreepJS has thousands of nodes and innerText forces a
    // layout on every one of them.
    const raw = nodes[i].textContent || '';
    if (raw.length > 4000 || !/userAgent\s*:/i.test(raw)) continue;
    const text = (nodes[i].innerText || '').trim();
    if (!text || text.length > 2000 || seen[text]) continue;
    seen[text] = true;
    blocks.push(text);
  }
  const body = document.body;
  return {
    blocks,
    text: body ? (body.innerText || '').slice(0, limit) : '',
    main: {
      userAgent: String(navigator.userAgent || ''),
      platform: String(navigator.platform || ''),
      cores: String(navigator.hardwareConcurrency ?? '')
    }
  };
};

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/** 'red' | 'green' | 'amber' | null for a CSS colour string. */
export function classifyColour(colour) {
  const match = /rgba?\(([^)]+)\)/.exec(String(colour || ''));
  if (!match) return null;
  const parts = match[1].split(',').map((n) => Number(n.trim()));
  const [r, g, b] = parts;
  const alpha = parts.length > 3 ? parts[3] : 1;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || alpha === 0) return null;
  if (r > 140 && g < 120 && b < 120) return 'red';
  if (r > 180 && g > 140 && b < 120) return 'amber';
  if (g > 120 && r < 160 && b < 140) return 'green';
  return null;
}

const CLASS_PASS = /\b(passed|pass|ok|success|green|good)\b/i;
const CLASS_FAIL = /\b(failed|fail|error|danger|red|bad)\b/i;
const CLASS_WARN = /\b(warn|warning|amber|yellow)\b/i;
const TEXT_PASS = /^(pass|passed|ok|yes|true|normal|green|present)$/i;
const TEXT_FAIL = /^(fail|failed|error|no|false|abnormal|red|detected|missing)$/i;

/**
 * The name and pass/fail/warn status of one table row. A row is classified by
 * its cell classes first, then by a short verdict word, then by the background
 * colour the page painted it. Returns `status:null` when none of those applies.
 */
export function classifyRowStatus(cells) {
  if (!cells || !cells.length) return { name: '', status: null, value: '' };
  const name = cells[0].text;
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i];
    const className = cell.className || '';
    if (CLASS_FAIL.test(className)) return { name, status: 'fail', value: cell.text };
    if (CLASS_WARN.test(className)) return { name, status: 'warn', value: cell.text };
    if (CLASS_PASS.test(className)) return { name, status: 'pass', value: cell.text };
    const text = (cell.text || '').trim();
    if (text.length <= 12) {
      if (TEXT_FAIL.test(text)) return { name, status: 'fail', value: text };
      if (TEXT_PASS.test(text)) return { name, status: 'pass', value: text };
    }
    const colour = classifyColour(cell.background) || classifyColour(cell.rowBackground);
    if (colour === 'red') return { name, status: 'fail', value: cell.text };
    if (colour === 'amber') return { name, status: 'warn', value: cell.text };
    if (colour === 'green') return { name, status: 'pass', value: cell.text };
  }
  return { name, status: null, value: cells.length > 1 ? cells[1].text : '' };
}

/** A row name as a check-id fragment; already-camelCase names are kept verbatim. */
export function slugify(name) {
  const trimmed = String(name || '').trim();
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'row';
}

const normaliseKey = (name) => String(name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * A `label: value` field out of a block of visible text, where the value may
 * sit on the line AFTER the label.
 *
 * CreepJS renders every field that way — `userAgent:` and then the string on
 * its own line. The original same-line form of this helper could not cross a
 * newline, read nothing from CreepJS, and skipped the whole worker comparison.
 */
export function creepjsField(text, label) {
  const pattern = new RegExp('(?:^|\\n)[^\\S\\n]*' + label + '[^\\S\\n]*:[^\\S\\n]*\\n?[^\\S\\n]*([^\\n]+)', 'i');
  const match = pattern.exec(String(text || ''));
  const value = match ? match[1].trim() : '';
  return value || null;
}

const truncate = (text, limit = 400) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

const layoutSkip = (id, name, expected, detail = LAYOUT_SKIP) =>
  makeCheck(id, name, 'skip', expected, 'not read', detail);

// ─── Per-page parsers ─────────────────────────────────────────────────────────

/** sannysoft: one check counting the red rows. Pass means zero. */
export function parseSannysoft(rows) {
  const id = 'sannysoft:red-rows';
  const name = 'bot.sannysoft.com failed rows';
  const expected = 'no failed rows';
  const classified = (rows || []).map(classifyRowStatus).filter((row) => row.status && row.name);
  if (!classified.length) return [layoutSkip(id, name, expected)];
  const failed = classified.filter((row) => row.status === 'fail');
  const warned = classified.filter((row) => row.status === 'warn');
  return [
    makeCheck(
      id, name, verdict(failed.length === 0), expected,
      `${failed.length} of ${classified.length} classified rows failed`,
      failed.length
        ? `failed: ${truncate(failed.map((row) => row.name).join(', '), 600)}`
        : `${warned.length} rows amber: ${truncate(warned.map((row) => row.name).join(', ') || 'none', 300)}`
    )
  ];
}

/** The rows section 2.3 named; they always get a check, found or not. */
const REBROWSER_ROWS = ['runtimeEnableLeak', 'navigatorWebdriver', 'useragent'];

/**
 * rebrowser states each verdict as an emoji at the head of the row's NAME
 * cell — not as a class, a verdict word or a background colour, which is why
 * the generic classifier found nothing on it and every row skipped.
 *
 * A white circle means the probe never fired: rebrowser's dummyFn,
 * sourceUrlLeak, mainWorldExecution and exposeFunctionLeak tests only run if
 * the client calls into them, and a benchmark that never calls them must
 * report that as "not triggered", not as a pass.
 */
const REBROWSER_MARKERS = [['🔴', 'fail'], ['🟠', 'warn'], ['🟡', 'warn'], ['🟢', 'pass'], ['⚪', 'neutral'], ['⚫', 'neutral']];

export function classifyRebrowserRow(cells) {
  if (!cells || !cells.length) return { name: '', status: null, value: '' };
  // U+FE0F (variation selector) trails some of these emoji and not others.
  const raw = String(cells[0].text || '').replace(/️/g, '').trim();
  const marker = REBROWSER_MARKERS.find(([emoji]) => raw.startsWith(emoji));
  // No marker: the header row, or rebrowser restyled. Fall back rather than guess.
  if (!marker) return classifyRowStatus(cells);
  return {
    name: raw.slice(marker[0].length).trim(),
    status: marker[1],
    // [name, time since load, notes] — the notes cell carries the explanation.
    value: cells.length > 2 ? cells[2].text : (cells.length > 1 ? cells[1].text : '')
  };
}

/** rebrowser: one check per reported row. A red row is a fail; amber is too. */
export function parseRebrowser(rows) {
  const expected = 'row reports no detection';
  const classified = (rows || []).map(classifyRebrowserRow).filter((row) => row.name && row.status);
  if (!classified.length) {
    return REBROWSER_ROWS.map((row) =>
      layoutSkip(`rebrowser:${row}`, `bot-detector.rebrowser.net ${row}`, expected)
    );
  }
  const checks = classified.map((row) => {
    const rowId = slugify(row.name);
    if (row.status === 'neutral') {
      return makeCheck(
        `rebrowser:${rowId}`,
        `bot-detector.rebrowser.net ${row.name}`,
        'skip',
        expected,
        'not triggered',
        'this probe only fires when the client calls into it, and the harness does not'
      );
    }
    return makeCheck(
      `rebrowser:${rowId}`,
      `bot-detector.rebrowser.net ${row.name}`,
      // Amber is a partial detection on this page, so it is not a pass.
      row.status === 'pass' ? 'pass' : 'fail',
      expected,
      row.status === 'pass' ? 'green' : row.status === 'warn' ? 'amber' : 'red',
      truncate(row.value || '', 300)
    );
  });
  const seen = new Set(classified.map((row) => normaliseKey(row.name)));
  for (const row of REBROWSER_ROWS) {
    if (seen.has(normaliseKey(row))) continue;
    checks.push(layoutSkip(
      `rebrowser:${row}`,
      `bot-detector.rebrowser.net ${row}`,
      expected,
      'row not found on the page — parser needs updating'
    ));
  }
  return checks;
}

/**
 * CreepJS: worker scope vs main thread, and the headless score. The blocks are
 * matched by their own text, so a restyle skips rather than invents a result.
 */
export function parseCreepJS(snapshot) {
  const { blocks = [], text = '', main = null } = snapshot || {};
  const checks = [];

  const consistencyId = 'creepjs:worker-vs-main';
  const consistencyName = 'CreepJS worker scope matches the main thread';
  const consistencyExpected = 'worker userAgent, platform and cores match the main thread';
  const shortest = (candidates) => candidates.slice().sort((a, b) => a.length - b.length)[0] || null;
  const workerBlock = shortest(blocks.filter((block) => /worker/i.test(block)));
  const workerFields = workerBlock
    ? {
      userAgent: creepjsField(workerBlock, 'userAgent'),
      // CreepJS prints the platform inside the `device:` line, as
      // "Mac (MacIntel)" — the parenthesised half is navigator.platform.
      platform: (/\(([^)]+)\)/.exec(creepjsField(workerBlock, 'device') || '') || [])[1] || null,
      cores: (/cores\s*:\s*(\d+)/i.exec(workerBlock) || [])[1] || null
    }
    : null;
  const FIELDS = ['userAgent', 'platform', 'cores'];
  if (!workerBlock || !main) {
    checks.push(layoutSkip(consistencyId, consistencyName, consistencyExpected));
  } else {
    const differences = [];
    const missing = [];
    for (const field of FIELDS) {
      const mainValue = main[field] === undefined || main[field] === '' ? null : String(main[field]);
      const workerValue = workerFields[field];
      if (mainValue === null || workerValue === null) { missing.push(field); continue; }
      if (mainValue !== workerValue) differences.push(`${field}: worker "${workerValue}" vs main "${mainValue}"`);
    }
    if (missing.length === FIELDS.length) {
      checks.push(layoutSkip(consistencyId, consistencyName, consistencyExpected));
    } else {
      checks.push(makeCheck(
        consistencyId, consistencyName, verdict(differences.length === 0), consistencyExpected,
        differences.length ? `${differences.length} of ${FIELDS.length - missing.length} fields differ` : 'all compared fields match',
        truncate([...differences, missing.length ? `not shown: ${missing.join(', ')}` : ''].filter(Boolean).join(' | ') || 'no differences', 600)
      ));
    }
  }

  const scoreId = 'creepjs:headless-score';
  const scoreName = 'CreepJS headless score';
  const scoreExpected = '0%';
  const patterns = [
    /(\d+(?:\.\d+)?)\s*%\s*(?:like\s+)?headless/i,
    /headless(?:\s*rating)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/i
  ];
  let score = null;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) { score = Number(match[1]); break; }
  }
  if (score === null) checks.push(layoutSkip(scoreId, scoreName, scoreExpected));
  else checks.push(makeCheck(scoreId, scoreName, verdict(score === 0), scoreExpected, `${score}%`));

  return checks;
}

/** browserscan: the bot verdict, and whether a HeadlessChrome brand is on show. */
export function parseBrowserscan(text, engine) {
  const pageText = String(text || '');
  const checks = [];

  const verdictId = 'browserscan:verdict';
  const verdictName = 'browserscan.net bot-detection verdict';
  const verdictExpected = 'no abnormal check';
  const abnormal = pageText.match(/abnormal/gi) || [];
  const normal = pageText.match(/normal/gi) || [];
  if (!normal.length && !abnormal.length) {
    checks.push(layoutSkip(verdictId, verdictName, verdictExpected));
  } else {
    checks.push(makeCheck(
      verdictId, verdictName, verdict(abnormal.length === 0), verdictExpected,
      abnormal.length ? `${abnormal.length} "Abnormal" markers` : `${normal.length - abnormal.length} "Normal" markers, none abnormal`
    ));
  }

  const brandId = 'browserscan:headless-brand';
  const brandName = 'browserscan.net userAgentData brands';
  const brandExpected = 'no HeadlessChrome brand';
  if (/HeadlessChrome/i.test(pageText)) {
    checks.push(makeCheck(brandId, brandName, 'fail', brandExpected, 'HeadlessChrome shown on the page'));
  } else if (engine === 'camoufox') {
    checks.push(makeCheck(brandId, brandName, 'skip', brandExpected, 'not applicable', 'Firefox exposes no navigator.userAgentData'));
  } else if (/userAgentData|brands/i.test(pageText)) {
    checks.push(makeCheck(brandId, brandName, 'pass', brandExpected, 'brands shown, none headless'));
  } else {
    checks.push(layoutSkip(brandId, brandName, brandExpected, 'page did not display userAgentData brands — parser needs updating'));
  }

  return checks;
}

/** incolumitas: the FAILed entries of its `"testName": "OK" | "FAIL"` results. */
export function parseIncolumitas(text) {
  const id = 'incolumitas:failed-tests';
  const name = 'bot.incolumitas.com failed tests';
  const expected = 'no FAILed test';
  const results = new Map();
  const pattern = /"?([A-Za-z][A-Za-z0-9_]{2,})"?\s*:\s*"?(OK|PASS|PASSED|FAIL|FAILED)"?/g;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) results.set(match[1], match[2].toUpperCase());
  if (!results.size) return [layoutSkip(id, name, expected)];
  const failed = [...results].filter(([, value]) => value.startsWith('FAIL')).map(([test]) => test);
  return [
    makeCheck(
      id, name, verdict(failed.length === 0), expected,
      `${failed.length} of ${results.size} tests FAILed`,
      failed.length ? truncate(failed.join(', '), 600) : `${results.size} tests read, all OK`
    )
  ];
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const RUNNERS = {
  sannysoft: async (page) => {
    const rows = await evaluateWithTimeout(page, tableRowsSnapshot, undefined, PAGE_TIMEOUT_MS);
    if (!rows.ok) return [layoutSkip('sannysoft:red-rows', 'bot.sannysoft.com failed rows', 'no failed rows', rows.error)];
    return parseSannysoft(rows.value);
  },
  rebrowser: async (page) => {
    const rows = await evaluateWithTimeout(page, tableRowsSnapshot, undefined, PAGE_TIMEOUT_MS);
    if (!rows.ok) {
      return REBROWSER_ROWS.map((row) =>
        layoutSkip(`rebrowser:${row}`, `bot-detector.rebrowser.net ${row}`, 'row reports no detection', rows.error)
      );
    }
    return parseRebrowser(rows.value);
  },
  creepjs: async (page) => {
    const snapshot = await evaluateWithTimeout(page, creepjsSnapshot, TEXT_LIMIT, PAGE_TIMEOUT_MS);
    if (!snapshot.ok) {
      return [
        layoutSkip('creepjs:worker-vs-main', 'CreepJS worker scope matches the main thread', 'worker matches main', snapshot.error),
        layoutSkip('creepjs:headless-score', 'CreepJS headless score', '0%', snapshot.error)
      ];
    }
    return parseCreepJS(snapshot.value);
  },
  browserscan: async (page, engine) => {
    const text = await evaluateWithTimeout(page, textSnapshot, TEXT_LIMIT, PAGE_TIMEOUT_MS);
    if (!text.ok) {
      return [
        layoutSkip('browserscan:verdict', 'browserscan.net bot-detection verdict', 'no abnormal check', text.error),
        layoutSkip('browserscan:headless-brand', 'browserscan.net userAgentData brands', 'no HeadlessChrome brand', text.error)
      ];
    }
    return parseBrowserscan(text.value, engine);
  },
  incolumitas: async (page) => {
    const text = await evaluateWithTimeout(page, textSnapshot, TEXT_LIMIT, PAGE_TIMEOUT_MS);
    if (!text.ok) return [layoutSkip('incolumitas:failed-tests', 'bot.incolumitas.com failed tests', 'no FAILed test', text.error)];
    return parseIncolumitas(text.value);
  }
};

/**
 * Read one detector page. The page must already be at that detector's `url` and
 * settled; this only evaluates and parses. Never navigates, never throws.
 * @param {import('playwright').Page} page
 * @param {string} pageId one of DETECTOR_PAGES[].id
 * @param {{engine:'chromium'|'camoufox'}} context
 * @returns {Promise<import('./detectors.js').DetectorCheck[]>}
 */
export async function runDetectorPage(page, pageId, { engine } = {}) {
  const runner = RUNNERS[pageId];
  if (!runner) {
    return [makeCheck(
      `${pageId}:unknown`, `unknown detector page "${pageId}"`, 'skip', 'a known page id', String(pageId),
      `known ids: ${DETECTOR_PAGES.map((p) => p.id).join(', ')}`
    )];
  }
  try {
    return await runner(page, engine);
  } catch (error) {
    // The runners already absorb evaluate failures; this only fires if the page
    // itself is gone. A dead page is a skip, never a pass and never a throw.
    return [makeCheck(
      `${pageId}:unread`, `${pageId} could not be read`, 'skip', 'page readable', 'not read',
      error?.message || String(error)
    )];
  }
}
