/**
 * Unit tests: scrape_template (real modules — the extractors now live in the
 * shared crawlforge-extractors package, which both this server and the REST
 * API run; the per-template unit tests live there too. What is covered here
 * is the tool around them
 * and src/tools/templates/ScrapeTemplateTool.js)
 * Run: node --test tests/unit/tools/templates/scrapeTemplate.test.js
 *
 * TemplateRegistry.run(id, body, url) takes a raw response body directly (no
 * network), so the table-driven suite below exercises every page-scraping
 * template extractor against representative fixtures with no stubbing. Most bodies are
 * HTML; shopify-product reads the store's product JSON endpoint instead, so its
 * fixture is a JSON string. ScrapeTemplateTool
 * wraps the registry with a safeFetch (SSRF-guarded) network call, tested
 * separately against a local HTTP server allowlisted via ALLOWED_DOMAINS.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TEMPLATES, TemplateRegistry } from 'crawlforge-extractors';

// ---------------------------------------------------------------------------
// Table-driven fixtures — one entry per registered template, each with
// representative real-world-shaped HTML and an assertion over the result.
// ---------------------------------------------------------------------------

const CASES = [
  {
    // Reads /products/<handle>.json rather than the rendered page, so this
    // fixture is JSON. Behaviour is covered in depth by
    // tests/unit/shopifyProductTemplate.test.js.
    id: 'shopify-product',
    url: 'https://shop.example.com/products/some-handle',
    html: JSON.stringify({
      product: {
        id: 1, title: 'Test Product', vendor: 'Acme', handle: 'some-handle',
        body_html: '<p>Copy.</p>', tags: ['a'], options: [{ name: 'Size' }],
        images: [{ src: 'https://cdn.example/1.jpg' }],
        variants: [{
          id: 11, title: 'S', price: '19.99', compare_at_price: '29.99', sku: 'S-1',
          option1: 'S', inventory_management: 'shopify', inventory_policy: 'deny',
          inventory_quantity: 3, price_currency: 'USD'
        }]
      }
    }),
    assert: (data) => {
      assert.equal(data.title, 'Test Product');
      assert.equal(data.price, '19.99');
      assert.equal(data.compare_at_price, '29.99');
      assert.equal(data.on_sale, true);
      assert.equal(data.available, true);
    }
  },
  {
    // Markup shaped after a live product page captured 2026-08-25 — the
    // previous fixture was written to match the selectors rather than the
    // site, so six fields that were null or dirty in production passed here.
    id: 'amazon-product',
    url: 'https://amazon.com/dp/B000000000',
    html: `<html><body>
      <span id="productTitle">  Wireless Mouse  </span>
      <span class="a-price"><span class="a-offscreen">$19.99</span></span>
      <input type="hidden" name="items[0.base][customerVisiblePrice][currencyCode]" value="USD">
      <span id="acrPopover" title="4.5 out of 5 stars"><span>4.5</span></span>
      <span id="acrCustomerReviewText">(1,234)</span>
      <input id="ASIN" name="ASIN" value="B000000000">
      <a id="bylineInfo">Visit the Acme Store</a>
      <div id="feature-bullets"><ul>
        <li><span class="a-list-item">Ergonomic shape.</span></li>
        <li><span class="a-list-item">USB receiver included.</span></li>
      </ul></div>
      <div id="imgTagWrapperId"><img id="landingImage" src="https://m.media-amazon.com/images/I/61ABCDEFGH._AC_SY300_SX300_.jpg"></div>
      <div id="altImages">
        <img src="https://m.media-amazon.com/images/I/31IJKLMNOP._AC_SR40,60_.jpg">
        <img src="https://images-na.ssl-images-amazon.com/images/G/01/x-locale/common/transparent-pixel._V192234675_.gif">
      </div>
      <div id="availability"><span>In Stock</span></div>
      <div id="wayfinding-breadcrumbs_feature_div"><a href="#">Electronics</a><a href="#">Accessories</a></div>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.title, 'Wireless Mouse');
      assert.equal(data.price, '$19.99');
      assert.equal(data.currency, 'USD');
      assert.equal(data.rating, 4.5);
      assert.equal(data.review_count, 1234);
      assert.equal(data.asin, 'B000000000');
      assert.equal(data.brand, 'Acme');
      assert.equal(data.description, 'Ergonomic shape. USB receiver included.');
      assert.deepEqual(data.images, [
        'https://m.media-amazon.com/images/I/61ABCDEFGH.jpg',
        'https://m.media-amazon.com/images/I/31IJKLMNOP.jpg'
      ]);
      assert.deepEqual(data.category_breadcrumb, ['Electronics', 'Accessories']);
    }
  },

  {
    id: 'github-repo',
    url: 'https://github.com/acme/widget',
    html: `<html><head><meta property="og:description" content="A widget factory."></head><body>
      <strong itemprop="name"><a href="/acme/widget">widget</a></strong>
      <span itemprop="programmingLanguage">TypeScript</span>
      <a class="topic-tag" href="#">cli</a><a class="topic-tag" href="#">tooling</a>
      <relative-time datetime="2024-05-01T00:00:00Z"></relative-time>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.name, 'widget');
      assert.equal(data.description, 'A widget factory.');
      assert.equal(data.language, 'TypeScript');
      assert.deepEqual(data.topics, ['cli', 'tooling']);
      assert.equal(data.last_updated, '2024-05-01T00:00:00Z');
    }
  },

  // Reproduction (2026-08-20): GitHub's logged-out React layout has no
  // watchers aria-label (count is the <strong> after octicon-eye), renders
  // topics as /topics/<name> anchors instead of a.topic-tag, and ships the
  // Languages sidebar as an empty client-side skeleton (language stays null).
  {
    id: 'github-repo',
    url: 'https://github.com/acme/react-layout',
    html: `<html><head><meta property="og:description" content="React layout repo."></head><body>
      <strong itemprop="name"><a href="/acme/react-layout">react-layout</a></strong>
      <h3 class="sr-only"><span>Watchers</span></h3>
      <div class="mt-2"><span><svg class="octicon octicon-eye mr-2"></svg><strong>635</strong> watching</span></div>
      <a href="/topics/mcp">mcp</a><a href="/topics/scraping">scraping</a>
      <h2><span>Languages</span></h2><div class="prc-SkeletonText-SkeletonText--DvUT"></div>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.name, 'react-layout');
      assert.equal(data.watchers, '635');
      assert.deepEqual(data.topics, ['mcp', 'scraping']);
      assert.equal(data.language, null);
    }
  },

  {
    id: 'youtube-video',
    url: 'https://youtube.com/watch?v=abc123',
    html: `<html><head>
      <meta name="title" content="How CrawlForge Works">
      <link itemprop="name" content="CrawlForge Channel">
      <meta itemprop="uploadDate" content="2024-02-02">
      <meta property="og:description" content="A walkthrough video.">
      <meta property="og:image" content="https://img.example.com/thumb.jpg">
      <meta itemprop="duration" content="PT8M30S">
      <link rel="canonical" href="/watch?v=abc123">
    </head><body>
      <div itemprop="interactionStatistic" itemscope itemtype="https://schema.org/InteractionCounter">
        <meta itemprop="interactionType" content="https://schema.org/LikeAction">
        <meta itemprop="userInteractionCount" content="4321">
      </div>
      <div itemprop="interactionStatistic" itemscope itemtype="https://schema.org/InteractionCounter">
        <meta itemprop="interactionType" content="https://schema.org/WatchAction">
        <meta itemprop="userInteractionCount" content="98765">
      </div>
    </body></html>`,
    // Reproduction case for the youtube-video crash fix: `link[rel="canonical"]`
    // is a *relative* URL here (as real YouTube pages sometimes serve it),
    // which used to throw uncaught inside `new URL(...)` and abort the whole
    // extraction. It's now wrapped in try/catch and degrades to video_id:null.
    //
    // The counters are the markup YouTube actually serves (verified 2026-08-26):
    // one InteractionCounter block per statistic, LikeAction emitted FIRST, both
    // using userInteractionCount. This fixture previously carried an invented
    // `itemprop="interactionCount"` meta that matched the template's selector but
    // no real page, so views read null in production while this test stayed green.
    assert: (data) => {
      assert.equal(data.title, 'How CrawlForge Works');
      assert.equal(data.channel, 'CrawlForge Channel');
      assert.equal(data.views, 98765, 'views come from WatchAction, not the first counter');
      assert.equal(data.likes, 4321);
      assert.equal(data.duration, 'PT8M30S');
      assert.equal(data.video_id, null, 'relative canonical URL degrades to null, not a crash');
    }
  },

  {
    // Reads the Arctic Shift archive's /api/posts/ids record rather than the
    // page (reddit.com 403s plain fetchers), so the fixture is that JSON.
    id: 'reddit-thread',
    url: 'https://reddit.com/r/programming/comments/abc/title/',
    html: JSON.stringify({
      data: [{
        id: 'abc', title: 'My Post Title', subreddit: 'programming', author: 'alice',
        created_utc: 1709424000, score: 12, upvote_ratio: 0.9, num_comments: 3,
        is_self: true, selftext: 'Post body text here.', link_flair_text: null, over_18: false,
        permalink: '/r/programming/comments/abc/title/'
      }]
    }),
    assert: (data) => {
      assert.equal(data.title, 'My Post Title');
      assert.equal(data.subreddit, 'programming');
      assert.equal(data.posted, '2024-03-03T00:00:00.000Z');
      assert.equal(data.body, 'Post body text here.');
      assert.equal(data.url, 'https://www.reddit.com/r/programming/comments/abc/title/');
    }
  },

  {
    id: 'hacker-news-front-page',
    url: 'https://news.ycombinator.com/',
    html: `<html><body><table>
      <tr class="athing" id="111">
        <td class="title"><span class="titleline"><a href="https://example.com/story-one">Story One</a></span></td>
      </tr>
      <tr><td class="subtext">
        <span class="score">120 points</span> by <a class="hnuser" href="user?id=alice">alice</a>
        <span class="age"><a href="item?id=111">3 hours ago</a></span> |
        <a href="item?id=111">42&nbsp;comments</a>
      </td></tr>
      <tr class="athing" id="222">
        <td class="title"><span class="titleline"><a href="https://example.com/job-post">Acme (YC S26) Is Hiring</a></span></td>
      </tr>
      <tr><td class="subtext">
        <span class="age"><a href="item?id=222">1 hour ago</a></span> | <a href="hide?id=222">hide</a>
      </td></tr>
    </table></body></html>`,
    assert: (data) => {
      assert.equal(data.stories.length, 2);
      const story = data.stories[0];
      assert.equal(story.id, '111');
      assert.equal(story.title, 'Story One');
      assert.equal(story.url, 'https://example.com/story-one');
      assert.equal(story.score, '120');
      assert.equal(story.author, 'alice');
      assert.equal(story.posted, '3 hours ago');           // age text, not the item?id= permalink
      assert.equal(story.comments, '42\u00a0comments'); // comments link (HN uses &nbsp;), not the age anchor
      // Job posts have no score/author/comments link — only the age anchor.
      const job = data.stories[1];
      assert.equal(job.id, '222');
      assert.equal(job.score, null);
      assert.equal(job.author, null);
      assert.equal(job.posted, '1 hour ago');
      assert.equal(job.comments, null);                    // age must not leak into comments
    }
  },

  {
    // Condensed from a live /products capture (2026-09-01): PH folded
    // /posts/* into /products/* hubs whose data rides in Apollo's
    // streaming-SSR transport, which is what the template reads now.
    id: 'producthunt-launch',
    url: 'https://www.producthunt.com/products/acme-widget',
    html: `<html><head>
      <meta property="og:title" content="Acme Widget: The best widget yet. | Product Hunt">
      <meta property="og:description" content="The best widget yet.">
      <meta property="og:image" content="https://img.example.com/ph.jpg">
      <meta property="og:url" content="https://www.producthunt.com/products/acme-widget">
    </head><body>
      <a href="https://acme.example.com?ref=producthunt" data-test="visit-website-button">Visit website</a>
      <script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{"_R_1":{"data":{"product":{"__typename":"Product","id":"1","slug":"acme-widget","name":"Acme Widget","tagline":"The best widget yet.","description":"A widget.","websiteUrl":"https://acme.example.com","followersCount":42,"reviewsCount":7,"reviewsRating":4.5,"categories":[{"__typename":"ProductCategory","name":"Productivity","slug":"productivity"}]}}}}})</script>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.name, 'Acme Widget');
      assert.equal(data.tagline, 'The best widget yet.');
      assert.deepEqual(data.topics, ['Productivity']);
      assert.equal(data.website, 'https://acme.example.com');
      assert.equal(data.followers, 42);
      assert.equal(data.reviews_rating, 4.5);
    }
  },

  {
    // stackoverflow.com answers every non-browser fetch with a Cloudflare 403,
    // so this template reads the Stack Exchange API instead. The body below is
    // an API response (base=default filter plus bodies and nested answers),
    // not a page.
    id: 'stackoverflow-question',
    url: 'https://stackoverflow.com/questions/123/how-do-i',
    html: JSON.stringify({
      items: [{
        question_id: 123,
        title: 'How do I center a &quot;div&quot;?',
        body: '<p>Use flexbox with <code>justify-content: center</code>.</p>',
        score: 15,
        view_count: 4200,
        tags: ['css', 'flexbox'],
        owner: { display_name: 'alice', reputation: 900 },
        creation_date: 1712188800,
        last_activity_date: 1712275200,
        link: 'https://stackoverflow.com/questions/123/how-do-i',
        is_answered: true,
        accepted_answer_id: 456,
        answer_count: 2,
        answers: [
          { answer_id: 789, score: 40, is_accepted: false, owner: { display_name: 'carol' }, creation_date: 1712190000, body: '<p>Or use grid.</p>' },
          { answer_id: 456, score: 30, is_accepted: true, owner: { display_name: 'bob' }, creation_date: 1712189000, body: "<p>Here's the accepted answer body.</p>" }
        ]
      }],
      has_more: false,
      quota_max: 300,
      quota_remaining: 299
    }),
    assert: (data) => {
      assert.equal(data.title, 'How do I center a "div"?');
      assert.equal(data.body, 'Use flexbox with justify-content: center.');
      assert.equal(data.votes, 15);
      assert.equal(data.views, 4200);
      assert.deepEqual(data.tags, ['css', 'flexbox']);
      assert.equal(data.author, 'alice');
      assert.equal(data.asked, '2024-04-04T00:00:00.000Z');
      assert.equal(data.answered, true);
      assert.equal(data.answer_count, 2);
      assert.equal(data.answers.length, 2);
      assert.equal(data.answers[0].accepted, true, 'accepted answer is listed first even with a lower score');
      assert.equal(data.answers[0].body, "Here's the accepted answer body.");
      assert.equal(data.answers[1].votes, 40);
    }
  },

  {
    // npmjs.com answers plain HTTP fetches with 403, and its markup carries no
    // stable hooks, so this template reads the registry API instead. The body
    // below is a registry document, not a page.
    id: 'npm-package',
    url: 'https://npmjs.com/package/crawlforge-mcp-server',
    html: JSON.stringify({
      name: 'crawlforge-mcp-server',
      'dist-tags': { latest: '4.10.0' },
      maintainers: [{ name: 'someuser' }],
      time: { '4.10.0': '2026-05-01T00:00:00.000Z' },
      versions: {
        '4.10.0': {
          description: 'MCP server for web scraping.',
          license: 'MIT',
          repository: { type: 'git', url: 'git+https://github.com/acme/crawlforge-mcp-server.git' },
          dependencies: { cheerio: '^1.0.0' }
        }
      }
    }),
    assert: (data) => {
      assert.equal(data.name, 'crawlforge-mcp-server');
      assert.equal(data.version, '4.10.0');
      assert.equal(data.description, 'MCP server for web scraping.');
      assert.equal(data.license, 'MIT');
      assert.equal(data.install_command, 'npm install crawlforge-mcp-server');
      assert.equal(data.repository, 'https://github.com/acme/crawlforge-mcp-server');
      assert.deepEqual(data.maintainers, ['someuser']);
      assert.equal(data.dependency_count, 1);
      assert.equal(data.deprecated, false);
    }
  }
];

describe('TemplateRegistry.run (real extractors, table-driven)', () => {
  const registry = new TemplateRegistry();

  test('every page-scraping template is covered by this fixture table', () => {
    // The table covers the templates this tool reaches by URL and parses out of
    // a document. Connectors that build their own URL from params — the list
    // connectors and nhtsa-vin — are fixtured in the package against payloads
    // captured from the live APIs.
    const pageTemplates = TEMPLATES
      .filter((t) => !t.extractList && !t.listUrl)
      .map((t) => t.id)
      .sort();
    // Unique: a template may have multiple fixture cases (e.g. github-repo
    // classic + React layouts).
    assert.deepEqual(pageTemplates, [...new Set(CASES.map((c) => c.id))].sort());
  });

  for (const testCase of CASES) {
    test(`${testCase.id} — extracts expected fields from fixture HTML without throwing`, async () => {
      const result = await registry.run(testCase.id, testCase.html, testCase.url);
      assert.equal(result.template, testCase.id);
      assert.equal(result.url, testCase.url);
      assert.ok(result.data, 'data object should be returned');
      testCase.assert(result.data);
    });
  }

  test('unknown template id throws with the available-templates list', async () => {
    await assert.rejects(() => registry.run('not-a-real-template', '<html></html>', 'https://example.com'), /Unknown template/);
  });
});

// ---------------------------------------------------------------------------
// ScrapeTemplateTool — network path (local fixture server, SSRF-allowlisted)
// ---------------------------------------------------------------------------

process.env.ALLOWED_DOMAINS = 'localhost';
const { ScrapeTemplateTool } = await import('../../../../src/tools/templates/ScrapeTemplateTool.js');
const { robotsPreflight } = await import('../../../../src/utils/robotsGate.js');

/** One product, shaped like the /products.json endpoint's rows. */
const collectionProduct = (id, handle, title) => ({
  id, title, handle, vendor: 'Acme', body_html: '<p>Copy.</p>', tags: [], options: [{ name: 'Size' }],
  images: [{ src: `https://cdn.example/${id}.jpg` }],
  variants: [{
    id: id * 10, title: 'S', price: '19.99', compare_at_price: '', sku: `S-${id}`,
    option1: 'S', inventory_management: null, inventory_policy: 'deny'
  }]
});

/**
 * Nothing shipped needs an API key today, so the credential path is exercised
 * against a fixture connector rather than a live one. The key arrives as
 * `params.apiKey` — the registry never reads process.env itself.
 */
const KEY_VALUE = 's3cret-key-value';
const KEYED_TEMPLATE = {
  id: 'fixture-keyed',
  name: 'Fixture Keyed API',
  description: 'Test-only list connector behind an API key.',
  requiresApiKey: true,
  credentialRef: 'FIXTURE_TEMPLATE_KEY',
  listUrl(params = {}) {
    if (!params.base) throw new Error('fixture-keyed requires a "base" parameter: the API origin.');
    const url = new URL('/gated/list.json', params.base);
    url.searchParams.set('key', params.apiKey);
    return url.toString();
  },
  extractList(body) {
    const { rows } = JSON.parse(body);
    return { items: rows, count: rows.length };
  }
};

describe('ScrapeTemplateTool (real module, real fetch against a local server)', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const { pathname, searchParams } = new URL(req.url, 'http://localhost');

      // Allows everything except one collection endpoint — a path no caller
      // names directly. It is only ever produced by resolveUrl or listUrl,
      // which is what makes it a test of *which* URL the gate runs against.
      if (pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\nDisallow: /collections/mens/products.json\n');
        return;
      }
      if (pathname === '/acme/widget') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><strong itemprop="name"><a href="/acme/widget">widget</a></strong></body></html>');
        return;
      }
      if (pathname === '/collections/shoes/products.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          products: [collectionProduct(1, 'runner', 'Runner'), collectionProduct(2, 'trainer', 'Trainer')]
        }));
        return;
      }
      if (pathname === '/gated/list.json') {
        if (searchParams.get('key') !== KEY_VALUE) {
          res.writeHead(401);
          res.end('unauthorized');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] }));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('constructor creates a real TemplateRegistry', () => {
    const tool = new ScrapeTemplateTool();
    assert.ok(tool.registry instanceof TemplateRegistry);
  });

  test('list mode — returns all available templates, no network call', async () => {
    const tool = new ScrapeTemplateTool();
    const result = await tool.execute({ template: 'list' });
    assert.equal(result.count, result.templates.length);
    assert.ok(result.templates.some((t) => t.id === 'github-repo'));
    // A caller has to be able to tell the two kinds apart: an entity template
    // takes a url, a list connector takes params and returns N records.
    assert.equal(result.templates.find((t) => t.id === 'github-repo').mode, 'entity');
    assert.equal(result.templates.find((t) => t.id === 'greenhouse-jobs').mode, 'list');
  });

  test('missing url triggers list mode', async () => {
    const tool = new ScrapeTemplateTool();
    const result = await tool.execute({ template: 'github-repo' });
    assert.ok(Array.isArray(result.templates));
  });

  test('unknown template throws before any network call', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'fakebook', url: 'https://fb.example.com' }),
      /Unknown template "fakebook"/
    );
  });

  test('a retired template names its reason before any network call — by id, and by url under auto', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'tweet', url: 'https://x.com/jack/status/20' }),
      /Template "tweet" was retired: .*robots\.txt/s
    );
    await assert.rejects(
      () => tool.execute({ template: 'auto', url: 'https://www.linkedin.com/in/williamhgates' }),
      /The "linkedin-profile" template that handled .* was retired: .*robots\.txt/s
    );
    assert.ok(!tool.listTemplates().templates.some((t) => t.id === 'tweet' || t.id === 'linkedin-profile'));
  });

  test('happy path — fetches a real page through safeFetch and runs the github-repo extractor', async () => {
    const tool = new ScrapeTemplateTool();
    const result = await tool.execute({ template: 'github-repo', url: `${baseUrl}/acme/widget` });
    assert.equal(result.template, 'github-repo');
    assert.equal(result.data.name, 'widget');
  });

  test('HTTP 404 propagates as an error', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'github-repo', url: `${baseUrl}/missing` }),
      /HTTP 404/
    );
  });

  // ── auto ──────────────────────────────────────────────────────────────────

  test('auto — detects the template, names its choice, and returns the list connector\'s items', async () => {
    const tool = new ScrapeTemplateTool();
    const result = await tool.execute({ template: 'auto', url: `${baseUrl}/collections/shoes` });
    // A caller cannot audit "auto" that hides its own decision.
    assert.equal(result.template, 'shopify-collection');
    assert.equal(result.url, `${baseUrl}/collections/shoes`);
    assert.equal(result.fetchedUrl, `${baseUrl}/collections/shoes/products.json`);
    assert.equal(result.data.count, 2);
    assert.equal(result.data.items.length, 2);
  });

  test('auto — no matching template points the caller at template:"list"', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'auto', url: 'https://example.com/nothing-here' }),
      (error) => /No template matches/.test(error.message) && /template:"list"/.test(error.message)
    );
  });

  test('auto — without a url, says so rather than listing', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(() => tool.execute({ template: 'auto' }), /needs a url/);
  });

  // ── list connectors ───────────────────────────────────────────────────────

  test('list connector — params build the URL and N items come back', async () => {
    const tool = new ScrapeTemplateTool();
    const result = await tool.execute({
      template: 'shopify-collection',
      params: { store: baseUrl, collection: 'shoes' }
    });
    assert.equal(result.template, 'shopify-collection');
    // The caller named no URL, so the one we built is the one reported.
    assert.equal(result.url, `${baseUrl}/collections/shoes/products.json`);
    assert.deepEqual(result.params, { store: baseUrl, collection: 'shoes' });
    assert.equal(result.data.items.length, 2);
    assert.equal(result.data.items[0].title, 'Runner');
  });

  test('listUrl\'s missing-parameter error reaches the caller, before any fetch', async () => {
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'shopify-collection', params: { collection: 'mens' } }),
      /requires a "store" parameter/
    );
  });

  // ── the robots gate runs against the URL actually fetched ─────────────────

  test('robots gate runs against the URL listUrl produced, not the caller input', async () => {
    // The caller names no URL at all here — only params. robots.txt disallows
    // exactly the path listUrl builds, so a refusal can only mean the gate ran
    // against that URL. listUrl reaches a host the caller never named, which is
    // the way G5 breaks by accident.
    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'shopify-collection', params: { store: baseUrl, collection: 'mens' } }),
      (error) => error.code === 'ROBOTS_DISALLOWED' && /disallows this path/.test(error.message)
    );
  });

  test('robots gate runs against the resolved URL, not the caller input', async () => {
    const input = `${baseUrl}/collections/mens`;
    const decision = await robotsPreflight(input);
    assert.equal(decision.allowed, true, 'the input URL itself is allowed — only the resolved one is not');

    const tool = new ScrapeTemplateTool();
    await assert.rejects(
      () => tool.execute({ template: 'shopify-collection', url: input }),
      (error) => error.code === 'ROBOTS_DISALLOWED' && /disallows this path/.test(error.message)
    );
  });

  // ── credentials ───────────────────────────────────────────────────────────

  test('key-based connector — a missing key is an actionable error naming the env var', async () => {
    delete process.env.FIXTURE_TEMPLATE_KEY;
    const tool = new ScrapeTemplateTool({ templates: [KEYED_TEMPLATE] });
    await assert.rejects(
      () => tool.execute({ template: 'fixture-keyed', params: { base: baseUrl } }),
      // Named, not a 401 passthrough from the target.
      (error) => /FIXTURE_TEMPLATE_KEY/.test(error.message) && !/401/.test(error.message)
    );
  });

  test('key-based connector — the key reaches listUrl and never comes back out', async () => {
    process.env.FIXTURE_TEMPLATE_KEY = KEY_VALUE;
    try {
      const tool = new ScrapeTemplateTool({ templates: [KEYED_TEMPLATE] });
      const result = await tool.execute({ template: 'fixture-keyed', params: { base: baseUrl } });
      // The fixture server answers 401 unless the key arrived on the request.
      assert.equal(result.data.count, 2);
      assert.ok(!JSON.stringify(result).includes(KEY_VALUE), 'the API key must not be echoed back');
    } finally {
      delete process.env.FIXTURE_TEMPLATE_KEY;
    }
  });
});
