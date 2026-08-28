/**
 * Claim admission filters for deep_research synthesis.
 *
 * Claims are extractive sentences pulled out of source pages by the summarize
 * tool, so whatever the page starts with is a candidate claim. On a live run
 * (2026-08-28, "What anti-bot systems do major websites use in 2026") the top
 * finding was an arXiv front-matter block beginning "DOI: XXXXXXX.XXXXXXX" —
 * document furniture, not a research claim. These predicates reject that class
 * of text before it can become a key finding.
 */

// Document furniture: DOI stubs, retrieval notes, ACM/arXiv front matter,
// copyright rows, contact emails. Matched anywhere in the candidate claim.
const FRONT_MATTER_PATTERNS = [
  /\bdoi\s*:/i,
  /\bdoi\.org\//i,
  /\barxiv\s*:\s*\d/i,
  /\bccs concepts?\b/i,
  /\bacm reference format\b/i,
  /\bretrieved (?:from|on)\b/i,
  /\bissn\b|\bisbn\b/i,
  /\ball rights reserved\b/i,
  /\bcopyright\s*(?:©|\(c\)|\d{4})/i,
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
  // "Permission to make digital or hard copies…" — the ACM licence block.
  /\bpermission to make digital\b/i,
  // Bot-challenge interstitials. A research run on anti-bot systems scores
  // these as highly relevant — they are literally about bot detection — so the
  // relevance gate cannot catch them (live 2026-08-28: "Checking your browser.
  // This only takes a moment." was the top finding). Phrases are specific to
  // the challenge chrome; a claim that merely discusses CAPTCHAs is untouched.
  /\bchecking your browser\b/i,
  /\bjust a moment\b/i,
  /\bi am not a robot\b/i,
  /\bthis check is for\b/i,
  /\bverify (?:you are|that you are) (?:a )?human\b/i,
  /\bplease enable (?:javascript|cookies)\b/i,
  /\bray id\b/i,
  /\bddos protection by\b/i,
  /\bperformance (?:&|and) security by\b/i
];

// Tokens that mark an affiliation line rather than a sentence about the topic.
const AFFILIATION_TOKENS = new Set([
  'university', 'universities', 'institute', 'institut', 'department', 'dept',
  'faculty', 'college', 'school', 'laboratory', 'laboratoire', 'academy',
  'inc', 'llc', 'ltd', 'gmbh', 'corp', 'corporation', 'foundation'
]);

// Closed-class finite verbs. A declarative claim contains one of these or an
// inflected lexical verb (see hasFiniteVerb).
const AUXILIARY_AND_MODAL_VERBS = new Set([
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'has', 'have', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must'
]);

// Frequent base-form verbs. A plural subject takes an uninflected verb
// ("Akamai and Imperva rely on device fingerprinting"), which the -s/-ed test
// below cannot see.
const COMMON_BASE_VERBS = new Set([
  'use', 'rely', 'block', 'detect', 'deploy', 'prevent', 'provide', 'offer',
  'include', 'require', 'allow', 'make', 'run', 'work', 'help', 'need', 'show',
  'report', 'find', 'remain', 'become', 'appear', 'support', 'handle',
  'protect', 'track', 'monitor', 'serve', 'apply', 'target', 'return', 'know',
  'take', 'give', 'keep', 'add', 'build', 'create', 'enable', 'identify',
  'reduce', 'increase', 'mean', 'occur', 'exist', 'vary', 'differ', 'depend',
  'contain', 'combine', 'measure', 'generate'
]);

// Lowercase words that end in -s/-es/-ed but are not verbs; without these the
// inflection test in hasFiniteVerb reads plural nouns as verbs.
const NOT_VERBS = new Set([
  'as', 'its', 'this', 'thus', 'less', 'gas', 'plus', 'versus', 'yes',
  'always', 'perhaps', 'various', 'previous', 'obvious', 'serious', 'numerous',
  'analysis', 'access', 'process', 'business', 'address', 'success', 'progress'
]);

// Marketing register. Present in a vendor's own copy, rare in a factual claim.
const PROMOTIONAL_CUES = [
  /\bbest\b/i, /\bleading\b/i, /\bindustry[- ]leading\b/i, /\bworld[- ]class\b/i,
  /\bfastest\b/i, /\bmost (?:accurate|reliable|powerful|advanced)\b/i,
  /\btrusted by\b/i, /\breliable\b/i, /\beffortless/i, /\bseamless/i,
  /\bpowerful\b/i, /\bsolution\b/i, /\bunlimited\b/i, /\bguarantee/i,
  /\bget started\b/i, /\bsign up\b/i, /\bfree trial\b/i, /\bno credit card\b/i,
  /\bstart (?:scraping|crawling|building)\b/i, /\bcontact sales\b/i,
  /\bpricing\b/i, /\bplans start\b/i, /\b99\.9\d*%\b/i,
  /\bmost widely used\b/i, /\bmost popular\b/i
];

// A named commercial offering: a capitalized name bound to a product noun
// ("Zyte API", "Scrapy Cloud", "Managed Data service"), or a third-person
// possessive standing in for one ("their API"). This is the SUBJECT half of a
// recommendation. Nothing here names a company — the test is grammatical.
const NAMED_OFFERING_PATTERNS = [
  /\b[A-Z][A-Za-z0-9.\-]+\s+(?:APIs?|SDKs?|[Pp]latform|[Pp]roduct|[Ss]ervice|[Ss]uite|[Tt]oolkit|[Cc]loud)\b/,
  /\b(?:their|its|our)\s+(?:api|sdk|platform|product|service|suite|toolkit|cloud|tool)\b/i,
  /\bflagship product\b/i
];

// The PREDICATE half: an offering credited with doing the work for you, or
// ranked above its peers. Deliberately excludes plain capability verbs
// ("detects", "blocks", "scores", "protects"), which is how factual sentences
// about anti-bot systems read — those must survive to answer the question.
const PITCH_PREDICATE_PATTERNS = [
  /\bdesigned to\b/i, /\bbuilt to\b/i, /\bpurpose[- ]built\b/i,
  /\boffers?\b/i, /\bprovides?\b/i, /\bdelivers?\b/i,
  /\b(?:lets|helps|allows) you\b/i, /\bso you can\b/i,
  /\bautomates?\b/i, /\bunblocks?\b/i, /\bhandles? (?:everything|it all|the (?:complexity|hard part))/i,
  /\branked (?:#\s*1|number one|first)\b/i, /\ball[- ]in[- ]one\b/i,
  /\bout of the box\b/i, /\bno code (?:required|needed)\b/i,
  /\bstarts? at \$/i, /\bfree tier\b/i
];

/** Text that is document furniture rather than a claim about the topic. */
export function isFrontMatter(text) {
  return FRONT_MATTER_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Does the text contain a finite verb?
 *
 * Deliberately permissive: a closed list of auxiliaries, modals and frequent
 * base-form verbs, plus any lowercase token inflected as -s/-es/-ed. It
 * rejects verbless fragments
 * (author rows, keyword lists, DOI stubs), not bad grammar. Capitalized tokens
 * are never counted, so "Jane Doe, University of Somewhere" has no verb while
 * "Cloudflare uses TLS fingerprinting" does.
 */
export function hasFiniteVerb(text) {
  const tokens = text.split(/[^A-Za-z'-]+/).filter(Boolean);

  return tokens.some(token => {
    const lower = token.toLowerCase();
    if (AUXILIARY_AND_MODAL_VERBS.has(lower)) return true;
    // Lexical verbs only in their lowercase form — a capitalized token here is
    // a proper noun ("Systems Inc"), not a verb.
    if (token !== lower || NOT_VERBS.has(lower)) return false;
    return COMMON_BASE_VERBS.has(lower) || /^[a-z]{3,}(?:s|es|ed)$/.test(lower);
  });
}

/**
 * Share of tokens that look like proper nouns or affiliation words, ignoring
 * the first token (a normal sentence starts capitalized).
 */
export function properNounDensity(text) {
  const tokens = text.split(/[^A-Za-z'-]+/).filter(Boolean).slice(1);
  if (tokens.length === 0) return 0;

  const marked = tokens.filter(
    token => /^[A-Z]/.test(token) || AFFILIATION_TOKENS.has(token.toLowerCase())
  ).length;

  return marked / tokens.length;
}

// Above this share of proper-noun/affiliation tokens the text reads as an
// author or affiliation block rather than a sentence about the topic.
const PROPER_NOUN_DENSITY_MAX = 0.5;

/** A candidate claim is admissible when it is a verb-bearing, non-front-matter sentence. */
export function isAdmissibleClaim(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return false;
  if (isFrontMatter(text)) return false;
  if (!hasFiniteVerb(text)) return false;
  return properNounDensity(text) <= PROPER_NOUN_DENSITY_MAX;
}

/** Brand token of a URL's host: "https://scrape.do/blog" -> "scrape". */
export function brandFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const labels = host.split('.');
    // Drop the public suffix; for "scrape.do" that leaves "scrape", for
    // "api.datadome.co.uk" it leaves "datadome".
    const brand = labels.length > 2 && labels[labels.length - 2].length <= 3
      ? labels[labels.length - 3]
      : labels[labels.length - 2];
    return brand || null;
  } catch {
    return null;
  }
}

/**
 * Is this claim a vendor describing its own product in marketing register?
 *
 * Signal: the text refers to the site it came from (its brand token, or a
 * first-person "we/our") AND uses at least one marketing cue. That is enough
 * to stop "Scrape.do offers reliable scraping with effective anti-bot bypass"
 * being laundered into a research conclusion.
 *
 * On its own it does not catch one vendor pitching another vendor's product —
 * see looksLikeVendorPage + isProductPitch, which cover that case.
 */
export function isVendorSelfPromotion(text, sourceUrl) {
  if (typeof text !== 'string' || text.length === 0) return false;

  const brand = brandFromUrl(sourceUrl);
  const selfReference =
    (brand && brand.length >= 3 && new RegExp(`\\b${brand}\\b`, 'i').test(text)) ||
    /\b(?:we|our|us)\b/i.test(text);

  return Boolean(selfReference) && PROMOTIONAL_CUES.some(cue => cue.test(text));
}

/**
 * Is this claim a recommendation rather than evidence?
 *
 * A recommendation has a shape: its subject is a named commercial offering and
 * its predicate credits that offering with doing the work or ranking above its
 * peers. "Their flagship product, Zyte API, is a web scraping API designed to
 * unblock, render, and extract data from any website" has both halves; "CF-RAY
 * in the response header means Cloudflare" and "Modern anti-bot systems
 * fingerprint your TLS handshake" have neither, and both must survive — they
 * are the answer to an anti-bot question.
 *
 * The test is grammatical and domain-independent: no company or product name
 * appears anywhere in this module, and a page describing its own product and a
 * page describing a peer's are treated identically.
 *
 * It does NOT catch a recommendation written without a product noun ("Scrapy is
 * what most teams reach for"), and it will flag a factual sentence that
 * describes a named product as doing work for you — including an anti-bot
 * vendor's own product page. Both halves must match, which is what keeps
 * ordinary claims about detection systems out of it.
 */
export function isProductRecommendation(text) {
  if (typeof text !== 'string' || text.length === 0) return false;

  return NAMED_OFFERING_PATTERNS.some(pattern => pattern.test(text)) &&
    PITCH_PREDICATE_PATTERNS.some(pattern => pattern.test(text));
}
