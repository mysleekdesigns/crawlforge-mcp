/**
 * Unit tests: scrape_template (real modules — the extractors now live in the
 * shared crawlforge-extractors package, which both this server and the REST
 * API run; the per-template unit tests live there too. What is covered here
 * is the tool around them
 * and src/tools/templates/ScrapeTemplateTool.js)
 * Run: node --test tests/unit/tools/templates/scrapeTemplate.test.js
 *
 * TemplateRegistry.run(id, body, url) takes a raw response body directly (no
 * network), so the table-driven suite below exercises all 11 real template
 * extractors against representative fixtures with no stubbing. Most bodies are
 * HTML; shopify-product reads the store's product JSON endpoint instead, so its
 * fixture is a JSON string. ScrapeTemplateTool
 * wraps the registry with a safeFetch (SSRF-guarded) network call, tested
 * separately against a local HTTP server allowlisted via ALLOWED_DOMAINS.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TemplateRegistry } from 'crawlforge-extractors';

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
    id: 'linkedin-profile',
    url: 'https://linkedin.com/in/jane-doe',
    html: `<html><body>
      <h1>Jane Doe</h1>
      <h2>Senior Engineer at Acme</h2>
      <div class="profile-info-subheader">San Francisco, CA</div>
      <div class="summary"><p>Builds distributed systems.</p></div>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.name, 'Jane Doe');
      assert.equal(data.headline, 'Senior Engineer at Acme');
      assert.equal(data.location, 'San Francisco, CA');
      assert.ok(data.note.includes('authentication'));
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
      <meta itemprop="interactionCount" content="98765">
      <meta itemprop="uploadDate" content="2024-02-02">
      <meta property="og:description" content="A walkthrough video.">
      <meta property="og:image" content="https://img.example.com/thumb.jpg">
      <meta itemprop="duration" content="PT8M30S">
      <link rel="canonical" href="/watch?v=abc123">
    </head><body></body></html>`,
    // Reproduction case for the youtube-video crash fix: `link[rel="canonical"]`
    // is a *relative* URL here (as real YouTube pages sometimes serve it),
    // which used to throw uncaught inside `new URL(...)` and abort the whole
    // extraction. It's now wrapped in try/catch and degrades to video_id:null.
    assert: (data) => {
      assert.equal(data.title, 'How CrawlForge Works');
      assert.equal(data.channel, 'CrawlForge Channel');
      assert.equal(data.views, '98765');
      assert.equal(data.duration, 'PT8M30S');
      assert.equal(data.video_id, null, 'relative canonical URL degrades to null, not a crash');
    }
  },

  {
    id: 'tweet',
    url: 'https://x.com/acme/status/1234567890',
    html: `<html><head>
      <meta property="og:description" content="Shipping v5 today!">
      <meta property="og:title" content="Acme (@acme)">
      <meta property="og:url" content="https://x.com/acme/status/1234567890">
      <meta property="og:image" content="https://img.example.com/tweet.jpg">
    </head><body></body></html>`,
    assert: (data) => {
      assert.equal(data.text, 'Shipping v5 today!');
      assert.equal(data.author, 'Acme (@acme)');
      assert.equal(data.url, 'https://x.com/acme/status/1234567890');
    }
  },

  {
    id: 'reddit-thread',
    url: 'https://reddit.com/r/programming/comments/abc/title/',
    html: `<html><head><title>My Post Title • r/programming</title>
      <meta property="og:title" content="My Post Title">
      <meta property="og:url" content="https://reddit.com/r/programming/comments/abc/title/">
    </head><body>
      <a href="/user/alice" class="author">alice</a>
      <time datetime="2024-03-03T00:00:00Z"></time>
      <div data-click-id="text"><p>Post body text here.</p></div>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.title, 'My Post Title');
      assert.equal(data.subreddit, 'programming');
      assert.equal(data.posted, '2024-03-03T00:00:00Z');
      assert.equal(data.body, 'Post body text here.');
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
    id: 'producthunt-launch',
    url: 'https://producthunt.com/posts/acme-widget',
    html: `<html><head>
      <meta property="og:title" content="Acme Widget">
      <meta property="og:description" content="The best widget yet.">
      <meta property="og:image" content="https://img.example.com/ph.jpg">
      <meta property="og:url" content="https://producthunt.com/posts/acme-widget">
    </head><body>
      <a href="/topics/productivity">Productivity</a>
      <a data-test="product-link" href="https://acme.example.com">Visit</a>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.name, 'Acme Widget');
      assert.equal(data.tagline, 'The best widget yet.');
      assert.deepEqual(data.topics, ['Productivity']);
      assert.equal(data.website, 'https://acme.example.com');
    }
  },

  {
    id: 'stackoverflow-question',
    url: 'https://stackoverflow.com/questions/123/how-do-i',
    html: `<html><body>
      <div id="question-header"><h1>How do I center a div?</h1></div>
      <div class="question">
        <div class="s-prose">Use flexbox with justify-content: center.</div>
        <span class="js-vote-count">15</span>
        <div class="user-details"><a href="/users/1/alice">alice</a></div>
        <time datetime="2024-04-04T00:00:00Z"></time>
      </div>
      <span class="post-tag">css</span><span class="post-tag">flexbox</span>
      <div class="answer accepted-answer">
        <div class="js-vote-count">30</div>
        <div class="s-prose">Here's the accepted answer body.</div>
      </div>
    </body></html>`,
    assert: (data) => {
      assert.equal(data.title, 'How do I center a div?');
      assert.equal(data.votes, '15');
      assert.deepEqual(data.tags, ['css', 'flexbox']);
      assert.equal(data.answered, true);
      assert.equal(data.answers.length, 1);
      assert.equal(data.answers[0].accepted, true);
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

  test('registry lists exactly the templates covered by this fixture table', () => {
    const ids = registry.list().map((t) => t.id).sort();
    // Unique: a template may have multiple fixture cases (e.g. github-repo
    // classic + React layouts).
    assert.deepEqual(ids, [...new Set(CASES.map((c) => c.id))].sort());
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

describe('ScrapeTemplateTool (real module, real fetch against a local server)', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/acme/widget') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><strong itemprop="name"><a href="/acme/widget">widget</a></strong></body></html>');
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
    assert.equal(result.count, 11);
    assert.ok(result.templates.some((t) => t.id === 'github-repo'));
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
});
