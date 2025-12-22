# Testing Checklists

## MCP Server Core

- [ ] Server starts without errors
- [ ] Stdio transport connects properly
- [ ] Tools are discoverable
- [ ] Resources are accessible
- [ ] Proper error responses

## Web Scraping Tools

- [ ] URL validation works
- [ ] HTML parsing handles malformed content
- [ ] Network errors handled gracefully
- [ ] Timeout handling implemented
- [ ] Content sanitization working

## Package Configuration

- [ ] npm install completes successfully
- [ ] npx execution works
- [ ] Shebang line present (#!/usr/bin/env node)
- [ ] Dependencies resolve correctly
- [ ] No version conflicts

## Integration Points

- [ ] Compatible with Claude Code .mcp.json format
- [ ] Works with Cursor mcp.json configuration
- [ ] Stdio communication functioning
- [ ] Tool discovery working
- [ ] Proper JSON-RPC responses

## Common Issues to Check

### Module Resolution
- ES module imports working
- Correct file extensions (.js)
- Package.json type: "module"

### Schema Validation
- Zod schemas properly defined
- Required fields specified
- Type coercion handled

### Error Scenarios
- Invalid URLs
- Network timeouts
- Malformed HTML
- Missing parameters
- Rate limiting

## Credit Consumption Validation

- [ ] Basic tool consumes 1 credit
- [ ] Advanced tools consume 2-3 credits
- [ ] Premium tools consume 5-10 credits
- [ ] Failed operations consume half credits
- [ ] Cached responses use no additional credits

## Cursor & Claude Code Integration

- [ ] Tools discoverable in IDE
- [ ] Parameters validate correctly
- [ ] Responses format properly
- [ ] Error messages are clear
- [ ] Credit usage displays correctly
