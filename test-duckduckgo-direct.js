#!/usr/bin/env node

import { DuckDuckGoSearchAdapter } from './src/tools/search/adapters/duckduckgoSearch.js';

async function testDuckDuckGo() {
  console.log('Testing DuckDuckGo adapter directly...\n');
  
  const adapter = new DuckDuckGoSearchAdapter();
  
  try {
    // Test basic search
    console.log('Searching for "javascript tutorial"...');
    const results = await adapter.search({
      query: 'javascript tutorial',
      num: 5,
      start: 1
    });
    
    console.log('\nRaw response structure:');
    console.log('- kind:', results.kind);
    console.log('- searchInformation:', JSON.stringify(results.searchInformation, null, 2));
    console.log('- items count:', results.items ? results.items.length : 0);
    
    if (results.items && results.items.length > 0) {
      console.log('\nSearch Results:');
      results.items.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.title}`);
        console.log(`   URL: ${item.link}`);
        console.log(`   Display: ${item.displayLink}`);
        console.log(`   Snippet: ${item.snippet?.substring(0, 100)}...`);
      });
    } else {
      console.log('\nNo results found or parsing failed');
      console.log('Full response:', JSON.stringify(results, null, 2));
    }
    
    // Test validate method
    console.log('\n\nTesting validateApiKey method...');
    const isValid = await adapter.validateApiKey();
    console.log('Validation result:', isValid);
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testDuckDuckGo().catch(console.error);