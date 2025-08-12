#!/usr/bin/env node

/**
 * Demo script showing enhanced query expansion capabilities
 * Run: node examples/query-expansion-demo.js
 */

import { QueryExpander } from '../src/tools/search/queryExpander.js';

console.log('🚀 Query Expansion Demo\n');

const expander = new QueryExpander({
  enableSynonyms: true,
  enableSpellCheck: true,
  enableStemming: true,
  enablePhraseDetection: true,
  enableBooleanOperators: true,
  maxExpansions: 6
});

const demoQueries = [
  'javascript tutorial',
  'machien learning', // misspelling
  'web development best practices',
  'React components guide'
];

for (const query of demoQueries) {
  console.log(`🔍 Original: "${query}"`);
  
  const expansions = await expander.expandQuery(query);
  console.log('📈 Expansions:');
  expansions.forEach((exp, i) => console.log(`   ${i + 1}. ${exp}`));
  
  const suggestions = expander.generateSuggestions(query);
  console.log('💡 Suggestions:');
  suggestions.slice(0, 3).forEach((sug, i) => console.log(`   ${i + 1}. ${sug}`));
  
  console.log('');
}

console.log('📊 Capabilities:');
console.log(JSON.stringify(expander.getStats().capabilities, null, 2));