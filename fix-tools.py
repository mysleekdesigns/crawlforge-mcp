#!/usr/bin/env python3

"""
Script to convert all MCP tools from server.tool() to server.registerTool() pattern
"""

import re
import sys

def read_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(filepath, content):
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

def convert_tool_to_register_tool(content):
    """Convert server.tool() calls to server.registerTool() calls"""
    
    # Pattern to match server.tool calls with their schemas and handlers
    tool_pattern = r'server\.tool\(\s*"([^"]+)",\s*"([^"]+)",\s*\{([^}]+)\},\s*async\s*\(([^)]*)\)\s*=>\s*\{'
    
    def replace_tool(match):
        tool_name = match.group(1)
        description = match.group(2)
        old_schema = match.group(3)
        params = match.group(4)
        
        print(f"Converting tool: {tool_name}")
        
        # Convert old schema format to new inputSchema format
        # This is a simple conversion - may need manual adjustment
        new_schema = convert_schema_format(old_schema)
        
        # Convert function parameters to destructuring format
        new_params = convert_params_format(params, old_schema)
        
        return f'server.registerTool("{tool_name}", {{\n  description: "{description}",\n  inputSchema: {{\n{new_schema}\n  }}\n}}, async ({new_params}) => {{'
    
    return re.sub(tool_pattern, replace_tool, content, flags=re.MULTILINE | re.DOTALL)

def convert_schema_format(old_schema):
    """Convert old schema format to new inputSchema format"""
    # This is a simplified conversion
    # In practice, we'll need to manually define these schemas
    return "    // TODO: Define proper Zod schemas here"

def convert_params_format(params, schema):
    """Convert function parameters to destructuring format"""
    # Extract parameter names from schema
    # This is simplified - we'll manually define the proper destructuring
    return "/* TODO: Add destructured parameters */"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 fix-tools.py <server.js>")
        sys.exit(1)
    
    filepath = sys.argv[1]
    content = read_file(filepath)
    
    # Apply the conversion
    new_content = convert_tool_to_register_tool(content)
    
    # Write back
    write_file(filepath, new_content)
    print("Tool conversion completed!")