/**
 * ContentProcessor - Enhanced content extraction with Mozilla Readability
 * Provides main content detection, boilerplate removal, and structured data extraction
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import { z } from 'zod';

const ContentProcessorSchema = z.object({
  html: z.string(),
  url: z.string().url().optional(),
  options: z.object({
    extractStructuredData: z.boolean().default(true),
    calculateReadabilityScore: z.boolean().default(true),
    removeBoilerplate: z.boolean().default(true),
    preserveImageInfo: z.boolean().default(true),
    extractMetadata: z.boolean().default(true)
  }).optional().default({})
});

const ReadabilityResult = z.object({
  title: z.string().nullable(),
  content: z.string(),
  textContent: z.string(),
  length: z.number(),
  excerpt: z.string().nullable(),
  byline: z.string().nullable(),
  dir: z.string().nullable(),
  siteName: z.string().nullable(),
  lang: z.string().nullable()
});

export class ContentProcessor {
  constructor() {
    this.defaultOptions = {
      extractStructuredData: true,
      calculateReadabilityScore: true,
      removeBoilerplate: true,
      preserveImageInfo: true,
      extractMetadata: true
    };
  }

  /**
   * Process HTML content with enhanced extraction capabilities
   * @param {Object} params - Processing parameters
   * @param {string} params.html - HTML content to process
   * @param {string} params.url - Source URL (optional)
   * @param {Object} params.options - Processing options
   * @returns {Promise<Object>} - Processed content with metadata
   */
  async processContent(params) {
    try {
      const validated = ContentProcessorSchema.parse(params);
      const { html, url, options } = validated;
      const processingOptions = { ...this.defaultOptions, ...options };

      const result = {
        url,
        processed_at: new Date().toISOString(),
        processing_options: processingOptions
      };

      // Create JSDOM instance for Readability
      const dom = new JSDOM(html, { url });
      const document = dom.window.document;

      // Extract main content using Mozilla Readability
      if (processingOptions.removeBoilerplate) {
        const reader = new Readability(document, {
          debug: false,
          maxElemsToDivide: 300,
          charThreshold: 500
        });

        const article = reader.parse();
        if (article) {
          result.readability = {
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

          // Calculate readability score
          if (processingOptions.calculateReadabilityScore) {
            result.readability_score = this.calculateReadabilityScore(article.textContent);
          }
        }
      }

      // Extract structured data
      if (processingOptions.extractStructuredData) {
        result.structured_data = this.extractStructuredData(html);
      }

      // Extract additional metadata
      if (processingOptions.extractMetadata) {
        result.metadata = this.extractMetadata(html);
      }

      // Preserve image information
      if (processingOptions.preserveImageInfo) {
        result.images = this.extractImageInfo(html);
      }

      // Fallback content extraction if Readability fails
      if (!result.readability) {
        result.fallback_content = this.extractFallbackContent(html);
      }

      return result;

    } catch (error) {
      throw new Error(`Content processing failed: ${error.message}`);
    }
  }

  /**
   * Extract structured data from HTML (JSON-LD, microdata, schema.org)
   * @param {string} html - HTML content
   * @returns {Object} - Extracted structured data
   */
  extractStructuredData(html) {
    const $ = cheerio.load(html);
    const structuredData = {
      jsonLd: [],
      microdata: [],
      schemaOrg: []
    };

    try {
      // Extract JSON-LD
      $('script[type="application/ld+json"]').each((_, element) => {
        try {
          const jsonText = $(element).html();
          if (jsonText) {
            const parsed = JSON.parse(jsonText);
            structuredData.jsonLd.push(parsed);
          }
        } catch (err) {
          // Skip invalid JSON-LD
        }
      });

      // Extract microdata
      $('[itemscope]').each((_, element) => {
        const item = this.extractMicrodataItem($, element);
        if (item) {
          structuredData.microdata.push(item);
        }
      });

      // Extract schema.org markup
      $('[typeof], [property], [vocab]').each((_, element) => {
        const schemaItem = this.extractSchemaOrgItem($, element);
        if (schemaItem) {
          structuredData.schemaOrg.push(schemaItem);
        }
      });

    } catch (error) {
      console.warn('Error extracting structured data:', error.message);
    }

    return structuredData;
  }

  /**
   * Extract microdata item from element
   * @param {Object} $ - Cheerio instance
   * @param {Object} element - DOM element
   * @returns {Object|null} - Extracted microdata item
   */
  extractMicrodataItem($, element) {
    const $element = $(element);
    const itemType = $element.attr('itemtype');
    const itemId = $element.attr('itemid');

    if (!itemType) return null;

    const item = {
      type: itemType,
      properties: {}
    };

    if (itemId) {
      item.id = itemId;
    }

    // Extract properties
    $element.find('[itemprop]').each((_, propElement) => {
      const $prop = $(propElement);
      const propName = $prop.attr('itemprop');
      const propValue = this.extractMicrodataValue($, propElement);

      if (propName && propValue !== null) {
        if (!item.properties[propName]) {
          item.properties[propName] = [];
        }
        item.properties[propName].push(propValue);
      }
    });

    return item;
  }

  /**
   * Extract microdata property value
   * @param {Object} $ - Cheerio instance
   * @param {Object} element - DOM element
   * @returns {string|Object|null} - Property value
   */
  extractMicrodataValue($, element) {
    const $element = $(element);
    const tagName = $element.get(0).tagName.toLowerCase();

    // Check for nested itemscope
    if ($element.attr('itemscope')) {
      return this.extractMicrodataItem($, element);
    }

    // Extract value based on element type
    switch (tagName) {
      case 'meta':
        return $element.attr('content') || null;
      case 'a':
      case 'area':
      case 'link':
        return $element.attr('href') || null;
      case 'img':
      case 'audio':
      case 'embed':
      case 'iframe':
      case 'source':
      case 'track':
      case 'video':
        return $element.attr('src') || null;
      case 'object':
        return $element.attr('data') || null;
      case 'time':
        return $element.attr('datetime') || $element.text().trim() || null;
      default:
        return $element.text().trim() || null;
    }
  }

  /**
   * Extract schema.org item from element
   * @param {Object} $ - Cheerio instance
   * @param {Object} element - DOM element
   * @returns {Object|null} - Extracted schema.org item
   */
  extractSchemaOrgItem($, element) {
    const $element = $(element);
    const typeOf = $element.attr('typeof');
    const property = $element.attr('property');
    const vocab = $element.attr('vocab');

    if (!typeOf && !property && !vocab) return null;

    const item = {};

    if (typeOf) item.typeof = typeOf;
    if (property) item.property = property;
    if (vocab) item.vocab = vocab;

    const content = $element.attr('content') || $element.text().trim();
    if (content) {
      item.content = content;
    }

    return item;
  }

  /**
   * Extract metadata from HTML
   * @param {string} html - HTML content
   * @returns {Object} - Extracted metadata
   */
  extractMetadata(html) {
    const $ = cheerio.load(html);
    const metadata = {
      title: $('title').text().trim() || null,
      description: null,
      keywords: null,
      author: null,
      published: null,
      modified: null,
      openGraph: {},
      twitterCard: {},
      canonical: null,
      language: null
    };

    // Basic meta tags
    $('meta').each((_, element) => {
      const $meta = $(element);
      const name = $meta.attr('name') || $meta.attr('property') || $meta.attr('http-equiv');
      const content = $meta.attr('content');

      if (!name || !content) return;

      const nameLower = name.toLowerCase();

      // Standard meta tags
      if (nameLower === 'description') {
        metadata.description = content;
      } else if (nameLower === 'keywords') {
        metadata.keywords = content.split(',').map(k => k.trim());
      } else if (nameLower === 'author') {
        metadata.author = content;
      } else if (nameLower.includes('published') || nameLower.includes('date')) {
        metadata.published = content;
      } else if (nameLower.includes('modified') || nameLower.includes('updated')) {
        metadata.modified = content;
      }

      // Open Graph
      if (name.startsWith('og:')) {
        const ogProperty = name.substring(3);
        metadata.openGraph[ogProperty] = content;
      }

      // Twitter Cards
      if (name.startsWith('twitter:')) {
        const twitterProperty = name.substring(8);
        metadata.twitterCard[twitterProperty] = content;
      }
    });

    // Canonical URL
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical) {
      metadata.canonical = canonical;
    }

    // Language
    const htmlLang = $('html').attr('lang');
    if (htmlLang) {
      metadata.language = htmlLang;
    }

    return metadata;
  }

  /**
   * Extract image information from HTML
   * @param {string} html - HTML content
   * @returns {Array} - Image information
   */
  extractImageInfo(html) {
    const $ = cheerio.load(html);
    const images = [];

    $('img').each((_, element) => {
      const $img = $(element);
      const imageInfo = {
        src: $img.attr('src'),
        alt: $img.attr('alt') || null,
        title: $img.attr('title') || null,
        width: $img.attr('width') || null,
        height: $img.attr('height') || null,
        loading: $img.attr('loading') || null,
        srcset: $img.attr('srcset') || null
      };

      if (imageInfo.src) {
        images.push(imageInfo);
      }
    });

    return images;
  }

  /**
   * Calculate readability score using simple metrics
   * @param {string} text - Text content
   * @returns {Object} - Readability metrics
   */
  calculateReadabilityScore(text) {
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
    
    // Simple readability score (lower is better)
    const readabilityScore = (avgWordsPerSentence * 1.015) + (avgCharsPerWord * 84.6) - 206.835;

    return {
      sentences: sentences.length,
      words: words.length,
      characters,
      charactersNoSpaces,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
      avgCharsPerWord: Math.round(avgCharsPerWord * 100) / 100,
      readabilityScore: Math.round(readabilityScore * 100) / 100,
      readabilityLevel: this.getReadabilityLevel(readabilityScore)
    };
  }

  /**
   * Get readability level based on score
   * @param {number} score - Readability score
   * @returns {string} - Readability level
   */
  getReadabilityLevel(score) {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  /**
   * Extract fallback content when Readability fails
   * @param {string} html - HTML content
   * @returns {Object} - Fallback content
   */
  extractFallbackContent(html) {
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .advertisement, .ads, .social-share').remove();

    // Find main content candidates
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.main-content',
      '.content',
      '.post-content',
      '.entry-content',
      '#content',
      '#main'
    ];

    let mainContent = null;
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        mainContent = element.text().trim();
        break;
      }
    }

    // Fallback to body content
    if (!mainContent) {
      mainContent = $('body').text().trim();
    }

    return {
      content: mainContent,
      title: $('title').text().trim() || null,
      headings: this.extractHeadings($),
      length: mainContent ? mainContent.length : 0
    };
  }

  /**
   * Extract headings from content
   * @param {Object} $ - Cheerio instance
   * @returns {Array} - Extracted headings
   */
  extractHeadings($) {
    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const $heading = $(element);
      const level = parseInt(element.tagName.substring(1));
      const text = $heading.text().trim();
      
      if (text) {
        headings.push({
          level,
          text,
          id: $heading.attr('id') || null
        });
      }
    });
    return headings;
  }
}

export default ContentProcessor;