# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server implementation for web scraping functionality. The project uses the MCP SDK to create a server that can be used for web scraping tasks.

## Architecture

- **server.js**: Main entry point that sets up the MCP server using the MCP SDK
- Uses ES modules (`"type": "module"` in package.json)
- Built on `@modelcontextprotocol/sdk` for MCP server functionality

## Development Commands

```bash
# Install dependencies
npm install

# No build step required - runs directly with Node.js

# No test command configured yet
# Currently package.json shows: "test": "echo \"Error: no test specified\" && exit 1"
```

## Running the Server

This is an MCP server that communicates via stdio transport. To run:

```bash
node server.js
```

## Dependencies

- `@modelcontextprotocol/sdk`: Core MCP SDK for building the server
- its august 2025 so always search to the latest date