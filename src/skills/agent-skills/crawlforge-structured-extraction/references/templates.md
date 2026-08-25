# scrape_template — Site Templates

Pre-built extractors for well-known sites. Call
`scrape_template({ template: "list" })` (or CLI `crawlforge template --list`)
to enumerate at runtime. Cost: 1 credit per call.

| Template ID | Target | Typical fields returned |
|-------------|--------|-------------------------|
| `shopify-product` | Any Shopify storefront product page (`/products/<handle>`), custom domains included | title, price, compare-at price, on_sale, currency, price range, per-variant stock, options, images, tags — read from the store's `/products/<handle>.json`, not the rendered page |
| `amazon-product` | Amazon product page (`/dp/...`) | title, price, currency, rating (number), review count (number), brand, ASIN, availability, full-size images, description, breadcrumbs. Breadcrumbs are empty on device pages, which genuinely have none |
| `linkedin-profile` | LinkedIn public profile | name, headline, location, current role, about, experience |
| `github-repo` | GitHub repository | name, owner, description, stars, forks, language, topics, README excerpt |
| `youtube-video` | YouTube watch page | title, channel, views, likes, published date, description |
| `tweet` | A single tweet/X post | author, handle, text, timestamp, likes, reposts |
| `reddit-thread` | Reddit thread | title, subreddit, author, score, top comments |
| `hacker-news-front-page` | HN front page | ranked stories: title, URL, points, author, comment count |
| `producthunt-launch` | Product Hunt launch | name, tagline, upvotes, maker, description |
| `stackoverflow-question` | Stack Overflow question | title, tags, votes, question body, accepted answer |
| `npm-package` | npm package page | name, version, description, weekly downloads, license, repo link |

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
