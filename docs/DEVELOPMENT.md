# Development Guide

👩‍💻 **Purpose**: Guide for contributors and developers working on MCP WebScraper  
🏗️ **Focus**: Architecture, contributing, testing, and best practices  
🎯 **Audience**: Developers contributing to or extending the project

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Contributing Guidelines](#contributing-guidelines)
- [Development Workflow](#development-workflow)
- [Testing Strategy](#testing-strategy)
- [Code Style Guide](#code-style-guide)
- [Adding New Tools](#adding-new-tools)
- [Debugging](#debugging)
- [Release Process](#release-process)

## Development Setup

### Prerequisites

- Node.js 18+ (use `nvm` for version management)
- Git 2.0+
- VS Code or preferred IDE
- Docker (optional, for testing)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/your-username/mcp-webscraper.git
cd mcp-webscraper

# Install dependencies
npm install

# Set up development environment
cp .env.example .env.development

# Install development tools
npm install --save-dev

# Run initial tests
npm test

# Start development server
npm run dev
```

### Development Scripts

```json
{
  "scripts": {
    "dev": "nodemon server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "build": "npm run lint && npm test",
    "debug": "node --inspect server.js"
  }
}
```

## Project Architecture

### Directory Structure

```
mcp-webscraper/
├── server.js              # MCP server entry point
├── src/
│   ├── core/             # Core infrastructure
│   │   ├── queue/        # Queue management
│   │   ├── cache/        # Caching system
│   │   ├── workers/      # Worker pool
│   │   └── processing/   # Content processors
│   ├── tools/            # MCP tool implementations
│   │   ├── basic/        # Basic scraping tools
│   │   ├── search/       # Search tools
│   │   ├── crawl/        # Crawling tools
│   │   ├── extract/      # Content extraction
│   │   ├── advanced/     # Advanced tools
│   │   └── research/     # Research tools
│   ├── utils/            # Utility functions
│   │   ├── validation/   # Input validation
│   │   ├── security/     # Security utilities
│   │   └── network/      # Network helpers
│   └── config/           # Configuration
├── tests/                # Test suites
│   ├── unit/            # Unit tests
│   ├── integration/     # Integration tests
│   ├── performance/     # Performance tests
│   └── fixtures/        # Test fixtures
├── docs/                # Documentation
└── scripts/             # Build and utility scripts
```

### Core Components

#### MCP Server (`server.js`)

```javascript
// Main server implementation
class MCPWebScraperServer {
  constructor() {
    this.tools = new Map();
    this.initializeTools();
    this.setupMiddleware();
  }
  
  // Register all tools
  initializeTools() {
    this.registerTool(new FetchUrlTool());
    this.registerTool(new ExtractTextTool());
    // ... more tools
  }
}
```

#### Tool Architecture (`src/tools/`)

```javascript
// Base tool class
class BaseTool {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.schema = this.defineSchema();
  }
  
  // Override in subclasses
  async execute(params) {
    throw new Error('Not implemented');
  }
  
  // Zod schema definition
  defineSchema() {
    return z.object({
      // Define parameters
    });
  }
}

// Example tool implementation
class FetchUrlTool extends BaseTool {
  constructor() {
    super('fetch_url', 'Fetch content from URL');
  }
  
  defineSchema() {
    return z.object({
      url: z.string().url(),
      timeout: z.number().optional()
    });
  }
  
  async execute(params) {
    // Implementation
  }
}
```

#### Queue Management (`src/core/queue/`)

```javascript
// Concurrent operation management
class QueueManager {
  constructor(options = {}) {
    this.queue = new PQueue({
      concurrency: options.concurrency || 10,
      interval: options.interval || 100,
      intervalCap: options.intervalCap || 10
    });
  }
  
  async add(task, priority = 0) {
    return this.queue.add(task, { priority });
  }
}
```

## Contributing Guidelines

### Code of Conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature`
3. **Make your changes**
4. **Write/update tests**
5. **Update documentation**
6. **Submit a pull request**

### Pull Request Process

1. **Ensure all tests pass**: `npm test`
2. **Update documentation** if needed
3. **Follow commit conventions** (see below)
4. **Request review** from maintainers
5. **Address feedback** promptly

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style
- `refactor`: Refactoring
- `perf`: Performance
- `test`: Testing
- `chore`: Maintenance

**Examples:**
```bash
feat(tools): add deep_research tool for comprehensive analysis
fix(cache): resolve memory leak in LRU cache implementation
docs(api): update API reference for batch_scrape tool
perf(worker): optimize HTML parsing with streaming
```

## Development Workflow

### Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/new-tool

# 2. Develop feature
npm run dev

# 3. Write tests
npm run test:watch

# 4. Check code quality
npm run lint
npm run format

# 5. Run full test suite
npm test

# 6. Commit changes
git add .
git commit -m "feat(tools): add new tool for X"

# 7. Push and create PR
git push origin feature/new-tool
```

### Bug Fixing

```bash
# 1. Create bugfix branch
git checkout -b fix/issue-123

# 2. Write failing test
npm run test:watch

# 3. Fix the bug

# 4. Verify fix
npm test

# 5. Commit with issue reference
git commit -m "fix(cache): resolve issue with TTL calculation

Fixes #123"
```

## Testing Strategy

### Test Structure

```javascript
// tests/unit/tools/fetch_url.test.js
describe('FetchUrlTool', () => {
  let tool;
  
  beforeEach(() => {
    tool = new FetchUrlTool();
  });
  
  describe('validation', () => {
    it('should validate URL format', () => {
      // Test validation
    });
  });
  
  describe('execution', () => {
    it('should fetch content successfully', async () => {
      // Test execution
    });
  });
});
```

### Test Coverage Requirements

- **Unit tests**: Minimum 80% coverage
- **Integration tests**: Critical paths
- **Performance tests**: Benchmarks for each tool
- **Security tests**: Input validation and SSRF protection

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Performance tests
npm run test:performance

# Coverage report
npm run test:coverage

# Watch mode
npm run test:watch
```

## Code Style Guide

### JavaScript Style

We use ESLint with the following rules:

```javascript
// Good
async function fetchContent(url) {
  validateUrl(url);
  
  try {
    const response = await fetch(url);
    return response.text();
  } catch (error) {
    logger.error('Fetch failed', { url, error });
    throw new FetchError(`Failed to fetch ${url}`, error);
  }
}

// Bad
async function fetchContent(url) {
  // No validation
  var response = await fetch(url) // No error handling
  return response.text()
}
```

### Naming Conventions

```javascript
// Classes: PascalCase
class ContentProcessor {}

// Functions/methods: camelCase
function processContent() {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;

// Files: kebab-case
'content-processor.js'

// MCP tools: snake_case
'fetch_url', 'extract_content'
```

### Error Handling

```javascript
// Custom error classes
class WebScraperError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// Proper error handling
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  // Log error with context
  logger.error('Operation failed', {
    operation: 'riskyOperation',
    error: error.message,
    stack: error.stack
  });
  
  // Re-throw with additional context
  throw new WebScraperError(
    'Failed to complete operation',
    'OPERATION_FAILED',
    { originalError: error }
  );
}
```

## Adding New Tools

### Step-by-Step Guide

1. **Create tool file**: `src/tools/category/new_tool.js`

```javascript
import { BaseTool } from '../base-tool.js';
import { z } from 'zod';

export class NewTool extends BaseTool {
  constructor() {
    super('new_tool', 'Description of the new tool');
  }
  
  defineSchema() {
    return z.object({
      param1: z.string(),
      param2: z.number().optional()
    });
  }
  
  async execute(params) {
    // Validate inputs
    const validated = this.schema.parse(params);
    
    // Implement tool logic
    const result = await this.doSomething(validated);
    
    // Return formatted response
    return {
      success: true,
      data: result
    };
  }
}
```

2. **Register in server**: `server.js`

```javascript
import { NewTool } from './src/tools/category/new_tool.js';

// In initializeTools()
this.registerTool(new NewTool());
```

3. **Add tests**: `tests/unit/tools/new_tool.test.js`

```javascript
describe('NewTool', () => {
  // Test implementation
});
```

4. **Update documentation**:
   - Add to `docs/API_REFERENCE.md`
   - Add to `docs/TOOLS_GUIDE.md`
   - Add examples to `docs/EXAMPLES.md`

## Debugging

### Debug Mode

```bash
# Start with debugging
npm run debug

# Or with VS Code
# Use launch.json configuration
```

### VS Code Configuration

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Server",
      "program": "${workspaceFolder}/server.js",
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "*"
      }
    }
  ]
}
```

### Logging

```javascript
import { logger } from './utils/logger.js';

// Different log levels
logger.debug('Detailed debug info', { data });
logger.info('General information');
logger.warn('Warning message');
logger.error('Error occurred', { error });

// Structured logging
logger.info('Tool executed', {
  tool: 'fetch_url',
  duration: 245,
  success: true,
  url: 'https://example.com'
});
```

## Release Process

### Version Management

We follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0)**: Breaking changes
- **Minor (0.X.0)**: New features, backward compatible
- **Patch (0.0.X)**: Bug fixes

### Release Workflow

```bash
# 1. Update version
npm version minor

# 2. Update CHANGELOG
npm run changelog

# 3. Run all tests
npm run test:all

# 4. Build and verify
npm run build

# 5. Create release tag
git tag -a v3.1.0 -m "Release version 3.1.0"

# 6. Push to GitHub
git push origin main --tags

# 7. Publish to npm (if applicable)
npm publish
```

### Release Checklist

- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped
- [ ] Security audit passed
- [ ] Performance benchmarks run
- [ ] Docker image built
- [ ] Release notes written

---

## Development Resources

### Useful Links

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Web Scraping Ethics](https://blog.apify.com/web-scraping-ethics/)

### Getting Help

- **Discord**: [Join our community](https://discord.gg/webscraper)
- **GitHub Discussions**: [Ask questions](https://github.com/your-username/mcp-webscraper/discussions)
- **Stack Overflow**: Tag with `mcp-webscraper`

---

*Happy coding! Your contributions make MCP WebScraper better for everyone.*

*Last updated: January 2025 | Version: 3.0*