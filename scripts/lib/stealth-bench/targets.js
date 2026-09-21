/**
 * targets.js — the twelve bot walls of section 2.2 of
 * docs/STEALTH_REVIEW_2026-09.md, as data.
 *
 * Changing a URL here changes what the matrix means, so each row also carries
 * the cell the 2026-09-21 review recorded for it. The report prints the deltas
 * against `recorded`, which is how "reproduces the section 2 matrix within one
 * run's noise" is checked without diffing two tables by eye.
 *
 * `waitFor` is the wait the review used (6 s on every wall). `retryWaitFor` is
 * the one retry it documented: nowsecure.nl was still blocked at 15 s, and the
 * harness has to try that before it can say so.
 *
 * Every target is public and unauthenticated. trustpilot.com is in the list on
 * purpose: robots.txt disallows CrawlForge there, and the run must report that
 * honestly instead of quietly dropping the row.
 */

export const DEFAULT_WAIT_MS = 6000;

export const WALL_TARGETS = [
  {
    id: 'nowsecure',
    url: 'https://nowsecure.nl',
    vendor: 'Cloudflare, interactive challenge',
    waitFor: DEFAULT_WAIT_MS,
    retryWaitFor: 15000,
    recorded: { plain: 'Blocked', chromium: 'Blocked', camoufox: 'Blocked' }
  },
  {
    id: 'indeed',
    url: 'https://www.indeed.com/cmp/Burger-King/reviews',
    vendor: 'Cloudflare Turnstile',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Blocked', chromium: 'Blocked', camoufox: 'Pass' }
  },
  {
    id: 'quora',
    url: 'https://www.quora.com',
    vendor: 'Cloudflare (login wall embeds Turnstile)',
    waitFor: DEFAULT_WAIT_MS,
    // Both engines rendered the real login page and the verdict layer called it
    // blocked anyway (finding 6). A Pass here means Phase 1 fixed the verdict.
    recorded: { plain: 'Blocked', chromium: 'Blocked', camoufox: 'Blocked' }
  },
  {
    id: 'harrods',
    url: 'https://www.harrods.com',
    vendor: 'Akamai',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Blocked', chromium: 'Blocked', camoufox: 'Pass' }
  },
  {
    id: 'g2',
    url: 'https://www.g2.com',
    vendor: 'DataDome',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Blocked', chromium: 'Blocked', camoufox: 'Blocked' }
  },
  {
    id: 'stackoverflow',
    url: 'https://stackoverflow.com/questions',
    vendor: 'Cloudflare',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Blocked', chromium: 'Pass', camoufox: 'Pass' }
  },
  {
    id: 'leboncoin',
    url: 'https://www.leboncoin.fr',
    vendor: 'DataDome',
    waitFor: DEFAULT_WAIT_MS,
    // One run each in the review, and the two engines came out the reverse of
    // Indeed and Harrods. Treat a flip here as vendor noise, not a regression.
    recorded: { plain: 'Blocked', chromium: 'Pass', camoufox: 'Blocked' }
  },
  {
    id: 'producthunt',
    url: 'https://www.producthunt.com',
    vendor: 'Cloudflare',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Pass', chromium: 'n/a', camoufox: 'n/a' }
  },
  {
    id: 'lesswrong',
    url: 'https://www.lesswrong.com',
    vendor: 'Vercel checkpoint',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Pass', chromium: 'n/a', camoufox: 'n/a' }
  },
  {
    id: 'zalando',
    url: 'https://www.zalando.co.uk',
    vendor: 'Akamai',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'Pass', chromium: 'n/a', camoufox: 'n/a' }
  },
  {
    id: 'carvana',
    url: 'https://www.carvana.com',
    vendor: 'client-rendered shell',
    waitFor: DEFAULT_WAIT_MS,
    // The review's Pass was metadata only: the shell carries a title and no
    // article text, which the verdict accepts.
    recorded: { plain: 'Pass', chromium: 'n/a', camoufox: 'n/a' }
  },
  {
    id: 'trustpilot',
    url: 'https://www.trustpilot.com',
    vendor: 'DataDome',
    waitFor: DEFAULT_WAIT_MS,
    recorded: { plain: 'skipped (robots)', chromium: 'skipped (robots)', camoufox: 'skipped (robots)' }
  }
];
