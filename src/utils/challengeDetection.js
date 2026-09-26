/**
 * challengeDetection.js — the challenge-vendor tables, refined for widgets.
 *
 * The tables moved to crawlforge-extractors 1.7.0 so the REST `scrape` route
 * reaches the same verdict as the MCP server (Phase 0, 0.1). Callers keep
 * importing from here.
 *
 * Upstream treats a vendor marker on a page under 4000 visible characters as
 * definitive, which reports a block on a real page that merely embeds a
 * Turnstile widget: quora.com rendered its real 397-character login page on
 * both engines and the verdict layer still called it blocked (2026-09-21
 * benchmark, finding 6). A widget embed and an interstitial are separable by
 * what else is in the document, not by length — the interstitial carries
 * Cloudflare's challenge bootstrap or the prose it shows while it holds the
 * request, and a page that merely embeds the widget carries neither. So the
 * refinement below suppresses that one case and leaves every other path
 * upstream owns (a challenge title, Amazon's validateCaptcha form, DataDome,
 * PerimeterX, Akamai) exactly as it is. Worth upstreaming.
 */

import { detectChallengePage as detectUpstream } from 'crawlforge-extractors';

// The bootstrap a real interstitial ships and a page embedding a widget never
// does: Cloudflare's challenge options blob and its cf-chl- element ids,
// Vercel's checkpoint script and token. Two Cloudflare tokens are deliberately
// NOT here, because a real page legitimately carries both:
//   - challenges.cloudflare.com, the widget's own script host;
//   - cf-chl-widget-*, the hidden response input Turnstile names itself.
// quora.com's login page carries exactly one cf-chl- token and it is
// "cf-chl-widget-gaztz_response" (measured 2026-09-21), so a bare cf-chl- test
// matches every widget embed there is. Hence the lookahead — do not put
// cf-chl- back.
const INTERSTITIAL_MARKERS = [
  { vendor: 'cloudflare', markers: /_cf_chl_opt|window\._cf_chl|cf-chl-(?!widget)|cf_chl_rc_/i, evidence: 'the Cloudflare challenge bootstrap' },
  { vendor: 'vercel', markers: /_vercel\/challenge|vercel\.link\/security-checkpoint|x-vercel-challenge-token/i, evidence: 'the Vercel Security Checkpoint bootstrap' }
];

// What an interstitial says to the reader while it holds the request.
const INTERSTITIAL_PROSE = /verifying you are human|checking your browser|needs to review the security of your connection|enable javascript and cookies to continue/i;

// The floor for "this document has a real body". quora.com's real login page
// is 397 visible characters, so the floor has to sit below that; Cloudflare's
// own interstitial renders well under 200 characters of prose ("Verifying you
// are human…", "Enable JavaScript and cookies to continue"), so a genuinely
// empty wall carrying only a widget marker is still short enough to be caught.
const REAL_BODY_MIN_CHARS = 200;

/**
 * Whether a document is a challenge wall rather than the page: a known
 * challenge title OR a challenge bootstrap marker, regardless of the title and
 * regardless of page length, so a custom-titled interstitial (nowsecure.nl,
 * whose title is just "nowsecure.nl") is recognised too.
 *
 * @param {{ title?: string, html?: string, text?: string }} page
 * @returns {{ vendor: string, evidence: string } | null}
 */
export function looksLikeInterstitial(page = {}) {
  const { title = '', html = '' } = page;
  // A title on its own reaches only upstream's title branch — its marker
  // branch needs html and its definitive branch a form — so the challenge
  // titles stay in one place rather than being copied here.
  const byTitle = detectUpstream({ title });
  if (byTitle) return byTitle;
  for (const { vendor, markers, evidence } of INTERSTITIAL_MARKERS) {
    if (markers.test(html)) return { vendor, evidence };
  }
  return null;
}

/** A title, a body a reader could read, and none of the interstitial's prose. */
function looksLikeRealPage({ title = '', text = '' }) {
  if (!String(title).trim()) return false;
  const visible = String(text).replace(/\s+/g, ' ').trim();
  if (visible.length < REAL_BODY_MIN_CHARS) return false;
  return !INTERSTITIAL_PROSE.test(`${title} ${visible}`);
}

/**
 * A page the server answered 200 that carries only a Turnstile widget: no
 * bootstrap (the caller has already ruled that out) and none of the
 * interstitial's prose. Cloudflare serves its walls as 403; a 200 with a
 * widget is a page that embeds one. nowsecure.nl is exactly this — 200 to the
 * honest CrawlForge UA, 43 visible characters and two widgets on Cloudflare's
 * test sitekey — and every "Blocked" cell recorded for it came from this
 * module, not from Cloudflare (2026-09-25). The status is what separates it
 * from a widget-only wall, which the length floor cannot; without a status the
 * floor still decides. It still has to be a document — a title and some text —
 * so an empty 200 shell carrying only the widget script stays a wall, as
 * Phase 1 decided.
 */
function looksLikeWidgetOnlyPage({ status, title = '', text = '' }) {
  if (status !== 200) return false;
  const visible = String(text).replace(/\s+/g, ' ').trim();
  if (!String(title).trim() || !visible) return false;
  return !INTERSTITIAL_PROSE.test(`${title} ${visible}`);
}

/**
 * @param {{ title?: string, html?: string, text?: string, status?: number|null }} page
 * @returns {{ vendor: string, evidence: string } | null}
 */
export function detectChallengePage(page = {}) {
  const hit = detectUpstream(page);
  // Cloudflare is the only vendor whose markers a real page can carry, so it is
  // the only one refined. Reaching here with a cloudflare hit that is not an
  // interstitial means the evidence was the widget's own script host or
  // response input on a short page.
  if (!hit || hit.vendor !== 'cloudflare') return hit;
  if (looksLikeInterstitial(page)) return hit;
  if (looksLikeWidgetOnlyPage(page)) return null;
  return looksLikeRealPage(page) ? null : hit;
}

export default detectChallengePage;
