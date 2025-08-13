#!/usr/bin/env python3

# Mapping of schema names to their inline definitions
schema_replacements = {
    'ExtractMetadataSchema': '''{
    url: z.string().url()
  }''',
    
    'ScrapeStructuredSchema': '''{
    url: z.string().url(),
    selectors: z.record(z.string())
  }''',
    
    'SearchWebSchema': '''{
      query: z.string(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
      lang: z.string().optional(),
      safe_search: z.boolean().optional(),
      time_range: z.enum(['day', 'week', 'month', 'year', 'all']).optional(),
      site: z.string().optional(),
      file_type: z.string().optional()
    }''',
    
    'CrawlDeepSchema': '''{
    url: z.string().url(),
    max_depth: z.number().min(1).max(5).optional(),
    max_pages: z.number().min(1).max(1000).optional(),
    include_patterns: z.array(z.string()).optional(),
    exclude_patterns: z.array(z.string()).optional(),
    follow_external: z.boolean().optional(),
    respect_robots: z.boolean().optional(),
    extract_content: z.boolean().optional(),
    concurrency: z.number().min(1).max(20).optional()
  }''',
    
    'MapSiteSchema': '''{
    url: z.string().url(),
    include_sitemap: z.boolean().optional(),
    max_urls: z.number().min(1).max(10000).optional(),
    group_by_path: z.boolean().optional(),
    include_metadata: z.boolean().optional()
  }''',
    
    'ExtractContentSchema': '''{
    url: z.string().url(),
    options: z.object({}).optional()
  }''',
    
    'ProcessDocumentSchema': '''{
    source: z.string(),
    sourceType: z.enum(['url', 'pdf_url', 'file', 'pdf_file']).optional(),
    options: z.object({}).optional()
  }''',
    
    'SummarizeContentSchema': '''{
    text: z.string(),
    options: z.object({}).optional()
  }''',
    
    'AnalyzeContentSchema': '''{
    text: z.string(),
    options: z.object({}).optional()
  }'''
}

# Read the file
with open('server.js', 'r') as f:
    content = f.read()

# Replace each schema reference
for schema_name, inline_def in schema_replacements.items():
    old_pattern = f'inputSchema: {schema_name}'
    new_pattern = f'inputSchema: {inline_def}'
    content = content.replace(old_pattern, new_pattern)

# Write back
with open('server.js', 'w') as f:
    f.write(content)

print("Fixed all schema references to use inline definitions")