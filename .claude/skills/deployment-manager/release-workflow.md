# Release Workflow

## Pre-release Checks

```bash
# Run tests
npm test

# Audit dependencies
npm audit

# Check package size
npm pack --dry-run

# Verify build
npm run build
```

## Version Update

```bash
# Update version
npm version minor

# Update changelog
npm run changelog

# Commit changes
git add -A
git commit -m "chore: release v$(node -p "require('./package.json').version")"
```

## Publishing

```bash
# Publish to npm
npm publish

# Tag release
git tag -a v$(node -p "require('./package.json').version") -m "Release v$(node -p "require('./package.json').version")"
git push origin main --tags
```

## package.json Configuration

```json
{
  "name": "crawlforge-mcp-server",
  "version": "3.0.3",
  "main": "server.js",
  "bin": {
    "crawlforge-mcp-server": "./server.js"
  },
  "files": [
    "server.js",
    "src/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "prepublishOnly": "npm test && npm run lint",
    "preversion": "npm test",
    "version": "npm run changelog && git add -A",
    "postversion": "git push && git push --tags"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

## GitHub Actions Release

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Environment Configuration

### Development
```env
NODE_ENV=development
LOG_LEVEL=debug
```

### Production
```env
NODE_ENV=production
LOG_LEVEL=error
MONITORING_ENABLED=true
```
