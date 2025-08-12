/**
 * Worker thread script for CPU-intensive tasks
 * Handles HTML parsing, content analysis, and other computationally expensive operations
 */

import { parentPort } from 'worker_threads';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import compromise from 'compromise';
import { franc } from 'franc';

// Task handlers
const taskHandlers = {
  parseHtml: handleParseHtml,
  extractContent: handleExtractContent,
  analyzeText: handleAnalyzeText,
  processStructuredData: handleProcessStructuredData,
  calculateSimilarity: handleCalculateSimilarity,
  validateUrls: handleValidateUrls,
  normalizeData: handleNormalizeData,
  computeHash: handleComputeHash
};

// Listen for messages from main thread
parentPort.on('message', async (message) => {
  const { taskId, type, data } = message;
  
  try {
    const handler = taskHandlers[type];
    if (!handler) {
      throw new Error(`Unknown task type: ${type}`);
    }

    const result = await handler(data);
    
    parentPort.postMessage({
      taskId,
      result
    });
  } catch (error) {
    parentPort.postMessage({
      taskId,
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * Parse HTML and extract basic structure
 * @param {Object} data - Task data
 * @returns {Object} - Parsed HTML structure
 */
async function handleParseHtml(data) {
  const { html, options = {} } = data;
  const { 
    extractText = true, 
    extractLinks = true, 
    extractImages = true,
    extractMeta = true,
    removeScripts = true
  } = options;

  const $ = cheerio.load(html);
  const result = {};

  // Remove scripts and styles if requested
  if (removeScripts) {
    $('script, style').remove();
  }

  // Extract text content
  if (extractText) {
    result.text = $('body').text().trim();
    result.title = $('title').text().trim();
  }

  // Extract links
  if (extractLinks) {
    result.links = [];
    $('a[href]').each((_, element) => {
      const $link = $(element);
      result.links.push({
        href: $link.attr('href'),
        text: $link.text().trim(),
        title: $link.attr('title') || null
      });
    });
  }

  // Extract images
  if (extractImages) {
    result.images = [];
    $('img[src]').each((_, element) => {
      const $img = $(element);
      result.images.push({
        src: $img.attr('src'),
        alt: $img.attr('alt') || null,
        title: $img.attr('title') || null,
        width: $img.attr('width') || null,
        height: $img.attr('height') || null
      });
    });
  }

  // Extract meta information
  if (extractMeta) {
    result.meta = {};
    $('meta').each((_, element) => {
      const $meta = $(element);
      const name = $meta.attr('name') || $meta.attr('property');
      const content = $meta.attr('content');
      if (name && content) {
        result.meta[name] = content;
      }
    });
  }

  return result;
}

/**
 * Extract main content using Mozilla Readability
 * @param {Object} data - Task data
 * @returns {Object} - Extracted content
 */
async function handleExtractContent(data) {
  const { html, url, options = {} } = data;
  const {
    removeBoilerplate = true,
    extractStructuredData = true,
    calculateReadability = true
  } = options;

  const result = {};

  // Create JSDOM instance
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  // Use Readability for main content extraction
  if (removeBoilerplate) {
    const reader = new Readability(document, {
      debug: false,
      maxElemsToDivide: 300,
      charThreshold: 500
    });

    const article = reader.parse();
    if (article) {
      result.article = {
        title: article.title,
        content: article.content,
        textContent: article.textContent,
        length: article.length,
        excerpt: article.excerpt,
        byline: article.byline,
        dir: article.dir,
        siteName: article.siteName,
        lang: article.lang
      };

      // Calculate readability if requested
      if (calculateReadability && article.textContent) {
        result.readability = calculateReadabilityScore(article.textContent);
      }
    }
  }

  // Extract structured data
  if (extractStructuredData) {
    result.structuredData = extractStructuredData(html);
  }

  return result;
}

/**
 * Analyze text content for various metrics
 * @param {Object} data - Task data
 * @returns {Object} - Text analysis results
 */
async function handleAnalyzeText(data) {
  const { text, options = {} } = data;
  const {
    detectLanguage = true,
    extractEntities = true,
    analyzeSentiment = true,
    extractKeywords = true,
    calculateMetrics = true
  } = options;

  const result = {};

  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text input for analysis');
  }

  // Detect language
  if (detectLanguage) {
    try {
      result.language = franc(text);
    } catch (error) {
      result.language = 'unknown';
    }
  }

  // Use compromise for NLP analysis
  const doc = compromise(text);

  // Extract entities
  if (extractEntities) {
    result.entities = {
      people: doc.people().out('array'),
      places: doc.places().out('array'),
      organizations: doc.organizations().out('array'),
      topics: doc.topics().out('array')
    };
  }

  // Basic sentiment analysis
  if (analyzeSentiment) {
    result.sentiment = analyzeSentiment(text);
  }

  // Extract keywords
  if (extractKeywords) {
    result.keywords = extractKeywords(doc);
  }

  // Calculate text metrics
  if (calculateMetrics) {
    result.metrics = calculateTextMetrics(text);
  }

  return result;
}

/**
 * Process structured data from HTML
 * @param {Object} data - Task data
 * @returns {Object} - Processed structured data
 */
async function handleProcessStructuredData(data) {
  const { html, options = {} } = data;
  const {
    extractJsonLd = true,
    extractMicrodata = true,
    extractSchemaOrg = true,
    validateSchema = true
  } = options;

  const $ = cheerio.load(html);
  const result = {
    jsonLd: [],
    microdata: [],
    schemaOrg: []
  };

  // Extract JSON-LD
  if (extractJsonLd) {
    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const jsonText = $(element).html();
        if (jsonText) {
          const parsed = JSON.parse(jsonText);
          result.jsonLd.push(parsed);
        }
      } catch (error) {
        // Skip invalid JSON-LD
      }
    });
  }

  // Extract microdata
  if (extractMicrodata) {
    $('[itemscope]').each((_, element) => {
      const item = extractMicrodataItem($, element);
      if (item) {
        result.microdata.push(item);
      }
    });
  }

  // Extract schema.org markup
  if (extractSchemaOrg) {
    $('[typeof], [property], [vocab]').each((_, element) => {
      const schemaItem = extractSchemaOrgItem($, element);
      if (schemaItem) {
        result.schemaOrg.push(schemaItem);
      }
    });
  }

  return result;
}

/**
 * Calculate similarity between two pieces of text
 * @param {Object} data - Task data
 * @returns {Object} - Similarity metrics
 */
async function handleCalculateSimilarity(data) {
  const { text1, text2, algorithm = 'jaccard' } = data;

  if (!text1 || !text2) {
    throw new Error('Two text inputs required for similarity calculation');
  }

  const result = {};

  switch (algorithm) {
    case 'jaccard':
      result.jaccardSimilarity = calculateJaccardSimilarity(text1, text2);
      break;
    case 'cosine':
      result.cosineSimilarity = calculateCosineSimilarity(text1, text2);
      break;
    case 'levenshtein':
      result.levenshteinDistance = calculateLevenshteinDistance(text1, text2);
      break;
    default:
      // Calculate all
      result.jaccardSimilarity = calculateJaccardSimilarity(text1, text2);
      result.cosineSimilarity = calculateCosineSimilarity(text1, text2);
      result.levenshteinDistance = calculateLevenshteinDistance(text1, text2);
  }

  return result;
}

/**
 * Validate and normalize URLs
 * @param {Object} data - Task data
 * @returns {Object} - Validation results
 */
async function handleValidateUrls(data) {
  const { urls, options = {} } = data;
  const {
    checkReachability = false,
    normalizeUrls = true,
    extractDomains = true
  } = options;

  if (!Array.isArray(urls)) {
    throw new Error('URLs must be provided as an array');
  }

  const result = {
    valid: [],
    invalid: [],
    normalized: [],
    domains: new Set()
  };

  for (const url of urls) {
    try {
      const urlObj = new URL(url);
      result.valid.push(url);
      
      if (normalizeUrls) {
        result.normalized.push(normalizeUrl(url));
      }
      
      if (extractDomains) {
        result.domains.add(urlObj.hostname);
      }
    } catch (error) {
      result.invalid.push({ url, error: error.message });
    }
  }

  result.domains = Array.from(result.domains);
  
  return result;
}

/**
 * Normalize data structures
 * @param {Object} data - Task data
 * @returns {Object} - Normalized data
 */
async function handleNormalizeData(data) {
  const { input, schema, options = {} } = data;
  const { removeNulls = true, trimStrings = true, lowercaseKeys = false } = options;

  const result = normalizeObject(input, { removeNulls, trimStrings, lowercaseKeys });
  
  // Validate against schema if provided
  if (schema) {
    result.isValid = validateAgainstSchema(result.data, schema);
  }

  return result;
}

/**
 * Compute various hashes for data
 * @param {Object} data - Task data
 * @returns {Object} - Hash results
 */
async function handleComputeHash(data) {
  const { input, algorithms = ['md5', 'sha1', 'sha256'] } = data;
  
  const { createHash } = await import('crypto');
  const inputString = typeof input === 'string' ? input : JSON.stringify(input);
  
  const result = {};
  
  for (const algorithm of algorithms) {
    try {
      const hash = createHash(algorithm);
      hash.update(inputString);
      result[algorithm] = hash.digest('hex');
    } catch (error) {
      result[algorithm] = { error: error.message };
    }
  }

  return result;
}

// Helper functions

function calculateReadabilityScore(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;

  if (sentences.length === 0 || words.length === 0) {
    return null;
  }

  const avgWordsPerSentence = words.length / sentences.length;
  const avgCharsPerWord = charactersNoSpaces / words.length;
  
  // Flesch Reading Ease score
  const readabilityScore = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgCharsPerWord);

  return {
    sentences: sentences.length,
    words: words.length,
    characters,
    charactersNoSpaces,
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
    avgCharsPerWord: Math.round(avgCharsPerWord * 100) / 100,
    readabilityScore: Math.round(readabilityScore * 100) / 100,
    readabilityLevel: getReadabilityLevel(readabilityScore)
  };
}

function getReadabilityLevel(score) {
  if (score >= 90) return 'Very Easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly Easy';
  if (score >= 60) return 'Standard';
  if (score >= 50) return 'Fairly Difficult';
  if (score >= 30) return 'Difficult';
  return 'Very Difficult';
}

function extractStructuredData(html) {
  const $ = cheerio.load(html);
  const result = {
    jsonLd: [],
    microdata: [],
    schemaOrg: []
  };

  // Extract JSON-LD
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const jsonText = $(element).html();
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        result.jsonLd.push(parsed);
      }
    } catch (error) {
      // Skip invalid JSON-LD
    }
  });

  return result;
}

function extractMicrodataItem($, element) {
  const $element = $(element);
  const itemType = $element.attr('itemtype');
  
  if (!itemType) return null;

  const item = {
    type: itemType,
    properties: {}
  };

  $element.find('[itemprop]').each((_, propElement) => {
    const $prop = $(propElement);
    const propName = $prop.attr('itemprop');
    const propValue = $prop.text().trim();

    if (propName && propValue) {
      if (!item.properties[propName]) {
        item.properties[propName] = [];
      }
      item.properties[propName].push(propValue);
    }
  });

  return item;
}

function extractSchemaOrgItem($, element) {
  const $element = $(element);
  const typeOf = $element.attr('typeof');
  const property = $element.attr('property');
  
  if (!typeOf && !property) return null;

  const item = {};
  if (typeOf) item.typeof = typeOf;
  if (property) item.property = property;
  
  const content = $element.text().trim();
  if (content) {
    item.content = content;
  }

  return item;
}

function analyzeSentiment(text) {
  // Simple sentiment analysis based on positive/negative word counts
  const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'awesome', 'love', 'best', 'perfect'];
  const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'disappointing', 'poor', 'negative', 'sad'];
  
  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;
  
  words.forEach(word => {
    if (positiveWords.includes(word)) positiveCount++;
    if (negativeWords.includes(word)) negativeCount++;
  });
  
  const total = positiveCount + negativeCount;
  let sentiment = 'neutral';
  let score = 0;
  
  if (total > 0) {
    score = (positiveCount - negativeCount) / total;
    if (score > 0.1) sentiment = 'positive';
    else if (score < -0.1) sentiment = 'negative';
  }
  
  return {
    sentiment,
    score: Math.round(score * 100) / 100,
    positiveWords: positiveCount,
    negativeWords: negativeCount
  };
}

function extractKeywords(doc) {
  const nouns = doc.nouns().out('array');
  const adjectives = doc.adjectives().out('array');
  const verbs = doc.verbs().out('array');
  
  // Simple frequency-based keyword extraction
  const allWords = [...nouns, ...adjectives, ...verbs];
  const frequency = {};
  
  allWords.forEach(word => {
    const normalized = word.toLowerCase();
    frequency[normalized] = (frequency[normalized] || 0) + 1;
  });
  
  // Sort by frequency and return top keywords
  const keywords = Object.entries(frequency)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([word, freq]) => ({ word, frequency: freq }));
    
  return keywords;
}

function calculateTextMetrics(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    averageWordsPerSentence: words.length / (sentences.length || 1),
    averageSentencesPerParagraph: sentences.length / (paragraphs.length || 1)
  };
}

function calculateJaccardSimilarity(text1, text2) {
  const set1 = new Set(text1.toLowerCase().split(/\s+/));
  const set2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...set1].filter(word => set2.has(word)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

function calculateCosineSimilarity(text1, text2) {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const allWords = [...new Set([...words1, ...words2])];
  
  const vector1 = allWords.map(word => words1.filter(w => w === word).length);
  const vector2 = allWords.map(word => words2.filter(w => w === word).length);
  
  const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
  const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));
  
  return dotProduct / (magnitude1 * magnitude2);
}

function calculateLevenshteinDistance(text1, text2) {
  const matrix = [];
  const len1 = text1.length;
  const len2 = text2.length;
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = text1[i - 1] === text2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[len1][len2];
}

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash, convert to lowercase, remove default ports
    urlObj.pathname = urlObj.pathname.replace(/\/$/, '') || '/';
    urlObj.hostname = urlObj.hostname.toLowerCase();
    if ((urlObj.protocol === 'http:' && urlObj.port === '80') ||
        (urlObj.protocol === 'https:' && urlObj.port === '443')) {
      urlObj.port = '';
    }
    return urlObj.toString();
  } catch (error) {
    return url;
  }
}

function normalizeObject(obj, options) {
  const { removeNulls, trimStrings, lowercaseKeys } = options;
  
  if (obj === null || obj === undefined) {
    return removeNulls ? undefined : obj;
  }
  
  if (Array.isArray(obj)) {
    const normalized = obj.map(item => normalizeObject(item, options)).filter(item => item !== undefined);
    return normalized;
  }
  
  if (typeof obj === 'object') {
    const normalized = {};
    for (const [key, value] of Object.entries(obj)) {
      const normalizedKey = lowercaseKeys ? key.toLowerCase() : key;
      const normalizedValue = normalizeObject(value, options);
      
      if (normalizedValue !== undefined) {
        normalized[normalizedKey] = normalizedValue;
      }
    }
    return normalized;
  }
  
  if (typeof obj === 'string' && trimStrings) {
    return obj.trim();
  }
  
  return obj;
}

function validateAgainstSchema(data, schema) {
  // Simple schema validation - in a real implementation, you'd use a proper schema validator
  try {
    if (typeof schema === 'object' && schema.type) {
      return typeof data === schema.type;
    }
    return true;
  } catch (error) {
    return false;
  }
}

// Signal that worker is ready
parentPort.postMessage({ type: 'ready' });