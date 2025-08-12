#!/usr/bin/env node

/**
 * Enhanced Sitemap Parser Usage Examples
 * 
 * This file demonstrates the new capabilities of the enhanced sitemap parser
 * and mapSite tool in the MCP WebScraper project.
 */

import { SitemapParser } from '../src/utils/sitemapParser.js';
import { MapSiteTool } from '../src/tools/crawl/mapSite.js';

// Example 1: Basic Enhanced Sitemap Parsing
async function basicSitemapParsing() {
  console.log('📄 Example 1: Basic Enhanced Sitemap Parsing\n');
  
  const parser = new SitemapParser({
    userAgent: 'Enhanced-Example/1.0',
    timeout: 10000,
    enableCaching: true
  });

  try {
    // Parse a sitemap with metadata
    const result = await parser.parseSitemap('https://example.com/sitemap.xml', {
      includeMetadata: true,
      followIndexes: true,
      maxDepth: 2
    });

    if (result.success) {
      console.log(`✅ Successfully parsed sitemap:`);
      console.log(`   - URLs found: ${result.urls.length}`);
      console.log(`   - Has images: ${result.metadata.images?.length > 0}`);
      console.log(`   - Has videos: ${result.metadata.videos?.length > 0}`);
      console.log(`   - Cache hits: ${result.statistics.cacheHits}`);
      console.log(`   - Compression savings: ${result.statistics.compressionSavingsKB}KB`);
    } else {
      console.log(`❌ Parsing failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  console.log('');
}

// Example 2: Sitemap Discovery
async function sitemapDiscovery() {
  console.log('🔍 Example 2: Automatic Sitemap Discovery\n');
  
  const parser = new SitemapParser();

  try {
    // Discover all sitemaps for a domain
    const sitemaps = await parser.discoverSitemaps('https://example.com', {
      checkRobotsTxt: true,
      checkCommonPaths: true,
      checkSitemapIndex: true
    });

    console.log(`✅ Discovered ${sitemaps.length} potential sitemaps:`);
    sitemaps.slice(0, 5).forEach((sitemap, index) => {
      console.log(`   ${index + 1}. ${sitemap}`);
    });
  } catch (error) {
    console.log(`❌ Discovery failed: ${error.message}`);
  }
  
  console.log('');
}

// Example 3: Advanced URL Filtering
async function advancedFiltering() {
  console.log('🔧 Example 3: Advanced URL Filtering\n');
  
  const parser = new SitemapParser();
  
  // Mock sitemap data for demonstration
  const mockSitemapData = {
    success: true,
    urls: [
      { 
        loc: 'https://example.com/', 
        lastmod: '2024-01-15', 
        changefreq: 'daily', 
        priority: '1.0' 
      },
      { 
        loc: 'https://example.com/blog/post-1', 
        lastmod: '2024-01-10', 
        changefreq: 'weekly', 
        priority: '0.8' 
      },
      { 
        loc: 'https://example.com/blog/post-2', 
        lastmod: '2024-01-05', 
        changefreq: 'weekly', 
        priority: '0.7' 
      },
      { 
        loc: 'https://example.com/about', 
        lastmod: '2023-12-01', 
        changefreq: 'monthly', 
        priority: '0.5' 
      }
    ],
    metadata: {}
  };

  try {
    // Filter for high-priority, recently updated URLs
    const filtered = parser.extractUrls(mockSitemapData, {
      priorityFilter: { min: 0.7, max: 1.0 },
      lastModAfter: '2024-01-01',
      pathFilter: '/(blog|about)/'
    });

    console.log(`✅ Filtered ${filtered.length} URLs from ${mockSitemapData.urls.length} total:`);
    filtered.forEach((url, index) => {
      console.log(`   ${index + 1}. ${url.url} (priority: ${url.priority})`);
    });
  } catch (error) {
    console.log(`❌ Filtering failed: ${error.message}`);
  }
  
  console.log('');
}

// Example 4: Enhanced MapSite Tool Usage
async function enhancedMapSite() {
  console.log('🗺️  Example 4: Enhanced MapSite Tool\n');
  
  const mapTool = new MapSiteTool({
    userAgent: 'Enhanced-MapSite/1.0',
    enableCaching: true
  });

  try {
    // Use enhanced sitemap features
    const result = await mapTool.execute({
      url: 'https://example.com',
      include_sitemap: true,
      include_sitemap_metadata: true,
      follow_sitemap_indexes: true,
      discover_sitemaps: true,
      sitemap_only: false,
      max_urls: 100
    });

    console.log(`✅ Enhanced mapping completed:`);
    console.log(`   - Total URLs: ${result.total_urls}`);
    console.log(`   - Unique paths: ${result.statistics.unique_paths}`);
    console.log(`   - Secure URLs: ${result.statistics.secure_urls}`);
    console.log(`   - Content types:`, result.statistics.content_types);
    
    if (result.sitemap_data) {
      console.log(`   - Sitemap URLs: ${result.sitemap_data.urls_from_sitemaps}`);
      console.log(`   - Discovered sitemaps: ${result.sitemap_data.discovered_sitemaps.length}`);
    }
  } catch (error) {
    console.log(`❌ Enhanced mapping failed: ${error.message}`);
  }
  
  console.log('');
}

// Example 5: Sitemap Analysis
async function sitemapAnalysis() {
  console.log('📊 Example 5: Detailed Sitemap Analysis\n');
  
  const mapTool = new MapSiteTool();

  try {
    // Analyze all sitemaps for a domain
    const analysis = await mapTool.analyzeSitemaps('https://example.com');

    console.log(`✅ Sitemap analysis completed:`);
    console.log(`   - Discovered sitemaps: ${analysis.discovered_sitemaps.length}`);
    
    analysis.sitemap_analysis.forEach((sitemap, index) => {
      console.log(`   ${index + 1}. ${sitemap.url}`);
      console.log(`      - URLs: ${sitemap.url_count}`);
      console.log(`      - Images: ${sitemap.has_images ? 'Yes' : 'No'}`);
      console.log(`      - Videos: ${sitemap.has_videos ? 'Yes' : 'No'}`);
      console.log(`      - Last modified: ${sitemap.last_modified || 'Unknown'}`);
    });
  } catch (error) {
    console.log(`❌ Analysis failed: ${error.message}`);
  }
  
  console.log('');
}

// Example 6: Cache Management
async function cacheManagement() {
  console.log('💾 Example 6: Cache Management\n');
  
  const mapTool = new MapSiteTool({ enableCaching: true });

  try {
    // Get cache statistics
    const stats = mapTool.getCacheStats();
    
    console.log(`📈 Cache Statistics:`);
    if (stats.mapsite_cache) {
      console.log(`   - MapSite cache: ${stats.mapsite_cache.memorySize}/${stats.mapsite_cache.memoryMax} items`);
      console.log(`   - Hit rate: ${stats.mapsite_cache.hitRate.toFixed(1)}%`);
    }
    if (stats.sitemap_cache) {
      console.log(`   - Sitemap cache: ${stats.sitemap_cache.memorySize}/${stats.sitemap_cache.memoryMax} items`);
      console.log(`   - Hit rate: ${stats.sitemap_cache.hitRate.toFixed(1)}%`);
    }

    // Clear caches
    await mapTool.clearCache();
    console.log(`✅ Caches cleared successfully`);
  } catch (error) {
    console.log(`❌ Cache management failed: ${error.message}`);
  }
  
  console.log('');
}

// Example 7: Error Handling and Resilience
async function errorHandling() {
  console.log('⚠️  Example 7: Error Handling and Resilience\n');
  
  const parser = new SitemapParser({
    timeout: 5000,
    enableCaching: false
  });

  // Test with various problematic URLs
  const testUrls = [
    'https://nonexistent-domain-12345.com/sitemap.xml',
    'https://httpstat.us/404/sitemap.xml',
    'https://httpstat.us/500/sitemap.xml'
  ];

  for (const url of testUrls) {
    try {
      console.log(`Testing: ${url}`);
      const result = await parser.parseSitemap(url);
      
      if (result.success) {
        console.log(`   ✅ Success: ${result.urls.length} URLs found`);
      } else {
        console.log(`   ⚠️  Handled gracefully: ${result.error}`);
      }
    } catch (error) {
      console.log(`   ❌ Unexpected error: ${error.message}`);
    }
  }
  
  console.log('');
}

// Run all examples
async function runAllExamples() {
  console.log('🚀 Enhanced Sitemap Parser Examples\n');
  console.log('=' .repeat(60));
  console.log('');

  await basicSitemapParsing();
  await sitemapDiscovery();
  await advancedFiltering();
  await enhancedMapSite();
  await sitemapAnalysis();
  await cacheManagement();
  await errorHandling();

  console.log('🎉 All examples completed!');
  console.log('=' .repeat(60));
}

// Export functions for individual testing
export {
  basicSitemapParsing,
  sitemapDiscovery,
  advancedFiltering,
  enhancedMapSite,
  sitemapAnalysis,
  cacheManagement,
  errorHandling
};

// Run examples if this file is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runAllExamples().catch(error => {
    console.error('❌ Examples failed:', error.message);
    process.exit(1);
  });
}