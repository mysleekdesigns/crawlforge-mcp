/**
 * TemplateRegistry — pre-built scraping templates for popular sites (D3.3).
 *
 * Each template is a self-contained object with:
 *   id            — unique slug used as the `template` parameter
 *   name          — human-readable name
 *   description   — when to use this template
 *   targetPattern — regex matching URLs this template handles
 *   selectors     — CSS selectors mapping field names to DOM locations
 *   postProcess   — optional function(raw: Object) → Object for cleanup
 *
 * Templates do NOT make network calls.  The ScrapeTemplateTool fetches the
 * page and passes the parsed HTML to the template's extract() method.
 *
 * Two optional hooks let a template read a machine-readable endpoint instead of
 * scraping the rendered page, without taking the fetch into its own hands:
 *   resolveUrl(url)      — rewrite the URL the tool should fetch
 *   extractRaw(body,url) — parse the response itself, instead of extract($)
 */

import { load } from 'cheerio';

// ── Helpers ──────────────────────────────────────────────────────────────────

function text($, sel) {
  return $(sel).first().text().trim() || null;
}

function attr($, sel, attribute) {
  return $(sel).first().attr(attribute) || null;
}

function list($, sel) {
  return $(sel).map((_, el) => $(el).text().trim()).get().filter(Boolean);
}

function listAttr($, sel, attribute) {
  return $(sel).map((_, el) => $(el).attr(attribute)).get().filter(Boolean);
}

// ── Shopify helpers ──────────────────────────────────────────────────────────

/** Shopify writes an absent compare-at price as "" rather than omitting it. */
function money(value) {
  return value === '' || value === null || value === undefined ? null : String(value);
}

/**
 * A compare-at price of 0 means "unset", not "was free" — Allbirds ships
 * "0.00" where Death Wish ships "". Both render as no sale badge, so both read
 * as null here. Only compare-at prices are zero-normalised: a `price` of 0.00
 * is a genuinely free product.
 */
function compareAtPrice(value) {
  const raw = money(value);
  return raw !== null && Number.parseFloat(raw) === 0 ? null : raw;
}

/**
 * Whether a variant can be bought.
 *
 * The product JSON endpoint does not carry the storefront's `available` flag,
 * so it is derived: an untracked variant is always sellable, a variant whose
 * policy allows overselling is always sellable, and otherwise it comes down to
 * stock on hand. Returns null when the payload does not say — better than
 * guessing "in stock" for something sold out.
 */
function variantAvailable(variant) {
  if (typeof variant.available === 'boolean') return variant.available;
  if (!variant.inventory_management) return true;
  if (variant.inventory_policy === 'continue') return true;
  return typeof variant.inventory_quantity === 'number' ? variant.inventory_quantity > 0 : null;
}

/** Shopify returns tags as an array on some stores and a comma-joined string on others. */
function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

/** body_html is a rendered HTML fragment; callers want the copy, not the markup. */
function htmlToText(html) {
  if (!html) return null;
  const text = load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
  return text || null;
}

// ── Amazon helpers ───────────────────────────────────────────────────────────

/** Amazon's server-side templates leave runs of whitespace and newlines inline. */
function tidy(value) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

/**
 * The byline slot holds three different things: "Brand: Amazon" on a
 * first-party device, "Visit the Apple Store" on a branded storefront, and
 * "by Jonathan Haidt (Author) Format: Hardcover" on a book. Each states the
 * same fact wrapped in different chrome.
 */
function amazonByline($) {
  const contributor = tidy($('#bylineInfo .contributorNameID').first().text());
  const raw = tidy($('#bylineInfo').first().text());
  if (!raw) return null;

  const branded = raw.match(/^Brand:\s*(.+)$/i) || raw.match(/^Visit the (.+?) Store$/i);
  if (branded) return tidy(branded[1]);

  // Books: the contributor link is the name on its own; the surrounding text
  // continues into "(Author) Format: Hardcover".
  if (/^by\s/i.test(raw)) return contributor || tidy(raw.replace(/^by\s+/i, '').split('(')[0]);

  return raw;
}

/** "4.7 out of 5 stars" → 4.7 */
function amazonRating(value) {
  const match = tidy(value)?.match(/([\d.]+)/);
  return match ? Number.parseFloat(match[1]) : null;
}

/** Both "(198,594)" and "198,594 global ratings" mean 198594. */
function amazonCount(value) {
  const digits = tidy(value)?.replace(/[^\d]/g, '');
  return digits ? Number.parseInt(digits, 10) : null;
}

/**
 * Amazon serves every size of an image from one object, with the size encoded
 * in the filename: ..._AC_SR40,60_.jpg is the 40x60 thumbnail of ....jpg.
 * Dropping the token yields the original (verified 2026-08-25: the thumbnail
 * is 1KB, the same URL without the token is 16KB).
 */
function fullSizeImage(src) {
  if (!src) return null;
  // The alt-image strip is padded with a transparent spacer gif, and the page
  // chrome is served from the shared /x-locale/common/ sprite directory.
  if (/transparent-pixel|\/x-locale\/common\//.test(src)) return null;
  return src.replace(/\._[^/]*_\.(jpe?g|png|gif)$/i, ".$1");
}

// ── Template definitions ─────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'shopify-product',
    name: 'Shopify Product',
    description:
      'Read a Shopify product from the store\'s own /products/<handle>.json endpoint: exact price, ' +
      'compare-at price, per-variant stock, options and images. Works on any Shopify storefront, ' +
      'including custom domains. No HTML parsing and no LLM, so prices cannot be misread or invented.',
    // Shopify runs on millions of custom domains, so the product URL shape is
    // the only reliable signal. Non-Shopify sites using /products/ URLs are
    // rejected by extractRaw rather than silently returning nonsense.
    targetPattern: /\/products\/[^/?#]+/i,

    /** Point the fetch at the JSON endpoint for the same product. */
    resolveUrl(url) {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^(.*\/products\/[^/]+?)(?:\.json)?\/?$/i);
      if (!match) return url;
      parsed.pathname = `${match[1]}.json`;
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    },

    extractRaw(body, url) {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error(
          `Not a Shopify product endpoint: ${url} did not return JSON. ` +
          'This template only works on Shopify storefronts.'
        );
      }

      const product = payload?.product;
      if (!product || !Array.isArray(product.variants)) {
        throw new Error(
          `Not a Shopify product endpoint: ${url} returned JSON without a product. ` +
          'This template only works on Shopify storefronts.'
        );
      }

      const variants = product.variants.map(v => ({
        id: v.id,
        title: v.title,
        price: money(v.price),
        compare_at_price: compareAtPrice(v.compare_at_price),
        sku: v.sku || null,
        available: variantAvailable(v),
        inventory_quantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : null,
        options: [v.option1, v.option2, v.option3].filter(Boolean)
      }));

      const prices = variants.map(v => Number.parseFloat(v.price)).filter(Number.isFinite);
      const first = variants[0] || {};
      const availability = variants.map(v => v.available);

      return {
        title: product.title || null,
        vendor: product.vendor || null,
        product_type: product.product_type || null,
        handle: product.handle || null,
        product_id: product.id ?? null,

        // Headline price is the first variant's, matching what the product page
        // shows before a selection is made.
        price: first.price ?? null,
        compare_at_price: first.compare_at_price ?? null,
        // A compare-at price above the price is what renders as a sale badge.
        on_sale: first.compare_at_price !== null && first.compare_at_price !== undefined
          ? Number.parseFloat(first.compare_at_price) > Number.parseFloat(first.price)
          : false,
        currency: product.variants[0]?.price_currency || null,
        price_min: prices.length ? String(Math.min(...prices).toFixed(2)) : null,
        price_max: prices.length ? String(Math.max(...prices).toFixed(2)) : null,

        available: availability.some(a => a === true) ? true
          : availability.every(a => a === false) ? false
          : null,
        variants,
        options: (product.options || []).map(o => o.name),

        description: htmlToText(product.body_html),
        tags: normalizeTags(product.tags),
        images: (product.images || []).map(i => i.src),
        published_at: product.published_at || null,
        updated_at: product.updated_at || null
      };
    }
  },

  {
    id: 'amazon-product',
    name: 'Amazon Product',
    description: 'Scrape an Amazon product page for title, price, rating, reviews, ASIN, and description.',
    targetPattern: /amazon\.(com|co\.uk|de|fr|jp|ca|com\.au)/i,
    extract($) {
      const bullets = $('#feature-bullets ul li span.a-list-item')
        .map((_, el) => tidy($(el).text()))
        .get()
        .filter(Boolean);
      const images = [attr($, '#landingImage', 'src'), ...listAttr($, '#altImages img', 'src')]
        .map(fullSizeImage)
        .filter(Boolean);

      return {
        title: tidy(text($, '#productTitle')),
        price: text($, '.a-price .a-offscreen') || text($, '#priceblock_ourprice') || text($, '#priceblock_dealprice'),
        // Amazon ships no priceCurrency meta tag — the ISO code is a hidden
        // field on the add-to-cart form.
        currency: attr($, 'input[name*="currencyCode"]', 'value') || attr($, 'meta[itemprop="priceCurrency"]', 'content'),
        rating: amazonRating(attr($, '#acrPopover', 'title') || text($, '#averageCustomerReviews .a-icon-alt')),
        review_count: amazonCount(text($, '#acrCustomerReviewText') || text($, '[data-hook="total-review-count"]')),
        asin: text($, 'input#ASIN') || attr($, 'input[name="ASIN"]', 'value'),
        brand: amazonByline($),
        // Device pages leave #productDescription empty and put the copy in the
        // bullet list; books use neither and have their own container.
        description:
          tidy(text($, '#productDescription')) ||
          (bullets.length ? bullets.join(' ') : null) ||
          tidy(text($, '#bookDescription_feature_div .a-expander-content')) ||
          tidy(text($, '#feature-bullets')),
        images: [...new Set(images)].slice(0, 8),
        availability: tidy(text($, '#availability span')),
        // Only category pages (books, media) carry breadcrumbs; device pages
        // genuinely have none, so [] here is a fact about the page.
        category_breadcrumb: list($, '#wayfinding-breadcrumbs_feature_div a')
      };
    }
  },

  {
    id: 'linkedin-profile',
    name: 'LinkedIn Profile',
    description: 'Scrape a LinkedIn public profile for name, headline, location, and about section.',
    targetPattern: /linkedin\.com\/in\//i,
    extract($) {
      return {
        name: text($, 'h1') || text($, '.top-card-layout__title'),
        headline: text($, '.top-card-layout__headline') || text($, 'h2'),
        location: text($, '.top-card-layout__first-subline') || text($, '.profile-info-subheader'),
        about: text($, '.core-section-container__content p') || text($, '.summary'),
        connections: text($, '.top-card__connections'),
        current_company: text($, '.top-card-layout__card-inner-full-width .top-card-link'),
        note: 'LinkedIn requires authentication for full profiles. This template works on public profile pages only.'
      };
    }
  },

  {
    id: 'github-repo',
    name: 'GitHub Repository',
    description: 'Scrape a GitHub repository page for stars, forks, description, language, topics, and README summary.',
    targetPattern: /github\.com\/[^/]+\/[^/]+\/?$/i,
    extract($) {
      return {
        name: text($, 'strong[itemprop="name"] a') || text($, '.repository-content h1'),
        description: attr($, 'meta[property="og:description"]', 'content') || text($, 'p.f4.my-3'),
        stars: text($, '#repo-stars-counter-star') || text($, '[aria-label*="stargazers"]'),
        forks: text($, '#repo-network-counter') || text($, '[aria-label*="forks"]'),
        // React (logged-out) layout has no watchers aria-label; the count is
        // the <strong> right after the single octicon-eye. Language is a
        // client-side skeleton on that layout — unrecoverable from static
        // HTML, so it stays null there (itemprop still works on classic).
        watchers: text($, '.octicon-eye + strong') || text($, '[aria-label*="watchers"]'),
        language: text($, 'span[itemprop="programmingLanguage"]') || text($, '.d-inline-flex[class*="language"]'),
        topics: list($, 'a.topic-tag, a[href^="/topics/"]'),
        license: text($, 'a[href*="blob/"][href*="LICENSE"]') || text($, '.octicon-law ~ span'),
        last_updated: attr($, 'relative-time', 'datetime'),
        homepage: attr($, 'a[href][rel="noopener noreferrer"]', 'href'),
        open_issues: text($, '.Counter[aria-label*="issue"]')
      };
    }
  },

  {
    id: 'youtube-video',
    name: 'YouTube Video',
    description: 'Scrape a YouTube video page for title, channel, views, likes, publish date, and description.',
    targetPattern: /youtube\.com\/watch/i,
    extract($) {
      return {
        title: attr($, 'meta[name="title"]', 'content') || attr($, 'meta[property="og:title"]', 'content'),
        channel: attr($, 'link[itemprop="name"]', 'content') || text($, '#channel-name'),
        channel_url: attr($, 'span[itemprop="author"] link[itemprop="url"]', 'href'),
        views: attr($, 'meta[itemprop="interactionCount"]', 'content'),
        published: attr($, 'meta[itemprop="uploadDate"]', 'content') || attr($, 'meta[itemprop="datePublished"]', 'content'),
        description: attr($, 'meta[property="og:description"]', 'content'),
        thumbnail: attr($, 'meta[property="og:image"]', 'content'),
        duration: attr($, 'meta[itemprop="duration"]', 'content'),
        video_id: (() => {
          try {
            return new URL($('link[rel="canonical"]').attr('href') || 'https://youtube.com').searchParams.get('v');
          } catch {
            return null;
          }
        })()
      };
    }
  },

  {
    id: 'tweet',
    name: 'Tweet / X Post',
    description: 'Scrape a tweet/X post for text, author, timestamp, likes, and retweets from the Open Graph / structured data.',
    targetPattern: /(twitter|x)\.com\/[^/]+\/status\//i,
    extract($) {
      return {
        text: attr($, 'meta[property="og:description"]', 'content'),
        author: attr($, 'meta[property="og:title"]', 'content'),
        url: attr($, 'meta[property="og:url"]', 'content') || attr($, 'link[rel="canonical"]', 'href'),
        image: attr($, 'meta[property="og:image"]', 'content'),
        note: 'X.com requires JavaScript rendering for full tweet data. Structured metadata is returned from static HTML.'
      };
    }
  },

  {
    id: 'reddit-thread',
    name: 'Reddit Thread',
    description: 'Scrape a Reddit thread for title, subreddit, score, comment count, author, and top-level comments.',
    targetPattern: /reddit\.com\/r\/[^/]+\/comments\//i,
    extract($) {
      return {
        title: attr($, 'meta[property="og:title"]', 'content') || text($, 'h1'),
        subreddit: text($, 'a[href*="/r/"][class*="subreddit"]') || (($('title').text().match(/r\/([^•]+)/) || [])[1] || '').trim(),
        score: text($, '[data-score]') || attr($, '[itemprop="upvoteCount"]', 'content'),
        author: text($, 'a[href*="/user/"]'),
        posted: attr($, 'time[datetime]', 'datetime'),
        body: text($, 'div[data-click-id="text"] p') || attr($, 'meta[property="og:description"]', 'content'),
        url: attr($, 'meta[property="og:url"]', 'content'),
        flair: text($, '[class*="flair"]')
      };
    }
  },

  {
    id: 'hacker-news-front-page',
    name: 'Hacker News Front Page',
    description: 'Scrape the Hacker News front page for a list of stories with title, URL, score, and comment count.',
    targetPattern: /news\.ycombinator\.com(\/news)?$/i,
    extract($) {
      const stories = [];
      $('tr.athing').each((_, el) => {
        const $row = $(el);
        // The metadata row (".subtext") is the sibling row immediately after tr.athing.
        const $subtext = $row.next('tr').find('.subtext');
        const $score = $subtext.find('.score');
        const $titleLink = $row.find('.titleline > a');
        stories.push({
          id: $row.attr('id'),
          title: $titleLink.text().trim(),
          url: $titleLink.attr('href'),
          site: $row.find('.sitebit a').text().trim() || null,
          score: $score.text().replace(' points', '').trim() || null,
          author: $subtext.find('.hnuser').text().trim() || null,
          // ".age a" wraps the relative age string ("3 hours ago"); its href is the item permalink.
          posted: $subtext.find('.age a').text().trim() || null,
          // The comments link is also an item?id= link, so exclude the age anchor.
          // Job posts have no comments link at all -> null.
          comments: $subtext.find('a[href*="item"]').not('.age a').last().text().trim() || null
        });
      });
      return { stories: stories.slice(0, 30), scraped_at: new Date().toISOString() };
    }
  },

  {
    id: 'producthunt-launch',
    name: 'Product Hunt Launch',
    description: 'Scrape a Product Hunt product page for name, tagline, vote count, topics, and maker details.',
    targetPattern: /producthunt\.com\/posts\//i,
    extract($) {
      return {
        name: attr($, 'meta[property="og:title"]', 'content'),
        tagline: attr($, 'meta[property="og:description"]', 'content'),
        image: attr($, 'meta[property="og:image"]', 'content'),
        url: attr($, 'meta[property="og:url"]', 'content'),
        votes: text($, '[data-test="vote-button"] span') || text($, 'button[data-vote-button]'),
        topics: list($, 'a[href*="/topics/"]'),
        website: attr($, 'a[data-test="product-link"]', 'href') || attr($, 'a[href][rel="noopener"][target="_blank"]', 'href')
      };
    }
  },

  {
    id: 'stackoverflow-question',
    name: 'Stack Overflow Question',
    description: 'Scrape a Stack Overflow question for title, body, votes, tags, answers, and accepted answer.',
    targetPattern: /stackoverflow\.com\/questions\//i,
    extract($) {
      const answers = [];
      $('.answer').each((_, el) => {
        const $a = $(el);
        answers.push({
          votes: $a.find('[itemprop="upvoteCount"]').attr('content') || $a.find('.js-vote-count').text().trim(),
          accepted: $a.hasClass('accepted-answer'),
          body: $a.find('.s-prose').first().text().trim().slice(0, 500)
        });
      });

      return {
        title: text($, '#question-header h1'),
        body: text($, '.question .s-prose'),
        votes: text($, '.question .js-vote-count') || attr($, '.question [itemprop="upvoteCount"]', 'content'),
        views: text($, '.js-view-count') || attr($, 'meta[name="twitter:data1"]', 'content'),
        tags: list($, '.post-tag'),
        author: text($, '.question .user-details a'),
        asked: attr($, '.question time', 'datetime'),
        answers: answers.slice(0, 5),
        answered: $('div.accepted-answer').length > 0
      };
    }
  },

  {
    id: 'npm-package',
    name: 'npm Package',
    description: 'Scrape an npm package page for name, version, description, weekly downloads, license, and dependencies.',
    targetPattern: /npmjs\.com\/package\//i,
    extract($) {
      const scripts = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try { scripts.push(JSON.parse($(el).html())); } catch {}
      });
      const ld = scripts[0] || {};

      return {
        name: text($, 'h1') || ld.name,
        version: text($, 'h3[data-testid="package-version-number"]') || text($, '[class*="version"]'),
        description: attr($, 'meta[name="description"]', 'content') || text($, 'p[class*="description"]'),
        license: text($, 'span[class*="license"]') || text($, '[data-cy="license"]') || ld.license,
        weekly_downloads: text($, 'span[class*="weekly-downloads"]') || text($, '[data-cy="downloads"]'),
        install_command: `npm install ${ld.name || text($, 'h1') || ''}`.trim(),
        homepage: attr($, 'a[href][class*="homepage"]', 'href'),
        repository: attr($, 'a[href*="github.com"]', 'href'),
        maintainers: list($, 'a[href*="/~"]')
      };
    }
  }
];

// ── Registry ─────────────────────────────────────────────────────────────────

export class TemplateRegistry {
  constructor() {
    this._templates = new Map(TEMPLATES.map(t => [t.id, t]));
  }

  /**
   * List all registered template IDs and names.
   * @returns {{ id: string, name: string, description: string }[]}
   */
  list() {
    return TEMPLATES.map(({ id, name, description, targetPattern }) => ({
      id, name, description,
      targetPattern: targetPattern.toString()
    }));
  }

  /**
   * Look up a template by ID.
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    return this._templates.get(id);
  }

  /**
   * Run a template against a fetched response body.
   * @param {string} id     — template ID
   * @param {string} body   — response body (HTML, or JSON for extractRaw templates)
   * @param {string} url    — original URL (for context)
   * @param {string} [fetchedUrl] — URL actually fetched, when resolveUrl rewrote it
   * @returns {{ template: string, url: string, data: object, extractedAt: string }}
   */
  async run(id, body, url, fetchedUrl = url) {
    const template = this.get(id);
    if (!template) {
      throw new Error(`Unknown template: "${id}". Available: ${TEMPLATES.map(t => t.id).join(', ')}`);
    }

    const data = template.extractRaw
      ? template.extractRaw(body, url)
      : template.extract(load(body));

    return {
      template: id,
      template_name: template.name,
      url,
      ...(fetchedUrl !== url ? { fetchedUrl } : {}),
      data,
      extractedAt: new Date().toISOString()
    };
  }
}

export default TemplateRegistry;
