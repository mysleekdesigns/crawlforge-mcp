/**
 * challengeDetection.js — recognise a bot-wall interstitial served as a page.
 *
 * Cloudflare, Amazon, DataDome, PerimeterX and Akamai all answer a blocked
 * request with HTTP 200 and a page of their own: a title, some prose and a
 * challenge script. Reported as a successful scrape, that page hides the
 * block — producthunt.com came back "success:true, title: Just a moment..."
 * for three regression rounds (R10 Q1 → R15, 2026-09-04). A title match is
 * definitive; a script or form marker is definitive only on a short page,
 * because a real page can legitimately embed a Turnstile widget.
 */

const SHORT_PAGE_CHARS = 4000;

const CHALLENGES = [
  {
    vendor: 'cloudflare',
    title: /^just a moment/i,
    markers: /challenges\.cloudflare\.com|cf-chl-|_cf_chl_opt|cf_chl_rc_|window\._cf_chl/i,
    evidence: 'a Cloudflare challenge script'
  },
  {
    vendor: 'amazon',
    // The robot check is the only Amazon page whose form posts to validateCaptcha.
    definitive: /action="[^"]*validateCaptcha/i,
    evidence: 'the validateCaptcha form'
  },
  {
    vendor: 'datadome',
    markers: /captcha-delivery\.com\/captcha|geo\.captcha-delivery\.com|dd\.captcha/i,
    evidence: 'a DataDome captcha frame'
  },
  {
    vendor: 'perimeterx',
    markers: /px-captcha|_pxCaptcha|human-challenge/i,
    evidence: 'a PerimeterX / HUMAN challenge element'
  },
  {
    vendor: 'akamai',
    title: /^access denied/i,
    markers: /errors\.edgesuite\.net/i,
    evidence: 'an Akamai access-denied page'
  },
  {
    // Vercel's Attack Challenge Mode answers with HTTP 429, an
    // x-vercel-mitigated: challenge header and a JavaScript interstitial
    // titled "Vercel Security Checkpoint" (lesswrong.com, hashicorp.com,
    // bombas.com, R17 2026-09-04). Chromium solves it and reloads; camoufox
    // was left on the interstitial, which then read as a successful scrape.
    vendor: 'vercel',
    title: /^vercel security checkpoint/i,
    markers: /vercel\.link\/security-checkpoint|_vercel\/challenge|x-vercel-challenge-token/i,
    evidence: 'a Vercel Security Checkpoint page'
  }
];

/**
 * @param {{ title?: string, html?: string, text?: string }} page
 * @returns {{ vendor: string, evidence: string } | null}
 */
export function detectChallengePage({ title = '', html = '', text = '' } = {}) {
  const cleanTitle = (title || '').trim();
  const visible = (text || '').replace(/\s+/g, ' ').trim();
  const shortPage = visible.length < SHORT_PAGE_CHARS;
  for (const challenge of CHALLENGES) {
    if (challenge.title && challenge.title.test(cleanTitle)) {
      return { vendor: challenge.vendor, evidence: `title "${cleanTitle}"` };
    }
    if (challenge.definitive && challenge.definitive.test(html)) {
      return { vendor: challenge.vendor, evidence: challenge.evidence };
    }
    if (shortPage && challenge.markers && challenge.markers.test(html)) {
      return { vendor: challenge.vendor, evidence: `${challenge.evidence} on a ${visible.length}-character page` };
    }
  }
  return null;
}

export default detectChallengePage;
