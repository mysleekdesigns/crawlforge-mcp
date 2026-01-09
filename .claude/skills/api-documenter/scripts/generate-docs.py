#!/usr/bin/env python3
"""
Generate API documentation from MCP tool schemas.

Extracts tool definitions from server.js and generates markdown documentation.
Usage: python3 generate-docs.py [--output FILE] [--format FORMAT]
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent.parent.parent


def extract_tools(server_content: str) -> list[dict]:
    """Extract tool definitions from server.js."""
    tools = []

    # Pattern to match tool registrations
    # Look for server.registerTool("name", { description, inputSchema }, handler)
    pattern = r'server\.registerTool\(\s*["\'](\w+)["\']\s*,\s*\{\s*description:\s*["\']([^"\']+)["\']'

    matches = re.finditer(pattern, server_content, re.DOTALL)

    for match in matches:
        tool_name = match.group(1)
        description = match.group(2)

        tools.append({
            "name": tool_name,
            "description": description,
        })

    return tools


def categorize_tools(tools: list[dict]) -> dict[str, list[dict]]:
    """Categorize tools by their type."""
    categories = {
        "Basic Tools": ["fetch_url", "extract_text", "extract_links", "extract_metadata", "scrape_structured"],
        "Search & Crawl": ["search_web", "crawl_deep", "map_site"],
        "Content Processing": ["extract_content", "process_document", "summarize_content", "analyze_content"],
        "Advanced (Wave 2)": ["batch_scrape", "scrape_with_actions"],
        "Research & Tracking (Wave 3)": ["deep_research", "track_changes", "generate_llms_txt", "stealth_mode", "localization"],
    }

    categorized = {cat: [] for cat in categories}
    uncategorized = []

    tool_map = {t["name"]: t for t in tools}

    for category, tool_names in categories.items():
        for name in tool_names:
            if name in tool_map:
                categorized[category].append(tool_map[name])

    # Find uncategorized
    all_categorized = set()
    for names in categories.values():
        all_categorized.update(names)

    for tool in tools:
        if tool["name"] not in all_categorized:
            uncategorized.append(tool)

    if uncategorized:
        categorized["Other"] = uncategorized

    return categorized


def generate_markdown(tools: list[dict], version: str) -> str:
    """Generate markdown documentation."""
    categorized = categorize_tools(tools)

    lines = [
        "# CrawlForge MCP Server - Tool Reference",
        "",
        f"**Version:** {version}",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"**Total Tools:** {len(tools)}",
        "",
        "---",
        "",
        "## Table of Contents",
        "",
    ]

    # TOC
    for category in categorized:
        if categorized[category]:
            anchor = category.lower().replace(" ", "-").replace("(", "").replace(")", "")
            lines.append(f"- [{category}](#{anchor})")

    lines.extend(["", "---", ""])

    # Tool sections
    for category, cat_tools in categorized.items():
        if not cat_tools:
            continue

        lines.append(f"## {category}")
        lines.append("")

        for tool in cat_tools:
            lines.append(f"### `{tool['name']}`")
            lines.append("")
            lines.append(tool["description"])
            lines.append("")
            lines.append("**Usage:**")
            lines.append("```json")
            lines.append("{")
            lines.append(f'  "name": "{tool["name"]}",')
            lines.append('  "arguments": {')
            lines.append('    // Tool-specific parameters')
            lines.append('  }')
            lines.append("}")
            lines.append("```")
            lines.append("")

        lines.append("---")
        lines.append("")

    # Credit costs
    lines.extend([
        "## Credit Costs",
        "",
        "| Tool | Credits |",
        "|------|---------|",
        "| fetch_url | 1 |",
        "| extract_text | 1 |",
        "| extract_links | 1 |",
        "| extract_metadata | 1 |",
        "| scrape_structured | 2 |",
        "| search_web | 5 |",
        "| crawl_deep | 5 |",
        "| map_site | 5 |",
        "| extract_content | 2 |",
        "| process_document | 2 |",
        "| summarize_content | 2 |",
        "| analyze_content | 2 |",
        "| batch_scrape | 5 |",
        "| scrape_with_actions | 5 |",
        "| deep_research | 10 |",
        "| track_changes | 3 |",
        "| generate_llms_txt | 3 |",
        "| stealth_mode | 5 |",
        "| localization | 5 |",
        "",
    ])

    return "\n".join(lines)


def generate_json(tools: list[dict], version: str) -> str:
    """Generate JSON documentation."""
    return json.dumps({
        "version": version,
        "generated": datetime.now().isoformat(),
        "total_tools": len(tools),
        "tools": tools,
        "categories": categorize_tools(tools),
    }, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Generate API documentation")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")
    parser.add_argument("--format", "-f", choices=["markdown", "json"], default="markdown", help="Output format")
    args = parser.parse_args()

    project_root = get_project_root()
    server_path = project_root / "server.js"
    package_path = project_root / "package.json"

    if not server_path.exists():
        print("Error: server.js not found", file=sys.stderr)
        sys.exit(1)

    # Get version
    version = "unknown"
    if package_path.exists():
        with open(package_path) as f:
            version = json.load(f).get("version", "unknown")

    # Extract tools
    with open(server_path) as f:
        content = f.read()

    tools = extract_tools(content)

    if not tools:
        print("Warning: No tools found in server.js", file=sys.stderr)

    # Generate output
    if args.format == "markdown":
        output = generate_markdown(tools, version)
    else:
        output = generate_json(tools, version)

    # Write output
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
        print(f"Documentation written to: {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
