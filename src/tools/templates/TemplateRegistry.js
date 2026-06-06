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

// ── Template definitions ─────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'amazon-product',
    name: 'Amazon Product',
    description: 'Scrape an Amazon product page for title, price, rating, reviews, ASIN, and description.',
    targetPattern: /amazon\.(com|co\.uk|de|fr|jp|ca|com\.au)/i,
    extract($) {
      return {
        title: text($, '#productTitle'),
        price: text($, '.a-price .a-offscreen') || text($, '#priceblock_ourprice') || text($, '#priceblock_dealprice'),
        currency: attr($, 'meta[itemprop="priceCurrency"]', 'content'),
        rating: text($, '#acrPopover .a-size-base'),
        review_count: text($, '#acrCustomerReviewText'),
        asin: text($, 'input#ASIN') || attr($, 'input[name="ASIN"]', 'value'),
        brand: text($, '#bylineInfo'),
        description: text($, '#productDescription p') || text($, '#feature-bullets'),
        images: listAttr($, '#altImages img.a-thumbnail-image', 'src').slice(0, 8),
        availability: text($, '#availability span'),
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
        watchers: text($, '[aria-label*="watchers"]'),
        language: text($, 'span[itemprop="programmingLanguage"]') || text($, '.d-inline-flex[class*="language"]'),
        topics: list($, 'a.topic-tag'),
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
        video_id: new URL($('link[rel="canonical"]').attr('href') || 'https://youtube.com').searchParams.get('v')
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
          posted: $subtext.find('.age a').attr('href') || null,
          comments: $subtext.find('a[href*="item"]').last().text().trim() || null
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
   * Run a template against raw HTML.
   * @param {string} id     — template ID
   * @param {string} html   — raw HTML of the target page
   * @param {string} url    — original URL (for context)
   * @returns {{ template: string, url: string, data: object, extractedAt: string }}
   */
  async run(id, html, url) {
    const template = this.get(id);
    if (!template) {
      throw new Error(`Unknown template: "${id}". Available: ${TEMPLATES.map(t => t.id).join(', ')}`);
    }

    const $ = load(html);
    const data = template.extract($);

    return {
      template: id,
      template_name: template.name,
      url,
      data,
      extractedAt: new Date().toISOString()
    };
  }
}

export default TemplateRegistry;
