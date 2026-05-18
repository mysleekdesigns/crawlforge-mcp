/**
 * Offline HTML fixtures for template integration tests (D3.3).
 * These stubs do not require network access — tests use them directly.
 */

export const FIXTURES = {
  'amazon-product': {
    url: 'https://www.amazon.com/dp/B09V3KXJPB',
    html: `<html><head><title>Test Product - Amazon</title></head><body>
      <span id="productTitle">Wireless Earbuds, Bluetooth 5.3</span>
      <span class="a-price"><span class="a-offscreen">$29.99</span></span>
      <span id="acrPopover"><span class="a-size-base">4.5</span></span>
      <span id="acrCustomerReviewText">1,234 ratings</span>
      <input id="ASIN" value="B09V3KXJPB">
      <span id="availability"><span>In Stock</span></span>
    </body></html>`,
    expected: { title: 'Wireless Earbuds, Bluetooth 5.3', price: '$29.99' }
  },

  'linkedin-profile': {
    url: 'https://www.linkedin.com/in/test-user/',
    html: `<html><head><title>Test User - LinkedIn</title></head><body>
      <h1 class="top-card-layout__title">Test User</h1>
      <h2 class="top-card-layout__headline">Senior Engineer at Acme Corp</h2>
      <span class="top-card-layout__first-subline">San Francisco, CA</span>
    </body></html>`,
    expected: { name: 'Test User', headline: 'Senior Engineer at Acme Corp' }
  },

  'github-repo': {
    url: 'https://github.com/user/awesome-repo',
    html: `<html><head><title>user/awesome-repo: A test repo</title></head><body>
      <strong itemprop="name"><a>awesome-repo</a></strong>
      <p class="f4 my-3">A test repository for template testing</p>
      <span id="repo-stars-counter-star">4,200</span>
      <span id="repo-network-counter">312</span>
      <span itemprop="programmingLanguage">JavaScript</span>
      <a class="topic-tag">mcp</a>
      <a class="topic-tag">testing</a>
    </body></html>`,
    expected: { stars: '4,200', language: 'JavaScript' }
  },

  'youtube-video': {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    html: `<html><head>
      <meta name="title" content="Never Gonna Give You Up">
      <meta property="og:title" content="Never Gonna Give You Up">
      <meta itemprop="uploadDate" content="2009-10-25">
      <meta itemprop="interactionCount" content="1400000000">
      <link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
    </head><body></body></html>`,
    expected: { title: 'Never Gonna Give You Up', video_id: 'dQw4w9WgXcQ' }
  },

  'tweet': {
    url: 'https://twitter.com/user/status/123456789',
    html: `<html><head>
      <meta property="og:title" content="@user on Twitter">
      <meta property="og:description" content="This is a test tweet about templates #mcp">
      <meta property="og:url" content="https://twitter.com/user/status/123456789">
    </head><body></body></html>`,
    expected: { text: 'This is a test tweet about templates #mcp' }
  },

  'reddit-thread': {
    url: 'https://www.reddit.com/r/programming/comments/abc123/test_post/',
    html: `<html><head>
      <title>Test Post • r/programming</title>
      <meta property="og:title" content="Test Post">
      <meta property="og:description" content="A test reddit post about programming">
      <meta property="og:url" content="https://www.reddit.com/r/programming/comments/abc123/test_post/">
    </head><body>
      <h1>Test Post</h1>
    </body></html>`,
    expected: { title: 'Test Post' }
  },

  'hacker-news-front-page': {
    url: 'https://news.ycombinator.com',
    html: `<html><head><title>Hacker News</title></head><body>
      <table>
        <tr class="athing" id="12345">
          <td class="titleline"><a href="https://example.com">Show HN: Template scraper for MCP</a></td>
          <td class="sitebit"><a>example.com</a></td>
        </tr>
        <tr class="spacer">
          <td class="subtext"><span class="score">142 points</span> by <a class="hnuser">testuser</a></td>
        </tr>
      </table>
    </body></html>`,
    expected: { stories: [{ title: 'Show HN: Template scraper for MCP' }] }
  },

  'producthunt-launch': {
    url: 'https://www.producthunt.com/posts/crawlforge',
    html: `<html><head>
      <meta property="og:title" content="CrawlForge - MCP server for web scraping">
      <meta property="og:description" content="Professional MCP server with 23 web scraping tools">
      <meta property="og:url" content="https://www.producthunt.com/posts/crawlforge">
    </head><body></body></html>`,
    expected: { name: 'CrawlForge - MCP server for web scraping' }
  },

  'stackoverflow-question': {
    url: 'https://stackoverflow.com/questions/12345/how-to-use-mcp',
    html: `<html><head><title>How to use MCP - Stack Overflow</title></head><body>
      <div id="question-header"><h1>How to use MCP servers</h1></div>
      <div class="question">
        <span class="js-vote-count" data-value="42">42</span>
        <div class="s-prose"><p>How do I connect an MCP server to Claude?</p></div>
        <a class="post-tag">mcp</a><a class="post-tag">claude</a>
        <div class="user-details"><a>testuser</a></div>
      </div>
    </body></html>`,
    expected: { title: 'How to use MCP servers', tags: ['mcp', 'claude'] }
  },

  'npm-package': {
    url: 'https://www.npmjs.com/package/crawlforge-mcp-server',
    html: `<html><head>
      <meta name="description" content="Professional MCP server with 23 web scraping tools">
      <script type="application/ld+json">{"name":"crawlforge-mcp-server","license":"MIT"}</script>
    </head><body>
      <h1>crawlforge-mcp-server</h1>
    </body></html>`,
    expected: { name: 'crawlforge-mcp-server' }
  }
};
