# Contributing to CrawlForge MCP Server

Thank you for your interest in contributing to CrawlForge MCP Server! We welcome contributions from the community.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on our [GitHub Issues](https://github.com/mysleekdesigns/crawlforge-mcp/issues) page with:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Your environment (Node.js version, OS, etc.)
- Any relevant logs or error messages

### Suggesting Features

We love feature suggestions! Please open an issue with:

- A clear description of the feature
- The problem it solves or use case it addresses
- Any implementation ideas you have
- Examples of how it would be used

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following our code style
4. **Test your changes**:
   ```bash
   npm test
   npm run test:tools
   npm run test:real-world
   ```
5. **Commit your changes** with a clear, descriptive commit message
6. **Push to your fork** and submit a pull request

#### Pull Request Guidelines

- Keep PRs focused on a single feature or bug fix
- Include tests for new functionality
- Update documentation as needed
- Follow the existing code style
- Ensure all tests pass before submitting

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/crawlforge-mcp.git
cd crawlforge-mcp

# Install dependencies
npm install

# Setup your API key
npm run setup

# Run in development mode
npm run dev

# Run tests
npm test
```

## Code Style

- Use ES6+ features and modern JavaScript
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

## Testing

- Write tests for new features
- Ensure existing tests pass
- Test edge cases and error conditions
- Include both unit and integration tests where appropriate

## Documentation

- Update README.md for user-facing changes
- Update CLAUDE.md for internal development changes
- Add JSDoc comments for new functions
- Include examples in documentation

## Questions?

If you have questions about contributing, feel free to:

- Open a discussion in GitHub Issues
- Email us at support@crawlforge.dev
- Join our Discord community

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other contributors

## License

By contributing to CrawlForge MCP Server, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for helping make CrawlForge MCP Server better!** 🎉
