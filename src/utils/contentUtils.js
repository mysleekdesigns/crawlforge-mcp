/**
 * Content Processing Utilities
 * Supporting functions for content extraction, cleaning, and quality assessment
 */

import * as cheerio from 'cheerio';
import { z } from 'zod';

/**
 * HTML cleaning utilities
 */
export class HTMLCleaner {
  /**
   * Clean HTML content by removing unwanted elements and attributes
   * @param {string} html - HTML content to clean
   * @param {Object} options - Cleaning options
   * @returns {string} - Cleaned HTML
   */
  static cleanHTML(html, options = {}) {
    const defaultOptions = {
      removeScripts: true,
      removeStyles: true,
      removeComments: true,
      removeEmpty: true,
      allowedTags: ['p', 'div', 'span', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'blockquote', 'code', 'pre'],
      allowedAttributes: ['href', 'src', 'alt', 'title', 'class', 'id']
    };

    const cleaningOptions = { ...defaultOptions, ...options };
    const $ = cheerio.load(html);

    // Remove scripts and styles
    if (cleaningOptions.removeScripts) {
      $('script, noscript').remove();
    }
    if (cleaningOptions.removeStyles) {
      $('style, link[rel="stylesheet"]').remove();
    }

    // Remove comments
    if (cleaningOptions.removeComments) {
      $('*').contents().filter((_, node) => node.type === 'comment').remove();
    }

    // Remove unwanted elements
    $('nav, header, footer, aside, .advertisement, .ads, .social-share, .popup, .modal').remove();

    // Clean attributes
    if (cleaningOptions.allowedAttributes) {
      $('*').each((_, element) => {
        const $element = $(element);
        const attributes = element.attribs || {};
        
        Object.keys(attributes).forEach(attr => {
          if (!cleaningOptions.allowedAttributes.includes(attr)) {
            $element.removeAttr(attr);
          }
        });
      });
    }

    // Remove empty elements
    if (cleaningOptions.removeEmpty) {
      $('*').filter((_, element) => {
        const $element = $(element);
        return $element.text().trim() === '' && 
               $element.find('img, video, audio, iframe').length === 0;
      }).remove();
    }

    return $.html();
  }

  /**
   * Extract text content with preserved formatting
   * @param {string} html - HTML content
   * @param {Object} options - Extraction options
   * @returns {string} - Extracted text
   */
  static extractTextWithFormatting(html, options = {}) {
    const defaultOptions = {
      preserveLineBreaks: true,
      preserveParagraphs: true,
      includeLinks: false,
      includeImageAlt: true
    };

    const extractOptions = { ...defaultOptions, ...options };
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, header, footer, aside').remove();

    let text = '';

    $('body').find('*').each((_, element) => {
      const $element = $(element);
      const tagName = element.tagName.toLowerCase();

      switch (tagName) {
        case 'p':
        case 'div':
          if (extractOptions.preserveParagraphs) {
            text += '\n\n' + $element.text().trim();
          } else {
            text += ' ' + $element.text().trim();
          }
          break;
        case 'br':
          if (extractOptions.preserveLineBreaks) {
            text += '\n';
          }
          break;
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          text += '\n\n' + $element.text().trim().toUpperCase() + '\n';
          break;
        case 'a':
          if (extractOptions.includeLinks) {
            const href = $element.attr('href');
            const linkText = $element.text().trim();
            text += ` ${linkText}${href ? ` (${href})` : ''}`;
          } else {
            text += ' ' + $element.text().trim();
          }
          break;
        case 'img':
          if (extractOptions.includeImageAlt) {
            const alt = $element.attr('alt');
            if (alt) {
              text += ` [Image: ${alt}]`;
            }
          }
          break;
        case 'li':
          text += '\n• ' + $element.text().trim();
          break;
        default:
          // For other elements, just extract text
          if ($element.children().length === 0) {
            text += ' ' + $element.text().trim();
          }
      }
    });

    return text.replace(/\s+/g, ' ').replace(/\n\s+/g, '\n').trim();
  }
}

/**
 * Content quality assessment utilities
 */
export class ContentQualityAssessor {
  /**
   * Assess content quality based on various metrics
   * @param {string} content - Text content to assess
   * @param {Object} options - Assessment options
   * @returns {Object} - Quality assessment results
   */
  static assessContentQuality(content, options = {}) {
    const defaultOptions = {
      minLength: 100,
      maxLength: 50000,
      minWords: 20,
      assessReadability: true,
      checkForBoilerplate: true
    };

    const assessmentOptions = { ...defaultOptions, ...options };

    if (!content || typeof content !== 'string') {
      return {
        isValid: false,
        score: 0,
        reasons: ['Invalid or empty content']
      };
    }

    const assessment = {
      isValid: true,
      score: 100,
      reasons: [],
      metrics: {}
    };

    // Basic metrics
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    assessment.metrics = {
      length: content.length,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      avgWordsPerSentence: words.length / Math.max(sentences.length, 1),
      avgSentencesPerParagraph: sentences.length / Math.max(paragraphs.length, 1)
    };

    // Length assessment
    if (content.length < assessmentOptions.minLength) {
      assessment.score -= 30;
      assessment.reasons.push(`Content too short (${content.length} chars)`);
    }
    if (content.length > assessmentOptions.maxLength) {
      assessment.score -= 10;
      assessment.reasons.push(`Content very long (${content.length} chars)`);
    }

    // Word count assessment
    if (words.length < assessmentOptions.minWords) {
      assessment.score -= 25;
      assessment.reasons.push(`Too few words (${words.length})`);
    }

    // Sentence structure assessment
    if (assessment.metrics.avgWordsPerSentence < 5) {
      assessment.score -= 15;
      assessment.reasons.push('Very short sentences detected');
    }
    if (assessment.metrics.avgWordsPerSentence > 30) {
      assessment.score -= 10;
      assessment.reasons.push('Very long sentences detected');
    }

    // Boilerplate detection
    if (assessmentOptions.checkForBoilerplate) {
      const boilerplateScore = this.detectBoilerplate(content);
      if (boilerplateScore > 0.3) {
        assessment.score -= Math.round(boilerplateScore * 50);
        assessment.reasons.push('Potential boilerplate content detected');
      }
      assessment.metrics.boilerplateScore = boilerplateScore;
    }

    // Readability assessment
    if (assessmentOptions.assessReadability) {
      const readability = this.calculateSimpleReadability(content);
      assessment.metrics.readability = readability;
      
      if (readability.score < 30 || readability.score > 100) {
        assessment.score -= 10;
        assessment.reasons.push('Poor readability score');
      }
    }

    // Final validation
    if (assessment.score < 50) {
      assessment.isValid = false;
    }

    assessment.score = Math.max(0, Math.min(100, assessment.score));

    return assessment;
  }

  /**
   * Detect boilerplate content patterns
   * @param {string} content - Content to analyze
   * @returns {number} - Boilerplate score (0-1)
   */
  static detectBoilerplate(content) {
    const boilerplatePatterns = [
      /cookie/gi,
      /privacy policy/gi,
      /terms of service/gi,
      /subscribe to/gi,
      /newsletter/gi,
      /follow us/gi,
      /share this/gi,
      /related articles/gi,
      /read more/gi,
      /advertisement/gi,
      /sponsored/gi,
      /copyright/gi,
      /all rights reserved/gi
    ];

    let matches = 0;
    let totalLength = 0;

    boilerplatePatterns.forEach(pattern => {
      const patternMatches = content.match(pattern);
      if (patternMatches) {
        matches += patternMatches.length;
        totalLength += patternMatches.join('').length;
      }
    });

    // Calculate score based on frequency and length of matches
    const frequency = matches / Math.max(content.split(/\s+/).length, 1);
    const lengthRatio = totalLength / Math.max(content.length, 1);

    return Math.min(1, frequency * 10 + lengthRatio * 5);
  }

  /**
   * Calculate simple readability metrics
   * @param {string} text - Text to analyze
   * @returns {Object} - Readability metrics
   */
  static calculateSimpleReadability(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const syllables = words.reduce((count, word) => count + this.countSyllables(word), 0);

    if (sentences.length === 0 || words.length === 0) {
      return { score: 0, level: 'Unknown' };
    }

    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;

    // Flesch Reading Ease Score
    const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

    return {
      score: Math.round(score * 100) / 100,
      level: this.getReadabilityLevel(score),
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
      avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100
    };
  }

  /**
   * Count syllables in a word (simple approximation)
   * @param {string} word - Word to count syllables for
   * @returns {number} - Syllable count
   */
  static countSyllables(word) {
    if (!word || word.length <= 3) return 1;
    
    const vowels = 'aeiouy';
    let count = 0;
    let prevIsVowel = false;

    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i].toLowerCase());
      if (isVowel && !prevIsVowel) {
        count++;
      }
      prevIsVowel = isVowel;
    }

    // Adjust for silent 'e'
    if (word.toLowerCase().endsWith('e')) {
      count--;
    }

    return Math.max(1, count);
  }

  /**
   * Get readability level from score
   * @param {number} score - Readability score
   * @returns {string} - Readability level
   */
  static getReadabilityLevel(score) {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }
}

/**
 * Structured data parsing utilities
 */
export class StructuredDataParser {
  /**
   * Parse and validate JSON-LD data
   * @param {Array} jsonLdArray - Array of JSON-LD objects
   * @returns {Array} - Validated and parsed JSON-LD data
   */
  static parseJsonLD(jsonLdArray) {
    if (!Array.isArray(jsonLdArray)) {
      return [];
    }

    return jsonLdArray.map(item => {
      try {
        // If item is a string, parse it
        const parsed = typeof item === 'string' ? JSON.parse(item) : item;
        
        // Validate basic JSON-LD structure
        if (parsed && typeof parsed === 'object') {
          return {
            type: parsed['@type'] || 'Unknown',
            context: parsed['@context'] || null,
            data: parsed,
            isValid: true
          };
        }
        return null;
      } catch (error) {
        return {
          type: 'Invalid',
          context: null,
          data: item,
          isValid: false,
          error: error.message
        };
      }
    }).filter(item => item !== null);
  }

  /**
   * Extract common schema.org types from structured data
   * @param {Object} structuredData - Structured data object
   * @returns {Object} - Extracted common types
   */
  static extractCommonSchemaTypes(structuredData) {
    const commonTypes = {
      article: null,
      organization: null,
      person: null,
      product: null,
      event: null,
      place: null,
      website: null
    };

    // Process JSON-LD data
    if (structuredData.jsonLd && Array.isArray(structuredData.jsonLd)) {
      structuredData.jsonLd.forEach(item => {
        if (!item || typeof item !== 'object') return;

        const type = (item['@type'] || '').toLowerCase();
        
        if (type.includes('article') || type.includes('blogposting') || type.includes('newsarticle')) {
          commonTypes.article = this.extractArticleData(item);
        } else if (type.includes('organization')) {
          commonTypes.organization = this.extractOrganizationData(item);
        } else if (type.includes('person')) {
          commonTypes.person = this.extractPersonData(item);
        } else if (type.includes('product')) {
          commonTypes.product = this.extractProductData(item);
        } else if (type.includes('event')) {
          commonTypes.event = this.extractEventData(item);
        } else if (type.includes('place')) {
          commonTypes.place = this.extractPlaceData(item);
        } else if (type.includes('website')) {
          commonTypes.website = this.extractWebsiteData(item);
        }
      });
    }

    return commonTypes;
  }

  /**
   * Extract article data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted article data
   */
  static extractArticleData(data) {
    return {
      headline: data.headline || data.name || null,
      author: data.author ? (typeof data.author === 'string' ? data.author : data.author.name) : null,
      datePublished: data.datePublished || null,
      dateModified: data.dateModified || null,
      description: data.description || null,
      image: data.image || null,
      publisher: data.publisher ? (typeof data.publisher === 'string' ? data.publisher : data.publisher.name) : null,
      wordCount: data.wordCount || null,
      articleSection: data.articleSection || null
    };
  }

  /**
   * Extract organization data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted organization data
   */
  static extractOrganizationData(data) {
    return {
      name: data.name || null,
      url: data.url || null,
      logo: data.logo || null,
      description: data.description || null,
      address: data.address || null,
      telephone: data.telephone || null,
      email: data.email || null,
      foundingDate: data.foundingDate || null
    };
  }

  /**
   * Extract person data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted person data
   */
  static extractPersonData(data) {
    return {
      name: data.name || null,
      givenName: data.givenName || null,
      familyName: data.familyName || null,
      jobTitle: data.jobTitle || null,
      worksFor: data.worksFor ? (typeof data.worksFor === 'string' ? data.worksFor : data.worksFor.name) : null,
      url: data.url || null,
      image: data.image || null,
      description: data.description || null
    };
  }

  /**
   * Extract product data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted product data
   */
  static extractProductData(data) {
    return {
      name: data.name || null,
      description: data.description || null,
      image: data.image || null,
      brand: data.brand ? (typeof data.brand === 'string' ? data.brand : data.brand.name) : null,
      price: data.offers ? data.offers.price : null,
      currency: data.offers ? data.offers.priceCurrency : null,
      availability: data.offers ? data.offers.availability : null,
      sku: data.sku || null,
      gtin: data.gtin || data.gtin13 || data.gtin12 || data.gtin8 || null
    };
  }

  /**
   * Extract event data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted event data
   */
  static extractEventData(data) {
    return {
      name: data.name || null,
      description: data.description || null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      location: data.location ? (typeof data.location === 'string' ? data.location : data.location.name) : null,
      organizer: data.organizer ? (typeof data.organizer === 'string' ? data.organizer : data.organizer.name) : null,
      price: data.offers ? data.offers.price : null,
      url: data.url || null
    };
  }

  /**
   * Extract place data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted place data
   */
  static extractPlaceData(data) {
    return {
      name: data.name || null,
      address: data.address || null,
      telephone: data.telephone || null,
      url: data.url || null,
      description: data.description || null,
      geo: data.geo || null,
      openingHours: data.openingHours || null
    };
  }

  /**
   * Extract website data from structured data
   * @param {Object} data - Structured data item
   * @returns {Object} - Extracted website data
   */
  static extractWebsiteData(data) {
    return {
      name: data.name || null,
      url: data.url || null,
      description: data.description || null,
      publisher: data.publisher ? (typeof data.publisher === 'string' ? data.publisher : data.publisher.name) : null,
      inLanguage: data.inLanguage || null,
      potentialAction: data.potentialAction || null
    };
  }
}

export default {
  HTMLCleaner,
  ContentQualityAssessor,
  StructuredDataParser
};