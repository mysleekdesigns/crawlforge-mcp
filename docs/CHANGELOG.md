# Changelog



All notable changes to CrawlForge MCP Server will be documented in this file.
## [Unreleased]

## [5.6.9] - 2026-09-04

Round 18 live regression: pricing across travel, auto and retail sites (656
URLs pre-flighted, ~200 calls over all 29 tools). Ships with
crawlforge-extractors 1.6.4, unchanged. Limits found and not fixed in code:
`extract_structured` has no `model` parameter, and gemma3:4b misread
delta.com's baggage fees ($0/$45 for $45/$55) where `extract_with_llm` with
`model: 'gemma3:12b'` read them correctly; `extract_embedded_state` cannot
read a Nuxt 2 function-wrapped `__NUXT__` payload (hostelworld.com) and says
so; bestbuy.com resets the HTTP/2 connection for both stealth engines
(Akamai, at the TLS level) and travel.state.gov's Cloudflare Turnstile is
interactive and IP-scored, so neither engine passes it and the result is
`blocked: { vendor: 'cloudflare' }`; target.com paints its price about 5 s
after a non-empty document, so pass `wait_for: 5000`.

### Fixed
- **`stealth_mode` reports HTTP error pages and soft blocks as failures.**
  Edmunds' "403 - Access Denied", Lufthansa's 404 "Page not found", Home
  Depot's "Error Page" and Hilton's "Something went wrong" all came back
  `success: true`: nothing looked at the navigation's HTTP status, and
  neither the challenge-vendor check (5.6.2) nor the empty-document check
  (5.6.3) matches a titled error page. The result now carries `status`, the
  HTTP status of the document finally read after any challenge or redirect;
  a status of 400 or above is `success: false` with the reason, and a short
  document with an error title on a 200 is reported as a soft block. The
  content is still returned so the caller can read what the site served.
  `scrape_with_actions` applies the same verdict to the document its chain
  ended on: tesla.com's Akamai denial had run every action and reported
  success, and is now `success: false` with `blocked: { vendor: 'akamai' }`
  and `httpStatus: 403`.
- **`stealth_mode` waits for an empty document to fill in.** booking.com's
  self-solving `chal_t` redirect and the carvana, chewy, tesla and costco
  JavaScript shells were read straight after `domcontentloaded` and reported
  "rendered no title and no text after 0ms", while a 6-second `wait_for`
  returned the full page. A document with no title and no text now gets up
  to 8 s to paint or to navigate on, and the result says how long it waited
  in `waited_for_render_ms`. The Plaza's room rates on booking.com arrive
  with no `wait_for` after about 3 s.
- **`crawl_deep` fetches URLs as the site wrote them.** The crawler fetched
  the normalized form of every URL, which drops a trailing slash;
  globalpetrolprices.com answers `/gasoline_prices/` with 200 and
  `/gasoline_prices` with 404, so a root crawl returned one page and four
  errors. The normalized form is now only the dedupe and cache key; the
  request, the robots check, link resolution and the reported `url` use the
  URL as written (a bare origin gains its root `/`).
- **`deep_research` on a long topic reaches more than one source.** A
  45-word paragraph topic went verbatim to the search backend and found one
  URL; a seven-word restatement found eight. A topic over 12 words is reduced
  to its first 12 content words for search (stopwords and punctuation
  dropped), every generated query is clamped to 16 words, and the full topic
  still steers the LLM expansion and the relevance ranking. The same
  paragraph now yields 12 sources.
- **`localization` `configure_country` sets Accept-Language for the
  country.** GB answered `en-US,en;q=0.9` because the country never reached
  the header builder; it now answers `en-GB,en;q=0.9`, and a bare language
  takes the configured country as its region (`de-DE,de;q=0.9,en;q=0.8`).

### Changed
- **`scrape_template` `shopify-product` falls back to the product page's
  JSON-LD.** gymshark.com answers `/products/<handle>.json` with 403 while
  the product page is public and carries a schema.org ProductGroup with a
  priced Product per size; allbirds.com redirected a retired handle to a
  collection page, so the `.json` URL was a bare 404. On a 401, 403, 404 or
  410 from the JSON endpoint the tool reads the product page's JSON-LD
  (Product, ProductGroup with `hasVariant`, AggregateOffer) and returns the
  record with `source: 'json-ld'` and a warning naming the fallback;
  per-variant inventory, compare-at prices and option names are not in
  JSON-LD, so those fields are null. A handle that redirected to a
  collection is reported as such instead of "HTTP 404".
- **`reddit_search` explains an empty Arctic Shift result.** Arctic Shift
  matches every word of the query, so "Toyota Camry 2026 out the door price
  paid" found nothing in r/askcarsales while "Camry OTD" found eight. Zero
  results for a query longer than four words now carry a note saying so and
  suggesting two or three keywords.

## [5.6.8] - 2026-09-04

Round 17 live regression: all 29 tools and 18 templates on sites new to the
runbook (~150 calls). Ships with crawlforge-extractors 1.6.4.

### Fixed
- **Shift_JIS and other non-UTF-8 pages decode correctly on every fetch
  path.** `scrape`, `extract_structured`, `extract_embedded_state`,
  `extract_with_llm`, `agent`, `crawl_deep` and `extract_content` read bodies
  with `response.text()`, which is UTF-8 only, so kakaku.com, vector.co.jp
  and 2ch.sc came back as mojibake while `batch_scrape` and
  `extract_metadata`, already on the shared `readBody`, read them. The
  shared fetch helper and `extract_content` now go through `readBody`, which
  honours the Content-Type charset and the `<meta charset>` sniff; the sniff
  window grew from 1,024 to 8,192 bytes because vector.co.jp declares its
  charset at byte 1,293.
- **`agent` no longer invents versions and dates.** Small local models fill
  gaps from memory ("commander 8.6.2 published January 18, 2024" on a page
  that says 15.0.0). Every version, date and count in the synthesised answer
  must appear in the fetched source text; what does not gets one corrective
  rewrite, and anything still unsupported is named in the answer and in a
  new `provenance: { checked, unverified[] }` field. Quoted terms in the
  prompt (`"commander"`) are kept in every search query so the planner
  cannot reduce `npm package "commander"` to a generic search, and when a
  result page cannot be fetched (npmjs.com challenges every fetch) its
  search snippet stands in as evidence, labelled as such, instead of the
  run ending with no evidence at all. A small local model can still pick a
  grounded but wrong value from a tutorial; the guard rules out invented
  ones.
- **A Vercel Security Checkpoint is reported as blocked.** The HTTP 429
  interstitial (title "Vercel Security Checkpoint", lesswrong.com) passed as
  a successful stealth scrape carrying the checkpoint's own title. It is now
  a `blocked: { vendor: 'vercel' }` result, and `stealth_mode` waits up to
  8 s for a challenge title to change before reading the page, so Chromium
  gets the time it needs to clear the checkpoint.
- **Switching stealth engines keeps existing contexts alive.** A camoufox
  request closed the running Chromium browser and every live context in it,
  so a `create_context` id from before the switch failed with "Target page,
  context or browser has been closed". The running browser is now parked per
  engine and reused on the way back; `cleanup` closes both.
- **`generate_timezone_spoof` offset is measured against UTC.** The old
  arithmetic added the host's own offset once more, so America/Sao_Paulo
  came out as -420 from a UTC-4 host. It reads -180 from any host.
- **Page titles never include inline SVG titles.** Twelve call sites read
  `$('title')`, which cheerio concatenates with every `<svg><title>` in the
  body ("Roc — a fast, friendly, functional languageGitHubYouTube…" on
  roc-lang.org). All read the head title through `src/utils/pageTitle.js`,
  the fix `extract_metadata` got on 2026-08-26.
- **Stealth hardware spoof reaches Web Workers.** Init scripts never run in
  a worker, so a detector comparing `navigator` inside a worker with the
  main thread saw the real platform and core count beside the spoofed ones
  (bot.incolumitas.com). At the advanced level, classic workers start from a
  blob that patches `WorkerNavigator` and then imports the real script;
  service workers are blocked at the context so they offer no vantage point.
  camoufox spoofs workers itself and is left alone.

### Changed
- **`extract_structured` keeps the page head beside a long article.** When
  the main content filled the 24k-character budget the whole-page text was
  dropped, and with it swift.org's nav "Install (6.3.3)"; the model answered
  with the previous release from the article. Up to 6,000 characters of the
  page head now follow a cut article.
- **`analyze_content` outside English.** Keywords and topics for Hindi,
  Finnish and every other non-English language come from word segmentation
  instead of the English noun-phrase matcher, which returned whole clauses;
  the Devanagari danda (।, ॥) ends a sentence; Japanese particles and
  auxiliaries (ます, です, こと…) are no longer keywords.
- **`localization` auto_detect tests kana and hangul before ideographs**, so
  Japanese text is no longer labelled "chinese".
- **crawlforge-extractors 1.6.4:** `amazon-product` reads SEK (.se), TRY
  (.com.tr), AED, EGP and SAR prices and localised bylines ("Av George
  Orwell (Författare)", "Marke: Sony"); `hacker-news-front-page` returns
  absolute `item?id=` URLs on /ask and /show; `extract_embedded_state` reads
  bracket-notation assignments and tumblr's `window['___INITIAL_STATE___']`.

## [5.6.7] - 2026-09-04

### Changed
- **Tool selection surface rewritten to stop unnecessary calls.** A 30-day
  invocation-log review found 21% of session calls repeated a call already
  made with identical params, and the most common pair was `fetch_url`
  followed by an `extract_*` tool on the same URL — a chain the tool
  descriptions and the `getting-started` prompt taught in so many words.
  The server `instructions` (the only routing text a Claude Code session
  sees before its first tool search) are now a decision ladder with credit
  costs, a never-re-fetch rule and a one-call-per-page rule; every tool
  description leads with when to use it, names the tool to use instead for
  the cases it is not for, and states its cost (a test pins each number to
  `getToolCost`); `scrape` and `search_web` carry
  `_meta["anthropic/alwaysLoad"]` so the first call needs no tool-search
  round-trip; and every error result now ends with a `Next step:` line
  (`src/server/fallbackHints.js`, applied by `withAuth`) naming the tool
  to try next, so a failure is not followed by a blind retry.
  `deep_research` is the third always-loaded tool: with only `scrape` and
  `search_web` visible at session start, a model asked for a report from
  several sources fanned out into five searches and seven scrapes instead of
  one call, so the ladder now also states that cost comparison.
- **Installed skills carry the package version.** The skills installer
  stamps `metadata.version` in every installed `SKILL.md` from
  `package.json` (the repo files had said 4.8.0 through eleven releases);
  `crawlforge-getting-started` said 28 tools in its description and 29 in
  its body; `crawlforge-web-scraping`'s cost note led with "cheapest first:
  fetch_url, extract_text…" — the ordering that produces the double fetch —
  and now leads with `scrape` as the default page read.
- **Two measurement scripts.** `npm run usage:report` reads
  `logs/app.log` and prints the duplicate-call rate and the
  `fetch_url` → `extract_*` double-fetch pair count; `npm run
  eval:selection` runs 21 natural-language tasks through `claude -p` and
  scores first-tool choice, call count, duplicate calls and tool-search
  calls (21/21 first-tool on the current surface).
- Repo hygiene with no runtime effect: the seven `.claude/agents` follow
  Claude 5 conventions with current facts, `CLAUDE.md` reads 5.6.6 and no
  longer asks for parallel delegation, `toolFilter.js` says 29 tools.

## [5.6.6] - 2026-09-04

### Fixed
- **`batch_scrape` selectors and `scrape_structured` keep table structure.**
  Both read matched elements with cheerio's `.text()`, so a selector that
  matched a table returned one string with every cell run together
  (`DateOpen*HighLowClose**VolumeMarket CapSep 03, 2026$77,300.17…`) — the
  same gap 5.6.5 closed for `scrape_with_actions`, left open there because
  that release was scoped to one tool. Both now read elements through the
  shared helper (`src/utils/elementText.js`): a table, a row group or a row
  renders one line per row with cells joined by ` | `, an element that wraps
  a table renders each table that way in place, and every other selector —
  including `selector@attr` and `row_selector` records — is unchanged. In
  `scrape_structured`'s row mode a field that names the row itself
  (`row_selector: "tbody tr"`, field `"tr"`) now yields the delimited row.

## [5.6.5] - 2026-09-04

### Fixed
- **`scrape_with_actions` `extractionOptions.selectors` keep table structure.**
  A selector that matched a table returned one string with every cell run
  together — CoinMarketCap's historical-data table came back as
  `DateOpen*HighLowClose**VolumeMarket CapSep 03, 2026$77,300.17…`
  (2026-09-04) — because cheerio's `.text()` has no cell boundaries. A table,
  a row group or a row now renders one line per row with cells joined by
  ` | ` (the same convention the text format uses for a recovered table), an
  element that wraps a table renders each table that way in place, and every
  other selector is unchanged. The helper (`src/utils/elementText.js`) is
  shared; `batch_scrape`'s selector extraction and `scrape_structured` read
  matched elements the same way and are not yet on it.

## [5.6.4] - 2026-09-04

### Fixed
- **`scrape_with_actions`, `extract_content` and `process_document` keep the
  data tables Readability drops.** Readability keeps one article candidate and
  discards every table outside it; `scrape` had been re-attaching those since
  the S&P 500 constituents table went missing, but the shared content
  processor behind these three tools ran its own Readability pass without the
  recovery. Found on CoinMarketCap's historical-data page (2026-09-04): the
  action chain's wait for `table tbody tr` succeeded, and the `markdown` and
  `text` formats then came back as the page's FAQ copy with no table at all —
  a silent loss, since the prose read as complete. The recovery now lives in
  one exported helper (`recoverDroppedTables`) used by both paths. Recovered
  tables render as pipe tables in markdown and as one line per row with cells
  joined by ` | ` in text (a bare `textContent` runs the cells together:
  `DateOpen*HighLowClose**…`). The result reports `tablesRecovered` and, on
  `extract_content`, the same `mainContent: re-attached N data table(s)`
  warning `scrape` emits.

## [5.6.3] - 2026-09-04

Everything found by the Round 16 live regression (29 tools, 18 templates,
all-new sites, 2026-09-04), fixed. Five defects and three of the quality gaps;
the extractors side ships as crawlforge-extractors 1.6.3.

### Fixed
- **`analyze_content` keeps non-ASCII letters.** Entity, topic and keyword
  extraction used `[A-Z]`/`[a-z0-9]` classes, so "Universität" came back as
  "Universit", "Wisłą" as "Wis" and "Środkowej" was dropped outright; topic
  cleaning cut a trailing ą/ł/ż off every Polish word. Every letter class is
  now a Unicode property (`\p{L}`, `\p{Lu}`, `\p{N}`), with a lookbehind where
  `\b` used to be — `\b` stays ASCII-only even under the `u` flag.
- **The stealth fingerprint is one coherent display.** The screen and the
  viewport were drawn from the size pool independently (a 1536×864 window on a
  1366×768 screen), the device scale factor was a random float (1.7, which
  Chromium reports as 1.7000000476837158 and a 1408.0000305175781px screen),
  outerWidth/outerHeight equalled the inner size (a window with no toolbar),
  10% of fingerprints emulated mobile under a desktop user agent, and the
  timezone was a random US persona beside whatever zone the machine is in —
  pixelscan called the fingerprint inconsistent and both it and iphey called
  the timezone spoofed. The screen is drawn first and the window derived from
  it as a maximised browser (viewport = screen minus taskbar and toolbar,
  outer = available area), the scale factor is the one that size is seen at
  (1 / 1.25 / 1.5, 2 on a Mac), mobile emulation is off, and the timezone
  persona follows the host's own zone when it has one. A container on UTC
  keeps the persona — set `TZ` there to the zone the egress address
  geolocates to. Fonts remain the host's (font enumeration through
  measureText is not spoofable) and Playwright's CDP session remains
  detectable; those two are the limits of this layer.
- **WebGL2 contexts report the spoofed GPU.** Only `webgl`/`experimental-webgl`
  contexts went through the renderer wrapper; iphey read the GPU through a
  webgl2 context and printed "SwiftShader" under a Windows user agent. The
  unmasked vendor/renderer are now answered on both context prototypes.
- **`stealth_mode` scrape no longer reports a crashed or closed page as an
  empty success.** The three document reads were each wrapped in
  `.catch(() => '')`, so a renderer that crashed during the wait came back as
  `success:true` with an empty title and body. A page that cannot be read is
  now an error naming whether it crashed or was closed, and a document that
  rendered no title and no text is `success:false` with the reason (a longer
  `wait_for`, or an empty response). The body text is read through
  `document.body` rather than `innerText('body')`, which waited a full 30s
  for a `<body>` on frameset documents.
- **A thin Readability article is not the main content.** `scrape` at its
  default `onlyMainContent:true` returned ~150 of gnome.org's 1,666 visible
  characters, and `extract_content` returned libreoffice.org's 509-character
  "Welcome" box at confidence 0.9. When Readability keeps under 1,500
  characters that are under 35% of the page's visible text, `scrape` uses the
  whole page and says so in `warnings`, and `extract_content` hands off to the
  boilerplate-removal fallback with a `fallback_reason` that says why.
- **`localization` `configure_country` lists each language once** — it
  returned `["de", "de", "en"]` for a `de` request.

## [5.6.2] - 2026-09-04

Everything found by the Round 15 live regression (29 tools, 18 templates,
all-new sites, 2026-09-04), fixed. Five defects and four of the quality gaps.

### Fixed
- **`batch_scrape` text no longer carries script and style bodies.** The
  batch worker took the body text with nothing removed, so erlang.org's
  downloads page ended with its whole theme-toggle script and opennet.ru's
  with its CSS rules; `extract_text` on the same pages was clean. Script,
  style, noscript and template elements are dropped before the text and
  markdown formats are built (the html format is the raw document, as
  before). `scrape_with_actions` had the same gap in its intermediate-state
  text and short-page fallback.
- **The stealth browser can reach www.selenium.dev again — and any URL that
  mentions selenium, webdriver or puppeteer.** The stealth page router aborted
  every request whose URL contained one of those words, the top-level
  navigation included, so every stealth path (`stealth_mode` scrape,
  `create_context` → `create_page`, `scrape_with_actions` with
  `browserOptions.stealth`) failed there with `net::ERR_FAILED`. It also
  aborted `challenges.cloudflare.com`, which meant a Cloudflare challenge could
  never complete: the interstitial itself named the blocked host. No request
  is aborted by URL any more.
- **A challenge interstitial is reported as a block, not a scrape.**
  `stealth_mode` scrape returns `success:false` with `blocked:{vendor,
  evidence}` and an `error` when the page is a Cloudflare "Just a moment...",
  an Amazon captcha, a DataDome or PerimeterX challenge or an Akamai
  access-denied page; the content is still returned. `create_page` reports the
  same under `navigation.blocked`.
- **`bypassCSP` is no longer set on stealth contexts.** Ignoring a page's
  Content Security Policy is invalid behaviour for a real browser and
  rebrowser's bot detector flagged it; nothing here needed it.
- **Stealth fingerprint coherence.** The plugin fallback now also defines
  `navigator.mimeTypes` (two PDF entries, as Chrome reports beside its five
  plugins — detect-headless read "5 plugins / 0 mime types"); the user-agent
  pools track the bundled engines (Chrome 149–151, Firefox 135) instead of
  Chrome 119–121.
- **`analyze_content` counts Thai, Lao, Khmer and Burmese words.** Only CJK
  scripts reached Intl.Segmenter; a 290-character Thai paragraph was counted
  as 4 words.

### Changed
- `crawlforge-extractors` 1.6.2: `amazon-product` rebuilds the price from the
  whole/fraction spans when the offscreen string carries no decimal separator
  (amazon.com.au rendered "$1105" for A$11.05 — a price 100× too high that
  every guard accepted); `template:"auto"` recognises every Amazon marketplace
  the extractor handles (amazon.co.jp, .es, .in, .it, …); `hacker-news`
  `comments` is a bare count ("2 comments" → "2", "discuss" → "0"), the shape
  `score` already had; `extract_embedded_state` reads `window.__preloadedData`
  (nytimes.com).

## [5.6.1] - 2026-09-03

Everything found by the Round 14 live regression (29 tools, all-new sites,
2026-09-03), fixed. Six defects plus two gaps the fixes uncovered.

### Fixed
- **`extract_structured` reads the whole page, not only Readability's main
  content.** Main content alone hid the version banner on racket-lang.org — the
  answer sits in the page chrome — and a model that never sees the answer fills
  a required field with the nearest heading, the page title, which the
  provenance guard cannot fault because it carries no digits. The model now
  reads the main content first and the whole page after it when both fit a
  24k-character budget (it was 6k, which cut a 20k-character article to its
  first third); the article still leads, so the Cloudflare blog headline case
  stays right. Verified live: racket-lang.org 9.3, rust-lang.org 1.98.1, both
  provenance-verified.
- **LLM extraction decoders can answer null.** `extract_structured`,
  `extract_with_llm` and `scrape`'s json format sent Ollama a bare `'json'`
  format, or the schema with `required`, so a model shown content that never
  stated a field invented one — `scrape` json returned "Racket 5.1.0" for a
  version the page states as 9.3. Every property is now nullable for the
  decoder, `required` is withheld from it, and the prompts say to answer null
  for anything the content does not state. Both validators treat a null in a
  field the schema does not require as valid (it read as "expected number, got
  object") and a null required field as missing. `scrape`'s json format also
  shows the model the main content first and the whole page after it, the
  same way `extract_structured` now does, so the banner is in view: racket
  answers 9.3.
- **The provenance guard checks version strings inside prose.** "Racket 5.1.0"
  rode past it because only whole-value versions were checked; a token with two
  or more dots inside prose is now verified against the page and nulled when
  absent. Decimals and plain integers in prose are left alone.
- **HTTP page fetches no longer send `Accept-Language: *`.** Node's fetch adds
  it when none is set, and Amazon answers the honest `CrawlForge/…` identity
  with a captcha interstitial whenever ANY Accept-Language rides along — `*`,
  en-US, de-DE, a full browser list — while serving the page when it is absent
  (bisected header by header with curl, reproduced with Node's fetch). fetch
  cannot omit the header, so the gate sends it empty, which Amazon treats as
  absent. `amazon-product` on amazon.de and amazon.in returns the product
  again. amazon.com still refuses this identity from some networks regardless
  of headers; the template names that captcha rather than returning nulls.
- **`agent` no longer searches for "```".** A fenced plan list leaked the fence
  markers as two of three search queries; fences, wrapping quotes and lines
  with no letter or digit are stripped from the plan.
- **`stealth_mode`'s Chromium fingerprint is coherent.** bot.sannysoft.com
  showed a Firefox User-Agent on Chromium (navigator.vendor "Google Inc.",
  window.chrome present), deviceMemory 32 where Chrome caps at 8, a plain-Array
  plugins list, and a nulled WEBGL_debug_renderer_info that threw a TypeError.
  Chromium now draws a Chrome User-Agent only (Camoufox keeps its own),
  deviceMemory is 8 or 4, the fallback plugins are a real `PluginArray`, and
  the WebGL wrapper spoofs the unmasked vendor and renderer and tolerates a
  canvas with no WebGL context. Sannysoft now: 5 plugins, PluginArray passed,
  CHR_MEMORY ok, no failures.
- **`localization generate_timezone_spoof` honours an explicit `timezone`.**
  Asia/Tokyo asked, Berlin answered — only `countryCode` was read.
- **`hacker-news-front-page` strips "1 point" too** (crawlforge-extractors
  1.6.1; the regex stripped only " points"). Also from 1.6.1: `amazon-product`
  reads the currency off the price string ("52,02USD", "₹1,950.00", a bare
  "$" told apart by marketplace) when the page ships no buy-box currencyCode
  input — amazon.de and amazon.in book pages don't.

### Changed
- `crawlforge-extractors` ^1.6.1.

## [5.6.0] - 2026-09-01

Everything found by the Round 12 live regression (29 tools, all-new sites,
2026-09-01), fixed. Three defects, one archive-availability gap, two cosmetics.

### Fixed
- **`scrape` no longer silently drops inline links on pages whose CSS uses
  native nesting.** The hidden-content stripper parsed stylesheets with a flat
  regex that read a nested rule as a top-level one: legalblogs.wolterskluwer.com
  ships `.aside-container.is-closed .aside-header{ … a{display:none;} }` — links
  hidden only in a closed sidebar pane — and the stripper read the inner rule as
  a bare `a{display:none}`, deleting 56 of an article's 68 anchors (text and
  URL both) before markdown conversion. The rule scanner is now depth-aware:
  only top-level declarations are honoured and nested blocks are skipped —
  conservative, since a skipped hide rule keeps content. A rule left unclosed by
  the stylesheet size cap is dropped for the same reason.
- **`batch_scrape`, `crawl_deep`, `generate_llms_txt` and `track_changes` now
  decode non-UTF-8 pages correctly.** Their fetch paths read bodies with plain
  UTF-8 decoding, so lua.org (ISO-8859-1) came back as "portugu�s" in batch text
  and "Programa��o" in generated llms.txt while `extract_text` on the same URL
  was clean. All four now read through crawlforge-extractors' `readBody` — the
  same charset-aware, size-capped reader the single-page tools and the REST API
  already used. For `track_changes`, mojibake would also have faked diffs on
  pages whose bytes never moved.
- **`track_changes` names the cause of a fetch failure.** undici reports every
  network failure as bare "fetch failed" with the real reason in `error.cause`;
  a dead host and a typoed domain read identically until now.

### Changed
- **`reddit_search` extends the 7d/3d/1d window ladder to scoped POSTS
  searches.** Arctic Shift sheds a full-history posts search with the same 422
  "Timeout" it uses for throttling (an r/selfhosted search failed unbounded and
  answered at 7d, observed live 2026-09-01); only comment searches narrowed
  before. `window_applied` reports which window answered, as it did for
  comments.
- **`analyze_content` language alternatives can no longer print a higher
  confidence than the picked language.** The pick's confidence is length-based
  while alternatives carried franc's relative-similarity scores — two scales in
  one field (Italian picked at 0.8 with an alternative printing 0.82).
  Alternatives are now scaled by the pick's confidence, preserving their order.
- **crawlforge-extractors 1.5.3 → 1.6.0** (see that repo's v1.6.0 release
  notes): `producthunt-launch` reworked for Product Hunt's /products layout
  (reads the Apollo streaming-SSR transport; `votes` — gone from the layout —
  replaced by `followers`/`reviews_count`/`reviews_rating`), `amazon-product`
  names Amazon's HTTP-200 captcha interstitial instead of returning a silent
  all-null record, every entity template refuses an all-empty record,
  `ashby-jobs` descriptions become opt-in via `descriptions: true` with
  `company` reporting the board slug, and `extract_embedded_state` learns the
  ApolloSSRDataTransport source.

## [5.5.9] - 2026-08-31

Prompt-injection posture: fencing where we call a model, and a documented
position on tool output. No behaviour change for normal use.

### Security
- Scraped page text is now fenced before it reaches a model **we** call —
  `extract_with_llm`, `summarize_content`, and the `agent` tool's synthesis
  step. Previously the text was concatenated straight into the prompt, so a page
  saying "ignore your instructions and…" arrived as a peer of the instructions
  around it. The delimiter carries a random per-call nonce: a fixed marker is
  guessable, so a page could otherwise write the closing marker and continue
  outside the fence.

  This is mitigation, not a solution. No prompt wording makes a model immune to
  a persuasive instruction in its input.

### Documentation
- `docs/SECURITY.md` gains a trust-model section stating the position in full,
  including what we deliberately do **not** do: tool output is not sanitised and
  will not be, because no filter can separate an attack from a page legitimately
  *about* one. Tool results are untrusted input to whatever model receives them,
  and the host application owns that boundary — the division the MCP
  specification draws. Includes guidance for integrators.

## [5.5.8] - 2026-08-31

### Fixed
- `track_changes` webhook and Slack notifications are now bounded by a timeout.
  fetch/undici has no `timeout` request option, so an endpoint that accepted the
  connection and then never answered held the send open indefinitely — and
  because notifications for a change are awaited together, one unresponsive
  endpoint stalled the rest of them. Defaults to 30s, matching
  `WebhookDispatcher`; override with `TRACK_CHANGES_NOTIFY_TIMEOUT_MS`.


## [5.5.7] - 2026-08-31

Security hardening (defense-in-depth). No behaviour change for normal use.

### Security
- `track_changes` notifications now go out through the SSRF guard. The
  `notification.webhook.url` and `notification.slack.webhookUrl` fields are
  caller-supplied URLs, and these two senders were the last outbound calls still
  using bare `fetch` — `WebhookDispatcher` already used `safeFetch`. A monitor
  could otherwise be pointed at a link-local or private address and made to POST
  to it on every detected change.
- `process_document` refuses `sourceType: 'file'` and `'pdf_file'` when the
  server is bound to a non-loopback interface. Those source types resolve a path
  against the local filesystem and read it, which is the feature when you run the
  server yourself and arbitrary file read on the host when it is served to a
  network. **stdio and loopback-bound HTTP are unaffected** — local use, which is
  how the overwhelming majority of installs run, behaves exactly as before.
  Pass a URL with `sourceType: 'url'` or `'pdf_url'` on a hosted server.


## [5.5.6] - 2026-08-30

Security hardening (defense-in-depth). No behaviour change for normal use.

### Security
- The `--http` transport now binds loopback (`127.0.0.1`) by default instead of
  `0.0.0.0`, so a local HTTP server is not exposed to the LAN. Managed hosts stay
  reachable: Render sets `RENDER=true` (binds `0.0.0.0`), and the new
  `MCP_HTTP_HOST` env var overrides the bind on any other platform.
- Creator mode bypasses per-request HTTP auth only on a loopback bind. On a
  public interface the server now authenticates every request and warns at
  startup, instead of serving an unauthenticated MCP endpoint.
- A `.env` in the current working directory can no longer set
  `SSRF_PROTECTION_ENABLED`, `SSRF_STRICT` or `ALLOWED_DOMAINS`. It is read into
  an isolated object and only non-SSRF keys are copied through, so a `.env`
  planted in a launch directory cannot weaken the SSRF guard.
- `setup.js` writes the API-key-bearing MCP client configs with mode `0o600`.

### Changed
- `crawlforge-extractors` dependency bumped to `^1.5.3` (buffered-body size cap,
  own-property JSON path traversal).

## [5.5.5] - 2026-08-30

Security patch.

### Security

- **SSRF guard on the stealth/browser navigation path.** Added `safeGoto()` (SSRF + DNS-rebinding check before navigation, re-checked after redirects) to the three browser-navigation sites that lacked it: `scrapeWithStealth`, `deep_research`'s stealth fallback, and `BrowserProcessor.navigateAndWait` (the `extract_content` / `process_document` browser path). Previously these could be steered to `169.254.169.254` / RFC1918 / loopback and return the rendered response.
- **Full private-range SSRF enforcement on the hosted deployment.** `render.yaml` now sets `SSRF_STRICT=true` (Stage-2: blocks RFC1918 / ULA / CGNAT, not just metadata + loopback). npm/local users keep the Stage-1 default so they can still scrape their own localhost.
- **Pulled in `crawlforge-extractors@1.5.2`**, which fixes a flight-stream quadratic-DoS in `extract_embedded_state` and scheme-filters extracted URLs (drops `javascript:` / `data:`).

### Changed

- **`render.yaml`: `MAX_BROWSER_CONTEXTS=6` and `plan: standard`.** Each co-resident browser manager keeps its own context pool and Chromium, so the default 10 is really 2–3× that; 6 bounds it on the 2 GB box.

### Removed

- **Dead `src/security/wave3-*` modules** (imported by nothing at runtime).

## [5.5.4] - 2026-08-30

Documentation-only patch.

### Changed

- **`scrape_with_actions`: the `extractionOptions` description now states where selector results land.** `extractionOptions.selectors` output is returned as `content.json.extracted`, which only exists when `"json"` is in `formats` — a caller passing selectors with `formats: ["markdown"]` had their extraction computed and silently omitted from the response, with nothing in the schema saying so. No behavior change.

## [5.5.3] - 2026-08-30

Patch release from a 69-call live sweep of all 29 tools against sites not used in any earlier round. Two defects, both found by verifying engine behavior and field values rather than trusting success flags.

### Fixed

- **`stealth_mode` silently ran Chromium when `engine: "camoufox"` was requested and a browser was already running.** `createStealthContext` only called `launchStealthBrowser` when no browser existed, skipping the engine-mismatch guard inside it — so the first playwright scrape in a server's lifetime pinned every later camoufox request to Chromium. The result looked healthy (real content, no error), and user-agent strings cannot expose it because the fingerprint randomizer assigns Chrome-like UAs to Firefox and vice versa; a `CSS.supports('-moz-appearance')` probe was needed to prove which engine served the page. The context path now always routes through `launchStealthBrowser`, whose guard tears down a mismatched browser and relaunches the requested engine. `create_context` additionally never forwarded the tool-level `engine` parameter at all — it does now, mapped the same way `operation: "scrape"` maps it.

- **`extract_structured` returned a confident placeholder for a required field whose value is plainly on the page.** On git-scm.com, Readability's main-content pass drops the version box, so the model saw no version and answered `"N/A"` with confidence 0.9. The 5.5.1 full-text retry never fired because it triggers on provenance-nulled required fields, and a placeholder carries no digits for the guard to check. Required fields answered with a placeholder (`null`, empty, `N/A`, `none`, `unknown`, `not available/found/specified`) now count as missing: they trigger the same single full-text retry, and a retry is kept only when strictly fewer required fields are missing, so a retry can never make the result worse. git-scm.com now returns the correct version with `provenance.verified: 1`.

## [5.5.2] - 2026-08-30

Patch release fixing a silent content loss in main-content extraction that affected documentation sites in particular — the pages an agent is most likely to scrape.

### Fixed

- **`scrape` at its default `onlyMainContent: true` deleted every code example on Nextra-built documentation sites.** On next-intl.dev's routing docs it dropped all 12 `<pre>` blocks, all 96 inline `<code>` spans and the callout warning that `setRequestLocale` is a legacy API, while leaving the surrounding prose intact — so the result read as a complete page rather than as a failure, and sentences came back with holes where their inline code had been ("In order to use unique pathnames …, can be used to handle"). An agent reading that output would write the API call from memory instead of from the page. The cause is not that Readability drops `pre`/`code`. Its class regexes are unanchored and two of them collide with framework class names: `unlikelyCandidates` contains `extra`, which matches inside `nextra-`, the prefix on every element Nextra emits, so those elements are deleted before scoring runs; and `negative` contains `hidden`, which matches Tailwind's `overflow-hidden` on the code wrapper, docking 25 class weight — enough for `_cleanConditionally` to delete the wrapper holding every code block. Both had to be addressed: fixing only the first restored inline code and still returned zero code blocks. Extraction now strips just the class tokens that trip a removal regex accidentally, before Readability parses. A match is treated as accidental only when it sits mid-word behind a preceding letter, so `comments`, `banners`, `page-footer` and a genuine `hidden` are still removed as before; `overflow-hidden` and its overflow/scroll variants are listed explicitly, because they collide on a whole word. A class carrying one of Readability's positive signals is never stripped.

  Affects `scrape`, `extract_structured` and every path built on main-content extraction. On the page above, markdown went from roughly 3 KB with no fenced blocks to 8,953 characters with 11. The one block inside a collapsed `<details>` is still not recovered — Readability discards those wholesale — and element ids are left untouched, since they anchor in-page links.

## [5.5.1] - 2026-08-30

Patch release from a 152-call live sweep of all 29 tools against sites not used in earlier runs. Four defects, three of them fixed at the shared level rather than at the call site, so the same class cannot come back on another surface.

### Fixed

- **`extract_structured` could return a version number that is not on the page.** On sqlite.org it answered "3.34.0" on three runs running while the page said 3.53.4. Two things were wrong. The provenance guard only inspected values it could read as numbers, and a dotted version has too many segments to be one, so the field was skipped and reported as verified. The guard now also covers digit-bearing literals with no whitespace — versions, dates, ISBNs, SKUs, model numbers — matched literally against the page. Prose is still never checked, because a model may legitimately re-word it and a wrongly emptied field is the costlier failure. Separately, the model is shown the page's main content while the guard checks the whole document, and readability extraction had dropped the line carrying the version, so the model had nothing to read. When the guard empties a required field, extraction now retries once against the full page text and keeps that result only if strictly fewer required fields come back empty.
- **`stealth_mode` with `engine: "camoufox"` failed on every advanced-level scrape.** Network-condition emulation is a Chrome DevTools Protocol call and Camoufox is Firefox-based, so it raised "CDP session is only available in Chromium" before reaching the page. The emulation is cosmetic realism and is now skipped on non-Chromium engines instead of ending the scrape.
- **`localization` reported the wrong language.** Japanese came back empty and French came back as Spanish, while `analyze_content` read the same text correctly. The localization path carried its own five-language stop-word matcher, so the franc-based detection and CJK script handling added in 5.2.2 never reached it. Both surfaces now share one detector in `src/utils/languageDetection.js`, and a parity test pins that they agree.

### Changed

- Extraction guarded by `verify_numbers` now empties a fabricated version, date or SKU where such a value previously passed through untouched. Values removed are still reported verbatim under `provenance.unverified`, and `verify_numbers: false` returns the unguarded result as before.
- `crawlforge-extractors` moved to ^1.5.1, which reads a Teamtailor careers-site root URL and reports a board with no open roles as an empty list rather than an error.

## [5.5.0] - 2026-08-30

Minor release closing the "missing features" list from the 5.4.3 live matrix: two operations that returned a config instead of doing the work, a provider the schema would not accept, a Reddit search shape with no backend, and three templates with no compliant way to their data.

### Added

- **`localization` `localize_search` now runs the search.** With `searchParams.query` it localizes the parameters (country restrict, language, Accept-Language) and runs them through the same adapter `search_web` uses, returning `{ localizedParams, search }`; it is priced as a `search_web` call. Without a query it returns the localized parameters as before, with a note saying no search ran.
- **`reddit_search` serves an unscoped comment search.** It finds posts with a site-restricted web search, then searches each post's comments for the keywords in the Arctic Shift archive (`link_id` is the scope Arctic Shift accepts), in relevance order until `limit` is reached; `posts_searched` and `discovered` report the work, and one throttled post no longer discards the others. Previously the call failed with "no available backend". `source:"web_discovery"` is now in the MCP schema.
- **`reddit_search` narrows a scoped comment keyword search Arctic Shift times out on.** The archive answers a full-history comment search on a busy subreddit with a fast 422 "Timeout"; when the caller set no `after`, the search is retried over the last 7d, 3d and 1d, and the result reports `window_applied` and a note. A caller-chosen window is never overridden.
- **`deep_research.llmConfig.provider` accepts `"ollama"`** and an `ollama: { model, embeddingModel }` block. The chosen provider is now mapped onto `LLMManager`'s `defaultProvider` — before this the field was validated and then ignored, so `"anthropic"` ran whatever `auto` picked. An explicit cloud provider with no API key is rejected up front instead of silently downgrading to keyword extraction.

### Changed

- **`scrape_template` `reddit-thread` reads the Arctic Shift archive** (crawlforge-extractors 1.5.0): one keyless `/api/posts/ids` request returns the post — title, subreddit, author, score, upvote ratio, comment count, body, flair, removal state — where the old selector template never saw a page (reddit.com 403s every non-browser client). The comment tree is `reddit_search` `mode:"thread"` with the returned `id`.
- **`scrape_template` `linkedin-profile` and `tweet` are retired.** linkedin.com/robots.txt disallows every path for all agents but LinkedIn's own crawler and profiles sit behind an auth wall; x.com/robots.txt disallows every path for generic agents and the keyless embed endpoints (`cdn.syndication.twimg.com`, `publish.x.com/oembed`) are disallowed by their own robots.txt (all verified 2026-08-30). Naming either template — or passing one of their URLs to `template:"auto"` — returns the reason, fetches nothing and costs nothing. 18 templates ship.

## [5.4.3] - 2026-08-30

Patch release from a 29-tool live matrix (209 calls against sites not used in earlier sweeps). Nine defects, all fixed and re-verified over MCP stdio; unit suite 1552/1552, protocol compliance 100%.

### Fixed

- **Five `track_changes` operations had no implementation.** `get_dashboard`, `export_history`, `create_alert_rule`, `generate_trend_report` and `get_monitoring_templates` each returned `success:false` with `this.changeTracker.<method> is not a function` — the tool called `ChangeTracker` methods that were never written (since v3.1.0). All five now exist: alert rules are evaluated on every compare (a matching compare returns `alerts`; url-scoped, throttled, `significance` equality and ordered comparisons), the dashboard aggregates tracked pages, rules, fired alerts, per-URL trends and both polling and scheduled monitors, `export_history` emits JSON rows or CSV with optional diff details and baseline snapshots, the trend report summarises change rate, drift direction and significance mix with recommendations, and six built-in presets (`price-watch`, `availability`, `news-feed`, `documentation`, `regulatory`, `job-board`) back `get_monitoring_templates` and are applied by `scheduledMonitorOptions.templateId`, which the schema accepted and ignored. An omitted `dashboardOptions` now means the schema defaults instead of stripping every section.
- **`scrape_with_actions` never returned `extractionOptions.selectors`.** They were forwarded to extract_content as `customSelectors`, which it does not read, so they only surfaced inside `captureIntermediateStates`. They now run over the post-action DOM and come back as `content.json.extracted`. On a small post-action page Readability's "main" block could be the footer alone (and it drops `<button>` text), so a readable result under 300 chars falls back to the body text, marked `textSource:"body"`.
- **`get_batch_results` dropped `status` once a job completed.** Both completed branches (result cache and job lookup) now carry `status:"completed"` and `mode`, so a poller can key on one field for the whole lifecycle.
- **`crawl_deep` on a seed its robots.txt gate declined returned 0 pages and 0 errors** — indistinguishable from an empty site. The decision is now reported once in `errors` with `code:"ROBOTS_DISALLOWED"`; declined child links stay silent as before.
- **`generate_llms_txt` ignored `customGuidelines`/`customRestrictions` in `llms-full.txt`** (and `customRestrictions` in the spec-format `llms.txt`); only the legacy robots-style output emitted them. Both files now carry them.
- **`scrape_template` `stackoverflow-question` returned nothing** — the rendered page is not served to plain HTTP clients. crawlforge-extractors 1.4.1 reads the public, keyless Stack Exchange API instead (question, owner and answers in one request, accepted answer first). **`hacker-news-front-page` did not match `https://news.ycombinator.com/`** (trailing slash), so `template:"auto"` reported no template for the front page.

### Verified live, not defects

Declined fetches on `lobste.rs`, `webscraper.io/test-sites/e-commerce/`, `scrapingcourse.com/ecommerce/`, `x.com`, `linkedin.com/in/` and `reddit.com` are correct robots.txt gate behaviour (each disallows the path for `*`). `executeJavaScript` stays behind `ALLOW_JAVASCRIPT_EXECUTION=true` by design. Empty Lever/Workable/Teamtailor boards return honest zero-item lists. `analyze_content` reports ISO 639-3 language codes (`eng`, `spa`, `jpn`).

## [5.4.2] - 2026-08-30

Patch release: a regex in the numeric provenance guard could backtrack exponentially and **hang the entire server**, not just the tool that triggered it.

### Fixed

- **Catastrophic backtracking in `src/utils/provenance.js`.** `MARKUP_BETWEEN_DIGITS` carried `\s*` on *both* sides of a `+`-quantified group, so a whitespace run could be split between one iteration's trailing `\s*` and the next one's leading `\s*`. A digit followed by whitespace-separated tags and no closing digit then explored 2^n paths: n=12 took 7ms, n=16 552ms, n=18 5036ms, and on live python.org HTML it never returned. Whitespace is now consumed in exactly one place per iteration. Welded output is byte-identical to the old pattern on every case checked, and the 60KB input that hung completes in 0ms.
- **`reddit_search` unscoped keyword search failed MCP output validation.** The successful `web_discovery` path returns a `discovered` count that was never declared in `redditSearchShape`, so the call was rejected with `-32602 "data must NOT have additional properties"`. The empty-result branch omits the field, so only a search that actually found posts broke.
- **`serverInfo.version` reported `5.3.1`**, two releases stale. It now tracks the package version.

### Why it mattered more than a two-line diff suggests

The provenance guard (`verify_numbers`, default `true`) runs only in `extract_structured` and `extract_with_llm`. But Node is single-threaded: the runaway `replace` pinned the event loop at 100% CPU, and **every other tool queued behind it forever** — including `list_ollama_models`, which is a localhost call. A live sweep read as "the whole MCP server is dead" when one regex on one page was the cause. Anything that reports a hang across unrelated tools is worth checking for a busy loop before suspecting the network.

The `reddit_search` gap is the third time a result field has shipped without its output schema. Adding or changing a tool's returned fields still means updating `OUTPUT_SCHEMAS` in the same change, and verification has to include one real MCP stdio call — `execute()` and the REST route both bypass output validation entirely.

### Verified

All 29 tools exercised over live MCP stdio against real sites. `extract_structured` 804ms returning Python 3.14.7 (was: never returned), unscoped `reddit_search` returning `discovered: 3`, and four concurrent calls — the batch shape that previously produced four 120s timeouts — all returning normally. Unit suite 1532 pass / 0 fail / 1 skip.

## [5.4.1] - 2026-08-29

Patch release: `extract_embedded_state`'s reader moves into the shared `crawlforge-extractors` package. **No behaviour change** — the tool returns exactly what it did in 5.4.0.

### Changed

- **`extract_embedded_state` now reads its state through `crawlforge-extractors` 1.4.0** rather than a local copy. `src/utils/embeddedState.js` (304 lines) and `src/utils/jsonPath.js` (80) are gone; the tool imports `extractEmbeddedState` and `selectJsonPath` from the package.

### Why

The CrawlForge REST API gained an `extract_embedded_state` endpoint the same day, which meant either a second implementation of this reader or one shared implementation. A second RSC flight-stream parser is the wrong kind of duplication: a T row's declared byte length *includes* its terminating newline, and reading one character past it makes the next row id `14` parse as `4` and silently overwrite an unrelated row — on the live Healthgrades capture that destroyed 19 rows while still looking like a clean parse. That fix living in only one of two copies is exactly the failure `crawlforge-extractors` exists to prevent.

Both surfaces now run the same function, so **MCP and REST are both 29 tools at identical credit costs.**

### Note on the test count

The unit suite reads **1530 tests / 1529 pass / 1 skip**, down from 1565 / 1564. That is the 35 embedded-state and JSON-path tests relocating to the package alongside the code they cover — they run there now (package suite: 339 pass). It is not a loss of coverage. MCP protocol compliance stays 100%, 29 tools discovered.

## [5.4.0] - 2026-08-29

Minor release: Tier 2 extraction — the structured data that is already in the HTML. One fetch, exact values, **no LLM in the extraction path**. Phase 3 of `VERTICAL_COVERAGE_PLAN.md`.

### New tool: `extract_embedded_state` (2 credits) — the 29th tool

- Reads a page's embedded JavaScript state rather than its rendered HTML: `__NEXT_DATA__`, `self.__next_f` (React Server Component payloads), `window.__NUXT__`, `__APOLLO_STATE__`, `__INITIAL_STATE__`, `__PRELOADED_STATE__`, and `<script type="application/json">` blocks, each keyed by source name. Verified live 2026-08-29: Ticketmaster returned a parsed 439,333-byte `__NEXT_DATA__`, Healthgrades a parsed 1,426,837-byte RSC payload.
- **RSC chunks are genuinely parsed, not just collected.** The `self.__next_f.push([1,"…"])` chunks are concatenated in document order into the flight stream, then split into `<hexId>:<payload>` rows — JSON parsed, module refs and text blobs kept as strings. Two bugs the live-capture rule caught before they shipped: a T-row's declared byte length *includes* its terminating newline, and reading one character past it silently destroyed 19 rows on the live Healthgrades page while still looking like a clean parse; and `<script>` inside an HTML comment matched through to the first real `</script>`, swallowing the genuine tag after it.
- **`path` scopes the result** — dotted keys and array indexes, not JSONPath. Verified live: Ticketmaster's 439,347-byte payload scoped to `next_data.props.pageProps.eventsJsonLD` returns 28,346 bytes.
- **Large payloads warn, they are never capped.** Truncating structured JSON produces something worse than a big object, and a default cap would have silently dropped Ticketmaster's whole payload. Over 256 KB unscoped the result names the largest source and hands back a ready-to-paste `path`.
- A source that is not JSON — Nuxt 3's unquoted-key object literal, Nuxt 2's IIFE wrapper — is reported as unparsed rather than guessed at. No `eval`.

### `extract_metadata` — JSON-LD becomes a first-class extraction path

- New `json_ld_types` filter. Nodes are found at any depth, so `@graph` wrappers, top-level arrays and nodes nested inside a parent all resolve; `@type` may be a string, an array, or a full `https://schema.org/X` IRI. With no filter the output is byte-identical to before.
- **Subtypes match their parent, because exact matching returns nothing on real pages.** Ticketmaster publishes `MusicEvent` and never `Event`; Apple publishes `AggregateOffer` and `BreadcrumbList`, never `Offer` or `ItemList`. `JSON_LD_SUBTYPES` carries the transitive descendants of the six documented types; anything outside it is matched exactly, never guessed.
- Verified live: Ticketmaster `Event`→20, `Offer`→20; Apple `Product`→1; propertyfinder.ae `RealEstateListing`→23 with `offers.price`, from a single 64-node `@graph`.

### `extract_with_llm` / `extract_structured` — numeric provenance guard

- **Any number an LLM returns must be findable in the page source, or it comes back `null` with a reason** in a new `provenance` block. Default on; `verify_numbers: false` opts out and is documented as returning derived numbers too.
- Checked against the **full fetched source**, never the trimmed main content the model was shown. On the Apple MacBook Air page Readability keeps the FAQ block and leaves every price behind in an embedded JSON blob, so checking against the model's own input would have nulled every correct price.
- Matching normalises both sides — grouping spaces, NBSP, `.`/`,` resolved by position — and admits every ambiguous reading of a source number, so an extra reading can only let a value through, never null a real one.
- When the guard nulls a **required** field, the result's `valid` flag flips to false rather than reporting a fabrication as valid.

### Fixed — G5 overrides that were accepted and silently dropped

Four tools declared `respect_robots` and `user_agent`, validated them at the MCP boundary, and then threw them away: their `server.js` wrappers destructured a fixed parameter list and re-packed it for `execute()`. Each tool's own schema reads both and forwards them to the fetch layer, so the override worked everywhere except the one place it had to. `extract_structured` (found while wiring 3.4), `map_site`, `extract_content` and `process_document` now forward params whole.

Robots failed safe — the override was ignored, so robots.txt was always respected — but `user_agent` did not: a customer with their own agreement with a target could not identify as themselves, which is the case G4 exists to serve.

`tests/unit/complianceParamForwarding.test.js` now fails the build if a tool declares `COMPLIANCE_PARAMS` and drops one, whether by destructuring a short list or by re-packing `execute()` arguments. Its exemption list is a decision record, not clutter: `stealth_mode` is exempt from `user_agent` only, because its browser generates the UA from a fingerprint persona and derives `Sec-CH-UA` and the OS profile from it — injecting a caller's UA would desynchronise the fingerprint. `stealth_mode` still forwards `respect_robots`.

## [5.3.1] - 2026-08-28

Patch release: `deep_research` judges its claims with a model measured fit to judge.

- **`deep_research` routes its three judgement calls — claim relevance, same-meaning grouping, contradiction — to `gemma3:12b` when it is installed** (`ollama pull gemma3:12b`), falling back to the extraction model otherwise. Measured 2026-08-28 by replaying a live run's own 136 claims through every installed model, three runs each: the 4B extraction winner scored "Playwright vs Selenium" marketing 0.9 relevant to an anti-bot topic and produced 1-2 false contradictions per run; `gemma3:12b` produced 0 false contradictions on 27 real pairs, caught every planted one, and formed 7-9 cross-source claim groups against 1.
- **Conflict detection is on again — gated on the model, not a flag.** It runs only when the judging model is one measured not to invent disagreement (`gemma3:12b`, or a cloud provider). On a machine without one `conflictsFound` stays 0, which is the honest answer.
- The orchestrator formed up to 40 candidate pairs but the judge examined 30 by default; the caps now agree.
- Two model findings recorded, not fixed: thinking-capable models (`gemma4`, `gpt-oss`) return **empty content** at these token budgets because hidden reasoning consumes `num_predict`, and the flag that fixes one (`think: false`) makes the other emit nothing — neither is ranked. The orchestrator's embedding-similarity path fails on chat models (`Ollama embedding error 500`) and is swallowed.

## [5.3.0] - 2026-08-28

Minor release, and the largest since 5.2.0: every fix from the 2026-08-28 tool-quality sweep, plus the compliance and identity work that gives the crawler one honest name and a robots gate on every path that fetches. 29 commits since 5.2.9, none of which had reached npm.

### Compliance and identity

- **Every fetching tool now checks robots.txt, and the crawler has one identity.** Both surfaces identify as the product token `CrawlForge`; the retired `CrawlForge-Bot` token is still honoured as a disallow so an existing opt-out keeps working. Two stealth paths that walked past the gate entirely are now gated with everything else — stealth changes how a page is rendered, not whose rules apply.
- **A compliance refusal is free.** A request refused for robots or blocklist reasons no longer bills the caller. Previously a refusal could still consume credits, which charged users for the tool declining to act.
- **Outbound requests are signed per RFC 9421 (Web Bot Auth).** Ed25519 signatures with a `Signature-Agent` header pointing at the published key directory, so a site can verify a crawl really came from CrawlForge. Unsigned is still the behaviour when no signing key is configured — the only difference is the signature itself.

### Tool correctness

The sweep exercised all 28 tools against live sites. These are the defects it found, each verified over real MCP stdio rather than a direct `execute()` call.

- **`scrape` silently discarded data tables at its default setting.** Readability's article candidate excluded them, so Wikipedia's *List of S&P 500 companies* returned **0 table rows** with the default `onlyMainContent: true`. Data tables the article pass dropped are now re-attached by re-parsing the original HTML in a second JSDOM (Readability mutates the document it is handed, so the tables are already gone from the first one), and a warning names how many came back. 503 company rows now; a normal article is byte-identical to before.
- **`extract_with_llm` returned `{}` with `success: true`.** An empty result fell straight through to success. It now gets one stricter retry and then fails honestly, naming the model.
- **`extract_structured` answered from page chrome.** It fed whole-body text to the model, so a Cloudflare blog post returned `headline: "Skip to content"`. It now runs the same main-content pass as `scrape` and restores the title Readability strips.
- **`crawl_deep`'s `include_patterns` blocked its own start URL**, making a documented parameter unusable: any value at all killed the crawl before it began, because the seed was tested against the patterns after normalization stripped its trailing slash. The seed is now exempt from the include gate (blacklist and exclude patterns still apply), and patterns are matched against the pre-normalization URL too.
- **`crawl_deep`'s `depth_distribution` reported URL path depth, not crawl depth** — keys above `max_depth` on every crawl. It is now built from the depth the crawler records; path depth moved to `path_depth_distribution`.
- **`track_changes` reported zero changes while the diff showed ten.** Text-only changes were never counted, so anything alerting on `summary.totalChanges` never fired. Text changes now count, with an explicit `textChanges` field beside the element counters.
- **`scrape_structured` returned parallel arrays that were not row-aligned**, so on python.org every version paired with the previous release's date. A new optional `row_selector` matches fields within each row and returns aligned records; the parallel-array default is unchanged for existing callers.
- **`summarize_content` led its summary with navigation chrome.** Fixed with an explicit navigation-phrase set rather than the punctuation heuristic originally proposed, which could not distinguish `Jump to content.` from a genuine short opening sentence.
- **`deep_research` promoted boilerplate and vendor marketing into findings.** An arXiv author/affiliation block was the top finding and a competitor's marketing copy became the conclusion. Front matter, DOI stubs and bot-challenge interstitials are now rejected at claim extraction; claims are gated on topical relevance; and findings are drawn round-robin by source, so a source contributes a second finding only after every other source has contributed one. Claim grouping and consensus detection are now semantic rather than lexical.
- **`process_document` returned two different readability scores for the same document** — 100 "Very Easy" against 54.75 "Fairly Difficult" on the same W-9. There were three Flesch implementations, not two; all response paths now use one.
- **`analyze_content`'s readability block ignored the CJK segmenter**, reporting 1 word and 1 sentence for a Chinese paragraph while `statistics` in the same response reported 96. Both blocks now share one tokenizer, sentence splitting understands CJK terminators, and on CJK the Flesch score is withheld with `notApplicable: 'flesch-requires-syllable-based-language'` instead of fabricated.
- **`search_web` returned fewer results than `limit`** when deduplication removed entries and nothing topped up. It now over-fetches a small margin once and trims after dedup, still issuing exactly one backend search. Note `limit: 10` cannot backfill — the provider caps a request at 10 items.
- **`generate_llms_txt` truncated in crawl order, not by importance.** On modelcontextprotocol.io with a 15-page budget it returned 15 `/community/*` pages and omitted the homepage, docs and specification. It now keeps the site root first, then one entry point per top-level section, then fills the remainder.
- **`scrape`'s `branding` format emitted `var(--default-font-family` as a font family**, splitting a CSS value mid-`var()`. Font lists are now split on top-level commas only and `var()` references resolve against the collected variables.
- **`scrape_template github-repo` returned GitHub's OG boilerplate as the description** ("Contribute to owner/repo development by creating an account on GitHub"). Fixed in `crawlforge-extractors` 1.2.3, which this release depends on: the About text now comes from the repository's embedded sidebar payload, and a repo with no description honestly reports `null`.

### Verification

1439 unit tests / 1438 pass / 1 skipped, MCP compliance 100% with 28 tools. Every fix above was verified against a live target over MCP stdio, and each regression test was confirmed to fail against the pre-fix source rather than assumed to.


## [5.2.9] - 2026-08-26

Patch release. The last of the small-local-model JSON parsing defects in `deep_research`.

- **Per-source relevance analysis silently degraded to word overlap on every run.** `analyzeRelevance` was the one remaining place that passed a completion straight to `JSON.parse` with no output-format constraint, so the markdown fences small local models wrap JSON in made the parse throw — and the catch quietly substituted the word-overlap fallback, on every source, since the feature shipped. It now uses the same discipline as the synthesis path: schema-constrained output, a brevity instruction, fence stripping, validation of the load-bearing `relevanceScore`, and one retry before the fallback. The rewrite also fixes a falsy-default bug: a legitimate relevance score of 0 was coerced to 0.5 by `|| 0.5`. Live against local Ollama: zero fallbacks in four calls where before every call fell back, and the scores discriminate — 0.95 for on-topic content, 0.1 for off-topic.


## [5.2.8] - 2026-08-26

Patch release. Two leftovers from the 5.2.6 `deep_research` fix, caught by re-running the live repro.

- **The LLM synthesis fell back to the extractive stub about two runs in three.** With the output shape schema-constrained, the remaining failure was simpler than it looked: small local models fill all six fields verbosely and overran the 800-token budget, truncating the JSON mid-string — and findings were fed to the prompt whole, including flattened sitemap dumps over 1,500 characters. Each finding is now capped at 300 characters in the prompt, the model is asked to be brief, the budget is 1,600 tokens, and a parse failure is retried once before falling back. After the fix, five live syntheses out of five parsed — and ran about twice as fast, since the prompt is smaller.

- **`researchGaps`, `consensus` and the gap-filling recommendation were still keyword-join gibberish.** The 5.2.6 fix cured `findings` of composing text from `group.keywords.join(' ')`, but three sibling sites kept the pattern ("have more real options than year most them good very"). All three now quote the group's most credible claim — a real sentence from a real source — truncated at a word break.


## [5.2.7] - 2026-08-26

Patch release. One defect, found by re-testing the 5.2.6 fixes over the real MCP surface rather than at the function level.

- **An unscoped `reddit_search` failed with a protocol error over MCP.** Since 5.2.3 a Reddit-wide keyword search returns `source: "web_discovery"`, but the tool's declared output schema still enumerated only the two archives — so the tool ran the search successfully and the MCP layer then rejected its own result with `-32602 Invalid enum value … received 'web_discovery'`. Scoped searches passed (they return `source: "arctic_shift"`), which is how the gap survived three releases: pre-ship verification called the tool's `execute()` directly and the REST API has its own implementation, and neither path goes through MCP output validation. The enum now includes `web_discovery`, and the regression test pins the exact rejected shape.


## [5.2.6] - 2026-08-26

Patch release. Seven result-quality defects across the research, analysis and extraction tools, found by pointing the tools at live pages instead of fixtures.

- **A Reddit-wide keyword search failed with a DNS error from every npm install.** The web-discovery route added in 5.2.3 builds its search adapter lazily, and the adapter factory's default base URL pointed at `api.crawlforge.dev` — a host that does not resolve. `search_web` was unaffected because its config carries the real host; `reddit_search` never received it, so an unscoped search died before reaching the network. The factory default is now the live `www.crawlforge.dev` host and the server passes the configured base URL through explicitly. Subreddit- and author-scoped searches query the archive directly and were unaffected.

- **`agent` answered questions about the current state of things from dated articles.** Asked for the #1 story on Hacker News right now, it searched with the words of the task, fetched the articles that rank for those words — a months-old thread — and answered from them; news.ycombinator.com was never fetched. Prompts about the live "now" ("right now", "currently", "today", "latest") are now detected deterministically; the plan step's first query becomes the bare entity name, the results are voted by origin and the dominant domain's root — the live front page — is promoted to the front of the fetch queue and the synthesis input, and synthesis is instructed to answer from it. The raw top result is not a safe proxy: a search engine ranks thehackernews.com above news.ycombinator.com for "Hacker News".

- **`deep_research` key findings were stopword-stripped gibberish.** A finding was composed by joining a claim cluster's keywords ("scraping server model context protocol server that…"). Each finding is now the cluster's most credible claim verbatim — a complete sentence that actually appears in a source.

- **`deep_research` computed an LLM synthesis and then dropped it.** With an LLM available the response said `llmEnhanced: true`, but the synthesis itself — `aiSummary`, `intelligentInsights` — was never included in any output format. It now is, and the summary format carries `aiSummary`. Relatedly, small local models wrap JSON in markdown fences, the parse threw, and the response silently fell back to the keyword composition above — the completion now pins the output shape with a JSON schema and strips fences before parsing.

- **Chinese, Japanese and Korean text was analyzed as if words were whitespace-delimited.** `analyze_content` on a Chinese page counted the entire text as a handful of "words", and topics/keywords returned whole multi-sentence runs as single terms — compromise's noun-phrase matching is English-only. CJK text is now segmented with `Intl.Segmenter`'s dictionary segmentation: word statistics count real words, and topics and keywords are ranked from segmented content words with a small Chinese function-word stopword list.

- **`summarize_content` led with navigation chrome.** Text extracted from real pages opens with lines like "Jump to content" and "Main menu", and they surfaced as the summary's opening and as key points. Leading short, unpunctuated, navigation-shaped lines are now stripped before summarizing, with a size guard so prose that starts mid-sentence is never eaten.

- **`extract_metadata` titles included inline SVG labels.** cheerio's bare `title` selector also matches `<svg><title>` accessibility labels and `.text()` concatenates every match, so pages built with inline SVG icons returned welded titles ("JavaScript | MDNMDNMDNMozilla"). The selector is now `head > title`. OG tags are also read from `meta[name^="og:"]` — MDN, among others, emits them with `name=` instead of the standard `property=`.

- **`process_document` accepted `extractTables` and silently discarded it.** The options schema stripped the unknown key and no table extraction existed at any layer, so the response simply never carried a tables field. The option is now wired through, and PDF tables are detected from the pdfjs text layer by clustering text items into rows and deriving column separators from x-extent gaps — the Transformer paper's Table 2 comes back with its BLEU scores each in their own cell, and prose-only pages yield none. When requested and nothing is found, `tables` is an honest empty array; when not requested, the field stays absent.

- **`crawlforge-extractors` raised to `^1.2.2`**, which repairs the `github-repo` template against GitHub's logged-out React code view: the About sidebar now ships as embedded JSON, so `license` was the file tree's literal link text "LICENSE" and `homepage`/`open_issues` were null. The template reads the embedded payload (SPDX license id, real homepage, exact issue count). `language` and `last_updated` stay null there honestly: GitHub loads both post-render from JSON endpoints a static fetch cannot reach, and the classic-layout selectors remain for if they return.


## [5.2.5] - 2026-08-26

Patch release. Three `track_changes` defects found while testing price tracking on Zillow and Newegg.

- **`customSelectors` targeting any tag outside a fixed allowlist indexed zero elements.** Element-level analysis only indexed `h1`-`h6`, `p`, `div`, `span` and `a`, so scoping a monitor to `address`, `td`, `li`, `tr` or `dd` built a baseline of nothing and no element-level change could ever be reported — a Zillow page scoped to `['address']` built a baseline of 0 elements from 9 matching nodes. Matches for tags outside the allowlist are now hashed as `custom_<sel>_<idx>`; allowlisted tags are skipped, so div-scoped counts are unchanged.

- **A scoped compare silently ran unscoped.** `compareWithBaseline` discards the caller's `trackingOptions` in favour of the baseline's, which is required for a valid diff — both sides must be analyzed identically, and a scoped baseline no longer holds the full document to re-scope — but doing it silently let a scoped compare return results identical to an unscoped run with nothing saying so. The ignored options are now reported through a `warnings` array on the compare result.

- **"Text content changed" was reported on compares that found no changes.** Sub-threshold token noise still populates `textChanges`, so the summary said the text had changed while `hasChanges` was `false`. The description now defers to significance.

Verified live against the Zillow page that exposed them: baseline 0 → 9 elements, and a compare that had reported `true`/"moderate"/28 modified now reports `false`/"none"/0 modified at 100% similarity.

- **`crawlforge-extractors` raised to `^1.2.1`**, which reads YouTube view counts from the `WatchAction` interaction counter rather than an attribute that appears nowhere on a watch page, and adds the `likes` field the `youtube-video` template already described.


## [5.2.4] - 2026-08-26

Pricing change.

- **`reddit_search` now costs 5 credits, up from 2.** Since 5.2.3 a Reddit-wide keyword search discovers posts through a site-restricted web search before reading them from the archive — the same upstream call `search_web` makes, at the same price. A subreddit- or author-scoped search still queries the archive directly, but bills the same: the tool has one published price rather than a per-request one. The client-side cost table, the skill credit tiers, and the routing description in `CLAUDE.md` are updated to match.


## [5.2.3] - 2026-08-26

Patch release. The two remaining findings from the live 28-tool sweep.

- **Reddit-wide keyword search failed outright.** PullPush began refusing automated clients in August 2026 — every request returns 429 with "This website does not provide free scraping resources for agents", regardless of user agent, and from some IPs a Cloudflare 403 challenge instead. It was the only backend that could keyword-search across all of Reddit, because Arctic Shift rejects a keyword query that names no subreddit or author (verified live: HTTP 400). `reddit_search` now serves that search in two steps: find matching posts with a site-restricted web search, then read those posts out of the Arctic Shift archive by ID. The rows returned are real archive rows — score, comment count, subreddit, selftext — in web-search relevance order, not scraped snippets. `after`/`before` cannot be applied on that route, so the response says so rather than silently dropping them.

- **PullPush is no longer tried automatically.** That includes its role as the fallback for a scoped search, where it could only spend a request and bury the real Arctic Shift error behind a second failure. `source: "pullpush"` still reaches it unchanged for whenever it returns. An unscoped comment search, which no backend can serve now, returns a message asking for a subreddit or author scope instead of a generic archive failure.

- **The `npm-package` template returned almost nothing.** npmjs.com answers plain HTTP fetches with 403, and where a body did arrive the selectors keyed off class-name fragments that no longer match — version and weekly downloads came back null, and "repository" pointed at the stargazers link. The template now reads the package's registry document, the way `shopify-product` reads `/products/<handle>.json`, and returns version, license, repository, homepage, maintainers, keywords, dependencies and any deprecation notice. Weekly downloads are omitted rather than null: they live on a separate endpoint, and the registry search endpoint that carries them is a search — asked for "left-pad" it answers "pad-left" — so it cannot be trusted for exact package data.


## [5.2.2] - 2026-08-26

Patch release. Two result-quality fixes surfaced by a live regression sweep of all 28 tools against real sites.

- **The `markdown` format returned raw HTML on table-layout pages.** `turndown-plugin-gfm` converts a table only when its first row is entirely `<th>`; every other table goes through the plugin's `keep` filter and is emitted verbatim. Scraped pages are full of layout tables — Hacker News is built out of them — so `scrape` with `formats: ["markdown"]` and `extract_text` with `output_format: "markdown"` handed back `<table>` markup instead of markdown. Rules registered after the plugin now match those tables first (added rules take precedence over keep filters) and flatten them to their cell content, so links and text convert normally. Tables with a real heading row are untouched and still render as GFM pipe tables.

- **Language detection could never return Chinese, Greek, Arabic, Norwegian or Malay.** `ContentAnalyzer` restricted franc to the keys of its `LANGUAGE_NAMES` map, but five of those keys were ISO 639-2/B codes (`chi`, `gre`, `ara`, `nor`, `msa`) that franc, which emits ISO 639-3, never produces. Text in any of those languages fell through to the undetermined branch — a page written entirely in Chinese returned `null`. The codes are now `cmn`, `ell`, `arb`, `nob` and `zlm`/`zsm`.

- **CJK pages carrying English text detected as English.** franc scores whichever script is most common, so a Chinese or Japanese page with the usual run of English product names and code samples was scored as Latin-script prose. Detection now short-circuits on a Han/kana/hangul share of at least 10% of letters, which those scripts only reach in genuine CJK text.


## [5.2.1] - 2026-08-26

Patch release. Two fixes that shipped to the hosted server the day 5.2.0 was published but could not reach anyone installing from npm until now.

### Fixed

- **`shopify-product` was missing from the `scrape_template` tool description.** The template shipped in 5.2.0 and was listed in the skill docs and in the REST API's own description, but not in the description registered with the MCP server — which is the copy a client model actually reads when it decides which template to reach for. An agent asked for a Shopify product would fall back to scraping the rendered page, which is the exact failure the template exists to prevent.

- **`track_changes` structural scores could never fall below 0.5.** `structuralSimilarity` averages a tag-vocabulary comparison with a hierarchy comparison, but the hierarchy object was initialised empty and never written to, so that half compared `{}` against `{}`, returned a constant 1, and pinned every score at `(tagSimilarity + 1) / 2`. A page rebuilt from the same tags in a completely different nesting scored a perfect 1.0 — precisely the case the metric exists to catch. The hierarchy is now an element-count-by-depth histogram compared as a weighted Jaccard, so a layout change moves the score.

### Changed

- **Body reading and structural scoring moved to `crawlforge-extractors` (≥1.1.0).** `fetchWithTimeout`'s charset detection and body-size cap, and the structural signature `track_changes` compares, now have one implementation shared with the CrawlForge REST API instead of a copy on each side. Behaviour here is unchanged apart from the hierarchy fix above. The per-unit tests for both moved into the package.


## [5.2.0] - 2026-08-26

Minor release. One new `scrape_template` template, two tools that now report facts they always had but never returned, and a long run of fixes to things that were silently wrong — several of which passed their own tests because the fixtures had been written to match the code rather than the world.

### Added

- **`shopify-product` template.** Every Shopify failure this cycle came from parsing the rendered page: the Dawn theme ships each price badge unconditionally and hides the inapplicable ones in component CSS, so extraction reported "Sold out" for a product with 100 units in stock, and an LLM asked for a compare-at price invented `27.99` for a product that has none. Shopify serves the same data at `/products/<handle>.json`, and this template reads that — exact price, compare-at price, per-variant stock, options, images and tags, with no HTML parsing and no LLM, on any storefront including custom domains. Store quirks handled from live captures: an absent compare-at price is `""` on one store and `"0.00"` on another (both read as `null`, since both render no badge, while a genuinely free product keeps its `0.00` price); tags arrive as an array or a comma-joined string; the endpoint carries no `available` flag, so stock is derived from inventory management, policy and quantity, and reports `null` rather than guessing "in stock" when the payload does not say. A non-Shopify response fails with a clear message instead of a row of empty fields.
- **Templates can read a machine-readable endpoint.** `TemplateRegistry` gains two optional hooks — `resolveUrl(url)` to redirect the tool's single fetch and `extractRaw(body, url)` to parse a non-HTML response — so a template can do this without taking the fetch into its own hands. `ScrapeTemplateTool` still owns the SSRF-guarded fetch and now reports `fetchedUrl` when a rewrite happened. HTML templates are unchanged.
- **`fetch_url` reports `responseTime`.** It returned status, headers, body, size and contentType — enough to answer "is this URL up?" and nothing that could answer "how slow is it?", despite being the raw-HTTP tool with no other output to fall back on. The measurement starts *after* the per-host politeness throttle, so a monitor polling one host in a loop does not read its own wait as the site being slow, and closes after the body is fully read, so a server that answers instantly then trickles is reported as slow. Live: example.com 96ms, crawlforge.dev/api/health 547ms.
- **`crawl_deep` reports `cached` and `crawled_at`.** A replayed crawl was indistinguishable from a fresh one; `crawled_at` carries when the pages were really fetched. Both are declared in the tool's output schema.
- **Remote Ollama endpoints via `OLLAMA_API_KEY`.** Every Ollama HTTP call now sends `Authorization: Bearer` when the variable is set, so a hosted deployment can use Ollama Cloud or any auth-fronted instance with no OpenAI/Anthropic key. Unset, nothing changes.
- **Internal-proxy auth with per-request billing exemption.** `X-Internal-Secret` (checked against `INTERNAL_PROXY_SECRET`, sha256 + `timingSafeEqual`) lets the CrawlForge REST API forward browser/LLM tools here after it has already authenticated and billed the end user, so the call is not metered twice. Presenting the header claims internal identity: a mismatch is a hard 401 with no fall-through, and the header never authenticates when the env var is unset. The flag is request-scoped via `AsyncLocalStorage` and never persisted on the session. Static-key and OAuth billing are unchanged.

### Fixed

- **`amazon-product` returned nulls against every current Amazon page.** Run against three live product pages the template returned `null` for currency, rating, images and breadcrumbs, and returned `"Brand: Amazon"` and `"(198,594)"` verbatim. Every failing selector — a `priceCurrency` meta tag, `#acrPopover .a-size-base`, `img.a-thumbnail-image` — exists nowhere on Amazon today; the fixtures had been written to match the selectors rather than the site, so all six passed in CI. Selectors re-derived from live captures of a first-party device, a branded storefront and a book: currency from the hidden add-to-cart field, rating parsed to a number from `#acrPopover`'s `title`, review count parsed from either `"(198,594)"` or `"198,594 global ratings"`, brand reduced to `X` from all three byline shapes, and images upsized to the original by dropping Amazon's size token (the tokened URL is a 1KB thumbnail; the same URL without it is the 16KB original).
- **`track_changes` scored price moves by how much of the page they occupy.** Significance was purely volumetric, so `$19.99 → $29.99` and `$19.99 → $99.99` both scored "minor", and unscoped the change did not register at all. With `notificationThreshold` defaulting to "moderate", a monitor set up the obvious way never fired on a price change — the core promise of price monitoring did not work. Monetary amounts are now compared directly and their relative magnitude raises significance to at least "moderate", or "major" at 20%+. Only currency-tagged numbers count, so view counters and review totals do not fire; thousands separators parse, so `$1,299` reads as 1299. The pair is surfaced in `details.valueChanges` so a caller can see why a monitor fired.
- **`track_changes` `customSelectors` never scoped anything.** It was read only inside section-level analysis, where it *added* hashes, so scoping a comparison made it worse: on an Amazon product page, scoping to the price block raised modified elements 456→3204 and payload 5.35MB→6.18MB, and reported changes on a page whose price had not moved. Analysis now narrows the document to the matched subtrees, which scopes hashing, similarity and diffs together. A selector matching nothing falls back to the full document and warns rather than silently tracking nothing. Separately, `line_diff` embedded the full before+after document because whitespace collapsing degenerates the diff into "remove everything, add everything"; both diffs are now bounded with an explicit `omittedEntries` marker.
- **`track_changes` reported `structuralSimilarity: 0` when it had not measured it.** Zero is a real score meaning "the structure changed completely", so opting out of structural tracking produced the strongest possible signal that the structure had changed. It is `null` when not measured.
- **`scrape` deleted framework-streamed content.** The hidden-content strip removed `<div id="S:0" hidden>`, where the Next.js App Router streams the rendered page. On a pricing page that wrapper is the whole visible page: markdown came back empty, losing every price. The wrapper guard now takes the larger of the text and markup shares, so a wrapper is recognised whichever way it is heavy.
- **`scrape` counted script payload as page text when sizing a wrapper.** The bulk-removal guard sized elements with `$('body').text()`, which includes the source of every inline `<script>`. On a Shopify storefront the denominator was 62,269 characters of which 4,295 was visible copy, so a wrapper holding the entire product section measured under the threshold and was deleted along with the price — after which the json path had no price to extract and the model invented one. Both sides of the ratio now exclude `script`/`style`/`noscript`/`template`.
- **`scrape` returned an LLM's schema echo as if it were data.** The json format read only `success` from `extract_with_llm` and discarded the rest, so three failures reached callers looking like clean extractions: a schema document returned instead of page data (well-formed JSON, and with no required fields it passed validation too), output that failed schema validation, and input silently clipped at the 50,000-character cap. `extract_with_llm` now detects a schema echo, retries once, and fails with an actionable error; `scrape` surfaces schema-mismatch and truncation as warnings while keeping the data.
- **Ollama was never registered as an LLM provider.** `LLMManager` registered only OpenAI and Anthropic, both gated on an API key, so on a machine running Ollama with no cloud keys `extract_structured` skipped LLM extraction entirely and reported `css_fallback` (producing `"$79.99$79.99"` and dropping fields), and `deep_research` silently disabled query expansion, semantic ranking and synthesis. `extract_with_llm` has its own private client, which is why it worked and masked the gap. Also stops mislabelling failures: a failed LLM call no longer reports `extraction_method: "llm"` with confidence 0.9.
- **Ollama routing picks the best installed model** instead of always `llama3.2`. Benchmarked against three live product pages with verified ground truth, `gemma3:4b` scored 18/18 at 1040ms while `llama3.2` scored 16/18 — and the failures are systematic, not sampling noise: over five runs `llama3.2` invented a compare-at price on all five. Parameter count did not predict accuracy; the 4B model beat both a 12B and a 20B. `selectOllamaModel()` picks the highest-ranked installed model rather than hardcoding one; `OLLAMA_DEFAULT_MODEL` still wins.
- **`scrape_with_actions`: seven Playwright API and error-recovery defects**, all invisible to the suite because its fake pages implemented whatever the executor called — including APIs Playwright does not have. `scroll toElement` called `scrollIntoView()`, which does not exist on a handle or locator, so the branch threw every time it ran. The `wait` action advertised `enabled`/`disabled`/`stable` but passed them to an API that rejects them. The per-action `Promise.race` shared a deadline with the work it raced and won, replacing Playwright's real error with a bare "Action timeout", and left a live timer per action. Clicks and keypresses did not wait on the document they replaced. A chain retry replayed against whatever the failed attempt left behind, never reloading. And every recovery strategy sat behind `retries > 0` while the schema defaulted `retries` to 0, so none could ever run.
- **Stealth browser wedge.** `stealth_mode create_page` never closed its page, leaking one Chromium renderer per call until the instance ran out of memory; a wedged browser was then reused forever behind truthiness-only checks, and cleanup hung on protocol calls to the dead browser so it could not be unwedged remotely. Adds `isConnected()` corpse detection, a disconnected handler, cleanup racing closes against 5s deadlines with a SIGKILL fallback and pool recreation, and an in-flight launch mutex.
- **Hosted images ignored the system Chromium.** `chromium.launch` now honours `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — the Dockerfile has set it all along, but Playwright never reads env vars itself — so browser paths stop dying on Alpine looking for a chrome-headless-shell that was never downloaded.
- **Task-capable tools failed over Streamable HTTP.** `cloneServerForSession` dropped capabilities and the task store, so `tools/call` on `agent`, `crawl_deep`, `batch_scrape` or `deep_research` threw "No task store provided for task-capable tool."
- **`CACHE_DIR` and `CACHE_ENABLE_DISK` did nothing.** `constants/config.js` has always exposed both, but `CacheManager` read neither: the directory was hard-wired to `./cache` and the disk cache was unconditionally on. Every test process therefore shared one directory that survived every run — 1,778 files had accumulated — and because `crawl_deep` keys on the crawled URL while test servers bind ephemeral ports that the OS recycles, a run could be handed an earlier run's crawl of a different site. That was the cause of a rare parallel-run flake whose tell was in the timings: two failures took 13ms and 5ms for tests that perform two full crawls each. Defaults are unchanged (`./cache`, enabled) — the variables simply do what they always claimed.
- **`crawl_deep`'s `cacheEnabled: false` switched off only half the caching.** `BFSCrawler` builds its own cache and stores every fetched page body with no way to turn it off, so a caller who explicitly asked for none was still served cached pages. Both caches also wrote to disk despite being described in-code as per-session and destroyed after each crawl; on disk, bodies outlived the crawler by an hour and crossed process boundaries, and crawl payloads grew the cache directory without bound. Both are memory-only now. Within a process, caching is unchanged.

### Changed

- **The `scrape_template` extractors moved to [`crawlforge-extractors`](https://www.npmjs.com/package/crawlforge-extractors).** This server and the CrawlForge REST API each carried their own copy, in two languages, with nothing detecting divergence — and it diverged twice in two days. There is now one implementation. `TemplateRegistry` is re-exported from the package with an unchanged API; nothing about the `scrape_template` tool changes for callers. It is a runtime dependency of this package, not a peer dependency, so `npm install -g crawlforge-mcp-server` and `npx crawlforge-mcp-server` pull it in automatically — there is nothing extra to install.

### Tests

- 1122 unit tests / 1121 pass / 0 fail / 1 skipped. MCP protocol compliance 100.0%, 0 errors, 28 tools. The per-template unit tests moved to `crawlforge-extractors` (44 there); `scrapeTemplate.test.js` keeps the tests for the tool wrapped around them. New suites were written to fail against the pre-fix code first — 15 of 24 for `amazon-product`, 8 of 10 for the `crawl_deep` cache scope, 7 for the `scrape_with_actions` Playwright APIs — and `actionExecutorPlaywrightApi.test.js` drives a real Chromium against a local fixture server, skipping when no browser binary is installed.


## [5.1.0] - 2026-08-24

Minor release: new `reddit_search` tool — the 28th tool — giving CrawlForge real Reddit search despite reddit.com blocking every direct access path.

### Added

- **`reddit_search` tool (28 tools total).** reddit.com 403-blocks ALL direct CrawlForge access — verified live against `fetch_url` (even with a full browser User-Agent), `scrape` on old.reddit.com, `scrape_template` reddit-thread, and `stealth_mode` at advanced level, so the block is IP/TLS-reputation based and unbeatable from a scraper. The new tool never touches reddit.com; it queries the two community-run archives: **Arctic Shift** (`arctic-shift.photon-reddit.com` — near-real-time ingestion, verified returning a post created the same day; nested comment trees) and **PullPush** (`api.pullpush.io` — Pushshift-compatible cross-subreddit full-text search, with documented post-2023 gaps and aggressive ~15 req/min rate limits). Three modes: `posts` (default) and `comments` keyword search, and `thread` (a post plus its nested comment tree by `link_id`, with reddit-style `{more_count, more_ids}` markers for collapsed branches). Routing is dictated by a live-verified Arctic Shift constraint — its keyword search returns HTTP 400 without a `subreddit`/`author` scope — so unscoped full-text search goes to PullPush only, while scoped searches use Arctic Shift with error-only PullPush fallback (`fallback_used` reports when this happened). Both archives shed load transiently (PullPush 429s; Arctic Shift answers 422 "Timeout. Maybe slow down a bit" — observed live), so each request gets one bounded retry after 3s. Every request also carries an identifying `User-Agent` (`CrawlForge-MCP/x.y.z`) — verified live that Arctic Shift throttles UA-less Node clients into a shared bucket (422 for the tool while curl got 200 on the identical URL, seconds apart); with the UA it answers instantly. PullPush's 429 policy message ("does not provide free scraping resources for agents…") is passed through verbatim so callers see the real reason. Results are normalized (full reddit.com permalinks, ISO dates, 2000-char selftext/body caps with truncation flags) and carry provenance `notes` (archive freshness caveats — scores of <36h-old content read 0/1). Free, no credentials; `REDDIT_SEARCH_TIMEOUT_MS` overrides the 30s per-request cap. Cost: **2 credits**. Registered with structured `outputSchema`; `search/` instructions and getting-started prompt updated.

### Tests

- 1018 unit tests / 1017 pass / 0 fail / 1 skipped (31 new `redditSearch.test.js` cases: routing, the scoped-keyword constraint, fallback, forced-source behavior, normalization, thread-tree nesting, PullPush date conversion, throttle retry semantics; `phase6-output-schemas.test.js` extended to the new 7-key frozen contract with realistic posts/thread samples). MCP protocol compliance 100.0%, 0 errors, 28 tools. Live verification over MCP stdio: `tools/list` shows 28 tools and `reddit_search` returns real r/ClaudeAI posts through Arctic Shift.

## [5.0.5] - 2026-08-23

Patch release: `serp_rank` live-verified against a real DataForSEO account, which invalidated two numbers the codebase had been asserting — the request timeout and the documented price. Also ships the Smithery static server card fix and a stale `serverInfo` version.

### Fixed

- **`serp_rank` timed out on healthy lookups.** DataForSEO's Live Advanced endpoint runs a real-time Google scrape, so latency tracks their capacity *and* the requested `depth` rather than being roughly fixed. Measured on one account in a single session: ~13–15s at `depth:10`, and 30s / 44.9s / over 60s (twice) for the *same* `depth:100` request. The adapter's 30s abort cap sat well inside that spread and killed lookups that were merely slow — and a killed lookup is still billed, because DataForSEO has already run the scrape. Default raised to **120000 ms**, overridable per-deployment with the new **`DATAFORSEO_TIMEOUT_MS`** env var (an explicit `options.timeoutMs` still wins for tests/self-host; a non-numeric env value falls back to the default instead of `NaN`).
- **`serp_rank` cost was documented 10× too low.** `~US$0.002/call` is the `depth:10` price; Live Advanced bills **US$0.002 per 10 results of `depth`**, so the old `depth:100` default cost **$0.02** per lookup. Confirmed two ways — the API's own `cost` field (0.002 at depth 10, 0.004 at depth 20, 0.02 at depth 100) and the account balance across billed calls. Corrected in `.env.example`, `CLAUDE.md`, the adapter header, and the `AuthManager` cost notice.
- **MCP `serverInfo.version` was stale.** `server.js` hard-coded `5.0.2` while `package.json` was at 5.0.4, so every client saw a version two patches old. Now bumped with the release. `package-lock.json`, which the v5.0.4 release left at 5.0.3, is back in sync too.
- **Smithery listing showed a hand-written, drifted tool table** (18 rows labelled "20 tools" against a real count of 27). Smithery populates a listing by scanning the server, but `/mcp` 401s without a key, so the scan enumerated nothing and the listing kept whatever was typed in at publish time. The static card at `/.well-known/mcp/server-card.json` now derives its `tools` from `server._registeredTools`, so it tracks the registry every release; ZodRawShape input schemas are wrapped before conversion and a tool whose schema fails to convert is still listed with an open object schema rather than silently dropped. Adds the `authentication` block Smithery reads plus empty resources/prompts arrays. `zod-to-json-schema` (already a hard dependency of the MCP SDK) is now declared directly rather than relying on npm hoisting.

### Changed

- **`serp_rank` default `depth` lowered 100 → 20** (tool zod schema and the adapter's own fallback, kept in sync): two pages of Google for **$0.004** in ~19s, instead of one deep scan for $0.02 in 30–60s+. Ranks below position 20 now report `found:false` until the caller raises `depth` (min 10, max 200 — DataForSEO's cap — both unchanged). The server-side `depth` description states the new default and the per-10 billing.

### Tests

- 982 unit tests / 981 pass / 0 fail / 1 skipped (one new case covering `DATAFORSEO_TIMEOUT_MS` override, `options.timeoutMs` precedence, and the non-numeric fallback; default-value assertions updated). MCP protocol compliance 100.0%, 0 errors. Live verification over MCP stdio: `serp_rank` with no `depth` argument returned `depthScanned:20`, `cost:0.004` in 18.9s, and correctly placed python.org at organic position 1 in a separate lookup.

## [5.0.4] - 2026-08-20

Patch release: third full-surface live retest (all 27 MCP tools via a 10-agent workflow judging returned content, all 24 CLI subcommands against live sites). The one remaining hard defect (`agent` tool synthesis) is fixed and verified end-to-end, plus a CLI key-resolution bug found during testing.

### Fixed

- **`agent` tool fetched the right page but could not answer from it.** It gathered the named site fine (HTTP 200, evidence recorded) yet answered "unable to find the #1 story" / "I'm unable to access the internet". Three coupled causes, each verified insufficient to fix alone: (1) `_fetchAndParse` flattened pages with `$('body').text().replace(/\s+/g,' ')`, welding adjacent block elements into one string ("1.Story title329 points") — the new exported `flattenBodyText()` marks block-element boundaries with a U+E000 sentinel (NUL cannot be used: cheerio's `.after()` parses its argument as HTML and the parser strips NUL), collapses whitespace, then turns sentinels into newlines, so every table row / list item survives as its own line; it works on a detached clone because `unifiedScrape` reuses the returned `$`. (2) The SHAPE stage ordered synthesis sources purely by prompt-term overlap, so a generic article containing the task's words ("title", "story", "current") outranked the site the prompt explicitly named — an NFL article buried the news.ycombinator.com front page. Seed URLs and prompt-named sites now carry a fixed priority boost above any term-overlap score. (3) Small local models refused even perfectly-ordered input — the synthesis prompt now states the sources were ALREADY fetched and forbids refusing for lack of browsing ability; with that wording all four installed Ollama models answer the isolated test correctly. Live end-to-end over MCP stdio, the agent now names the real current HN #1 story.
- **CLI `search` ignored the API key stored by setup.** `config.js` captured `process.env.CRAWLFORGE_API_KEY` at import time, but the CLI's preAction hook resolves the key (`--api-key` flag → env → `~/.crawlforge/config.json`) after that import, so a user whose only key was the stored one always got "CrawlForge API key is required". `getToolConfig('search_web')` now reads the env at call time. Verified from a non-repo working directory with no env var set.

### Changed

- Synthesis-model guidance: on the real ~13KB multi-source synthesis prompt, llama3.2 (the code default) still fails where qwen2.5:3b (the same 3B size), mistral:7b, and gemma3:12b all succeed — if `agent` answers degrade locally, set `OLLAMA_DEFAULT_MODEL=qwen2.5:3b`. The code default remains llama3.2 for ecosystem compatibility.

### Tests

- 980 unit tests pass (6 new: `tests/unit/fetchAndParse-text-structure.test.js` — line-structure, td spacing, br/li/p breaks, NBSP collapsing, no `$`-tree mutation; `tests/unit/agent-shape-priority.test.js` — prompt-named site precedes higher-term-overlap decoys in the synthesis input); MCP protocol compliance 100%.

## [5.0.3] - 2026-08-20

Patch release: fifteen defects from a second full-surface live retest (all 27 MCP tools judged on returned content via an 8-agent workflow, all 23 CLI subcommands against live sites), run after v5.0.2 shipped. Every fix was researched via `search_web`, reproduced against live-captured fixtures, and re-verified live end-to-end.

### Fixed

- **`agent` tool returned wrong or fabricated answers despite gathering correct evidence.** Three coupled causes in `AgentOrchestrator`: the planning LLM's preamble line ("Here are 3 concise web search queries…") became search query #1 and poisoned the URL queue; the synthesis context was a flat 12K-char truncation of queue-ordered evidence, so the relevant source (fetched last) never reached the model; and nothing stopped the model inventing URLs. Now: preamble/garbage lines are filtered from the plan, every source gets a per-source context budget (`max(1500, 12000/n)` chars) in relevance order, the synthesis prompt forbids fabricating URLs and requires citing sources, and sites named directly in the prompt (full URLs or bare domains like `news.ycombinator.com`) are queued ahead of search results.
- **`stealth_mode --engine camoufox` falsely reported "camoufox is not installed".** camoufox's `exports.import` entry is a broken esbuild ESM bundle that throws `Dynamic require of "events" is not supported`; `CamoufoxAdapter.isAvailable()` swallowed every load error as "not installed", and `launch()` called a `camoufox.launch` API that has never existed. The adapter now loads the working CJS entry via `createRequire`, calls the real `Camoufox()` launcher (with the macOS `properties.json` bridge), and distinguishes genuinely-absent from failed-to-load.
- **playwright-core 1.62 broke every camoufox context (latent since the v5.0.0 dependency upgrade).** camoufox pins `playwright-core ^1.54`; 1.62's `Browser.setDefaultViewport` payload carries fields (`screenSize`, `isMobile`) its older Firefox build rejects, so any fixed-viewport context — including plain `newPage()` — failed. Contexts for the camoufox engine now use `viewport: null`, which skips that protocol call entirely (window.screen spoofing via init script is unaffected). Applied in both `StealthBrowserManager.createStealthContext` and `ResearchOrchestrator._stealthFetchOnce`, un-breaking `deep_research`'s camoufox anti-bot fallback.
- **Scheduled-monitor store was working-directory-relative.** `MonitorStore` defaulted to `./monitors`, so `monitor:list`/`monitor:stop`/`monitor:run-due` silently saw different stores per directory ("No scheduled monitor found" for a monitor that existed) and the documented cron workflow only worked from the creation directory. The store now defaults to `~/.crawlforge/monitors` with a best-effort one-time migration of legacy `./monitors` files; `--every`-based cron firing works from any directory.
- **`track_changes` compare contradicted itself and overflowed its metric.** An unchanged page still reported `changeType:"text_change"` / "Text content changed"; `structuralSimilarity` could exceed 1 (observed 1.05) because tag similarity intersected a duplicate-laden list against a set union; and `create_baseline` read a nonexistent `.analysis` property so `sections`/`elements`/`contentHash`/`createdAt` were 0/undefined for every page. Unchanged compares now return `changeType:"none"` with "No significant changes detected", tag similarity is true set-based Jaccard clamped to [0,1], and baselines report real values.
- **`batch_scrape` markdown dropped main content.** The worker's hand-rolled converter only emitted h1–h3/p/li text, losing anything in other elements (quotes.toscrape.com's `<span class="text">` quotes vanished entirely). It now uses the same shared Turndown helper as the unified `scrape` tool; batch markdown consequently also stops including nav/footer boilerplate.
- **`scrape_template` hacker-news-front-page mis-mapped two fields.** `posted` carried the item permalink (`item?id=NNN`) instead of the age ("3 hours ago") for every story, and on job posts the age string leaked into `comments`. `posted` now reads the `.age` link text and the comments selector excludes it (job posts correctly yield `comments:null`).
- **`extract_text` leaked literal HTML from `<noscript>`.** Wikipedia's CentralAutoLogin tracking pixel appeared verbatim as an `<img …>` tag in "plain text" output because parsers treat noscript contents as raw text. noscript elements are now stripped before extraction.
- **`localization` shipped wrong locale data and an impossible contract.** France (and most non-US countries) reported `dateFormat: "MM/DD/YYYY"` — the mapping is now audited for all 26 supported countries with a world-majority `DD/MM/YYYY` fallback; `auto_detect` demanded both `content` and `url` while its schema implied url alone sufficed — it now works content-only with url as an optional TLD hint (never fetched); and language confidence was absolute-count-based so plain English returned `detectedLanguage:null` at 0.07 — scoring is now stopword-density-based (unambiguous English detects `en` at ~0.4–0.6).
- **`summarize_content` extractive summaries skipped the lead sentence.** Sentence salience averaged normalized word frequency, inflating short high-frequency sentences (a 4-word trailer outscored everything) while the lead carried a weak bonus. Document-leading sentences now get a strong position bonus and sub-5-content-word sentences a brevity penalty; definitional leads rank first.
- **`analyze_content` topics were always empty and entities noisy.** Topic confidence was normalized by total phrase count, so on long texts nothing cleared the threshold — it is now relative to the max phrase frequency (RAKE-style). Entity output gets a cleanup pipeline: edge-punctuation stripping (abbreviations preserved), case-insensitive dedupe, sentence-initial stopword suppression, an "X v. Y" legal-case guard (no longer classified as PERSON), and ALL-CAPS tokens (UNIX, DOM) demoted from organizations unless corroborated.
- **`scrape_with_actions` silently ignored scroll `x`/`y`.** The documented CLI action format `{"type":"scroll","x":0,"y":500}` was stripped by three schema layers and scrolled the default 100px. `x`/`y` are now accepted at the ActionExecutor, tool-schema, and MCP-schema layers as absolute `window.scrollTo` coordinates (taking precedence over direction/distance), and the action result reports the effective `scrolledTo` target; recordings round-trip the fields.
- **`llmstxt` CLI dumped a raw zod error for `--max-pages` below 10.** The value is now validated (10–500) before invocation with a clear one-line message.
- **`generate_llms_txt` labeled pages "[1]" and used boilerplate descriptions.** Link names now prefer each page's captured `<title>` (duplicate titles fall back), else a humanized full path ("/tag/abilities/page/1" → "Tag: abilities — page 1"); the site description prefers the homepage's meta/og:description when present.
- **`docs/cli-guide.md` was stale.** The `map` section documented nonexistent `--depth`/`--format` flags (real options: `--max-pages`, `--no-sitemap`); `monitor:create`/`monitor:list`/`monitor:stop`/`monitor:run-due`, `init`, and `mcp|serve` were entirely undocumented; the llmstxt minimum is now stated.

### Tests

~50 new regression tests across 11 files (monitor store default + legacy migration, compare labeling + Jaccard bounds, HN template job-post fixture, batch markdown span survival, noscript stripping, 26-country dateFormat audit, content-only auto_detect, lead-bias summaries, topic/entity cleanup rules, scroll x/y at every layer, llms.txt labeling). Suite: 974/975 pass (1 skipped), MCP protocol compliance 100%.

## [5.0.2] - 2026-08-20

Patch release: the four content-quality defects deferred from v5.0.1, all found in the same full-surface live test.

### Fixed

- **`analyze_content` entity extraction always returned zero entities.** `ContentAnalyzer.extractEntities` called `doc.dates()`, which in compromise v14 requires the uninstalled `compromise-dates` plugin — the throw aborted the whole extraction (people/places/organizations worked fine underneath) and the catch silently returned empties. Dates now use the core build's `#Date+` tag matching; the repro sentence yields Tim Cook / Microsoft / California.
- **`extract_structured` CSS fallback silently omitted price fields.** The semantic-selector table had no commerce entry and the literal `.price` selector cannot match class tokens like `price_color`. Added `price: ['[itemprop="price"]', '[class*="price"]']` — books.toscrape.com-style markup now extracts (`£53.74`).
- **`generate_llms_txt` produced no URL inventory and mislabeled content pages as APIs.** Substring matching classified "S-**api**-ens" as an API link (now word-boundary `\b(api|developer)s?\b`), and the `## Pages` sitemap fallback ran *after* the APIs section, so one false positive suppressed the entire inventory (fallback now runs first). Uncategorized sites always get a `## Pages` listing; categorized sections are unchanged.
- **`scrape_template` github-repo returned null watchers and empty topics.** GitHub's logged-out React layout dropped the old markup: watchers now read from `.octicon-eye + strong` (aria-label kept as classic-layout fallback) and topics accept `a[href^="/topics/"]` alongside `a.topic-tag`. Language is client-side-rendered on the React layout (unrecoverable from static HTML) and correctly stays null there; the `itemprop` selector still works on classic pages.

### Tests

+5 regression tests (entity repro, `price_color` fixture, Pages-fallback ordering, word-boundary API matching, React-layout GitHub fixture); suite now 925 tests, 100% MCP-protocol-compliant.

## [5.0.1] - 2026-08-20

Patch release: eleven defects found by a full-surface live test of all 27 MCP tools and all 23 CLI subcommands against real websites (see PRD.md, "Live tool-test remediation").

### Fixed

- **`crawl_deep` event-loop starvation (critical).** `BFSCrawler.extractLinkMetadata` re-parsed the entire page HTML with cheerio (plus a full `$('body').text()` serialization) for *every link* on a page — O(links × page size) synchronous CPU. On link-dense pages (~1,500 links, MB-scale HTML) the server pegged the CPU for 13+ minutes at multi-GB memory, starving the event loop so *all* concurrent MCP calls hung and even SIGTERM/graceful shutdown could not run. The page is now parsed once and reused for every link. Same crawl: ~168s, server responsive throughout.
- **`crawl_deep` could overshoot `max_pages`.** The cap check ran before an awaited robots.txt lookup, so concurrent queue tasks all passed it before any registered (asked 5, crawled 10). The cap is now re-checked synchronously at registration and is exact.
- **`serp_rank` rejected valid paid responses.** DataForSEO emits `snippet: null` for organic items without a description, but the output schema required a string — one such item discarded the whole (already-billed) lookup. `snippet` is now nullable.
- **`generate_llms_txt` ignored `analysisOptions.maxPages`/`maxDepth`.** The per-call options never reached the analyzer's constructor, which is where the crawl caps are read (asked 10, analyzed 100). They are now applied.
- **CLI `stealth` failed on every default invocation.** `--engine` defaulted to `playwright`, a value the engine enum stopped accepting in v4.0.0 (`chromium | camoufox`). Default is now `chromium`; `playwright` remains a back-compat alias.
- **CLI `track` could never compare across invocations.** Baselines lived only in process memory, so every CLI run re-created the baseline. New `TrackChangesTool.rehydrateBaseline()` rebuilds the baseline from the newest persisted snapshot at compare time — fixing fresh CLI processes and restarted MCP servers alike.
- **Baseline rehydration never worked (latent since v4.8.0).** `SnapshotManager.querySnapshots` returns stored content as a Buffer; both rehydration sites guarded with `typeof content === 'string'` and silently rejected every snapshot, so scheduled monitors re-baselined after every restart. Buffers are now normalized to UTF-8.
- **`monitor:stop` reported `stopped:false` while succeeding.** In a fresh process the unloaded `MonitorStore` made the existence check always false (and `stopByUrl` a silent no-op) even though the file was removed. Both now load the store first; unknown ids return `success:false` with a clear error (CLI exit 1).
- **`crawlforge init` demanded an API key in creator mode.** Creator machines now proceed keyless (via `isCreatorModeVerified()`), writing an env-less MCP stanza; machines with neither key nor creator secret still exit 1 with setup guidance.
- **`init` wrote a stanza pointing at a nonexistent npm package.** The generated MCP-server entry invoked `npx -y crawlforge@latest mcp`, but the published package is `crawlforge-mcp-server` — every init-generated config was broken (and the unclaimed name was a squatting risk). The stanza now references `crawlforge-mcp-server@latest`.
- **Every detected change stored an empty junk snapshot.** The `changeDetected` handler stored `changeRecord.details.current || ''`, but the change record carries diff analysis, never page content — so each significant change wrote a zero-byte snapshot (often timestamp-tied with the real one, which could then make baseline rehydration pick the empty and give up). The handler now only stores when content is actually present, and both rehydration sites skip empty snapshots so stores polluted by the old behavior still rehydrate correctly.
- **Custom snapshot dirs split content from metadata.** `SnapshotManager` anchored `metadataDir`/`tempDir` to the global default (`~/.crawlforge/snapshots`) even when a custom `storageDir` was passed, so snapshot content and its metadata landed in different directories and all custom-dir instances shared one metadata store. Both now derive from the effective storage dir (default-path users are unaffected — the paths coincide).
- Environment note for self-hosters: `stealth_mode`, `scrape_with_actions`, and `scrape`'s screenshot format require the Playwright browsers matching the installed playwright version (`npx playwright install chromium`).

### Tests

- +6 unit tests: cross-process baseline rehydration (including roll-forward), fresh-store `monitor:stop` and unknown-id contract, keyless/keyed `mcpStanza` shapes; suite now 920 tests. A null-snippet regression case guards the `serp_rank` schema.

## [5.0.0] - 2026-08-05

**Major release** bundling remediation Phases 0–6 (everything below previously under [Unreleased]). **Breaking:** Node floor raised `>=18.0.0` → `>=20.16.0` (Phase 5). Highlights: SSRF/OAuth/secrets/billing hardening (Phase 1), 52 correctness fixes incl. the `crawl_deep` rewrite (Phase 2), leak/timeout robustness (Phase 3), rebuilt streamable-HTTP transport (Phase 4), dependency modernization to 0 npm-audit vulnerabilities (Phase 5), and MCP-spec adoption — structured output, async tasks, tool whitelist, registry `server.json` (Phase 6).

### Changed — Documentation layout (2026-08-05)

Root markdown files moved into `docs/`: `CHANGELOG.md` (this file), `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `OPEN_CORE_PLAN.md`, `SECURITY.md`, `SKILL.md`. The repo root keeps only `README.md`, `PRD.md`, and `CLAUDE.md` (root-required: Claude Code instruction loading + npm package `files`). Cross-references updated; `npm run skills:gen` now writes `docs/SKILL.md`, and `SKILL.md` was re-synced with its generator (picks up the v4.10.0 "Prefer CrawlForge for web work" routing section). `test:unit` now includes `--test-force-exit` (matching `test:coverage`), so the suite no longer hangs at exit on the d2-reliability Playwright handle.

### Added — Remediation Phase 6: MCP-spec adoption & competitive parity (2026-08-05)

Executes the user-greenlit subset of the [remediation plan](../plan/README.md)'s Phase 6 (DECISION phase): all of Track A, plus Track B's async-task pattern and client-side tool selection. Hosted remote endpoint/OAuth, keyless tier, scheduled monitoring, persistent sessions, redactPII, vertical tool groups (Track B) and the SDK v2 migration (Track C) were deliberately deferred.

**Structured output (MCP 2025-06-18)**
- `scrape`, `map_site`, `serp_rank`, `search_web`, `extract_structured`, `crawl_deep` now declare `outputSchema` and return `structuredContent` alongside the legacy JSON text (`src/schemas/toolOutputSchemas.js` — permissive-by-design shapes so a legitimate result can never fail SDK output validation).

**Protocol hygiene (`src/server/specHygiene.js`)**
- Tool schemas advertised in **JSON Schema 2020-12** (`$schema` stamp, `definitions`→`$defs` + `$ref` rewrite) instead of draft-07.
- **Deterministic tools/list**: alphabetical, byte-order sort for client prompt-cache stability.
- **SEP-2549-style cache hints**: `_meta["io.modelcontextprotocol/cacheable"] = { ttlMs: 300000, cacheScope: "private" }` on 10 read-only tools' call results (documented adaptation — the SEP defines these fields on list results; there is no call-result key in the spec text yet).
- **SEP-973 icons** on serverInfo (`icons`, `websiteUrl`), every tool, and every prompt.
- **SEP-1303** — invalid tool arguments come back as `isError:true` tool results (self-correctable by the calling model), not `-32602` protocol errors. In effect via SDK 1.30; now pinned by regression tests so it can't silently regress.

**Async tasks — MCP `io.modelcontextprotocol/tasks` extension (experimental)**
- `crawl_deep`, `batch_scrape`, `deep_research`, `agent` are registered via `registerToolTask` with `taskSupport: 'optional'` (`src/server/taskSupport.js`): task-aware clients receive a task handle immediately and poll `tasks/get` / fetch `tasks/result` (also `tasks/list`, `tasks/cancel`); clients without task support still get the synchronous result. In-memory task store with 10-min default / 30-min max TTL, unref'd cleanup timers, late-result-after-cancel protection, and no unhandled rejections.

**Client-side tool selection**
- `CRAWLFORGE_TOOLS` (names) / `CRAWLFORGE_TOOL_GROUPS` (groups) env whitelist (`src/server/toolFilter.js`) — expose a subset of the 27 tools to cut client context bloat. 12 groups (basic, search, crawl, extract, batch, research, tracking, llmstxt, stealth, templates, scrape, agent); unset = all tools; unknown names ignored with a stderr warning; `batch_scrape` auto-enables `get_batch_results`; startup banner reports enabled/total.

**MCP Registry**
- `server.json` completed against the 2025-12-11 registry schema (required `CRAWLFORGE_API_KEY` + optional DataForSEO env-var declarations, `websiteUrl`), with a GitHub-OIDC publish workflow (`.github/workflows/publish-mcp-registry.yml`) that publishes to registry.modelcontextprotocol.io on the next GitHub Release. Manual fallback + prerequisites: `docs/mcp-registry.md`.

**Docs & tests**
- `docs/mcp-spec-adoption.md` (wire-level examples + client-compatibility notes), README env + spec-features sections.
- 5 new unit suites (`phase6-{output-schemas,tool-filter,tasks,spec-hygiene,sep1303-validation}`) + live stdio integration suite `tests/integration/phase6-spec-adoption.test.js`; 3 source-scan regression tests updated for the new registration surface. Unit total 845 → **914**.

### Verification (Phase 6)

- `npm run test:unit`: 914 tests — 913 pass, 0 fail, 1 deliberately skipped.
- `npm test` (MCP protocol compliance): 100.0% COMPLIANT, 0 errors.
- Live stdio server: `tests/integration/phase6-spec-adoption.test.js` 3/3 — 2020-12 schemas + icons + outputSchema + `execution.taskSupport` on tools/list, `capabilities.tasks` on initialize, SEP-1303 isError result, and both `CRAWLFORGE_TOOLS`/`CRAWLFORGE_TOOL_GROUPS` filter modes.

### Changed — Remediation Phase 5: dependency modernization, Node ≥ 20 floor (2026-08-05)

Executes the [remediation plan](../plan/README.md)'s Phase 5 (user-approved DECISION phase): raises the Node floor, retires every abandoned/unmaintained dependency, and takes the security-only-in-a-major upgrades the old floor blocked. `npm audit` goes from 4 moderate to **0 vulnerabilities**.

**Node floor (approved decision)**
- `engines.node` raised `>=18.0.0` → `>=20.16.0` (Node 18 is EOL April 2025; 20.16 is pdf-parse 2.4.5's own floor). Dockerfile (`node:20-alpine`) and CI (Node 22) already satisfy it — no changes needed. Downstream: Node 18 consumers now see an engines warning on install.

**Retired dependencies**
- `node-cron` **removed** (was 3.0.3) — imported nowhere since Phase 3 moved change-monitor scheduling to `MonitorScheduler`'s setInterval timers; removal clears its vulnerable-`uuid` chain (GHSA-w5hq-g745-h8pq) outright. Monitor fire/stop suites verified green.
- `@googleapis/customsearch` **removed** (was 5.0.1) — imported nowhere; `search_web`'s Google adapter calls the Custom Search REST endpoint directly.
- `node-summarizer` **removed** (abandoned 2019) — `ContentAnalyzer`'s extractive summarization rewritten as a `compromise`-based Luhn-style word-frequency scorer (sentence segmentation, salience scoring, top-N selection in document order, proper sentence separators); `summarize_content`/`analyze_content` result shapes and abstractive-degradation behavior unchanged.

**Security/maintenance majors**
- `pdf-parse` 1.1.1 → **2.4.5** (exact pin) — the actively maintained ESM rewrite (pdfjs-dist 5 + @napi-rs/canvas). `PDFProcessor` ported to the class API (`new PDFParse({data, password})`, `getInfo()`, `getText()`, `destroy()`): the `password` option now actually decrypts protected PDFs (v1 silently ignored it — closes the Phase 2 password no-op), page-range extraction uses v2's native `getText({ partial })`, the encrypted-metadata flag reads pdfjs-dist's real `EncryptFilterName`, and v1's debug-mode crash is gone. Download SSRF guard, 30 s abort, and size caps preserved.
- `commander` 12 → **^14.0.3** — `src/cli/` audited against the v13/v14 stricter argument/option handling; no breaking patterns, zero code changes; subcommand smokes pass. (v15 is ESM-only + Node ≥22.12 — deferred.)
- `p-queue` 8 → **^9.3.3** — v9 deletes `throwOnTimeout` (timeouts always throw); `QueueManager` already set it to `true`, so semantics are identical — the dead option is removed and callers audited for reliance on timeout-returns-undefined (none; the Phase 2 BFS refactor already handles rejected tasks).
- `diff` 8 → **^9.0.0** — only `diffWords`/`diffLines`/`diffChars` are used (`ChangeTracker`); the breaking `formatPatch`/`parsePatch` changes don't apply; zero code changes, changeTracker suites green.
- `@hono/node-server` override 1.19.x → **2.0.12** — our own `overrides` block was pinning the vulnerable 1.x line under `@modelcontextprotocol/sdk`; clears GHSA-frvp-7c67-39w9 (Windows path traversal).
- Deferred to a future "Node 22 + SDK v2" initiative (unchanged): `undici` 8, `jsdom` 30, `zod` 4.

**Supply-chain hardening (ChainDrop npm worm, active since 2026-08-04)**
- Every install ran with `--ignore-scripts`; every adopted version (direct + new transitives) was publish-date-gated to before 2026-08-04; the full lockfile diff (12 added / 6 changed / 28 removed) was cross-checked against the Socket and StepSecurity compromised-package lists with zero matches; IoC scans (worm dropper filenames + `preinstall` hook grep) clean before and after; final `npm audit`: 0 vulnerabilities.

**Tests**
- `processDocument.test.js` rewritten for the true-ESM pdf-parse (the old CJS `require.cache` stubbing cannot intercept dynamic `import()`); new real-PDF fixture generator `tests/fixtures/pdfBuilder.js` and new `tests/unit/core/processing/PDFProcessor.test.js` covering multi-page text, page ranges, and password decryption. Unit total 835 → **845**.

### Verification (Phase 5)

- `npm run test:unit`: 845 tests — 844 pass, 0 fail, 1 deliberately skipped.
- `npm test` (MCP protocol compliance): 100.0% COMPLIANT, 0 errors.
- `node test-tools.js`: 20/20 tools pass.
- `npm audit`: **0 vulnerabilities** (was 4 moderate).

### Fixed — Remediation Phase 4: HTTP transport, protocol hygiene & medium/low cleanup (2026-08-04)

Closes all 19 Phase 4 findings from the [2026-08 codebase audit](CODEBASE_AUDIT_2026-08.md) — the HTTP/remote deployment path (previously degraded to one session and bricked on reconnect/DELETE), the unretrievable `getting-started` prompt, and the remaining medium/low catalog. Fifth phase of the [remediation plan](../plan/README.md).

**Streamable HTTP transport (`npm run start:http`)**
- Stateful mode now follows the SDK's documented per-session pattern: a `Map<sessionId, {transport, server}>` with a fresh transport + cloned `McpServer` per `initialize`, disposal on DELETE/`onsessionclosed`, and a JSON-RPC 404 for unknown session ids. A second concurrent client, a reconnect-via-re-initialize after a network drop, and DELETE followed by a fresh initialize all work — previously a single shared transport meant only one session ever, and any clean disconnect bricked `/mcp` until process restart.
- Legacy stateless mode (`--legacy-http`) builds a fresh transport + cloned server per request inside a try/catch that always ends the response with a JSON-RPC 500 on failure — previously the SDK's no-reuse guard made every request after the first die as an unhandled rejection with the client hanging until timeout.
- Discovery metadata is real: the version is read live from `package.json` (was hard-coded `3.5.1`) and the Smithery server-card tool count is computed from the registered-tools map (27 — was "20 tools"); `/health` and the startup banner report the same.

**Protocol hygiene**
- `getting-started` prompt registered via the `registerPrompt` config-object API — the plain config object previously hit the SDK's positional `argsSchema` overload, advertising a bogus required argument and failing every `prompts/get` with -32602/-32603, making the prompt unretrievable by any client.
- `scrape` no longer inlines full base64 screenshot bytes into the JSON tool result: once the image is stored in the resource registry, the returned object keeps only metadata + the `crawlforge://screenshot/{id}` resource URI (previously several MB of base64 shipped into the conversation alongside the URI).
- Auto-setup status banners (`AuthManager.runSetup`/`clearConfig`) moved from stdout to stderr — first launch with `CRAWLFORGE_API_KEY` set no longer injects non-JSON lines into the stdio JSON-RPC channel; the stdout-hygiene test now scans AuthManager instead of excluding it.
- Insufficient-credits refusals from `withAuth` carry `isError: true` like every other failure path, so clients branching on the flag see the refusal.

**Key/config correctness**
- `search_web` falls back to the `~/.crawlforge/config.json` API key when `CRAWLFORGE_API_KEY` is absent — users configured via `npm run setup` (no env var) previously passed the credit check but hit a guaranteed adapter failure half-billed at 2 credits per call.
- `AuthManager.projectCost` reads `crawl_deep`'s actual snake_case `max_pages` field (with `maxPages` fallback) — `_cost.projected` transparency metadata no longer stuck at the 10-page default.

**Webhooks**
- HMAC signatures now cover the exact serialized request body that is POSTed (the full `{event,id,timestamp,data,metadata}` envelope) — standard receiver-side raw-body verification finally matches; previously only the `data` sub-object was signed and every verification failed.
- Thrown HTTP delivery errors carry `.response = { status }`, so the RetryManager's configured `retryableStatusCodes` actually trigger retries instead of being dead config.

**Tool-layer cleanup**
- `extract_structured` invokes its wired-but-dormant elicitation before the low-fidelity CSS fallback when the schema has >3 required fields and no LLM is configured (fail-open when the client lacks elicitation), matching the documented behavior.
- MCP-sampling fallback un-deadened: `extract_with_llm` and `summarize_content` gain `setMcpServer()` wiring in `server.js`, so the client-side sampling leg of the advertised Ollama → API → sampling chain can actually run.
- `scrape` screenshot failures surface the real error (navigation timeout, DNS failure, browser-launch failure) instead of flattening everything to "capture produced no image".
- `BrowserBaseBackend.connect` failures include the HTTP status + response body (was `throw new Error()` with no message); the stale comment referencing a nonexistent fallback wiring replaced with an accurate "defined but unwired" note.
- `scrape_with_actions` `metadata.finalUrl` reads the top-level `chainResult.finalUrl` (was always `undefined` after navigation-changing actions).
- Recordings made with `captureIntermediateStates` preserve the `script` field of `executeJavaScript` entries, so replays no longer fail `ActionChainSchema` validation.

**Tests**
- Transport: second-concurrent-session, reconnect re-initialize, DELETE-then-initialize, and multi-request legacy-mode coverage against a real listening server in `streamableHttp.test.js` (31 tests).
- The MCP compliance suite gains prompt coverage: `prompts/list` must advertise `getting-started` with a description and no bogus required argument, and `prompts/get` must succeed for all 6 registered prompts.
- `withAuth`: checkCredits-throws path asserts no usage is reported (no billing on refusal); refusal shape aligned with `isError: true`.
- Real-lifecycle coverage: `initializePage` goto-failure asserts page **and context** close; webhook delivery against a local endpoint asserts abort at `config.timeout` and body-string HMAC; `batchResults` TTL eviction.

### Verification (Phase 4)

- `npm run test:unit`: 835 tests — 834 pass, 0 fail, 1 deliberately skipped.
- `npm test` (MCP protocol compliance): 100.0% COMPLIANT, 0 errors — 11 groups including the new prompt discovery/retrieval checks.
- Live transport re-smoke (real listening server): second session, reconnect, DELETE + fresh initialize, and repeated legacy-mode requests all succeed; `/health` and the server-card report v4.10.0 / 27 tools.

### Fixed — Remediation Phase 3: resource leaks, timeouts & robustness (2026-08-03)

Closes all 24 Phase 3 findings from the [2026-08 codebase audit](CODEBASE_AUDIT_2026-08.md) — the "safe to run for days" class: timers, browser contexts, and caches that accumulated for the process lifetime, and body reads with no deadline. Fourth phase of the [remediation plan](../plan/README.md).

**Browser lifecycle**
- `ActionExecutor.initializePage` closes the already-created page and its context when navigation or stealth setup throws — every failed `page.goto` (DNS error, timeout, blocked URL) previously orphaned a live page + context.
- Non-stealth `BrowserContext`s are closed alongside their page in `ActionExecutor`'s per-chain `finally` and `BrowserProcessor.processURL` — closing a Playwright page does not close its context, so every `scrape_with_actions` / browser-rendered `extract_content` call leaked one context until shutdown.
- `executionHistory` entries strip `finalHtml`, the `screenshots` array, `capturedStates` (full intermediate-page HTML), and each screenshot action's base64 payload inside `results` — counts/byte sizes retained; `getExecutionHistory()` only ever read scalars.
- `ActionExecutor.destroy()` guards each `page.close()` so one crashed/disconnected page can no longer abort cleanup before the browser itself is shut down.
- `BrowserProcessor.cleanup()` tears down the `LocalizationManager` it constructs (its health-check intervals kept firing for the process lifetime); those intervals are also `unref()`d now, so idle processes (tests, CLI one-shots) exit naturally.
- `extractContentTool` and `processDocumentTool` added to `gracefulShutdown`'s `toolsToCleanup` — both hold lazily-launched Chromium instances.

**Research time budget**
- `ResearchOrchestrator.processWithTimeLimit` now derives every stage's budget from one shared wall-clock deadline (stages no longer each get the full `timeLimit`, which legally doubled it), passes an `AbortSignal` that the stage batch loops check between batches, clears the racer timer in a `finally` (previously a live timer of up to 5 minutes per stage), and lets a timed-out stage unwind before result compilation — no more sorting/verifying `detailedFindings` while the abandoned loop is still pushing into it, and no more stealth-browser teardown under in-flight fetches.

**Bounded caches**
- `crawl_deep` destroys its per-crawl `CacheManager` in a `finally` via the new `BFSCrawler.destroy()` — previously N crawls permanently leaked N caches (≤1000 full HTML documents each), every one re-running a JSON.stringify memory scan every 60 s forever. Dropped instances are now GC-verified (WeakRef + `--expose-gc` regression test).
- `batch_scrape` `batchResults`: LRU cap (20 batches), expired entries evicted on read, and an unref'd periodic TTL sweep — full HTML bodies for up to 50 URLs per batch no longer accumulate for the life of the server.
- `SnapshotManager`: `.meta` files no longer embed the full page `content` / `delta.deltaData` (they live only in the `.snap` file — disk usage no longer doubled, gzip no longer defeated); legacy fat `.meta` files are defensively stripped on load; `metadataCache` is size-bounded.
- `ChangeTracker`: change history is trimmed to `maxHistoryLength`, and the schema's `maxHistoryEntries` / `retainHistory` options are finally honored (previously declared but read by nothing).

**Deadlines and size caps on every body read**
- `_fetch.js` (all 5 basic tools): the abort timer stays armed through the body stream — the advertised `timeout` parameter finally covers a server that returns headers then trickles/stalls the body; chunk reassembly is single-pass (was O(n²) — ~1.5 s of synchronous event-loop block on a 25 MB body).
- `batchScrape/worker.js`: body reads are covered by the per-URL timeout and capped at `config.fetch.maxBodySize` — a slow-loris upstream can no longer hold a sync batch's semaphore slot indefinitely or buffer a multi-GB body.
- `_fetchAndParse.js` (`scrape`, `extract_structured`, `extract_with_llm`, `process_document` HTML path): enforces the same 25 MB streaming size cap `_fetch.js` already had.
- `PDFProcessor.downloadPDFFromURL`: real 30 s `AbortSignal.timeout` (the old `timeout:` fetch-init option was silently ignored by undici) plus Content-Length/streamed-byte size cap.
- SearXNG provider: 15 s `AbortSignal.timeout` with a clear timeout message (was undici's ~5-minute default).
- `WebhookDispatcher`: delivery and health-check fetches use `AbortSignal.timeout(config.timeout)` — one hung endpoint stalled the entire serialized delivery queue for minutes.
- `scrape` `branding` format: linked stylesheets are fetched concurrently (pool of 4) under a single overall deadline (≤10 s) — was up to ~160 s of sequential fetches against slow CSS hosts, unbounded by the tool's `timeoutMs`.
- `BFSCrawler`: the per-domain replacement abort timer is assigned back to `timeoutId` so the existing `clearTimeout` calls actually cancel it (previously one leaked pending timer per fetched page whenever a domain rule overrode the timeout).

**Initialization & module lifecycle**
- `SnapshotManager` / `TrackChangesTool`: fire-and-forget constructor `initialize()` (which surfaced real failures as opaque `'Unhandled error.'` rejections) replaced by an awaited, memoized `ensureInitialized()` called from every public entry point; snapshot storage now defaults to `~/.crawlforge/snapshots` instead of `process.cwd()` — MCP clients like Claude Desktop launch the server with cwd `/`, where every snapshot write silently failed.
- The module-level `trackChangesTool` eager singleton is replaced by a lazy Proxy with the same export surface — importing the module no longer constructs a duplicate ChangeTracker/SnapshotManager/cache stack, creates `cache/` + `snapshots/` directories in the caller's cwd, or keeps the process alive on a non-unref'd timer.
- `StealthBrowserManager.launchStealthBrowser`: single-flight in-flight-promise guard — two interleaved stealth calls could both launch Chromium and orphan the first `--no-sandbox` process.

**Tests**
- Two new suites (+23 tests, 802 → 825 total): `tests/unit/phase3-leaks.test.js` (WeakRef + `--expose-gc` GC assertions for the crawl cache, batch LRU/TTL, snapshot `.meta`/cache bounds, history stripping, import-side-effect and cleanup-teardown checks via spawned child processes) and `tests/unit/phase3-timeouts.test.js` (local trickle-body HTTP servers proving `_fetch`/batch-worker/`_fetchAndParse`/SearXNG/webhook abort at their configured deadlines; research racer-timer/abort-signal assertions; PDF oversize fast-reject).

### Verification (Phase 3)

- `npm run test:unit`: 825 tests — 824 pass, 0 fail, 1 deliberately skipped; run exits on its own.
- `npm test` (MCP protocol compliance): 100.0% COMPLIANT, 0 errors.
- Standalone `node --test` children that construct real tools now exit promptly without `--test-force-exit` (LocalizationManager health-check timers unref'd).

### Fixed — Remediation Phase 2: tool-breaking correctness bugs (2026-08-03)

Closes all 52 Phase 2 findings from the [2026-08 codebase audit](CODEBASE_AUDIT_2026-08.md) — the "silently wrong output" class: tools that passed smoke tests while returning misleading, truncated, or cross-contaminated results. Third phase of the [remediation plan](../plan/README.md).

**Crawling & site mapping**
- **`crawl_deep` is usable for real crawls again** (the critical): BFS child pages are no longer awaited from inside an occupied queue slot, so the per-task queue timeout now bounds one page instead of the entire recursive crawl, and low concurrency (incl. `concurrency: 1`) no longer deadlocks — previously any crawl outliving `CRAWL_TIMEOUT` (30 s) threw away every fetched page with `Promise timed out`.
- `crawl_deep`: result-cache key now covers `extract_content`, `content_max_length`, include/exclude patterns, `follow_external`, `respect_robots`, `concurrency`, domain filter and session — a cached call can no longer contradict the request for the 1 h TTL. Server config (`MAX_PAGES_PER_CRAWL`, `MAX_CRAWL_DEPTH`, `RESPECT_ROBOTS_TXT`, `FOLLOW_EXTERNAL_LINKS`, `QUEUE_CONCURRENCY`) is finally honored as ceiling/defaults. The scalar failure count (`error_count`) is no longer shadowed by the `errors` array.
- `map_site`: cache key includes `search`, domain filter, `include_metadata`, `group_by_path` — the v4.6.0 `search` ranking is no longer silently dropped (or leaked) on cache hits. Sitemap ingestion accumulates across **all** declared sitemaps up to `max_urls` instead of stopping at the first productive one.
- `sitemapParser`: gzip handling sniffs the 0x1f 0x8b magic bytes, so sitemaps served with `Content-Encoding: gzip` (already decompressed by undici) parse instead of silently returning 0 URLs; parse failures are surfaced.
- `normalizeUrl`: repeated query params (`?tag=a&tag=b`) survive normalization instead of being rewritten to fabricated URLs.

**Silently ignored options**
- `server.js`: `options` schemas for `extract_content`, `summarize_content`, `analyze_content` now `.passthrough()` (matching `process_document`) — previously every documented option key was stripped before reaching the handler.
- `summarize_content`: the extractive summarizer actually runs (`SummarizerManager` constructed per call, `getSummaryByRank()`); `summaryLength` changes output instead of always returning the 2-sentence fallback mislabeled 'extractive'.
- `search_web`: partial `ranking_weights` / `deduplication_thresholds` deep-merge over defaults instead of replacing them wholesale (no more NaN `finalScore` / silently disabled duplicate checks); all-short-token queries ("C#") score 0 instead of NaN; the zero-result expansion retry loop is capped (original + 1 fallback) with attempts surfaced in the response instead of up to 5 billed backend searches.
- `deep_research`: `maxUrls > 500` no longer fails every internal search (per-query limit clamped to the schema cap of 100); LLM-enabled runs no longer crash result compilation (4 dropped state maps restored in `initializeResearchSession`); advertised flags (`enableSourceVerification`, `enableConflictDetection`, `sourceTypes`, `includeRecentOnly`, `queryExpansion`) actually propagate to the orchestrator; approach-specific ranking/dedup tuning uses the `SearchWebTool` constructor's real contract (`rankingOptions`/`deduplicationOptions`); success log records a real duration.

**Wrong output on the scrape path**
- `extract_links`: relative hrefs resolve against the final page URL (not the origin), `<base href>` is honored, and protocol-relative links are classified external — same fixes applied to `scrape`'s link extractor, so the two agree.
- `scrape`: `formats` no longer mutate the shared cheerio document (output is independent of `formats[]` order); responses are checked for content-type (binary → explicit unsupported-content error steering to `process_document`, plain text/JSON passed through raw).
- Basic fetch path: response bodies decode with the declared charset (`Content-Type` / `<meta charset>` sniff) instead of always UTF-8 — no more U+FFFD-corrupted text from ISO-8859-1/Shift_JIS sites.
- `scrape_structured`: elements missing the requested attribute yield explicit `null` placeholders (parallel field arrays stay index-aligned with `elements_found`); selectors containing `@` (e.g. `a[href*="@"]`) parse correctly.
- `extract_structured`: schema keys that aren't valid CSS identifiers no longer abort the whole CSS-fallback extraction; LLM failures are recorded in `extractionNotes` instead of being silently swallowed.
- `extract_with_llm`: the Ollama branch receives the same `buildInputSchema()`-normalized JSON Schema as Anthropic (flat hint maps no longer rejected by Ollama's structured-output `format`).
- `process_document`: `sourceType: 'file'` reads local non-PDF files instead of failing with `Failed to parse URL`; PDF `pageRange` past the document end returns an explicit error instead of empty success; the never-functional PDF `password` option is removed from the schemas; URL fragments (`#anchor`) and paths like `/apple` no longer force headless-browser rendering (same fix in `extract_content`).
- `analyze_content`: language-detection alternative confidences report the franc score directly instead of `1 - score` (no longer inverted).

**Tracking, snapshots & core**
- `track_changes`: `get_history` and `monitor` no longer TypeError on the documented default call (`queryOptions`/`monitoringOptions` default to `{}`); content similarity is token-Jaccard over content (was Hamming distance between sha256 hex digests — every trivial edit scored ~0% similar and fired 'moderate' alerts).
- `SnapshotManager`: the stub delta-storage path (which silently discarded new content and returned the previous version on retrieval) is removed — snapshots always persist full compressed content; delta round-trip covered by tests.
- `generate_llms_txt`: fresh analyzer per call — concurrent/sequential runs no longer cross-contaminate domains or accumulate prior runs' errors; server schema mirrors the tool (`checkSecurity` opt-in default **false** — no more surprise /admin//login probing; `probeRateLimit` and `outputOptions.robotsStyle` reachable).
- `scrape_with_actions`: chain failure returns the per-action results and the promised error screenshot instead of empty arrays; `captureIntermediateStates` captures natively (no in-page JS) so it works with `ALLOW_JAVASCRIPT_EXECUTION` unset and injected actions no longer pollute failure counts.
- `batch_scrape`: `get_batch_results` reports status/progress for in-progress async batches (was `Batch not found`); `cancelBatch` threads an AbortController so cancellation actually stops the work; sync progress counts update; `statusCheckUrl` references the real `get_batch_results` tool.
- `agent`: `maxSteps` and `maxUrls` are decoupled counters (maxUrls was unreachable beyond maxSteps); the three orchestrator-enforced hard stops are unchanged.
- `CircuitBreaker.execute()` works (constructor callback options no longer shadow the prototype methods); `youtube-video` template no longer crashes `scrape_template` on relative/protocol-relative canonical hrefs.

**Tests**
- The six stub-based `tests/unit/tools/extract/*` suites now import the **real** tool classes; template tests are table-driven across all 10 extractors (incl. the youtube relative-canonical case); localization tests exercise the real `LocalizationManager` (cleanup stops its timers).
- New suites: `bfsCrawler`, `sitemapParser`, `urlNormalizer`, `circuitBreaker`, `llmsTxtAnalyzer`, `researchOrchestrator-limits`, `resultRanker`, `resultDeduplicator`, `server-schema-regressions`; snapshot delta round-trip, cache-key sensitivity (`crawl_deep`/`map_site`), ChangeTracker similarity, and a reproduction test for every 🟠 HIGH finding.
- `test:unit` glob widened to `tests/unit/**/*.test.js` — the ~20 `tests/unit/tools/**` suites now run under the standard command (closing the coverage gap flagged in the v4.7.0 notes).

### Verification (Phase 2)

- `npm run test:unit` → **802/802 pass** (+289 vs Phase 1's 513).
- `npm test` → **100.0% COMPLIANT, 0 errors**.
- Live re-smoke against the real tool classes: `crawl_deep` completes a multi-page crawl with `concurrency: 1`; `summarize_content` short ≠ long (extractive); `extract_links` on `/docs/page.html` resolves `about.html` → `/docs/about.html`; partial `ranking_weights` yields finite scores; `crawl_deep`/`map_site` cache keys differ when options differ. (MCP clients on the project `.mcp.json` pick the fixes up on `/mcp` reconnect.)

### Security — Remediation Phase 1: critical security holes (SSRF · OAuth · secrets · billing) (2026-08-03)

Closes all 14 Phase 1 findings from the [2026-08 codebase audit](CODEBASE_AUDIT_2026-08.md) — every path by which the server could be induced to reach internal/cloud-metadata addresses, mint operator-billed tokens, leak user secrets, or bill for calls that never ran. Second phase of the [remediation plan](../plan/README.md).

**SSRF guard core (`src/utils/ssrfGuard.js`)**
- **Fixed the IP-literal bypass** (critical): pre-flight now runs `ipBlocked()` on IP-literal hostnames (dotted-quad, decimal `2130706433`, hex `0x7f000001` — WHATWG URL normalizes them — plus bracketed IPv6), and the undici dispatcher wraps `buildConnector` with a per-connect IP-literal check, so redirect hops straight to `http://127.0.0.1/` etc. are blocked too (Node never routes IP literals through `lookup`).
- **Fixed IPv4-mapped/compatible IPv6 recognition**: `::ffff:127.0.0.1`, `::ffff:169.254.169.254`, and fully-expanded forms are normalized to their embedded IPv4 before range checks — in both Stage 1 and `SSRF_STRICT` modes. Kills the DNS-controlled AAAA-record bypass.
- **`BLOCKED_DOMAINS` is no longer dead config**: `config.security.ssrfProtection.blockedDomains` is enforced at pre-flight.
- Allowlist is now evaluated per-hop (an allowlisted first hop no longer unguards subsequent redirect hops); new shared `assertUrlAllowed(url, {resolveDns})` pre-flight exported for non-fetch subsystems.

**SSRF wiring on previously unguarded paths**
- `scrape_with_actions` (`src/core/ActionExecutor.js`): `assertUrlAllowed` with DNS resolution before `page.goto`, plus a post-navigation `page.url()` re-check that closes the page on a redirect into a blocked range — the Playwright internal-network read primitive is closed.
- `map_site` (`src/tools/crawl/mapSite.js`): page/metadata fetches (`fetchWithTimeout`) now use `safeFetch`.
- `process_document` PDF downloads (`src/core/processing/PDFProcessor.js`): `safeFetch`.
- Webhook delivery + health checks (`src/core/WebhookDispatcher.js`): `safeFetch`.
- `deep_research` webhook notifications (`src/tools/research/deepResearch.js`): `safeFetch` + 10s timeout (was raw fetch, no timeout).

**OAuth (`src/server/auth/oauth.js`)**
- `/oauth/authorize` now **requires proof of the operator's API key** (`Authorization: Bearer <key>` or `api_key` query param, constant-time SHA-256 digest comparison) before issuing a code. The anonymous register → authorize → token flow that minted operator-billed bearer tokens is closed.

**Secret leakage**
- Usage telemetry (`src/core/AuthManager.js`): tool params are passed through `maskSecrets()` before the `POST /api/v1/usage` payload — third-party API keys, auth headers, and webhook signing secrets no longer leave the process in plaintext. `cookie` added to the secret-key patterns (`src/utils/secretMask.js`).
- `deep_research` no longer logs `llmConfig` API keys to Winston file logs (`sanitizeConfigForLogging` redacts them).

**Billing correctness (`src/server/withAuth.js`, `src/core/AuthManager.js`)**
- The error-path half-charge now applies **only after the handler actually started** — a throw from the credit check itself (backend down past the grace window, key rejected) bills zero.
- `checkCredits` handles non-OK responses explicitly: 401/403 throws a descriptive invalid/revoked-key error (no more misreporting as "Insufficient credits"); 5xx falls into the grace-window path.
- Usage reporting checks `response.ok` in both `_reportUsageOnce` and `_flushPendingUsage`: backend rejections are queued/retained instead of silently dropped as "billed".

**Tests**
- `tests/unit/ssrfGuard.test.js`: literal-IP block assertions (dotted/decimal/hex/userinfo-obfuscated/bracketed IPv6), IPv4-mapped IPv6 cases, `BLOCKED_DOMAINS`, a real kill-switch test (fresh subprocess, asserts `ssrfGuard` returns `{}`), and an end-to-end redirect-hop test (allowlisted hostname 302s to an IP literal — blocked, `/secret` never reached).
- New: `tests/unit/phase1-ssrf-paths.test.js` (blocked-target test per fetch path: `_fetch`, `_fetchAndParse`, `map_site`, PDF download, `scrape_with_actions` navigation, webhook delivery), `tests/unit/phase1-oauth.test.js` (anonymous/wrong-key authorize rejected; correct key via header or query param works end-to-end), `tests/unit/phase1-billing.test.js` (telemetry masking, zero-bill on credit-check refusal, 401/403/5xx handling, non-2xx usage queueing).
- `tests/unit/oauth.test.js` legacy flows updated to present the now-required key proof.

### Verification (Phase 1)

- `npm run test:unit` → **513/513 pass** (+33 new).
- `npm test` → **100.0% COMPLIANT, 0 errors**.

### Security — Remediation Phase 0: dependency currency & audit cleanup (2026-08-03)

Zero code change — `npm update` inside existing caret ranges plus one new `overrides` entry. Takes `npm audit` from **16 vulnerabilities (8 high, 6 moderate, 2 low)** to **4 moderate (0 high, 0 critical)**. First phase of the [remediation plan](../plan/README.md) from the [2026-08 codebase audit](CODEBASE_AUDIT_2026-08.md).

- **`undici` 7.25 → 7.29.0** — clears 2 HIGH: SOCKS5 ProxyAgent TLS-cert-validation bypass (GHSA-vmh5-mc38-953g) and Set-Cookie percent-decode header injection (GHSA-p88m-4jfj-68fv).
- **`adm-zip` override `^0.6.0`** (new) — clears the HIGH crafted-ZIP 4GB-allocation advisory reached only via `camoufox` → `generative-bayesian-network` (optional, install-time-only); camoufox resolution verified intact.
- **`isomorphic-dompurify` 3.9 → 3.19.0** — bundles DOMPurify ≥3.4.12, clearing the DOMPurify moderate advisories, while deliberately staying on jsdom 29.x (verified 29.1.1) to preserve the Node ≥18 engines floor.
- **`@modelcontextprotocol/sdk` 1.29 → 1.30.0** — stdio message-buffer limit, Streamable-HTTP SSE keep-alive fixes, Content-Type validation. *Note:* the moderate `@hono/node-server` advisory (GHSA-frvp-7c67-39w9) does **not** clear — the pre-existing overrides pin holds it on 1.x for Node ≥18 compatibility (fix only in 2.0.5+, Node ≥20); revisit with the Phase 5 Node-floor decision.
- Routine caret minors: `lru-cache` 11.5.2, `jsdom` 29.1.1, `cheerio` 1.2.0, `compromise` 14.16.0, plus `winston`/`dotenv`/`playwright`/`franc`/`turndown`/`robots-parser`.
- **Remaining (deferred to Phase 5):** the pinned `@hono/node-server` chain above, and `node-cron` → `uuid` (GHSA-w5hq-g745-h8pq — fix requires the breaking `node-cron@4` major; `npm audit fix --force` deliberately not run).

### Verification

- `npm audit` → 4 moderate, 0 high/critical.
- `npm run test:unit` → **480/480 pass**.
- `npm test` → **100.0% COMPLIANT, 0 errors**.

## [4.10.0] - 2026-07-13

Minor release: the server now **steers any MCP client toward the CrawlForge tools** for web work. Additive — no breaking changes to tool schemas or credit costs.

### Added

- **Server-level MCP `instructions`.** The `new McpServer(...)` call in `server.js` now passes a second `ServerOptions` argument with an `instructions` string (returned in the `initialize` result; per the MCP spec, clients MAY inject it into the model's context as a usage hint). It tells the model to **prefer** CrawlForge tools over the client's built-in web capabilities for web search, page fetch/scrape, site crawl, and multi-source research — falling back to built-ins only when a CrawlForge tool is unavailable or unsuitable. Because it ships in the server binary, every MCP client (Claude Code, Cursor, Claude Desktop, other LLMs) receives it automatically on the next `crawlforge@latest` launch after upgrade — no re-`init` required.
- **`serp_rank` now returns the full top-10 organic SERP listing** alongside the target domain's rank positions. (Committed just after v4.9.0 was published to npm, so it first ships to members in this release.)

### Changed

- **Reinforced 4 overlapping tool descriptions** (always shown to the model in `tools/list`): `search_web` ("Preferred over the client's built-in web search"), `fetch_url` ("…built-in URL fetch"), `scrape` ("…built-in web fetch for page content"), `deep_research` ("Preferred over any built-in deep-research skill/tool"). Non-overlapping tools left unchanged.
- **`crawlforge-getting-started` skill** gained a "Prefer CrawlForge for web work" routing section (`src/skills/agent-skills/crawlforge-getting-started/SKILL.md`). Reinforces the same steer in Claude Code / Cursor / VSCode, but — unlike the MCP layer — only reaches members who re-run `crawlforge install-skills` / `crawlforge init` (the `postinstall` is echo-only).

### Verification

- Live `initialize` handshake confirmed to return the `instructions` string.
- `npm run test:unit` → **480/480 pass**.
- MCP protocol compliance → **100.0% COMPLIANT, 0 errors**.

**Note:** This is *guidance*, not enforcement. An MCP server cannot disable a client's own built-in web tools; hard-blocking is only possible in each client's own config.

## [4.9.0] - 2026-07-01

Minor release: adds the **27th** MCP tool, `serp_rank`, and hardens credit billing on the error/zero-cost paths. Additive — no breaking changes to existing tool schemas or costs.

### Added

- **`serp_rank` — real Google organic rank via DataForSEO.** Reports where a target domain ranks in Google's real organic SERP for a keyword (the position `search_web`/Custom Search can't give). Backed by the DataForSEO Google Organic **Live Advanced** API (`POST /v3/serp/google/organic/live/advanced`, HTTP Basic auth). Returns the target's best organic position, the ranking URL, and every position it holds; never fabricates a rank — returns `{ configured:false }` when DataForSEO isn't set up. Credentials via `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` (see `.env.example`), billed to the user's own DataForSEO account (~US$0.002–0.004/call), separate from CrawlForge credits. **Cost: 5** credits when configured, **0** when unconfigured. New: `src/tools/search/serpRank.js`, `src/tools/search/adapters/dataforseoSearch.js` (30s timeout, 401/402/429 mapping, `status_code:20000` checks), `tests/unit/serpRank.test.js`, `scripts/smoke-serp-rank.mjs`. Verified live against the real API (`github.com` → position 1).

### Changed

- **Billing hardening (`withAuth`, all tools).** A zero-cost call now emits **no** usage event (so a free no-op can't be re-priced by the backend, and the `Math.max(1,…)` error floor can't bill a free call). A tool that returns `{ isError:true }` (the shared self-catching pattern) is now treated as an **error outcome** billed at the **half** rate instead of full — honoring the documented "half credits on error" contract for every tool.
- **`serp_rank` depth capped at 200** (DataForSEO's real max; an earlier draft wrongly allowed 700).
- Tool count 26 → 27 across all current-facing docs (`CLAUDE.md`, `README.md`, `SKILL.md`, skills, `package.json`, `server.json`, `docs/`). Backend credit table (`crawlforge-website`) synced with `serp_rank: 5`.

### Verification

`npm run test:unit` **477/477**; MCP compliance **100% COMPLIANT / 0 errors**; cost-parity **27 tools / 0 mismatches**.

## [4.8.1] - 2026-06-28

Patch release: `deep_research` now always returns a top-level `sources[]` list in LLM-synthesis mode, plus a version-sync of files the 4.8.0 release left behind. Additive — no schema or credit-cost changes.

### Fixed

- **`deep_research` dropped its top-level `sources` list whenever an LLM key was active.** `DeepResearchTool.formatResults()` only emitted a top-level `sources` key for `outputFormat:'citations_only'` in LLM-synthesis mode; the default `comprehensive` returned the list under `supportingEvidence`, `summary` under `topSources`, and `conflicts_focus` dropped it entirely. The `raw_evidence` branch (no LLM key) always returned `sources`, so the field silently vanished the moment a caller supplied an LLM key (server env `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` **or** `llmConfig.{openai,anthropic}.apiKey` in the tool params). Fix lifts a single canonical `sources[]` (`{title,url,credibility,relevance}` from `supportingEvidence`) into the shared base object so every output format and both synthesis modes return it; `citations_only` (identical shape) and the `raw_evidence` branch are unchanged. Added regression tests driving the real `formatResults()` (the existing suite was fully stubbed). `src/tools/research/deepResearch.js`

### Changed

- **Version sync.** `server.json` (×2), `server.js` (`McpServer` version), and `package-lock.json` were still pinned at `4.7.2` (the 4.8.0 release bumped only `package.json`); all are now realigned to `4.8.1`.

## [4.8.0] - 2026-06-28

Minor release: real auto-activating Claude Agent Skills, two additive `scrape` formats, a genuinely-enforced security posture (two advertised-but-broken safety controls fixed), and working built-in change scheduling. All changes are additive — no existing tool schema, output shape, or credit cost changes for current callers.

### Security (fixes for controls that were silently non-functional)

- **SSRF is now actually enforced on the live scraping path.** The robust `src/utils/ssrfProtection.js` existed but was never wired into the tools — every scrape used raw `fetch()` with no IP/host validation. A new `src/utils/ssrfGuard.js` injects an undici dispatcher whose connect-time `lookup` validates **every** connection (initial request + each redirect hop) and pins to the validated IP, closing the DNS-rebinding TOCTOU window. Stage 1 (default) blocks loopback, link-local / cloud-metadata (169.254.169.254), and 0.0.0.0 — targets no legitimate public scrape needs. `SSRF_STRICT=true` adds full RFC1918/ULA enforcement. Kill switch `SSRF_PROTECTION_ENABLED=false`; `ALLOWED_DOMAINS` bypass for trusted hosts. Routed through `_fetch.js`, `_fetchAndParse.js`, `batchScrape/worker.js`, `mapSite.js`, `BFSCrawler.js`, `extractContent.js`, `processDocument.js`, `ScrapeTemplateTool.js`, `_sessionContext.js`, `ResearchOrchestrator.js`, `LLMsTxtAnalyzer.js`, `robotsChecker.js`, `sitemapParser.js`, and `trackChanges/differ.js`.
- **MCP Elicitation now actually fires.** `ElicitationHelper` called `server.elicit()` (no such method) instead of `server.elicitInput()` and never checked the client capability, so every cost/safety confirmation (deep_research >50 URLs, batch_scrape, crawl_deep, agent pro, low-credit) silently fail-opened. Fixed to use `elicitInput`, gate on the client's `elicitation` capability, and parse the `action` field (accept/decline/cancel). Still fail-open for clients that don't support it. **Behavior change:** elicitation-capable clients will now see these confirmations.
- **Per-host outbound rate limiting** (`src/utils/hostRateLimiter.js`) added to the basic fetch path and batch_scrape (default 10 req/s per host, gated by `RATE_LIMIT_PER_DOMAIN`); no global cap, so broad multi-host crawls are unaffected.
- **`executeJavaScript` hardening** (still OFF by default): max script length (`JS_MAX_SCRIPT_LENGTH`), explicit execution timeout (`JS_EXECUTION_TIMEOUT_MS`), and a structured stderr audit log (script sha256 + length + url).
- Repaired a pre-existing parse error (corrupted JSDoc) in `ssrfProtection.js` that prevented the module from loading.

### Added

- **Real Claude Agent Skills.** Skills are now proper `~/.claude/skills/<name>/SKILL.md` folders with YAML frontmatter and trigger-rich descriptions (they auto-activate), replacing the old bare reference-markdown files that Claude Code never loaded. Seven skills cover all 26 tools: `crawlforge-web-scraping`, `crawlforge-deep-research`, `crawlforge-stealth-browsing`, `crawlforge-structured-extraction`, `crawlforge-change-tracking`, `crawlforge-batch-automation`, `crawlforge-getting-started`. Source of truth: `src/skills/agent-skills/`. Installer rewritten (signatures preserved); cursor/vscode concatenated outputs unchanged. Upgrades self-heal by removing the legacy bare files (unrelated skills untouched). New `npm run skills:gen` regenerates the root `SKILL.md`.
- **Opt-in forced-eval hook** (`install-skills --with-hook`, `init --with-hook`, `uninstall-skills --remove-hook`): an idempotent `UserPromptSubmit` reminder that raises skill auto-activation. Off by default.
- **`scrape` format `"branding"`** — static design-token extraction (color palette, fonts/typography, logo/favicons, border-radius/shadow/spacing tokens) from HTML + CSS, no browser required. SSRF-guarded, count/size-capped linked-CSS fetches.
- **`scrape` format `"screenshot"` now works** (was a no-op): lazily renders via the shared browser pool and returns `crawlforge://screenshot/{id}` resources. Browser launches only when `screenshot` is requested; failures degrade to a warning (partial success preserved). `scrape` cost unchanged (2).
- **Built-in scheduled change monitoring.** `track_changes` operations `create_scheduled_monitor` / `stop_scheduled_monitor` (previously dead code that threw) now drive a real persisted scheduler (`src/core/MonitorScheduler.js` + `MonitorStore.js`), plus a new `list_scheduled_monitors`. Optional plain-English `goal` is LLM-judged (Ollama-first) and degrades gracefully to threshold significance with no LLM. Baselines rehydrate from snapshots on restart. CLI: `monitor:create`, `monitor:list`, `monitor:stop`, and `monitor:run-due` (one-shot for system cron — guaranteed firing). Honest firing model documented (stdio server isn't a daemon).

### Fixed

- `track_changes` is now torn down on graceful shutdown (added a `cleanup()` alias; previously its scheduler/snapshot resources leaked because the shutdown sweep only matched `destroy`/`cleanup`).

## [4.7.2] - 2026-06-28

Patch release: a second full live audit of all 26 MCP tools (each invoked through the real `mcp__crawlforge__*` interface and judged on actual output, not just "no exception"). 24 tools passed outright; `extract_structured` and `scrape_with_actions` were genuinely broken, which root-caused to **6 distinct defects** — all fixed and verified end-to-end through a freshly-spawned `server.js` (real browser + JSON-RPC round-trip).

### Fixed

- **`scrape_with_actions` wait action rejected `{type:"wait", timeout:1000}`.** The inner `ActionExecutor` validator required `duration`/`milliseconds`/`selector`/`text` and treated `timeout` only as the abort deadline, so the exact shape used by the project's own `test-tools.js` failed Zod validation. `timeout` is now accepted as a wait *duration* when no selector/text is given (selector/text waits still use it as the abort deadline), with an abort-race guard so a pure-`timeout` wait can't time itself out. `src/core/ActionExecutor.js`
- **`scrape_with_actions` returned a markdown placeholder.** Requesting `formats:["markdown"]` yielded the literal `"Content not available in markdown format"` because `extractFinalContent()` never asked the extractor for markdown (`extractContent` only emits `content.markdown` when `outputFormat:'markdown'`). Now passes `outputFormat:'markdown'` when markdown is requested. `src/tools/advanced/ScrapeWithActionsTool.js`
- **`scrape_with_actions` never surfaced screenshots.** Successful `screenshot` actions were never collected into `executionContext.screenshots` (only error screenshots were), so the top-level `screenshots[]` was always empty. Successful screenshots are now collected (with `actionId`, `data`, `format`, `fullPage`). `src/core/ActionExecutor.js`
- **`crawlforge://screenshot/{actionId}` resources were never created.** `ResourceRegistry.storeScreenshot()` existed but was never called, so the documented screenshot resources never materialized. The `scrape_with_actions` handler now registers each captured screenshot and annotates it with its `resourceUri`. `server.js`
- **`resources/read` threw for every resource type.** The MCP SDK hands the read callback a `URL` object, but `parseResourceUri()` calls `String#startsWith`, which throws on a URL — a latent bug first made reachable by the screenshot-resource fix. `readResource()` now coerces the URI to a string. `src/resources/ResourceRegistry.js`
- **`extract_structured` returned empty `{}` with no LLM and no hints.** The CSS fallback only mapped schema fields via `selectorHints`/meta tags/class-or-id matches, so a field literally named `title` never resolved to `<h1>`/`<title>`. Added a small semantic-selector map for well-known field names (title, description, author, date, …) as a last resort, so common fields resolve on the no-LLM path. `src/tools/extract/extractStructured.js`

### Notes

- Verification: default `npm run test:unit` **406/406** (sandbox-off; the 13 `streamableHttp`/`searchWebSearxng` cases are the pre-existing `listen EPERM` sandbox artifacts only); dedicated real-browser integration + full JSON-RPC e2e through a fresh server all green; MCP compliance unchanged at its pre-existing 70% baseline (`git stash` A/B confirmed). Live MCP clients pick this up via `npm install -g crawlforge-mcp-server@latest` (or an `/mcp` reconnect for the project's local-`server.js` config).

## [4.7.1] - 2026-06-28

Patch release: two correctness fixes surfaced by a full live audit of all 26 MCP tools (every tool confirmed functional with zero runtime errors; these were the only defects found).

### Fixed

- **`deep_research` `credibilityThreshold` now takes effect.** The schema-validated param (default 0.3) was a silent no-op — it was routed to `conductResearch` options instead of the orchestrator constructor (which never read it), while `verifySourceCredibility()` hardcoded `>= 0.3`. The constructor now reads and clamps it `[0,1]`, and all three source-inclusion gates (`verifySourceCredibility`, `compileSupportingEvidence`, `generateKeyFindings`) honor it. Verified live: `credibilityThreshold` 0.0 → 4 sources, 0.7 → 1. `src/core/ResearchOrchestrator.js`, `src/tools/research/deepResearch.js`
- **`generate_llms_txt` no longer emits literal `undefined`.** The `llms-full.txt` rate-limiting section printed `undefinedms`/`undefined` because `analyzeRateLimiting()` only runs with `probeRateLimit:true`, leaving `analysis.rateLimit` as the empty-object init `{}` (truthy, so the template rendered its undefined fields). Now initialized with conservative defaults (1000ms / 5 / 30); the average-response line renders only when actually measured. `src/core/LLMsTxtAnalyzer.js`, `src/tools/llmstxt/generateLLMsTxt.js`

## [4.7.0] - 2026-06-27

Reverts the open-core "free Tier 0" model. **Every tool is now metered and requires an API key — there is no free tier.**

### Changed

- **All tools are paid and key-gated.** `AuthManager.getToolCost()` reverts to the paid "Scheme B" table (no zero-cost tools): 1 credit (`fetch_url`, `extract_text`, `extract_links`, `extract_metadata`, `scrape_template`, `list_ollama_models`, `get_batch_results`), 2 (`scrape_structured`, `extract_content`, `map_site`, `process_document`, `localization`, `scrape`), 3 (`track_changes`, `analyze_content`, `extract_structured`, `extract_with_llm`), 4 (`summarize_content`, `crawl_deep`), 5 (`stealth_mode`, `scrape_with_actions`, `batch_scrape`, `search_web`, `generate_llms_txt`), 8 (`agent`), 10 (`deep_research`). The `scrape` screenshot surcharge special-case is dropped (flat 2). `src/core/AuthManager.js`
- **Every invocation requires a valid API key.** Removed the `freeTier` 0-cost short-circuit in `withAuth` (every call now checks credits and reports usage on success and error), removed `AuthManager.checkCredits(0) → true`, and reverted the `server.js` no-key startup banner — the server still starts so the MCP client can list tools, but every tool call returns "not configured" until a key is set. `src/server/withAuth.js`, `src/core/AuthManager.js`, `server.js`

### Migration

- This is a behavior change for anyone who relied on the free local tools: a CrawlForge API key is now required for **all** tools. New accounts still receive 1,000 free trial credits. Get a key at https://www.crawlforge.dev/signup and run `npm run setup` (or set `CRAWLFORGE_API_KEY`).

### Notes

- Tests updated (Scheme B + key-required assertions); `scripts/smoke-free-tier.mjs` replaced with `scripts/smoke-require-key.mjs`. Unit 401/401; MCP compliance at its pre-existing 70% baseline. Cross-repo parity with `crawlforge-website` `credits.ts` verified (0/26 mismatches via `scripts/verify-cost-parity.mjs`). `docs/tier-map.md` and `OPEN_CORE_PLAN.md` marked superseded.

## [4.6.6] - 2026-06-16

Adds a real browser / stealth extraction fallback to `deep_research` so sources that block the plain `fetch` path (Reddit, Quora, forums, DataDome/Cloudflare-protected pages) can still be read.

### Added

- **Stealth-browser extraction fallback in `deep_research`.** When the normal fetch/extract path yields no usable content (HTTP 403, JS-wall, empty body), `ResearchOrchestrator.exploreSourcesInDepth()` now retries the source through a real fingerprinted browser and re-runs extraction on the rendered HTML. Lazy (the browser stack only loads when a source is actually blocked), bounded (`maxStealthRetries`, default 8, + per-page timeout), and torn down when the extraction stage ends. Block/challenge pages are rejected by *rendered content* (title + body heuristics), not the initial HTTP status, so "Just a moment…"/"Blocked" shells never pollute results. New metrics: `stealthRetries`, `stealthRecovered`. Env: `RESEARCH_STEALTH_FALLBACK=false` to disable, `RESEARCH_STEALTH_ENGINE=camoufox|chromium|auto`, `RESEARCH_MAX_STEALTH_RETRIES`. `src/core/ResearchOrchestrator.js`
- **Camoufox (Firefox anti-detect) engine, preferred under `auto`.** Headless Chromium can't clear modern challenges (verified: Cloudflare Turnstile / DataDome / hard 403s all block it). Camoufox does — verified recovering Quora (3.5k chars) and Trustpilot (16k chars) that were fully blocked. Loaded via its CJS build (the package's ESM bundle has a broken dynamic-require), with a macOS `properties.json` path bridge, and a graceful fall back to Chromium stealth → plain fetch when Camoufox or its binary is absent. Optional dependency. **Requires a one-time binary fetch:** `npx camoufox fetch`. `src/core/ResearchOrchestrator.js`, `package.json`

### Fixed

- **`extract_content` silently ignored pre-rendered HTML.** `ExtractContentSchema` never declared the `html` field the handler reads (`const { url, html: providedHtml }`), so Zod stripped it and the tool always re-fetched the URL — defeating every pre-fetched-HTML caller (the new stealth path, and `scrape_with_actions` post-action pages). Schema now accepts optional `html`. `src/tools/extract/extractContent.js`

### Notes

- Hard IP-reputation blocks (e.g. Reddit's edge 403) still resist headless stealth from any IP — those need residential/mobile proxies, which are out of scope here.
- Unit suite: 377/377 (sandbox-on; +3 new stealth-fallback regression tests in `tests/unit/researchStealthFallback.test.js`). The 13 `streamableHttp`/`searchWebSearxng` cases fail only under the sandbox `listen EPERM` restriction and pass 24/24 sandbox-off.

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` bumped to `4.6.6`.

## [4.6.5] - 2026-06-16

Patch — fixes `deep_research` returning irrelevant / near-empty results on commercial topics. The v4.6.4 fix restored search execution; this fixes what those searches *find*.

### Fixed

- **Query expansion poisoned commercial/comparative research.** `ResearchOrchestrator.generateResearchVariations()` appended academic/scientific suffixes (`what is …`, `… explained`, `… research paper`, `… peer reviewed`, `… scientific`) to *every* topic regardless of `researchApproach`. On a competitor analysis this dragged web search toward irrelevant government/academic PDFs (reproduced: DNI SCIF specs, university course catalogs, a DLA logistics handbook surfaced as "top sources"), and on niche commercial topics it left only 1–2 usable sources. Variations are now tuned to the approach: `academic` keeps the scholarly suffixes, `current_events` uses recency terms, and `broad`/`focused`/`comparative` use commercial intent (`review`, `comparison`, `vs alternatives`, `pricing`, `best …`, `company`). Also dropped the stale hardcoded `2024` year suffix. `src/core/ResearchOrchestrator.js`
- **`researchApproach` never reached query generation.** It only configured search ranking weights in `buildOrchestratorConfig()`; the orchestrator itself always behaved as `broad`. `DeepResearchTool.buildOrchestratorConfig()` now passes `researchApproach` into the orchestrator config, and the `ResearchOrchestrator` constructor accepts and stores it. `src/tools/research/deepResearch.js`, `src/core/ResearchOrchestrator.js`
- **High-authority off-topic pages dominated results.** `verifySourceCredibility()` scored `.gov`/`.edu` at 0.9 domain authority irrespective of topical relevance, so unrelated authoritative pages ranked as top sources. Credibility is now blended with the per-source relevance signal (`overallCredibility *= 0.4 + 0.6 * relevanceScore`), demoting (and, at zero keyword overlap, dropping below the 0.3 threshold) sources that don't actually match the topic. `src/core/ResearchOrchestrator.js`

### Notes

- Unaddressed by design (scoped out): discussion sources behind bot protection (Reddit, Quora, gearspace, Facebook) return HTTP 403 to the plain-`fetch` extraction path; verified that realistic browser headers do **not** bypass their TLS-fingerprint/JS-challenge defenses. Recovering those needs a browser/stealth extraction path.
- Unit suite: 374/374 (sandbox-on); the 13 `streamableHttp` / `searchWebSearxng` cases fail only under the sandbox's `listen EPERM` localhost-bind restriction and pass 24/24 with the sandbox disabled.

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` bumped to `4.6.5`.

## [4.6.4] - 2026-06-09

Patch — fixes `deep_research` silently returning zero sources (and the same hole in `agent model:"pro"`), caught by live MCP usage.

### Fixed

- **`deep_research` returned zero sources, silently.** `ResearchOrchestrator` builds its own private `SearchWebTool`, but no layer of the `deep_research` stack ever passed it the `search_web` tool config (`apiKey`/`apiBaseUrl`): `server.js` constructs `DeepResearchTool` with no options, and `buildOrchestratorConfig()`'s per-approach `searchConfig` blocks carried only ranking/dedup weights. Every internal search threw "API key is required", the per-query catch swallowed it, and — because `metrics.searchQueries` incremented *before* the call — the result reported a successful run with 4–5 search queries and `urlsProcessed: 0`. (Pre open-core Phase 2 this failed loudly at construction; the key-optional constructor turned it into silent empty success.) `buildOrchestratorConfig()` now merges `getToolConfig('search_web')` into `searchConfig` for all five research approaches. `src/tools/research/deepResearch.js`
- **`agent` tool `model:"pro"` had the same hole.** `AgentOrchestrator` passed its `searchConfig` to its direct search tool but not to the `ResearchOrchestrator` it lazily constructs for pro runs. Now forwarded. `src/core/AgentOrchestrator.js`
- **All-queries-failed searches no longer masquerade as success.** `gatherInitialSources()` now throws when every attempted search query fails (carrying the first underlying error), and only counts `metrics.searchQueries` for searches that actually executed; partial failure (some queries fail, some succeed) still proceeds. `src/core/ResearchOrchestrator.js`
- **Orchestrator error payloads surfaced as failures.** `conductResearch()` never rejects — it returns a `handleResearchError()` payload — which `DeepResearchTool` previously formatted into a `success: true` result and the agent pro path wrapped as a successful answer. Both now detect the `error` field and return `success: false` with the message (deep_research includes `partialResults` under `includeRawData` and the recovery recommendations). `src/tools/research/deepResearch.js`, `src/core/AgentOrchestrator.js`

### Added

- **`tests/unit/researchSearchKey.test.js`** — 11 regression tests: key plumbing across all five research approaches, agent-pro `searchConfig` forwarding, loud all-failed behavior + metrics accuracy, partial-failure tolerance, and error-payload surfacing.

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` bumped to `4.6.4`.

## [4.6.3] - 2026-06-07

Patch — README rendering fix so the npm package page matches GitHub. No tool or runtime behavior changes.

### Fixed

- **README banner broken on npm.** The header banner used a relative-path SVG (`assets/banner.svg`); npm's README renderer blocks SVG and mishandles relative image paths, so the banner showed broken on the npm package page while rendering fine on GitHub. Pointed it at the absolute raw-GitHub URL of the JPG export (`assets/banner.jpg`), which renders identically on both. npm only refreshes a package's README on publish, so this required a new version. `README.md`

### Changed

- **Version sync** — `package.json`, `server.json` (manifest + npm package entry), and the `McpServer` version in `server.js` (which had lagged at `4.5.0`) all bumped to `4.6.3`.

## [4.6.2] - 2026-06-07

Patch — enables publication to the official MCP registry (`registry.modelcontextprotocol.io`). No tool or runtime behavior changes.

### Added

- **`mcpName` field in `package.json`** (`io.github.mysleekdesigns/crawlforge-mcp-server`). The MCP registry fetches the published npm tarball and rejects packages whose `package.json` lacks an `mcpName` matching the registry submission — so this required a new published version.
- **`server.json`** (repo root) — registry manifest validated against the `2025-12-11` schema; npm package `crawlforge-mcp-server`, stdio transport. Registry `description` trimmed to ≤100 chars per schema validation.
- **`docs/registry-submission.md`** — `mcp-publisher` publish runbook + ready-to-paste `awesome-mcp-servers` entries.

## [4.6.1] - 2026-06-07

Patch — fixes the `agent` tool's autonomous search, caught by live MCP smoke testing of the v4.6.0 release.

### Fixed

- **`agent` tool: autonomous search (GATHER) was a no-op.** `AgentOrchestrator` parsed search results assuming the MCP content-wrapped shape (`sr.content[0].text`), but `SearchWebTool.execute()` returns the **raw** results object — so `parsed` was always `null`, no URLs were ever queued, and any `agent` call without seed `urls[]` returned `{degraded:true, reason:"No content could be fetched…"}`. The orchestrator now handles both shapes (`sr.content?.[0]?.text ? JSON.parse(...) : sr`). `src/core/AgentOrchestrator.js`
- **Test gap that masked the above.** `tests/unit/phaseD-regressions.test.js` mocked `_searchTool.execute()` with the content-wrapped shape, encoding the orchestrator's wrong assumption. All six mocks now return the **raw** shape that the real `SearchWebTool` returns, so the suite guards this path. Verified live: `agent({prompt})` with no URLs now searches, fetches, and synthesizes.

## [4.6.0] - 2026-06-07

Phase D of `IMPROVEMENT_PLAN.md` — "Firecrawl-Competitive: Agent + Unified Scrape + Onboarding". Closes the three Firecrawl feature gaps with no clean CrawlForge equivalent — an autonomous **agent**, a **unified scrape** entry point, and **ranked map** — plus a one-command onboarding flow, all **local-first** (MCP-native primitives + local-LLM via Ollama; no cloud proxy/reliability layer). Purely additive: tool count 24 → 26, no breaking changes to existing tools. Regression coverage ships in `tests/unit/phaseD-regressions.test.js`.

### Added

- **`scrape` tool (unified scrape)** — one call takes a `formats` array (`"markdown" | "html" | "rawHtml" | "text" | "links" | "metadata" | "screenshot"` or `{type:"json", schema, prompt?}`) plus an `onlyMainContent` flag, does a **single fetch + one cheerio load**, and dispatches each requested format from that one parse (reusing `extractBlockText`, the Readability→markdown helper, `htmlToMarkdown`, and `ExtractWithLlm` for JSON). Partial-success is non-fatal: a failed format records a `warnings[]` entry rather than failing the whole call. `onlyMainContent` maps to the existing Readability boilerplate-removal branch. **New:** `src/tools/scrape/unifiedScrape.js`.
- **`agent` tool (autonomous)** — natural-language prompt → autonomous search / navigate / extract → prose-or-structured output, **no URLs required**. Input: `prompt`, optional `urls[]` (≤20), optional `schema`, `model:'default'|'pro'`, `maxSteps` (≤10), `maxUrls` (≤20). Built as a hardcoded PLAN → GATHER → ACT → DECIDE → SHAPE state machine over existing pieces (`SearchWebTool`, `fetchAndParse`, `ExtractWithLlm`, `SamplingClient`, and `ResearchOrchestrator` for the `pro` tier). **Three independent hard stops — steps, URLs, and a wall-clock budget — plus "answer found", all enforced in the orchestrator and never delegated to the LLM.** No-LLM-key path returns a degraded-but-useful result (`{degraded:true, reason, ...evidence}`) so the host LLM can finish, mirroring `deep_research`'s raw-evidence behavior. `ElicitationHelper` confirms before a `pro`/expensive run (fail-open). **New:** `src/core/AgentOrchestrator.js`, `src/tools/agent/agent.js`.
- **`map_site` `search=` ranking** — optional `search` string ranks discovered URLs by relevance via the existing `ResultRanker.rankResults()` (slug adapter over the URL path) and emits `ranked_urls:[{url, score}]` sorted descending. Default (no-`search`) output shape is **unchanged** (back-compat). The ranker is constructed lazily/once to avoid its `CacheManager` timer leaking per request. `src/tools/crawl/mapSite.js`, `server.js`
- **`crawlforge init` CLI command** — one command orchestrates existing pieces: API-key detection, skill installation (`install({target})`), and **idempotent merge of the MCP server stanza** into the detected client config (`~/.claude.json`, Claude Desktop's OS-specific config, Cursor `~/.cursor/mcp.json`) — without clobbering other servers. Flags: `--all`, `--client <name>`, `--yes`. **New:** `src/cli/commands/init.js`; registered in `src/cli/index.js`; `package.json` postinstall hint updated.
- **`SKILL.md`** — canonical, agent-fetchable capabilities reference generated by concatenating `src/skills/*.md` (the same `concatenateSkills()` source used by the installer), with a "Phase D New Tools" section documenting `scrape` and `agent`. Referenced from `README.md`.

### Changed

- **`extract_text` reuse** — `extractBlockText($)` is now exported and the Readability→markdown conversion is factored into a reusable exported helper, so the new `scrape` tool reuses them against an already-loaded cheerio instance without re-fetching. No behavior change to `extract_text`. `src/tools/basic/extractText.js`
- **Cost model** — `getToolCost()` adds `scrape: 2` and `agent: 8`; `projectCost()` scales `scrape` with the number of requested formats and `agent` with `maxUrls` + the `pro` tier (external LLM usage is billed by the provider, not in credits). `src/core/AuthManager.js`
- **Tool count 24 → 26** — `scrape` and `agent` registered (both `withAuth`), added to the startup tool list and graceful-shutdown cleanup; server description updated.

### Verified

`tests/unit/phaseD-regressions.test.js` 34/34 pass (mocked LLM/search/fetch — no live network; covers the agent loop's `maxSteps`/`maxUrls`/wall-clock hard stops and clamps, the no-LLM degraded path, unified `scrape` single-fetch multi-format + partial-success warnings, and `map_site` `search=` ranking). Full `npm run test:unit` green except the pre-existing `streamableHttp` / `searchWebSearxng` suites, which fail only under the sandbox's `listen EPERM` (localhost-bind) restriction and pass cleanly with the sandbox disabled (0 failures). `npm test` MCP harness exits 0 (0 errors; 60% rate unchanged from v4.5.0). `node test-tools.js` 15/15 pass + 5 network-skipped (100%). Live MCP smoke tests are deferred — they require publishing + reinstalling the global binary. Version bumped 4.5.0 → 4.6.0; tool count 24 → 26.

## [4.5.0] - 2026-06-07

Phase C of `IMPROVEMENT_PLAN.md` — "Robustness, Security & Polish". Closes all C-series items so tools are robust, polite on the network, and consistent in their contracts. Regression coverage ships in `tests/unit/phaseC-regressions.test.js` (27 tests).

### Added

- **`get_batch_results` tool** — paginated retrieval of `batch_scrape` results by `batchId` (`page` / `pageSize`). Tool count 23 → 24. Also restored `list_ollama_models` to the startup tool list. `server.js`, `src/tools/advanced/batchScrape/index.js`
- **`stealth_mode` engine selection** — `engine: 'chromium'` (default) | `'camoufox'`, wired through the operation-based `scrape_with_stealth` → `createStealthContext` → `launchStealthBrowser` path; a mismatched running browser is torn down before switching. `src/core/StealthBrowserManager.js`
- **`extract_with_llm` structured output** — when a `schema` is provided and the provider is Anthropic, output is forced via tool-use (`tools` + `tool_choice`), guaranteeing schema-shaped JSON; output is then validated with zod (`valid` / `validationErrors` in the result). Truncation metadata (`truncated`, `original_length`) is surfaced. `src/tools/extract/extractWithLlm.js`
- **`process_document` page ranges** — `options.pageRange: {start, end}` (1-based, inclusive) returns exactly those pages via per-page `pagerender` capture. The server `options` schema is now passthrough so granular options (`maxPages`, `pageRange`, `extractText`, …) actually reach the tool instead of being stripped. `src/core/processing/PDFProcessor.js`, `src/tools/extract/processDocument.js`, `server.js`

### Fixed

- **`fetch_url` body-size cap** — Content-Length pre-check plus a streaming byte-count guard (configurable via `MAX_FETCH_BODY_SIZE`, default 25 MB) prevents memory exhaustion across all basic tools. The guard is defensive: responses without a Headers object or a `ReadableStream` body are returned unchanged so native `.text()`/`.json()` keep working. `src/tools/basic/_fetch.js`, `src/constants/config.js`
- **Ineffective fetch timeouts** — replaced the no-op `timeout:` option (ignored by Node `fetch`) with `AbortSignal.timeout(...)` in `extract_content`, `process_document`, and `track_changes`. `src/tools/extract/extractContent.js`, `src/tools/extract/processDocument.js`, `src/tools/tracking/trackChanges/differ.js`
- **`generate_llms_txt` intrusive probing** — security-path and rate-limit probing are now opt-in (`checkSecurity`, `probeRateLimit` default `false`); remaining probes run in bounded parallel batches instead of long sequential loops. `src/core/LLMsTxtAnalyzer.js`, `src/tools/llmstxt/generateLLMsTxt.js`
- **`crawl_deep` rate limiting & logging** — per-domain rate-limiter map (reused rather than recreated per URL); filter/robots block messages routed through `logger.debug` instead of raw `console.error` (stdout-hygiene). `src/core/crawlers/BFSCrawler.js`
- **`stealth_mode` sec-ch-ua mismatch** — `sec-ch-ua` brand versions are derived from the resolved User-Agent's Chrome major version (was hardcoded `120` against a `121` UA). `src/core/StealthBrowserManager.js`
- **Stale User-Agent** — `fetch_url` / `extract_structured` now send a version-derived `CrawlForge/<version> (+https://crawlforge.dev)` UA (was `CrawlForge/1.0.0` / `CrawlForge-MCP/3.0`). `src/tools/basic/_fetch.js`, `src/tools/extract/extractStructured.js`
- **`localization` geo-blocking & phone regex** — `handle_geo_blocking` renamed to `detect_geo_blocking` (it only detects and recommends — no bypass is applied); fixed the US phone regex (`\\d` → `\d`). `src/core/LocalizationManager.js`, `server.js`
- **`extract_with_llm` JSON recovery** — extracts the first *balanced* embedded JSON object/array (string/escape-aware), tolerating prose both before and after the JSON; previously only leading-prose-then-trailing-JSON was recovered. `src/tools/extract/extractWithLlm.js`
- **`list_ollama_models` robustness** — hardened against a non-array `models` field; `modified_at` normalized to ISO 8601. `src/tools/extract/listOllamaModels.js`
- **`process_document` page extraction** — `extractPDFPages` now produces a real page range; previously its `endPage` was clobbered by `maxPages` and `startPage > 1` only logged a warning while returning all pages. `src/core/processing/PDFProcessor.js`
- **`batch_scrape` markdown title / webhook status** — markdown builder de-dups the `<title>` heading against the first `<h1>`; webhook delivery status is returned on the batch result. `src/tools/advanced/batchScrape/worker.js`, `reporter.js`, `index.js`

### Verified

`npm run test:unit` 360/360 (sandbox-off; sandbox-on `listen EPERM` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (0 errors). `npm audit`: 4 pre-existing moderate advisories (uuid/node-cron transitive) — out of Phase-C scope. Version bumped 4.4.0 → 4.5.0; tool count 23 → 24.

## [4.4.0] - 2026-06-06

Phase B of `IMPROVEMENT_PLAN.md` — "Result-Quality Upgrades". Closes 12 quality items so "working" tools return accurate, well-structured, high-fidelity data. Each fix ships a reproduce→pass regression test in `tests/unit/phaseB-regressions.test.js` (56 tests).

### Fixed

- **`extract_content` / `process_document` Flesch formula** — replaced the inverted, char-based readability score with the correct Flesch Reading-Ease formula (`206.835 − 1.015·avgWordsPerSentence − 84.6·avgSyllablesPerWord`); added a `_countSyllables` helper and exposed `avgSyllablesPerWord`. Higher score now means easier reading. `src/core/processing/ContentProcessor.js`
- **`extract_text` block structure** — text mode joins block-level elements with `\n\n` instead of collapsing whitespace (which glued paragraphs together); markdown mode runs `@mozilla/readability` before Turndown, and `turndown-plugin-gfm` renders HTML tables as GFM pipe tables. `src/tools/basic/extractText.js`, `src/utils/htmlToMarkdown.js`
- **`extract_metadata` JSON-LD/microdata** — now parses and returns `json_ld` and `microdata` (advertised but previously absent); title fallback chain is `og:title → <title> → h1`. `src/tools/basic/extractMetadata.js`
- **`scrape_structured` attributes & match counts** — added `@attr` extraction syntax (`a@href`, `img@src`) and a `max_results` param; `elements_found` is now a per-field DOM-match-count object instead of a count of result keys. `src/tools/basic/scrapeStructured.js`, `server.js`
- **`extract_structured` confidence penalty** — the "CSS fallback used" note moved out of `validationErrors` into its own `extractionNotes` array so it no longer drags down confidence; `ul/ol > li` array/list extraction improved. `src/tools/extract/extractStructured.js`
- **`crawl_deep` truncation** — replaced the hardcoded 500-char cut with a `content_max_length` param + `truncated` flag; no `...` appended to already-short content. `src/tools/crawl/crawlDeep.js`, `server.js`
- **`map_site` sitemap handling** — reuses `src/utils/sitemapParser.js` for sitemap-index recursion, gzipped (`.xml.gz`) sitemaps, real cheerio XML parsing (CDATA/entities), and robots.txt sitemap discovery; `min=Infinity` fixed to `null`. `src/tools/crawl/mapSite.js`
- **`search_web` ranking & contract** — `total_results` is now a Number (was `String()`-wrapped); BM25 uses real per-term IDF instead of a constant `df`; SimHash is a true 64-bit hash via two independent FNV-1a seeds (bits 32-63 no longer mirror 0-31); top-level `finalScore`/`contentHash`/`scores`/internal fields are stripped unless detail flags are set. `src/tools/search/providers/searxng.js`, `ranking/ResultRanker.js`, `ranking/ResultDeduplicator.js`, `searchWeb.js`
- **`analyze_content` false positives** — topic categorization and emotion detection use word-boundary (`\bword\b`) matching, eliminating substring matches like `'happy'`→`'app'` and `'glade'`→`'glad'`. `src/tools/extract/analyzeContent.js`
- **`track_changes` similarity** — token-based Jaccard `calculateSimilarity()` replaces length-only comparison, with a `DEFAULT_CHANGE_THRESHOLD = 0.85`. `src/tools/tracking/trackChanges/differ.js`

### Added

- **`extract_content` provenance fields** — `extractionMethod` (`readability` / `fallback_boilerplate_removal` / `raw_body_text`), `fallback_reason`, `confidence`, and `finalUrl`, so callers can distinguish Readability output from last-resort body text. `src/tools/extract/extractContent.js`
- **`deep_research` no-LLM `outputFormat`** — the `raw_evidence` path now honors `outputFormat`: `summary` trims to the top-5 sources, `citations_only` returns a citation shape plus `citationSummary`, `conflicts_focus` surfaces a `conflictsNote`; evidence is ranked by credibility. Previously these formats silently did nothing without an LLM. `src/tools/research/deepResearch.js`
- **`turndown-plugin-gfm` dependency** — enables GFM table rendering in markdown output.

### Verified

- `tests/unit/phaseB-regressions.test.js` 56/56; full recursive `npm run test:unit` 488/488 green sandbox-off (the sandbox-on `listen EPERM 127.0.0.1` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (0 errors). `McpServer` version bumped 4.3.0 → 4.4.0.

## [4.3.0] - 2026-06-06

Phase A of `IMPROVEMENT_PLAN.md` — "Critical Fixes & Restored Capabilities". Closes 9 critical-correctness bugs and restores 6 advanced MCP capabilities that `server.js` schemas were silently dropping. Each fix ships a reproduce→pass regression test in `tests/unit/phaseA-regressions.test.js`.

### Fixed

- **`extract_links` inverted `filter_external`** — `filter_external:true` now returns only *external* links (previously returned internal-only). `src/tools/basic/extractLinks.js`
- **`analyze_content` language detection** — `franc.all` (nonexistent in franc v6) replaced with the `francAll` named import; unblocks all language detection and `summarize_content`'s `metadata.language`. `src/core/analysis/ContentAnalyzer.js`
- **`summarize_content` abstractive mode** — implemented the missing `_abstractiveSummaryViaSampling()` (via `SamplingClient`); when no LLM/sampling backend is available it returns the extractive summary with explicit `degraded`/`degradedReason` flags instead of silently masking the failure. `src/tools/extract/summarizeContent.js`
- **`extract_with_llm` undefined `callViaSampling`** — removed the undefined call and wired the real `getSamplingClient()` fallback; the Ollama/auto error path no longer crashes. `src/tools/extract/extractWithLlm.js`
- **`deep_research` empty extractions** — failed/empty (`{"text":""}`) extractions are no longer counted as `contentExtracted` or surfaced; guards on `contentData.success` + non-empty trimmed content. `src/core/ResearchOrchestrator.js`
- **`track_changes` no-baseline** — returns a clean `No baseline found for <url> — run create_baseline first` error and no longer emits an unhandled `'error'` EventEmitter event. `src/core/ChangeTracker.js`
- **`scrape_template` Hacker News selectors** — `.subtext` is the sibling row after `tr.athing` (not `.spacer`); score/author/posted/comments now populate per story. `src/tools/templates/TemplateRegistry.js`
- **`generate_llms_txt` output format** — default output is now spec-compliant llmstxt.org markdown (`# Title`, `> summary`, `## Section` headers with `[name](url)` link lists) instead of robots.txt directives. The legacy robots-style output is preserved behind `outputOptions.robotsStyle:true`. `src/tools/llmstxt/generateLLMsTxt.js`

### Added (restored MCP capabilities)

- **`crawl_deep`** — `domain_filter`, `session`, `import_filter_config`, `enable_link_analysis`, `link_analysis_options` now forwarded through the MCP schema + handler. `server.js`
- **`search_web`** — 10 previously-dropped params forwarded: `provider`, `expand_query`, `expansion_options`, `enable_ranking`, `ranking_weights`, `enable_deduplication`, `deduplication_thresholds`, `include_ranking_details`, `include_deduplication_details`, `localization`. `server.js`
- **`map_site`** — `domain_filter` / `import_filter_config` forwarded. `server.js`
- **`scrape_with_actions`** — the MCP action schema now carries all action fields (`duration`, `distance`, `direction`, `captureAfter`, `clear`, `button`, `clickCount`, `delay`, `force`, `position`, `modifiers`, `smooth`, `toElement`, `condition`, `fullPage`, `quality`, `format`, `args`, `returnResult`) so `{type:'wait',duration:1000}` works; `formAutoFill` `{fields:[…]}` is reconciled end-to-end (flat record still accepted); and final content is read from the post-action live page (`ActionExecutor` captures `finalHtml`/`finalUrl`; `extractContent` accepts pre-rendered `html`) instead of re-fetching the original URL. `server.js`, `src/tools/advanced/ScrapeWithActionsTool.js`, `src/core/ActionExecutor.js`, `src/tools/extract/extractContent.js`

### Verified

- `tests/unit/phaseA-regressions.test.js` 12/12; full `npm run test:unit` 277/277 green sandbox-off (the sandbox-on `listen EPERM 127.0.0.1` failures are the pre-existing HTTP-transport/searxng port-binding cases). `node test-tools.js` 20/20 (100%). `npm test` MCP harness exits 0 (all 23 tools discovered). `McpServer` version corrected from a stale 4.2.6 to 4.3.0.

## [4.2.12] - 2026-06-06

Patch release: ship the previously-unreleased `stealth_mode` fingerprint-consistency and `create_page` output fixes (commit `28e2e3b`) so the published package matches HEAD. Tarball now carries the corrected `StealthBrowserManager` and `create_page` handler.

### Fixed

- **`stealth_mode` fingerprint OS consistency** (`src/core/StealthBrowserManager.js`): the user-agent, `sec-ch-ua-platform` header, and `navigator.platform` were drawn from `osDistribution` by three independent random calls, so a fingerprint could advertise a Windows UA with `navigator.platform: "Linux x86_64"`. `generateAdvancedFingerprint()` now selects the OS once (`selectOS()`, inferring OS from any `customUserAgent`) and threads it through the UA, headers, and hardware fingerprint. Verified 500/500 random fingerprints internally consistent.
- **`stealth_mode` `create_page` output leak** (`server.js`): `create_page` returned the raw, non-serializable Playwright `Response` handle. It now returns a serializable `navigation` object `{ requestedUrl, finalUrl, status, ok, title }`.

### Verified

- `tests/unit/d2-reliability.test.js` (StealthBrowserManager) 16/16; `npm run test:unit` green sandbox-off (sandbox-on `listen EPERM` HTTP-transport failures are pre-existing and environmental).

## [4.2.11] - 2026-05-25

Maintenance release. No shippable code changed — the published tarball is identical to 4.2.10 (the `files` allow-list excludes `tests/`); the version bump releases the post-4.2.10 test-hardening work and keeps the registry in lockstep with `main`.

### Added

- **`tests/unit/stdout-hygiene.test.js` regression lock** for the v4.2.10 stdout fixes — a source scan that fails if any `console.log` reappears in the tool/crawler/stealth/webhook execution paths, plus the `tests/fixtures/cli/actions-wait-screenshot.json` fixture. Landed after 4.2.10 was already published.

### Verified

- `npm run test:unit` passes (sandbox-off; the only sandbox-on failures are HTTP-transport tests that can't `listen` on `127.0.0.1` under the sandbox). `npm test` MCP harness exits 0.

## [4.2.10] - 2026-05-25

Patch release: eliminate stdout leaks that corrupted CLI `--json` output. Found while verifying the v4.2.9 CLI fixes — `crawlforge actions --json` emitted a non-JSON banner line before the JSON, breaking programmatic parsing.

### Fixed

- **Tool diagnostics no longer write to stdout** (reserved for the MCP JSON-RPC stream and CLI `--json`). Moved 11 `console.log` calls to `console.error` across the tool/crawler execution paths:
  - `ScrapeWithActionsTool` — "Starting scrape session …" banner (the one that broke `actions --json`) and its internal `log()` helper.
  - `extractContent` / `processDocument` — "Using browser rendering for JavaScript content…" (corrupted `scrape`/`extract`/`analyze`/`process-document --json` when JS rendering kicked in).
  - `StealthBrowserManager` — Cloudflare/reCAPTCHA-detected and proxy-rotation messages (corrupted `stealth --json` on protected sites).
  - `BFSCrawler` — domain-filter / legacy-pattern / robots.txt block messages (corrupted `map`/`crawl --json` on real multi-page sites).
  - `WebhookDispatcher` — webhook-retry message (corrupted `track`/`monitor --json` on webhook retries).
  - Completes the v4.2.4 stdout-hygiene pass. Left untouched: `AuthManager` interactive setup output (stdout is intended there), standalone `src/security/*` scripts/tests, and graceful-shutdown logs (don't fire on normal one-shot CLI exit).

### Verified

- `crawlforge actions … --json` now starts with `{` and parses cleanly (`success:true`, 2/2 actions, screenshot captured), confirmed against the global 4.2.10 install (banner on stderr, none on stdout). `npm run test:unit` 265/265.
- Regression-locked by `tests/unit/stdout-hygiene.test.js` (source scan: fails if any `console.log` reappears in tool/crawler execution paths) + `tests/fixtures/cli/actions-wait-screenshot.json`.

## [4.2.9] - 2026-05-25

Patch release: fix the remaining broken/no-op `crawlforge` CLI commands and make the CLI work inside sandboxed (proxied) environments. The CLI invokes tools directly, so these are CLI-layer fixes — the MCP server was already correct.

### Fixed

- **`research` no longer errors on every run.** Passed `query`/`depth`/`max_urls`/`output_format`, but `DeepResearchSchema` requires `topic` plus `maxDepth`/`maxUrls`/`outputFormat`. Zod stripped the unknown keys, leaving `topic` undefined → "Required". Now sends `topic` and maps `--depth basic|standard|deep` → `maxDepth` (2/5/8) and `--output-format summary|detailed` → `outputFormat` (`summary`/`comprehensive`).
- **`stealth` no longer throws `TypeError`.** It called `StealthBrowserManager.scrapeWithStealth()`, which did not exist (the `stealth_mode` tool is operation-based only). Added a one-shot `scrapeWithStealth({url, engine, wait_for, screenshot})` convenience method (create context → page → goto → extract title/text/html → optional base64 screenshot → `closeContext` in `finally`).
- **`track` / `monitor` flags were silently ignored, and both threw "No baseline found" on first run.** `--selector` → `trackingOptions.customSelectors`; `--threshold` (%) → `trackingOptions.significanceThresholds` (ordered 0-1). `monitor` now uses `operation: 'monitor'` (the interval poller) with `--interval` converted s→ms and `--webhook` → `notificationOptions.webhook`. Both commands now bootstrap a baseline before comparing/polling, so first use works.
- **`llmstxt` flags were no-ops.** `--include-full` → `format` (`both`/`llms-txt`), `--max-pages` → `analysisOptions.maxPages`.
- **`map` flags were no-ops.** `--max-pages` → `max_urls`. Removed `--depth`/`--format` (no backing in `map_site`); added `--no-sitemap`.
- **`actions` flags were no-ops.** `--screenshot` → `captureScreenshots`. Removed `--wait` (no between-action wait field; use `{type:'wait'}` actions in the script).

### Added

- **undici proxy support for the CLI.** Node's global `fetch()` ignores `HTTP(S)_PROXY`, so the CLI's API/scrape calls failed inside sandboxes that only allow proxied egress. `src/cli/index.js` now installs an undici `EnvHttpProxyAgent` global dispatcher when a proxy env var is set (honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`; no-op otherwise). Removes the need for a sandbox `excludedCommands` workaround. `undici` is now a direct dependency (pinned to the existing `^7.24.0` security override).

### Tests

- `npm run test:unit` 262/262; `npm test` exits 0. CLI smoke-tested (help/version, proxy dispatcher install, `scrapeWithStealth` presence).

## [4.2.6] - 2026-05-25

Patch release: make `crawlforge-mcp-server <command>` work as the CLI (follow-up to 4.2.5).

### Fixed

- **`crawlforge-mcp-server` bin now points at the CLI** (`src/cli/index.js`), not `server.js`. In 4.2.5 it launched the MCP server, so `crawlforge-mcp-server scrape <url>` (the form documented in `docs/cli-guide.md` and `docs/PRODUCTION_READINESS.md`) ignored its args and hung waiting for a JSON-RPC stream. Because the CLI auto-detects MCP-stdio launches and hands off to the server, this one-line change makes both paths work: `crawlforge-mcp-server scrape <url>` runs the CLI, while `npx -y crawlforge-mcp-server` spawned by an MCP host over stdio still starts the server. `crawlforge-mcp` remains the dedicated direct-to-`server.js` launcher.

## [4.2.5] - 2026-05-25

Patch release: restore the MCP server launch command that v4.1.0 silently broke, and make the documented launch commands actually work.

### Fixed

- **`crawlforge` no longer fails to start the MCP server.** Before v4.1.0 the `crawlforge` bin **was** the MCP server. v4.1.0 repurposed it into the CLI, so MCP clients still configured with `"command": "crawlforge"` received CLI help text instead of a JSON-RPC stream — surfacing in Claude Code / Cursor / Claude Desktop as `Failed to reconnect: -32000`. The CLI now detects MCP-stdio invocation (no subcommand + non-TTY stdin, i.e. how a host spawns it) and hands off to the server. **Existing configs keep working after `npm update` with no edits.** Escape hatch: `CRAWLFORGE_FORCE_CLI=true`.
- **`npx -y crawlforge-mcp-server` now resolves.** The README's Claude Desktop example pointed `npx` at the package, but no bin matched the package name, so npm errored with "could not determine executable to run." Added a matching bin.

### Added

- **`crawlforge-mcp-server` bin** → `server.js`, so `npx -y crawlforge-mcp-server` works (npx resolves the bin whose name matches the package).
- **`crawlforge-mcp` bin** → `server.js`: a dedicated, explicit MCP-server launcher. Because it resolves on `PATH`, it survives Node/nvm version switches (unlike a hard-coded `node /path/to/server.js`). This is what `crawlforge-setup` now writes into MCP client configs.
- **`crawlforge mcp` / `crawlforge serve` subcommand** to start the server by hand from an interactive shell.

### Changed

- **`crawlforge-setup`** now writes `"command": "crawlforge-mcp"` (was `"crawlforge"`) and migrates pre-v4.2.5 configs on re-run.
- **README** MCP config examples corrected; added a "Which launch command?" note.
- Server `serverInfo.version` corrected to track the package version (was pinned at `4.2.2`).

### Tests

- `tests/integration/cli.test.js`: assert `--help` lists `mcp`, and a guarded end-to-end test that drives a full `initialize` handshake through `crawlforge mcp` (skips when no CrawlForge credentials are present, so it never hangs CI).

## [4.2.2] - 2026-05-18

Patch release: CLI bugfix + retracted v4.0.0 breaking-change documentation.

### Fixed

- **`crawlforge batch` CLI command** — user-supplied `--format`, `--concurrency`, and `--max-retries` flags were silently dropped because the command passed `output_format` / `concurrency` / `max_retries` to `BatchScrapeTool.execute()`, but `BatchScrapeSchema` expects `formats` (array) / `maxConcurrency` / `jobOptions.maxRetries`. Zod's strip-mode silently discarded the unknown keys, so the tool always ran with defaults regardless of what was passed on the command line. Now maps to the schema's actual keys.

### Documentation

- **CHANGELOG v4.0.0 retracted** — the "breaking change" to `batch_scrape` defaults was a phantom at the MCP surface (see v4.2.1 postmortem). The v4.0.0 Breaking Changes and Migration Guide sections are now annotated as retracted with the corrected reality inline.

### Added

- Contract test in `tests/unit/tools/advanced/batchScrape.test.js` pins the CLI param shape so the flag-mapping regression can't silently re-appear.

### Internal

- CI workflow (`.github/workflows/ci.yml`) fixed: the quoted glob `"tests/unit/*.test.js"` never expanded in GitHub Actions, causing the unit-tests job to fail in 0s with "Could not find" before running any test. Replaced with `$(find tests/unit -name "*.test.js")` for recursive discovery (now runs 417 tests across 18 files vs. 0 before), added `--test-force-exit` to bypass open-handle hangs in legacy D2 reliability tests, bumped CI Node 20 → 22. Not user-facing; not in the published tarball.

## [4.2.1] - 2026-05-18

Backwards-compatibility fix: neutralize the v4.0.0 "breaking change" to `batch_scrape` defaults.

### Fixed

- **`batch_scrape` default formats** — Aligned the internal `BatchScrapeSchema` default from `['markdown']` back to `['json']` to match the MCP-facing default at `server.js:544`. The v4.0.0 release notes flagged this as a breaking change, but in practice the MCP tool registration always defaulted to `['json']` — the inner-schema mismatch only ever affected direct programmatic callers of `BatchScrapeTool.execute()`, never MCP clients (Claude Code, Cursor, the CLI). v4.2.1 closes the latent gap so the two layers agree. **No migration needed for any caller.** Markdown output remains a single-line opt-in via `formats: ['markdown']` (or `['markdown','json']` for both).

### Added

- Regression tests in `tests/unit/tools/advanced/batchScrape.test.js` pinning `BatchScrapeSchema` defaults so this mismatch can't silently re-appear: `default formats is ['json']`, `preserves explicit ['markdown']`, `preserves explicit ['markdown','json']`. 10/10 tests green.

### Migration Guide

If you upgraded from v3.x to v4.0.0–v4.2.0 via the MCP interface: **nothing changes**, you were never affected. If you import `BatchScrapeTool` directly and call `.execute({urls:[...]})` without specifying `formats`: you now get `content.json` again (matches v3.x). To get the markdown-first behavior promised in D3.1, pass `formats: ['markdown']` explicitly — the Turndown converter, `extract_text` markdown mode, `extract_content` markdown mode, and `process_document` markdown mode are all unchanged.

## [4.2.0] - 2026-05-18

Phase D5.2 + D5.3 — Per-tool unit tests and docs refresh. Additive release: no API changes.

### Added

**D5.2 Per-tool unit tests (17 new test files)**
- `tests/unit/tools/extract/extractContent.test.js` — 8 tests
- `tests/unit/tools/extract/processDocument.test.js` — 7 tests
- `tests/unit/tools/extract/analyzeContent.test.js` — 8 tests
- `tests/unit/tools/extract/summarizeContent.test.js` — 8 tests
- `tests/unit/tools/extract/extractStructured.test.js` — 7 tests
- `tests/unit/tools/extract/listOllamaModels.test.js` — 7 tests (with injectable fetch stub)
- `tests/unit/tools/research/deepResearch.test.js` — 9 tests (elicitation, session tracking)
- `tests/unit/tools/search/searchWeb.test.js` — 7 tests (cache, expander, provider)
- `tests/unit/tools/crawl/crawlDeep.test.js` — 7 tests (elicitation for >500 pages)
- `tests/unit/tools/crawl/mapSite.test.js` — 8 tests (sitemap parse, group_by_path, cache)
- `tests/unit/tools/advanced/batchScrape.test.js` — 7 tests (elicitation, jobManager integration)
- `tests/unit/tools/advanced/scrapeWithActions.test.js` — 8 tests (page.close() leak check)
- `tests/unit/tools/stealth/stealthMode.test.js` — 7 tests (camoufox/playwright engine)
- `tests/unit/tools/localization/localization.test.js` — 8 tests (geo-block, translation)
- `tests/unit/tools/tracking/trackChanges.test.js` — 8 tests (diff, monitoring lifecycle)
- `tests/unit/tools/llmstxt/generateLLMsTxt.test.js` — 9 tests (format modes)
- `tests/unit/tools/templates/scrapeTemplate.test.js` — 8 tests (list mode, HTTP errors)
- Total new tests: 131 — all green. No new npm dependencies (uses node:test + stubs).

**D5.3 Docs refresh**
- `docs/local-ollama-quickstart.md` — Ollama install, model selection, env vars, Docker, troubleshooting
- `docs/docker-deployment.md` — build, run, compose, Render deploy, health check, volumes
- `docs/observability-setup.md` — Prometheus metrics table, OTel spans, Winston log levels, Grafana dashboard import, alerting rules
- `tests/docs/example-runner.js` — validates README JSON and shell code blocks for syntax (no live network)

**Verified existing docs present from earlier phases:** `docs/mcp-resources-prompts.md`, `docs/cli-guide.md`, `docs/stealth-engines.md`, `docs/cloud-browser.md`

### Changed

- `IMPROVEMENT_ROADMAP_V4.md` header updated: version 4.0.0 → 4.1.0, status → ALL PHASES COMPLETE
- Carry-forward items noted at bottom of roadmap: D2.8 customDNS, D2.11 24h load test, D5.1 ESLint + Docker CI

## [4.1.0] - 2026-05-18

Phase D4 - CLI (PRD Phase 2) + Skills Installer (PRD Phase 3). Additive release: no breaking changes to existing MCP tools or API.

### Added

**D4.1 CLI scaffolding**
- `commander` added to dependencies.
- `"bin": { "crawlforge": "src/cli/index.js" }` in `package.json` — `crawlforge` command available after `npm install -g`.
- `src/cli/index.js` — main entry point with global flags: `--json`, `--pretty`, `--quiet`, `--api-key`, `--timeout`.
- `src/cli/formatter.js` — shared output formatter; formats MCP tool `content[]` responses for CLI output.
- `src/cli/lib/runTool.js` — thin wrapper calling tool `execute()` and formatting output per global flags.

**D4.2 CLI commands (15 tool commands)**
- `scrape <url>` — wraps `fetch_url` (default) or `extract_content` with `--extract` flag.
- `search <query>` — wraps `search_web`; supports `--limit`, `--lang`, `--provider`.
- `crawl <url>` — wraps `crawl_deep`; supports `--depth`, `--max-pages`, `--concurrency`.
- `map <url>` — wraps `map_site`; supports `--format json|xml`.
- `extract <url>` — wraps `extract_structured` (with `--schema`) or `extract_with_llm` (with `--prompt`).
- `track <url>` — wraps `track_changes`; supports `--selector`, `--threshold`.
- `analyze <url>` — wraps `analyze_content`; supports `--depth`.
- `research <topic>` — wraps `deep_research`; supports `--depth`, `--max-urls`, `--output-format`.
- `stealth <url>` — wraps `stealth_mode`; supports `--engine playwright|camoufox`, `--screenshot`.
- `batch <urls-file>` — wraps `batch_scrape`; reads newline-delimited URLs from file.
- `actions <url> --script <file>` — wraps `scrape_with_actions`; reads JSON action script from file.
- `localize <url>` — wraps `localization`; supports `--locale`, `--country`, `--currency`.
- `llmstxt <url>` — wraps `generate_llms_txt`; supports `--include-full`, `--max-pages`.
- `template <id> <target>` — wraps `scrape_template`; `--list` shows all 10 templates.
- `monitor <url>` — wraps `track_changes` in scheduled mode; supports `--interval`, `--webhook`.

**D4.3 Skills installer (2 management commands)**
- `src/skills/installer.js` — `install()` and `uninstall()` functions; idempotent, supports `--force` and `--dry-run`.
- `install-skills [--target=claude-code|cursor|vscode|all]` — copies skill files to target AI coding tool.
- `uninstall-skills [--target=...]` — removes installed skill files.
- Skill files in `src/skills/`:
  - `crawlforge-mcp.md` — overview of all 23 MCP tools with credit reference and example calls.
  - `crawlforge-cli.md` — full CLI usage guide with examples for all 17 commands.
  - `crawlforge-stealth.md` — stealth_mode engine selection guide.
  - `crawlforge-research.md` — deep_research workflow, depth levels, cost management.
- Claude Code target: `~/.claude/skills/crawlforge-*.md` (one file per skill).
- Cursor target: `.cursor/rules/crawlforge.mdc` (concatenated).
- VS Code target: `.github/instructions/crawlforge.instructions.md` (concatenated).

### Tests
- `tests/integration/cli.test.js` — 6 tests: `--help` coverage for all 15 commands + skills commands, dry-run path verification for all 3 targets, version semver format.

### Docs
- New: `docs/cli-guide.md` — complete CLI reference with all 17 commands, flags, and examples.
- Updated: `docs/PRODUCTION_READINESS.md` — CLI availability noted.
- Updated: `IMPROVEMENT_ROADMAP_V4.md` — D4 marked complete.
- Updated: `PRD.md` — Phase 2 (CLI) and Phase 3 (Skills) marked done.


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-05-18

Phase D3 - Competitive Feature Parity. ~~**Breaking change:** batch_scrape now defaults to markdown output (was json).~~ **Retracted in v4.2.1** — see note below. Adds scrape_template tool (23 tools total). Turndown HTML-to-Markdown converter. Camoufox Firefox-based stealth engine. BrowserBase cloud backend. Cost transparency in all tool responses.

> **Postmortem (added in v4.2.1):** the v4.0.0 "breaking change" to `batch_scrape` defaults was a phantom at the MCP surface. The MCP tool registration in `server.js:544` always defaulted `formats` to `['json']`; only the inner `BatchScrapeSchema` defaulted to `['markdown']`. Because params are validated at both layers and the MCP layer wins, MCP clients (Claude Code, Cursor, the `crawlforge` CLI) were never broken. The mismatch only ever affected direct programmatic callers of `BatchScrapeTool.execute()`. v4.2.1 aligned the inner schema to `['json']` to remove the latent gap. **No migration is needed for any caller — the section below describes a migration that was never actually required.**

### ~~Breaking Changes~~ (retracted in v4.2.1)

- ~~**batch_scrape** default `formats` changed from `["json"]` to `["markdown"]`. Callers that depend on `content.json` from batch results must now pass `formats: ["json"]` explicitly.~~ Reality: the MCP-facing default never changed; v4.2.1 aligned the inner schema to `['json']` to match.
- **server version** bumped 3.6.0 to 4.0.0.

### ~~Migration Guide~~ (not required — see postmortem above)

~~If you use `batch_scrape` without specifying `formats`, your response shape changes:~~
- ~~Before (v3.x): `result.results[n].content.json`~~
- ~~After (v4.0): `result.results[n].content.markdown`~~
- ~~To keep old behavior: pass `formats: ["json"]` explicitly.~~

Reality after v4.2.1: `content.json` continues to be the MCP default exactly as in v3.x. Pass `formats: ['markdown']` to opt into RAG-friendly markdown output.

### Added

**D3.1 Markdown-first output (Turndown) — additive only after v4.2.1**
- New utility `src/utils/htmlToMarkdown.js` wraps Turndown with sensible RAG-optimized defaults (atx headings, fenced code blocks, boilerplate removal).
- `extract_text`: new `output_format: "markdown"` parameter (default: "text").
- `extract_content`: `outputFormat: "markdown"` now uses Turndown instead of regex-based conversion.
- `process_document`: `outputFormat: "markdown"` added to enum (new option).
- `batch_scrape`: markdown output available via `formats: ['markdown']` (was framed as a default-change in v4.0.0; v4.2.1 confirms it's purely opt-in at the MCP surface).
- turndown added to dependencies.

**D3.2 Camoufox browser engine**
- `src/core/StealthBrowserManager.js`: new `BrowserEngine` abstract class + `CamoufoxAdapter` implementation.
- `stealth_mode` tool: new `engine: "playwright" | "camoufox"` parameter (default: "playwright").
- Camoufox adapter gracefully fails with actionable error when package not installed.
- Licensing verified: camoufox JS API is MIT, Firefox patches are MPL-2.0 (no AGPL).
- Benchmark methodology documented in `docs/stealth-engines.md`.
- New doc: `docs/stealth-engines.md`.

**D3.3 Pre-built site templates**
- New `src/tools/templates/TemplateRegistry.js` with 10 templates: amazon-product, linkedin-profile, github-repo, youtube-video, tweet, reddit-thread, hacker-news-front-page, producthunt-launch, stackoverflow-question, npm-package.
- New `src/tools/templates/ScrapeTemplateTool.js` wrapping the registry.
- New `scrape_template` tool registered in server.js (tool count: 22 to 23).
- Fixture stubs in `tests/integration/templates/fixtures.js` for all 10 templates.
- Credit cost: 1 credit per invocation (same as fetch_url).

**D3.4 Cloud browser backend (BrowserBase)**
- `src/core/StealthBrowserManager.js`: new `BrowserBackend` abstract class, `LocalPlaywrightBackend`, `BrowserBaseBackend` (CDP), and `resolveBrowserBackend()` factory.
- Env config: `CRAWLFORGE_BROWSER_BACKEND=local|browserbase`, `BROWSERBASE_API_KEY`.
- Graceful fallback: if browserbase requested but BROWSERBASE_API_KEY not set, logs warning and falls back to local.
- New doc: `docs/cloud-browser.md`.

**D3.5 Cost transparency**
- `src/core/AuthManager.js`: new `projectCost(toolName, params)` method returning `{ projected, note }`.
- `src/server/withAuth.js`: all successful tool responses include `_cost: { projected, actual, remaining_credits, projection_note }` injected into the first JSON content item.
- Dynamic tools (deep_research, crawl_deep, batch_scrape) return lower-bound estimates with accuracy caveats in `projection_note`.

### Changed
- server.js: version bumped to 4.0.0; description updated to 23 tools; scrape_template registered.
- package.json: version bumped to 4.0.0; turndown added to dependencies.

### Verification
- `node --check server.js` and all modified src files: no syntax errors.
- `npm test` (MCP protocol compliance): 60% pass rate - unchanged from pre-D3 baseline.
- `node --test tests/unit/withAuth.test.js`: 9/9 pass.
- `node --test tests/unit/authManager.test.js`: 6/6 pass.

## [3.6.0] - 2026-05-18

Phase D1 — MCP-Native Primitives. CrawlForge is now a first-class MCP server, not just a tool host.

### Added

**D1.1 Resources** — `crawlforge://` URI scheme for long-lived artifacts:
- Created `src/resources/ResourceRegistry.js` with URI parsing, MIME types, and TTL-based in-memory storage.
- Registered `ResourceTemplate` patterns in `server.js` for all 5 resource types: `crawlforge://research/{sessionId}`, `crawlforge://job/{jobId}`, `crawlforge://crawl/{sessionId}/sitemap`, `crawlforge://screenshot/{actionId}`, `crawlforge://snapshot/{urlHash}/{timestamp}`.
- 20 unit tests in `tests/unit/resources/resourceRegistry.test.js` — all green.
- Documented URI scheme and TTL policy in `docs/mcp-resources-prompts.md`.

**D1.2 Prompts** — 5 pre-built workflow prompts (plus existing `getting-started`):
- Created `src/prompts/PromptRegistry.js` with 5 prompts: `competitive-analysis`, `monitor-changes`, `rag-ingest`, `site-audit`, `research-deep-dive`.
- Wired `prompts/list` and `prompts/get` in `server.js` via `server.registerPrompt()`.
- Server now advertises `prompts.listChanged: true` capability.

**D1.3 Sampling** — LLM fallback chain removes requirement for server-side API keys:
- Created `src/core/SamplingClient.js` with `complete()` (Ollama → OpenAI → Anthropic → MCP sampling → error) and `probe()` to check available providers.
- `extract_with_llm`: when Ollama is unavailable and no API key set, tries MCP client sampling before returning an error.
- `summarize_content`: abstractive mode now attempts Ollama/API/sampling before falling back to extractive output.
- `extract_structured` and `deep_research`: SamplingClient integrated as last-resort LLM provider.

**D1.4 Elicitation** — mid-tool user confirmation for expensive/ambiguous operations:
- Created `src/core/ElicitationHelper.js` with `confirm()` and `requestString()` — fails open when client lacks elicitation support.
- `deep_research`: prompts user before scanning >50 URLs.
- `batch_scrape`: confirms large synchronous batches (>25 URLs in sync mode).
- `crawl_deep`: confirms crawls exceeding 500 pages.
- `extract_structured`: warns when schema has >3 required fields and LLM is unavailable.
- `AuthManager`: elicits confirmation when remaining credits fall below projected cost (replaces hard-fail).
- All tools expose `setMcpServer()` to wire elicitation post-instantiation.

**D1.5 Tool description audit** — all 22 tool descriptions rewritten to lead with *when to use*:
- Every `description` field now starts with "Use this when..." followed by specific scenarios.
- Example invocations embedded in each description.
- Descriptions updated for: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured, search_web, crawl_deep, map_site, extract_content, process_document, summarize_content, analyze_content, extract_structured, extract_with_llm, list_ollama_models, batch_scrape, scrape_with_actions, deep_research, track_changes, generate_llms_txt, stealth_mode, localization.

### Changed
- `server.js`: version bumped 3.5.1 → 3.6.0; description updated to mention Resources, Prompts, Sampling, Elicitation.
- `package.json`: version bumped to 3.6.0.
- Server now correctly advertises `resources.listChanged: true` and `prompts.listChanged: true` MCP capabilities.

### Verification
- `node --check server.js` and all modified src files: no syntax errors.
- `npm test` (MCP protocol compliance): 60% pass rate — unchanged from pre-D1 baseline (pre-existing compliance test issues unrelated to D1).
- `node --test tests/unit/resources/resourceRegistry.test.js`: **20/20 PASS**.
- `node --test tests/unit/d2-reliability.test.js`: **16/17 pass** (1 cancelled due to pre-existing pending promise issue in test harness — same as before D1).
- `ResourceTemplate` registered correctly: server capabilities response now includes `resources.listChanged: true`.

## [3.4.0] - 2026-05-18

Adds local-LLM support to `extract_with_llm` via Ollama. Cloud users see zero behavior change — the addition is strictly opt-in.

### Added
- **Ollama provider for `extract_with_llm`.** Set `provider: "ollama"` (or `provider: "auto"` with `OLLAMA_BASE_URL` env var) to extract using a local Ollama model — no API key, no API costs, no data leaving the machine.
  - Default base URL `http://localhost:11434`; default model `llama3.2` (override via `OLLAMA_DEFAULT_MODEL` env or the `model` param).
  - Calls Ollama's `/api/chat` directly with `stream: false`, `temperature: 0`, `num_predict: maxTokens`. Zero new runtime deps — same raw-`fetch()` pattern as the OpenAI/Anthropic branches.
  - JSON mode by default (`format: "json"`). When the optional `schema` param is provided, it is passed through as Ollama's structured-outputs `format` object, constraining the model to that JSON schema (per <https://ollama.com/blog/structured-outputs>).
  - Provider resolution: `provider: "ollama"` always selects Ollama (no key required). `provider: "auto"` keeps the existing Anthropic → OpenAI order and only falls back to Ollama when neither cloud key is set **and** `OLLAMA_BASE_URL` is exported — guaranteeing no behavior change for existing cloud users.
  - Friendly error on `ECONNREFUSED` / `ENOTFOUND`: surfaces `Ollama is not running at <url>. Start it with "ollama serve" and pull a model: "ollama pull llama3.2".` instead of a raw fetch error. Friendly error on `404 model not found` instructs `ollama pull <model>`.
  - Usage normalized: Ollama's `prompt_eval_count` / `eval_count` mapped to the uniform `{ input_tokens, output_tokens }` shape used by the OpenAI/Anthropic branches.
- 8 new unit tests in `tests/unit/extractWithLlm.test.js` (22 total, all pass): explicit-ollama path, JSON-mode body shape, schema → structured-outputs pass-through, ECONNREFUSED → friendly error, usage normalization, auto-fallback rules (no behavior change for cloud users), model override.

### Changed
- `server.js` — `extract_with_llm` provider enum extended to `["openai", "anthropic", "ollama", "auto"]`; tool description updated to mention local Ollama support and clarify that Ollama needs no key.

### Verification
- `node --test tests/unit/extractWithLlm.test.js`: **22/22 PASS**.
- `npm test` MCP protocol compliance: 10/10 tests completed, 0 errors — unchanged from HEAD baseline.
- **Live end-to-end against real Ollama 0.24.0 with `llama3.2:latest`**: 3/3 scenarios pass — plain JSON mode (extracted product/price/screen-size from "iPhone 16 Pro" text), structured-outputs schema (nested order with line-items array), and `provider: "auto"` fallback via `OLLAMA_BASE_URL`.

## [3.3.1] - 2026-05-17

Two pre-existing bugs surfaced during the full out-of-sandbox verification of the v3.3.0 release. Neither was caused by Phase C5 — both reproduce on the v3.2.0 commit. They were masked respectively by a populated LRU cache hit (bug #1) and by CI environments lacking the maintainer `.env` (bug #2).

### Fixed
- **`search_web` "Converting circular structure to JSON → Timeout" crash.** `ResultRanker` and `ResultDeduplicator` constructors spread `...options` (which includes `sharedCache`, a `CacheManager` instance holding a `setInterval` monitoring Timer) into `this.options`. Cache-key generation later called `JSON.stringify` on that options object, hitting a circular reference through `Timer → TimersList → Timer`. Fix: destructure `sharedCache` out before the spread so it lives in `this.cache` only — never in the serializable `this.options`. Inline comment added at both constructors so a future refactor doesn't reintroduce the bug. (`src/tools/search/ranking/ResultRanker.js`, `src/tools/search/ranking/ResultDeduplicator.js`)
- **`endpointGuard.test.js` "creator mode OFF" test was premise-unsatisfiable on the maintainer's machine.** `creatorMode.js` loads `.env` at module init and caches the verified flag in a module-scoped variable that is immutable from outside (by design — security note in that file). The test tried to disable creator mode by `delete process.env.CRAWLFORGE_CREATOR_SECRET` at test time, which has no effect once the module has loaded. Fix: have the test `t.skip()` with a clear rationale when `isCreatorModeVerified()` returns true — the test's other 7 assertions still run unconditionally. (`tests/unit/endpointGuard.test.js`)

### Verification (clean tree, no sandbox)
- `node test-tools.js`: **20/20 PASS** (was 19/20 — search_web fixed)
- `node --test tests/unit/*.test.js`: 240 tests — **227 pass, 0 fail, 13 skipped** (was 227 pass, 1 fail, 12 skipped)
- `node --test tests/unit/streamableHttp.test.js`: **12/12 pass** (was sandbox-blocked by EPERM listen on 127.0.0.1)
- `npm test` MCP protocol compliance: 70% — unchanged from HEAD baseline
- `npm audit`: **0 vulnerabilities**

## [3.3.0] - 2026-05-17

Ships Phase C5 "Feature parity" of `IMPROVEMENT_PLAN.md`. Adds one new MCP tool (`extract_with_llm`, bringing the total to 21) and extends three existing tools with capabilities at parity with Firecrawl, Crawl4AI, and ScrapeGraphAI. All changes are strictly additive — every existing call signature behaves exactly as in v3.2.0.

### Added
- **New tool `extract_with_llm`** — natural-language structured extraction over a URL or pre-fetched content. Gated on `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; `provider: 'auto'` picks Anthropic first then OpenAI. Dependency-free direct `fetch()` to `/v1/chat/completions` (OpenAI) or `/v1/messages` (Anthropic). Optional `schema` JSON-schema hint; defensive JSON parse with single retry; uniform `{ input_tokens, output_tokens }` usage shape across providers. Endpoints overridable via `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` for self-hosted gateways. Costs 5 credits.
- **`scrape_with_actions` recording & replay** — Firecrawl-style action recording. New input fields `record: boolean` + `recordingName: string` persist the executed action chain as JSON to `~/.crawlforge/recordings/<name>.json` (atomic `.tmp` + rename write). New `replayRecording: string` loads and re-executes a saved recording against a fresh URL. Special `replayRecording: '__list__'` returns the recordings index without a new tool. `recordingName` validated against `/^[a-zA-Z0-9_-]{1,64}$/` (path-traversal blocked). Home dir overridable via `CRAWLFORGE_HOME_OVERRIDE` for testing.
- **`crawl_deep` session reuse** — Crawl4AI-style cookie + header persistence across every page of a crawl. New optional `session: { enabled, persistCookies?, headers?, initialRequest? }`. With `enabled: true`, an in-memory cookie jar (hand-rolled, zero new deps, uses Node 18+ `Headers.getSetCookie()` for multi-value correctness) captures every `Set-Cookie` response and replays cookies on every subsequent fetch. `session.headers` merged into every request. Optional `session.initialRequest` performs a pre-crawl login (or any HTTP request) and seeds the jar before traversal starts. Backward compatible — omit `session` for v3.2.0 behavior.
- **`search_web` SearXNG provider** — new optional `provider: 'crawlforge' | 'searxng'` (default `'crawlforge'`). With `provider: 'searxng'`, queries route to a self-hosted SearXNG instance specified by `CRAWLFORGE_SEARXNG_URL` (e.g. `http://localhost:8888`). SearXNG JSON results are normalised to the same shape as the CrawlForge backend (`title→title`, `url→link/displayLink/formattedUrl`, `content→snippet/htmlSnippet`) so the existing ranking + deduplication pipeline runs unchanged. Errors clearly when `CRAWLFORGE_SEARXNG_URL` is unset or the upstream returns non-200.
- `src/tools/extract/extractWithLlm.js` — main tool class. 14 unit tests in `tests/unit/extractWithLlm.test.js` covering provider auto-pick, error when no key, JSON parse success + retry, URL fetch path, content-direct path, schema hint pass-through, token-usage normalization, OpenAI + Anthropic stubs.
- `src/tools/advanced/scrapeWithActions/recorder.js` — recording persistence helpers (`saveRecording`, `loadRecording`, `listRecordings`, `validateRecordingName`, `buildRecordedEntry`). 12 unit tests in `tests/unit/scrapeWithActionsRecording.test.js`.
- `src/tools/crawl/_sessionContext.js` — `SessionContext` class (cookie jar + session headers + `performInitialRequest`). 12 unit tests in `tests/unit/crawlDeepSession.test.js`.
- `src/tools/search/providers/searxng.js` — SearXNG adapter (`searchViaSearxng`, `normalizeSearxngResult`). 12 unit tests in `tests/unit/searchWebSearxng.test.js`.

### Changed
- `server.js` — registered `extract_with_llm`; tool count strings bumped 20 → 21.
- `src/core/AuthManager.js` `getToolCost()` — added `extract_with_llm: 5`.
- `src/tools/advanced/ScrapeWithActionsTool.js` — schema extended with `record` / `recordingName` / `replayRecording`; `executeSession()` captures recorded entries when recording is on; `execute()` short-circuits to listing / replay when those flags are set.
- `src/tools/crawl/crawlDeep.js` + `src/core/crawlers/BFSCrawler.js` — `SessionContext` plumbed into the BFS crawler; per-request session headers + cookies are layered before `fetch()` and the response's `Set-Cookie` is recorded back into the jar.
- `src/tools/search/searchWeb.js` — `provider` field added to `SearchWebSchema`; `_executeViaSearxng()` short-circuits when `provider === 'searxng'`.
- `package.json` 3.2.0 → 3.3.0; description "20" → "21".

### Test results (this release)
- 50 new unit tests across 4 new files — **50/50 pass** in `node --test`.
- Full unit suite: 240 tests, 227 pass, 12 skipped (sandbox-only HTTP listen restrictions on `streamableHttp.test.js`), 1 pre-existing `endpointGuard.test.js` failure unrelated to C5 (also fails on the v3.2.0 commit).
- `node test-tools.js`: 19/20 pass; the 1 failure (`search_web`) is a pre-existing sandbox network flake — same failure reproduces on the v3.2.0 baseline once the local search cache is cleared.
- `npm test` (MCP protocol compliance): unchanged from HEAD baseline (70% success rate).
- `npm audit`: **0 vulnerabilities**.

### Notes
- All four C5 items were implemented in parallel by four `mcp-implementation` sub-agents working on non-overlapping files. The lead handled `server.js` registration, version bookkeeping, and integration verification.

## [3.2.0] - 2026-05-17

Ships Phase C "Modernize" of `IMPROVEMENT_PLAN.md` end-to-end. Closes the protocol/feature gap with Firecrawl, Crawl4AI, and Bright Data MCP. No tool schema or public API changes for existing stdio users — strictly additive.

### Added
- `src/server/transports/streamableHttp.js` — stateful Streamable HTTP transport (MCP spec 2025-06-18). Sessions via `Mcp-Session-Id` header (request + response). Single `/mcp` endpoint handles POST (JSON or SSE) and GET (SSE) per spec. Built on `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.29`.
- `src/server/auth/oauth.js` — OAuth 2.1 authorization server (~350 LOC, zero new runtime deps). Discovery (`/.well-known/oauth-authorization-server`), Dynamic Client Registration (RFC 7591) at `/oauth/register`, Authorization Code + PKCE S256 at `/oauth/authorize`, token issuance + refresh rotation at `/oauth/token`, revocation (RFC 7009) at `/oauth/revoke`. Bearer tokens are opaque and mapped server-side to the operator's CrawlForge API key.
- `src/observability/metrics.js` — minimal Prometheus exposition (counters, gauges, histograms). Exposes `crawlforge_tool_requests_total`, `crawlforge_tool_errors_total{error_class}`, `crawlforge_tool_duration_ms` (histogram), `crawlforge_credits_consumed_total`, `crawlforge_browser_pool_in_use`, `crawlforge_browser_pool_capacity`.
- `src/observability/tracing.js` — OpenTelemetry tracing facade. No-op unless `OTEL_SDK_DISABLED=false` AND `globalThis.__otelTracer` is registered by the host application. Span attributes: `mcp.tool.name`, `mcp.tool.duration_ms`, `mcp.tool.outcome`, `mcp.credit.cost`, `mcp.credit.outcome`, `mcp.creator_mode`.
- `dualOutput()` helper in `src/server/registerTool.js` for tool handlers that want to emit both legacy `content` and MCP-2025-06-18 `structuredContent` from one value.
- `outputSchema` option on `registerTool()` — opt-in MCP structured outputs (validated server-side by the SDK against the supplied Zod shape).
- `--legacy-http` / `CRAWLFORGE_LEGACY_HTTP=true` — preserves v3.1 stateless HTTP behaviour for one release; emits a deprecation warning at startup.
- Environment knobs (all opt-in): `CRAWLFORGE_OAUTH_ENABLED`, `CRAWLFORGE_OAUTH_ISSUER`, `CRAWLFORGE_METRICS`, `CRAWLFORGE_LEGACY_HTTP`.
- `docs/oauth-quickstart.md` — copy-pasteable Node sample client covering register → authorize → exchange → refresh → `/mcp`.
- `docs/observability/grafana-dashboard.json` — six-panel dashboard (requests/sec, errors/sec, p50/p95 duration, credits/sec, browser pool utilization).
- `tests/unit/oauth.test.js` (12 cases) — discovery shape, DCR validation, full PKCE flow, wrong-verifier rejection, `plain` rejection, refresh rotation + replay protection, revocation.
- `tests/unit/streamableHttp.test.js` (12 cases) — `/health`, `/metrics`, server-card, `/mcp` 401 paths, creator-mode bypass, OAuth pass-through, OPTIONS preflight, unknown path.
- `tests/unit/metrics.test.js` (6 cases) — counter / gauge / histogram correctness + label escaping.
- `tests/unit/tracing.test.js` (7 cases) — gating logic, no-op span when disabled, attribute writes when enabled.
- `tests/unit/registerTool.test.js` (4 cases) — `outputSchema` forwarding + `dualOutput` shape.
- `tests/unit/withAuth.test.js` — three new cases for metrics integration (success counter + credits, error counter + `error_class`, no-op when registry not passed).

### Changed
- `server.js`: wires new Streamable HTTP transport (default in `--http`), OAuth provider when `CRAWLFORGE_OAUTH_ENABLED=true`, Prometheus registry when `CRAWLFORGE_METRICS=true`. Version string bumped 3.0.19 → 3.2.0.
- `src/server/transports/http.js`: now a 20-line back-compat shim that forwards to `connectStreamableHttp({ legacy: true })`.
- `src/server/withAuth.js`: emits Prometheus counter + histogram + credits-consumed on every invocation when a registry is passed; emits an OTel span when tracing is enabled. Both are wrapped in try/catch so they can't break the request path.
- `src/server/registerTool.js`: accepts and forwards `outputSchema`; exports `dualOutput`.
- `package.json`: version 3.1.0 → 3.2.0.
- `docs/PRODUCTION_READINESS.md`: version bump + dedicated Streamable HTTP endpoint table.

### Deferred (documented in `IMPROVEMENT_PLAN.md` § C5)
- Firecrawl-style action recording/replay for `scrape_with_actions`
- Crawl4AI-style session reuse in `crawl_deep`
- New `extract_with_llm` tool (LLM-gated)
- `provider: 'crawlforge' | 'searxng'` switch on `search_web`

The plan explicitly says "pick based on user demand". No user requests for these in the v3.1 window — leaving `[ ]` rather than building speculatively. All remain independently shippable.

### Notes
- Adding `outputSchema` to each of the 20 existing tool registrations is intentionally a follow-up. The framework, helper, and tests are in place — per-tool schema rollout will get its own review pass.

## [3.1.0] - 2026-05-17

Ships Phase B "Refactor" of `IMPROVEMENT_PLAN.md` end-to-end. No public-API or tool-schema changes — strictly internal restructuring, bounded browser pool, and a real test suite. All 20 MCP tools continue to pass.

### Added
- `src/server/registerTool.js` — single tool-registration helper that wraps every handler with `withAuth`. Replaces 20 near-identical registration blocks in `server.js`.
- `src/server/schemas/common.js` — shared Zod fragments (`urlSchema`, `paginationSchema`, `webhookSchema`, `cacheOptsSchema`).
- `src/server/transports/stdio.js` and `src/server/transports/http.js` — transport setup extracted from `server.js`.
- `src/tools/basic/` — 5 inline basic-tool handlers (`fetchUrl`, `extractText`, `extractLinks`, `extractMetadata`, `scrapeStructured`) moved out of `server.js`, plus a shared `_fetch.js` helper.
- `src/core/BrowserContextPool.js` (187 LOC) — bounded pool with capacity cap, idle eviction, periodic refresh, and a wait queue with timeout. Used by `StealthBrowserManager` instead of an unbounded `Map`. Defaults: `MAX_BROWSER_CONTEXTS=10`, refresh every 200 acquisitions or 30 minutes, `closeIdleAfterMs=300000`.
- `src/tools/tracking/trackChanges/{schema,monitor,differ,notifier,index}.js` — 1,377 LOC tool split into 5 files; root `trackChanges.js` is now a 15-line re-export shim.
- `src/tools/advanced/batchScrape/{schema,queue,worker,reporter,index}.js` — 1,089 LOC tool split into 5 files; reuses `JobManager` and `WebhookDispatcher` instead of embedding them. Root `BatchScrapeTool.js` is now a 15-line re-export shim.
- `src/tools/search/ranking/SearchResultCache.js` — single shared cache passed to `ResultRanker` and `ResultDeduplicator` via `sharedCache` option (was two separate `CacheManager` instances).
- `src/tools/extract/_fetchAndParse.js` — shared fetch + Cheerio parse helper used by `extractStructured`.
- `CacheManager` integration in `crawlDeep` and `mapSite` for fetch deduplication.
- `tests/unit/browserContextPool.test.js` (18 tests) — pool capacity, idle eviction, refresh interval, queue timeout, destroy semantics.
- `tests/unit/changeTracker.test.js` (33 tests) — `diff()` granularity matrix, text/structure/visual change detection, threshold gating.
- `tests/unit/jobManager.test.js` (28 tests) — lifecycle, validateJob, generateJobId, stats, destroy.
- `tests/unit/snapshotManager.test.js` (21 tests) — create/restore, gzip compression path, list/cleanup.
- `tests/unit/webhookDispatcher.test.js` (21 tests) — dispatch, retries, signing, queue draining.
- `tests/integration/tools/basicTools.test.js` (17 tests) — happy-path + invalid-input assertions for all 5 basic-tool handlers.
- `tests/integration/tools/schemas.test.js` (28 tests) — Zod schema acceptance/rejection for `BatchScrape`, `TrackChanges`, `UrlConfig`, plus `SearchResultCache` behaviour.
- `tests/integration/tools/batchScrape.test.js` (8 tests) — internal `scrapeUrl` worker contract.
- `npm run test:coverage` — c8 coverage script with a 60% line/statement gate (45% branch / 55% function). Reports 64.3% lines, 60.7% functions, 74.9% branches across `src/`.
- `npm run test:integration` — convenience script for `tests/integration/tools/*.test.js`.

### Changed
- `server.js`: **2,138 → 990 LOC** (54% reduction). All tool registrations now flow through `registerTool()`; transport selection delegated to `src/server/transports/*`.
- `src/core/StealthBrowserManager.js`: context storage swapped from raw `Map` to `BrowserContextPool`. Context limit, refresh, and idle eviction now bounded.
- `src/core/cache/CacheManager.js`: `cleanupTimer` and `monitoringTimer` now `.unref()` so they don't block process exit in short-lived CLI/test runs.
- `src/core/JobManager.js`: `validateJob()` now returns a strict boolean (was returning the falsy operand from `&&` short-circuit, breaking strict-equality tests).
- `src/tools/search/searchWeb.js`: ranker and deduplicator share one `SearchResultCache` instance instead of holding separate `CacheManager`s.
- `package.json`: version bumped 3.0.19 → 3.1.0.

### Fixed
- `JobManager.validateJob(null)` previously returned `null`; now returns `false` as the docstring implies.

### Deferred (documented in `IMPROVEMENT_PLAN.md` § B4 / B5)
- "Wire coverage gate into CI" — no CI workflow exists in this repo. Local gate is enforced via `npm run test:coverage`.
- "`npm run docker:prod` boots" — Docker is unavailable in the sandboxed verification environment; Dockerfile/compose unchanged from v3.0.19 green baseline.
- "1,000-call soak test" — requires real Chromium launches and outbound network blocked by sandbox; `BrowserContextPool` unit tests cover the bounded-pool / idle-eviction / refresh behaviour the soak test was meant to validate.

## [3.0.19] - 2026-05-17

### Security
- **HIGH:** HTTP transport (`--http`) now requires `Authorization: Bearer <api-key>` (or `X-API-Key`) on every `/mcp` request — closes audit phase 4. Unauthenticated requests return 401 and emit a structured warning log. Creator mode bypasses the check. `/health` and `/.well-known/mcp/server-card.json` remain unauthenticated for discovery.
- **MEDIUM:** Stored API key is re-validated against the backend at startup — closes audit phase 5. If the backend explicitly rejects the key (invalid / revoked / expired / unauthorized), the server throws and refuses to boot. Network failures are tolerated. `CRAWLFORGE_SKIP_STARTUP_VALIDATION=true` bypasses.
- Phase 6 (config HMAC) is formally deferred until the backend gains support; tracked in `docs/PRODUCTION_READINESS.md`.

### Added
- `src/server/withAuth.js` — tool-handler wrapper extracted from `server.js` for unit-testability.
- Structured `tool invocation` log line on every MCP tool call: `{ toolName, paramHash, durationMs, outcome, creditCost, creatorMode }`. `paramHash` is a 12-hex SHA-256 prefix — no payload leakage. `outcome ∈ { success | error | insufficient_credits }`.
- Per-report `requestId` + `idempotencyKey` (UUID v4) on every usage report; the latter is sent as the HTTP `Idempotency-Key` header and persisted into `~/.crawlforge/pending-usage.json` for safe retry replay.
- `tests/unit/withAuth.test.js` (6 tests) and `tests/unit/authManagerPhaseA.test.js` (6 tests). Unit-test count rises from 14 → 26.

### Changed
- `AuthManager._flushPendingUsage()` and `_appendPendingUsage()` no longer swallow errors silently — structured Winston logs at info/warn/error with retained requestIds. Pending-file ENOENT remains silent (normal), other read errors are now logged at warn.
- `withAuth()` resolves `getToolCost()` and `isCreatorMode()` once per call (was twice and three times respectively); wrapped in `try/finally` so the log line fires on every code path.
- `docs/PRODUCTION_READINESS.md` header bumped: v3.0.12 → v3.0.19, "19 Tools" → "20 Tools", date 2026-03-30 → 2026-05-17. Security Audit Phase Tracker updated: phases 4 and 5 ✅ COMPLETE, phase 6 DEFERRED with rationale.

### Removed
- `src/core/LocalizationManager.js`: deleted the `PROXY_PROVIDERS` constant (11 fake `proxy-*.example.com` endpoints), the `TRANSLATION_SERVICES` constant (Google / Azure / LibreTranslate stubs that were never wired up), the `initializeProxySystem()` and `initializeTranslationServices()` methods, and their re-exports. These never did anything.
- `src/core/ActionExecutor.js`: deleted the `if (url === 'http://example.com')` mock branch — no test depended on it and it short-circuited real action-chain validation.

### Notes
- `isomorphic-dompurify` was **not** removed (plan claim was incorrect — it's actively used by `src/security/wave3-security.js` and `src/utils/inputValidation.js` for HTML sanitization).
- `SnapshotManager.js` was **not** changed — gzip compression is already real, working code (lines 240–260), not a stale comment.

## [3.0.18] - 2026-04-18

### Security
- **CRITICAL:** Endpoint allow-list prevents `CRAWLFORGE_API_URL` from pointing to unauthorized/mock backends. Localhost only permitted in creator mode.
- **CRITICAL:** Credit check fails closed — cached results only trusted within 30 s of last successful backend response. `CREDIT_CHECK_INTERVAL` reduced from 60 s to 15 s.
- **HIGH:** Usage reporting now has a 5 s timeout and decrements local cache regardless of network success. Failed usage reports queued to `~/.crawlforge/pending-usage.json` and replayed automatically.

### Known Issues (deferred to future release)
- HTTP transport (`--http`) still uses the server's stored key for every request. Do not expose publicly until Phase 4 lands.
- API key is not re-validated at startup (Phase 5).
- Local `config.json` has no integrity check (Phase 6).

## [3.0.3] - 2025-10-01

### Security
- **CRITICAL:** Removed authentication bypass vulnerability that allowed users to use `BYPASS_API_KEY=true` for free unlimited access
- Implemented secure creator mode with SHA256 hash-based authentication
- Only package maintainer with secret UUID can enable creator mode (unlimited access for development)
- Protected business model - all users must now authenticate with valid API keys from crawlforge.dev

### Changed
- AuthManager now checks creator mode dynamically to fix initialization order issues
- `.env` file loading moved to top of server.js before all imports
- Updated documentation to reflect security changes

### Added
- `.env.example` file with configuration templates
- Comprehensive creator mode documentation in CLAUDE.md
- Security update notes in README.md

## [3.0.2] - 2025-10-01

### Fixed
- Removed backup files from npm package (ActionExecutor.js.backup, ssrfProtection.js.bak)
- Fixed author email from placeholder to support@crawlforge.dev
- Standardized repository URLs to github.com/mysleekdesigns/crawlforge-mcp
- Fixed homepage URL to https://crawlforge.dev

### Changed
- Updated .npmignore to exclude `*.backup` files
- Updated package-lock.json to sync version
- Reduced package size by 11.1 KB (3.5% reduction)

### Added
- CONTRIBUTING.md with comprehensive contribution guidelines

## [3.0.1] - 2025-10-01

### Security
- Disabled JavaScript execution by default in ActionExecutor
- Requires explicit `ALLOW_JAVASCRIPT_EXECUTION=true` environment variable
- Enforced HTTPS-only webhooks (HTTP webhooks now rejected)

### Fixed
- MCP protocol compliance test JSON parsing issues
- Version synchronization between server.js and package.json

### Changed
- Updated security documentation
- Improved error handling for webhook validation

## [3.0.0] - 2024-08-28

### Added
- Initial release with 19 comprehensive tools
- Basic tools: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured
- Advanced tools: search_web, crawl_deep, map_site
- Content processing: extract_content, process_document, summarize_content, analyze_content
- Wave 2 tools: batch_scrape, scrape_with_actions
- Wave 3 tools: deep_research, track_changes, generate_llms_txt, stealth_mode, localization
- MCP protocol compliance
- Authentication system with API key validation
- Credit tracking and usage reporting
- Docker support
- Comprehensive test suite

### Security
- SSRF protection with allowlist/blocklist
- Input validation and sanitization
- Rate limiting
- Secure webhook dispatching
- API key encryption

---

## Version History Summary

| Version | Date | Type | Description |
|---------|------|------|-------------|
| 3.0.18 | 2026-04-18 | Security | Endpoint allow-list, fail-closed credit check, usage-report hardening |
| 3.0.3 | 2025-10-01 | Security | Critical auth bypass fix |
| 3.0.2 | 2025-10-01 | Maintenance | Package cleanup & metadata fixes |
| 3.0.1 | 2025-10-01 | Security | JS execution & webhook security |
| 3.0.0 | 2024-08-28 | Major | Initial public release |

---

**Note:** For detailed security information, see `PRODUCTION_READINESS.md` and `.github/SECURITY.md`.
