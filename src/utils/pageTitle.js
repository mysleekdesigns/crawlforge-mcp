/**
 * Document title from a cheerio root.
 *
 * A bare `$('title')` also matches inline `<svg><title>` elements in the body,
 * and cheerio's `.text()` concatenates every match: roc-lang.org came back as
 * "Roc — a fast, friendly, functional languageGitHubYouTubeTwitter..." in the
 * R17 sweep (2026-09-04), the same defect extract_metadata fixed for MDN on
 * 2026-08-26. Read the head title first and fall back to the first `<title>`
 * anywhere for fragments without a head.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string} trimmed title or ''
 */
export function pageTitle($) {
  return $('head > title').first().text().trim() || $('title').first().text().trim();
}

export default pageTitle;
