# Documentation Templates

## Tool Documentation Template

```markdown
## Tool: [tool_name]

### Description
[Clear, concise description of what the tool does]

### Parameters
| Parameter | Type | Required | Description | Default |
|-----------|------|----------|-------------|---------|
| param1 | string | Yes | Description | - |
| param2 | number | No | Description | 10 |

### Response Schema
\`\`\`json
{
  "field1": "string",
  "field2": 123,
  "field3": {
    "nested": "value"
  }
}
\`\`\`

### Examples

#### Basic Usage
\`\`\`javascript
const result = await mcp.call('tool_name', {
  param1: 'value',
  param2: 20
});
\`\`\`

#### Advanced Usage
\`\`\`javascript
try {
  const result = await mcp.call('tool_name', {
    param1: 'value',
    param2: 20
  });
  console.log(result);
} catch (error) {
  console.error('Error:', error.message);
}
\`\`\`

### Error Codes
| Code | Message | Description |
|------|---------|-------------|
| 400 | Invalid URL | The provided URL is malformed |
| 429 | Rate Limited | Too many requests |

### Best Practices
- [Best practice 1]
- [Best practice 2]

### See Also
- Related tool 1
- Related tool 2
```

## Changelog Format

```markdown
# Changelog

## [1.1.0] - 2024-XX-XX
### Added
- New feature description

### Changed
- Changed behavior description

### Fixed
- Bug fix description

### Security
- Security update description
```

## Troubleshooting Guide

```markdown
### Common Issues

1. **Issue**: Rate limit errors
   - **Cause**: Exceeding API limits
   - **Solution**: Implement exponential backoff
   - **Example**: [code example]

2. **Issue**: Timeout errors
   - **Cause**: Large page or slow server
   - **Solution**: Increase timeout value
   - **Example**: [code example]
```

## OpenAPI Specification Template

```yaml
openapi: 3.0.0
info:
  title: CrawlForge MCP Server API
  version: 3.0.3
  description: Professional web scraping MCP server

paths:
  /tools/fetch_url:
    post:
      summary: Fetch URL content
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                url:
                  type: string
                  format: uri
      responses:
        200:
          description: Success
```
