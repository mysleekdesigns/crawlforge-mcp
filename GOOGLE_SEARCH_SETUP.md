# Google Custom Search API Setup Guide

## Quick Setup Steps

### 1. Get Google API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to "APIs & Services" > "Library"
4. Search for "Custom Search API" and enable it
5. Go to "APIs & Services" > "Credentials"
6. Click "Create Credentials" > "API Key"
7. Copy your API key

### 2. Create Custom Search Engine

1. Go to [Google Custom Search Engine](https://cse.google.com/cse/create/new)
2. Configure your search engine:
   - **Sites to search**: Choose "Search the entire web" for general web search
   - **Search engine name**: Give it any name (e.g., "MCP WebScraper")
3. Click "Create"
4. On the next page, find your **Search Engine ID** (looks like: `017643444788157903868:8bndhgi2jgo`)
5. Copy this ID

### 3. Update Your Configuration

Edit your `.env` file and replace the placeholders:

```bash
GOOGLE_API_KEY=AIzaSyB... (your actual API key)
GOOGLE_SEARCH_ENGINE_ID=017643444... (your actual search engine ID)
```

### 4. Test the Configuration

Run this test command:
```bash
node -e "
import('./src/providers/search/googleSearchProvider.js').then(async ({ GoogleSearchProvider }) => {
  const provider = new GoogleSearchProvider({
    apiKey: process.env.GOOGLE_API_KEY,
    searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID
  });
  const results = await provider.search('test query', { limit: 3 });
  console.log('Google Search is working!');
  console.log('Found', results.length, 'results');
}).catch(err => {
  console.error('Google Search error:', err.message);
});
"
```

## Troubleshooting

### Common Issues:

1. **"API key not valid"** - Make sure you've enabled the Custom Search API in Google Cloud Console
2. **"Invalid search engine ID"** - Double-check the ID from your Custom Search Engine settings
3. **"Quota exceeded"** - Google provides 100 free searches per day. For more, you'll need billing enabled
4. **No results** - Make sure your search engine is configured to "Search the entire web"

### API Limits:
- **Free tier**: 100 queries per day
- **Paid tier**: $5 per 1000 queries (after free tier)
- **Rate limit**: 10 queries per second

## Switching Between Providers

You can easily switch between Google and DuckDuckGo:

```bash
# Use Google (requires API credentials)
SEARCH_PROVIDER=google

# Use DuckDuckGo (no API key needed, but slower)
SEARCH_PROVIDER=duckduckgo

# Auto mode (uses Google if configured, falls back to DuckDuckGo)
SEARCH_PROVIDER=auto
```

## Benefits of Google Search over DuckDuckGo

- **Faster**: Direct API access vs web scraping
- **More reliable**: No rate limiting or blocking issues
- **Better results**: Google's superior search algorithm
- **Structured data**: Clean JSON responses with metadata
- **Pagination support**: Proper offset handling
- **Advanced features**: Site search, file type filters, date ranges

## Next Steps

After configuring Google Search:
1. Restart your MCP server
2. Test the `search_web` tool
3. Monitor your API usage in Google Cloud Console
4. Consider enabling billing if you need more than 100 searches/day