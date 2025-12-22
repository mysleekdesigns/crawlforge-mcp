# MCP Implementation Patterns

## Tool Registration Pattern

```javascript
server.registerTool(
  'tool_name',
  {
    description: 'Clear, concise description',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
      options: z.object({
        timeout: z.number().optional().default(30000)
      }).optional()
    })
  },
  withAuth('tool_name', async (params) => {
    try {
      const result = await toolInstance.execute(params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Operation failed: ${error.message}`
        }],
        isError: true
      };
    }
  })
);
```

## Response Format

```javascript
// Success response
{
  content: [{
    type: "text",
    text: JSON.stringify(data, null, 2)
  }]
}

// Error response
{
  content: [{
    type: "text",
    text: `Error: ${error.message}`
  }],
  isError: true
}
```

## Tool Class Pattern

```javascript
export class ToolName {
  constructor(config) {
    this.config = config;
    // Initialize resources
  }

  async execute(params) {
    // Validate params
    // Execute logic
    // Return structured result
    return { success: true, data: {...} };
  }

  async destroy() {
    // Cleanup resources (browsers, connections, etc.)
  }
}
```

## Credit-Efficient Patterns

### Batch Processing

```javascript
// Inefficient: Multiple individual calls
for (const url of urls) {
  await fetch_url({ url }); // 1 credit × N
}

// Efficient: Single batch operation
await batch_scrape({
  urls,
  formats: ['markdown'],
  maxConcurrency: 10
}); // 3-5 credits total
```

### Progressive Discovery

```javascript
// Optimal: Map first, then selective crawl
const { urls } = await map_site({ url }); // 1 credit
const importantUrls = urls.filter(filterCriteria);
await batch_scrape({ urls: importantUrls }); // 3-5 credits
```

### Caching Strategy

```javascript
// Use cache for repeated requests
await fetch_url({
  url,
  maxAge: 172800000 // 2 days, 500% faster
});
```

## Error Handling

```javascript
try {
  const result = await tool.execute(params);
} catch (error) {
  // Note: Failed operations consume half credits
  // Validate inputs before calling to avoid wasted credits
}
```

## Graceful Shutdown

```javascript
process.on('SIGINT', async () => {
  console.error('Shutting down...');
  for (const tool of cleanupTools) {
    await tool.destroy?.();
  }
  process.exit(0);
});
```
