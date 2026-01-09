#!/bin/bash
# Release script for CrawlForge MCP Server
# Usage: ./release.sh [patch|minor|major]
# Automates version bump, git tag, and npm publish

set -e

VERSION_TYPE=${1:-patch}
PROJECT_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)

cd "$PROJECT_ROOT"

echo "=== CrawlForge MCP Server Release ==="
echo "Version type: $VERSION_TYPE"
echo "Project root: $PROJECT_ROOT"
echo ""

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Invalid version type: $VERSION_TYPE"
  echo "Usage: ./release.sh [patch|minor|major]"
  exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "Error: Uncommitted changes detected"
  echo "Please commit or stash your changes before releasing"
  git status --short
  exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Bump version
echo ""
echo "Bumping $VERSION_TYPE version..."
npm version $VERSION_TYPE --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Update version in server.js
echo ""
echo "Updating version in server.js..."
sed -i '' "s/version: \"[0-9]*\.[0-9]*\.[0-9]*\"/version: \"$NEW_VERSION\"/" server.js

# Run tests
echo ""
echo "Running tests..."
npm test

# Build check
echo ""
echo "Running build check..."
npm run build 2>/dev/null || echo "No build script defined, skipping..."

# Git commit and tag
echo ""
echo "Creating git commit and tag..."
git add -A
git commit -m "chore: bump version to $NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo ""
echo "=== Release Summary ==="
echo "Version: $CURRENT_VERSION -> $NEW_VERSION"
echo "Git tag: v$NEW_VERSION"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git log -1"
echo "  2. Push to remote: git push && git push --tags"
echo "  3. Publish to npm: npm publish"
echo ""
echo "Or run all at once:"
echo "  git push && git push --tags && npm publish"
