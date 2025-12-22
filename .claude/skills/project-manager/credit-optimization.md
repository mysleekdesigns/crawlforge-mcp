# CrawlForge Credit Optimization

## Tool Selection Decision Tree

### Need to discover URLs?
1. Use `map_site` (1 credit) to find all URLs first
2. Then use `batch_scrape` for selective processing

### Need content from multiple URLs?
- 2+ URLs → `batch_scrape` (3-5 credits)
- Single URL → `fetch_url` (1 credit)

### Need web search results?
- Use `search_web` (2 credits) with appropriate limits
- Consider caching for repeated queries

### Need deep website analysis?
1. Start with `map_site` to assess scope
2. Use `crawl_deep` (5-10 credits) for comprehensive crawling
3. Consider `deep_research` (10 credits) for multi-source analysis

### Need browser automation?
- Use `scrape_with_actions` for dynamic content
- Consider `stealth_mode` for anti-detection needs

## Credit Costs Reference

| Tool | Credits | Use Case |
|------|---------|----------|
| fetch_url | 1 | Single page HTML |
| extract_text | 1 | Plain text extraction |
| extract_links | 1 | Link discovery |
| extract_metadata | 1 | Page metadata |
| scrape_structured | 2 | CSS selector extraction |
| search_web | 2 | Web search |
| extract_content | 2 | Readability extraction |
| summarize_content | 2 | Content summarization |
| analyze_content | 3 | Content analysis |
| batch_scrape | 3-5 | Multiple URLs |
| crawl_deep | 5-10 | Recursive crawling |
| map_site | 1 | Site structure discovery |
| deep_research | 10 | Comprehensive research |
| stealth_mode | 5 | Anti-detection scraping |

## Budget Management

### Planning Phase
- Estimate total credits needed
- Choose most cost-effective tools
- Plan batch operations to minimize calls

### Execution Phase
- Use parallel execution for independent tasks
- Leverage caching to reduce redundant calls
- Monitor credit consumption per operation

### Optimization Phase
- Review tool usage patterns
- Identify opportunities for batching
- Implement caching strategies
