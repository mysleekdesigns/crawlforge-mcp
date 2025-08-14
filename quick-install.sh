#!/bin/bash

# MCP WebScraper Quick Installation Script
# This script installs the MCP WebScraper server in your project

echo "🚀 MCP WebScraper Quick Installer"
echo "================================="
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js and npm first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

# Ask for installation method
echo "Choose installation method:"
echo "1) Global installation (available system-wide)"
echo "2) Local installation (current project only)"
echo "3) Just run with npx (no installation)"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo "📦 Installing globally..."
        npm install -g mcp-webscraper@latest
        echo ""
        echo "✅ Global installation complete!"
        echo "Run 'mcp-webscraper' from anywhere"
        ;;
    2)
        echo "📦 Installing locally..."
        npm install mcp-webscraper@latest
        echo ""
        echo "✅ Local installation complete!"
        echo "Run 'npx mcp-webscraper' in this project"
        ;;
    3)
        echo "📦 Preparing npx command..."
        echo ""
        echo "✅ You can run the server with:"
        echo "npx mcp-webscraper@latest"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "📝 MCP Configuration"
echo "==================="
echo ""
echo "Add this to your Claude MCP settings:"
echo ""
cat << 'EOF'
{
  "webscraper": {
    "command": "npx",
    "args": ["mcp-webscraper@latest"],
    "env": {
      "SEARCH_PROVIDER": "duckduckgo"
    }
  }
}
EOF

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy the configuration above"
echo "2. Add it to your Claude MCP settings"
echo "3. Restart Claude to load the server"
echo ""
echo "For Google search support, add:"
echo "  GOOGLE_API_KEY: 'your-api-key'"
echo "  GOOGLE_SEARCH_ENGINE_ID: 'your-engine-id'"
echo ""
echo "Documentation: https://github.com/mcp-webscraper/mcp-webscraper"