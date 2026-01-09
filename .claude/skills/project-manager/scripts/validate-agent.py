#!/usr/bin/env python3
"""
Validate agent names for project-manager skill.
Use this to verify an agent name before invocation.

Usage: python3 validate-agent.py <agent-name>
       python3 validate-agent.py --list
       python3 validate-agent.py --find <keyword>
"""

import sys
from typing import Optional

# Complete registry of available agents for CrawlForge MCP Server
AGENTS = {
    "project-manager": {
        "description": "Task coordination, parallel sub-agent delegation, progress tracking",
        "keywords": ["coordinate", "delegate", "task", "progress", "todo", "plan", "manage"],
    },
    "mcp-implementation": {
        "description": "Server code, tool implementation, SDK patterns, Zod schemas",
        "keywords": ["mcp", "server", "tool", "sdk", "zod", "schema", "implement", "protocol"],
    },
    "testing-validation": {
        "description": "MCP protocol compliance, tool testing, integration tests",
        "keywords": ["test", "validate", "compliance", "mcp", "integration", "qa", "quality"],
    },
    "security-auditor": {
        "description": "Security vulnerabilities, OWASP, SSRF protection, input validation",
        "keywords": ["security", "audit", "ssrf", "owasp", "vulnerability", "xss", "injection"],
    },
    "api-documenter": {
        "description": "API documentation, tool references, integration guides",
        "keywords": ["docs", "documentation", "api", "readme", "guide", "reference", "example"],
    },
    "deployment-manager": {
        "description": "npm publishing, Docker, version management, releases",
        "keywords": ["deploy", "npm", "docker", "release", "version", "publish", "ci", "cd"],
    },
    "performance-monitor": {
        "description": "Load testing, memory profiling, performance optimization",
        "keywords": ["performance", "memory", "benchmark", "optimize", "load", "profiling", "metrics"],
    },
}


def validate_agent(name: str) -> tuple[bool, Optional[str]]:
    """Validate if an agent name exists."""
    if name in AGENTS:
        return True, AGENTS[name]["description"]

    # Check for common mistakes
    suggestions = []
    name_lower = name.lower().replace("_", "-")

    for agent_name in AGENTS:
        if name_lower in agent_name or agent_name in name_lower:
            suggestions.append(agent_name)

    if suggestions:
        return False, f"Did you mean: {', '.join(suggestions)}?"

    return False, None


def find_agent_by_keyword(keyword: str) -> list[str]:
    """Find agents that match a keyword."""
    keyword_lower = keyword.lower()
    matches = []

    for agent_name, info in AGENTS.items():
        if keyword_lower in agent_name:
            matches.append(agent_name)
        elif any(keyword_lower in kw for kw in info["keywords"]):
            matches.append(agent_name)

    return matches


def list_all_agents():
    """List all available agents."""
    print("Available Agents for CrawlForge MCP Server:")
    print("=" * 60)
    for name, info in AGENTS.items():
        print(f"\n  {name}")
        print(f"    {info['description']}")


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 validate-agent.py <agent-name>")
        print("  python3 validate-agent.py --list")
        print("  python3 validate-agent.py --find <keyword>")
        sys.exit(1)

    arg = sys.argv[1]

    if arg == "--list":
        list_all_agents()
        return

    if arg == "--find":
        if len(sys.argv) < 3:
            print("Error: --find requires a keyword")
            sys.exit(1)
        keyword = sys.argv[2]
        matches = find_agent_by_keyword(keyword)
        if matches:
            print(f"Agents matching '{keyword}':")
            for match in matches:
                print(f"  - {match}: {AGENTS[match]['description']}")
        else:
            print(f"No agents found matching '{keyword}'")
        return

    # Validate agent name
    valid, message = validate_agent(arg)

    if valid:
        print(f"Valid agent: {arg}")
        print(f"   Description: {message}")
        print(f"\n   Invocation:")
        print(f'   Task(subagent_type="{arg}", prompt="...", description="...")')
    else:
        print(f"Invalid agent: {arg}")
        if message:
            print(f"   {message}")
        print("\n   Use --list to see all available agents")
        sys.exit(1)


if __name__ == "__main__":
    main()
