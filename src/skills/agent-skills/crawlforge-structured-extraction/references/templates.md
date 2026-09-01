# scrape_template — Site Templates

Pre-built extractors for well-known sites. Call
`scrape_template({ template: "list" })` (or CLI `crawlforge template --list`)
to enumerate at runtime. Cost: 1 credit per call.

| Template ID | Target | Typical fields returned |
|-------------|--------|-------------------------|
| `shopify-product` | Any Shopify storefront product page (`/products/<handle>`), custom domains included | title, price, compare-at price, on_sale, currency, price range, per-variant stock, options, images, tags — read from the store's `/products/<handle>.json`, not the rendered page |
| `amazon-product` | Amazon product page (`/dp/...`) | title, price, currency, rating (number), review count (number), brand, ASIN, availability, full-size images, description, breadcrumbs. Breadcrumbs are empty on device pages, which genuinely have none |
| `github-repo` | GitHub repository | name, owner, description, stars, forks, language, topics, README excerpt |
| `youtube-video` | YouTube watch page | title, channel, views, likes, published date, description |
| `reddit-thread` | Reddit post (read from the Arctic Shift archive, not reddit.com, which blocks plain fetchers) | id, title, subreddit, author, score, upvote_ratio, num_comments, posted, body, link_url, flair, removed. Pass `id` to `reddit_search` with `mode:"thread"` for the comment tree |
| `hacker-news-front-page` | HN front page | ranked stories: title, URL, points, author, comment count |
| `producthunt-launch` | Product Hunt product page (`/products/...`; old `/posts/...` links redirect there) | name, tagline, description, topics, website, followers, reviews_count, reviews_rating. The /products layout has no product-level vote count — followers and reviews are its engagement numbers |
| `stackoverflow-question` | Stack Overflow question (read from the keyless Stack Exchange API, not the page) | title, body, votes, views, tags, author, asked, answered, accepted_answer_id, answer_count, top 5 answers (accepted first: votes, author, posted, body) |
| `npm-package` | npm package page | name, version, description, weekly downloads, license, repo link |

**Retired (2026-08-30):** `linkedin-profile` and `tweet`. LinkedIn's robots.txt
disallows every path for all agents but its own crawler and profiles sit behind
an auth wall; X's robots.txt disallows every path for generic agents and its
keyless embed endpoints are disallowed by their own robots.txt. Naming either
returns the reason and fetches nothing. For X or LinkedIn data, use the
platform's own API with the user's credentials.

## Usage

```json
{ "tool": "scrape_template", "params": { "template": "amazon-product", "url": "https://amazon.com/dp/B0XXXXX" } }
```

Parameters:

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `template` | string | — | A template ID above, or `list`. |
| `url` | string (URL) | — | Required unless `template` is `list`. |
| `timeout` | number | `15000` | 5000–60000 ms. |

## When a template does not exist for the site

Fall back, cheapest first:
1. `scrape_structured` with your own CSS selectors (cost 2).
2. `extract_structured` with a JSON schema (cost 3, LLM with CSS fallback).
3. `extract_with_llm` with a natural-language prompt (cost 3).
