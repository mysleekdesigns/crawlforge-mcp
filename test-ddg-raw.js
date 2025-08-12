#!/usr/bin/env node

import * as cheerio from 'cheerio';

async function testDuckDuckGoRaw() {
  console.log('Testing raw DuckDuckGo HTML search...\n');
  
  const query = 'javascript tutorial';
  const formData = new URLSearchParams({
    q: query,
    b: '',
    kl: 'us-en',
    kp: '-2'
  });
  
  console.log('Making request to DuckDuckGo HTML endpoint...');
  console.log('URL: https://html.duckduckgo.com/html/');
  console.log('Query:', query);
  console.log('Form data:', formData.toString());
  
  try {
    const response = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://duckduckgo.com/',
        'Origin': 'https://duckduckgo.com'
      },
      body: formData.toString()
    });
    
    console.log('\nResponse status:', response.status);
    console.log('Response headers:');
    console.log('- Content-Type:', response.headers.get('content-type'));
    console.log('- Content-Length:', response.headers.get('content-length'));
    
    const html = await response.text();
    console.log('\nHTML length:', html.length, 'characters');
    
    // Parse with Cheerio
    const $ = cheerio.load(html);
    
    // Try different selectors
    console.log('\n=== Trying Different Selectors ===');
    
    const selectors = [
      '.result',
      '.results_links',
      '.web-result',
      '.result__body',
      'div[data-domain]',
      '.result--sep',
      '.result--more',
      'div.links_main',
      'div.result__wrap'
    ];
    
    for (const selector of selectors) {
      const count = $(selector).length;
      if (count > 0) {
        console.log(`✓ Found ${count} elements with selector: ${selector}`);
      }
    }
    
    // Try to extract actual results
    console.log('\n=== Extracting Results ===');
    
    const results = [];
    
    // Primary strategy
    $('.result').each((i, elem) => {
      const $elem = $(elem);
      
      // Skip ads and special results
      if ($elem.hasClass('result--ad') || $elem.hasClass('result--more')) {
        return;
      }
      
      const titleElem = $elem.find('a.result__a, .result__title a, h2 a').first();
      const snippetElem = $elem.find('.result__snippet, .result-snippet, .snippet').first();
      
      const title = titleElem.text().trim();
      const url = titleElem.attr('href');
      const snippet = snippetElem.text().trim();
      
      if (title && url && !url.startsWith('/y.js')) {
        results.push({ title, url, snippet });
      }
    });
    
    console.log(`Found ${results.length} results`);
    
    if (results.length > 0) {
      console.log('\nFirst 3 results:');
      results.slice(0, 3).forEach((result, i) => {
        console.log(`\n${i + 1}. ${result.title}`);
        console.log(`   URL: ${result.url}`);
        console.log(`   Snippet: ${result.snippet?.substring(0, 100)}...`);
      });
    } else {
      console.log('\nNo results found. Checking page content...');
      
      // Check for error messages
      const noResults = $('div:contains("No results found")').length > 0;
      if (noResults) {
        console.log('Page indicates: No results found');
      }
      
      // Sample HTML structure
      console.log('\nFirst 500 chars of body HTML:');
      const bodyHtml = $('body').html();
      console.log(bodyHtml ? bodyHtml.substring(0, 500) : 'No body content');
    }
    
  } catch (error) {
    console.error('Request failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testDuckDuckGoRaw().catch(console.error);