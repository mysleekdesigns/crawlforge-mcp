/**
 * Summarize Content MCP Tool
 * Content summarization with configurable length and type options
 */

import { z } from 'zod';
// D1.3: lazy SamplingClient for abstractive mode when no LLM keys are set
let _SamplingClient = null;
async function getSamplingClient() {
  if (!_SamplingClient) {
    const mod = await import('../../core/SamplingClient.js');
    _SamplingClient = mod.SamplingClient;
  }
  return _SamplingClient;
}
import { ContentAnalyzer } from '../../core/analysis/ContentAnalyzer.js';
import { splitSentences } from '../../core/analysis/sentenceUtils.js';
import { fenceUntrusted } from '../../utils/untrustedContent.js';

const SummarizeContentSchema = z.object({
  text: z.string().min(10),
  options: z.object({
    summaryLength: z.enum(['short', 'medium', 'long']).default('medium'),
    // No default: omitted with summaryLength 'medium', abstractive is tried
    // and falls back to extractive without flagging it (see execute).
    summaryType: z.enum(['extractive', 'abstractive']).optional(),
    includeKeypoints: z.boolean().default(true),
    includeKeywords: z.boolean().default(true),
    includeStatistics: z.boolean().default(true),
    maxKeywords: z.number().min(1).max(20).default(10),
    preserveStructure: z.boolean().default(false),
    language: z.string().optional()
  }).optional().prefault({})
});

const SummarizeContentResult = z.object({
  originalText: z.string(),
  summary: z.object({
    text: z.string(),
    sentences: z.array(z.string()),
    type: z.string(),
    length: z.string(),
    compressionRatio: z.number()
  }),
  keypoints: z.array(z.string()).optional(),
  keywords: z.array(z.object({
    keyword: z.string(),
    relevance: z.number(),
    frequency: z.number()
  })).optional(),
  statistics: z.object({
    original: z.object({
      characters: z.number(),
      words: z.number(),
      sentences: z.number(),
      paragraphs: z.number(),
      readingTime: z.number()
    }),
    summary: z.object({
      characters: z.number(),
      words: z.number(),
      sentences: z.number(),
      readingTime: z.number()
    })
  }).optional(),
  metadata: z.object({
    language: z.string().optional(),
    processingMethod: z.string(),
    confidenceScore: z.number()
  }),
  summarizedAt: z.string(),
  processingTime: z.number(),
  success: z.boolean(),
  degraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
  error: z.string().optional()
});

// Navigation chrome that some sites write with a trailing full stop, e.g. a
// skip link rendered "Jump to content." Chrome without a terminator is already
// caught by the punctuation test below; these are the only lines allowed to
// pass it. Half were observed live in extract_text output (en/es Wikipedia,
// MDN, BBC, GOV.UK); the rest are the same construction. Kept multilingual on
// purpose so the exception does not quietly narrow a language-agnostic rule.
const NAVIGATION_PHRASES = new Set([
  'jump to content',
  'jump to navigation',
  'jump to search',
  'skip to content',
  'skip to main content',
  'skip to navigation',
  'skip to search',
  'from wikipedia, the free encyclopedia',
  'ir al contenido',
  'de wikipedia, la enciclopedia libre'
]);

// Whole lines that are page chrome wherever they appear: consent buttons and
// account links. The live sweep (2026-10-20) found "all cookies manage
// preferences" and "register subscribe" in summarize_content key points and
// keywords. Matched exactly, like NAVIGATION_PHRASES, so a sentence that
// merely contains one of these words is never touched.
const CHROME_LINES = new Set([
  'accept', 'accept all', 'accept all cookies', 'accept cookies', 'reject all',
  'reject all cookies', 'manage preferences', 'manage cookies', 'manage settings',
  'cookie settings', 'cookie preferences', 'cookies', 'cookie policy', 'i agree',
  'register', 'subscribe', 'sign in', 'sign up', 'sign up now', 'log in', 'login',
  'menu', 'search', 'close', 'skip to content', 'accessibility help', 'privacy policy',
  'terms of use', 'terms of service'
]);

// A line about cookies that also speaks the language of consent is a banner,
// not content; "Bake the cookies for 12 minutes" has no consent vocabulary.
const COOKIE_WORD = /\bcookies?\b/i;
const CONSENT_WORD = /\b(accept|agree|consent|manage|preferences|settings|policy|privacy|reject|we use|partners)\b/i;
const SENTENCE_PUNCTUATION = /[.!?…。！？]/;

export class SummarizeContentTool {
  constructor() {
    this.contentAnalyzer = new ContentAnalyzer();
    this._mcpServer = null;
  }

  /** D1.3: Wire MCP server so the sampling fallback can reach the client. */
  setMcpServer(mcpServer) {
    this._mcpServer = mcpServer;
  }

  /**
   * Get tool definition for MCP server
   * @returns {Object} Tool definition
   */
  getDefinition() {
    return {
      name: 'summarize_content',
      description: 'Generate intelligent summaries of text content with configurable length, type, and additional analysis including key points and keywords.',
      inputSchema: SummarizeContentSchema
    };
  }

  /**
   * Execute content summarization
   * @param {Object} params - Summarization parameters
   * @returns {Promise<Object>} Summarization result
   */
  async execute(params) {
    const startTime = Date.now();
    
    try {
      const validated = SummarizeContentSchema.parse(params);
      const { text: rawText, options } = validated;

      // Page text often opens with navigation chrome ("Jump to content",
      // "From Wikipedia, the free encyclopedia") that otherwise leads the
      // summary and key points — strip it before summarizing.
      // The rest of the page's chrome (menus, consent banners, repeated
      // labels) is spread through the text, and its unpunctuated lines glue
      // whole runs of headlines into one "sentence" — strip and split those too.
      const text = this.terminateLines(this.stripPageBoilerplate(this.stripLeadingBoilerplate(rawText)));

      const result = {
        originalText: rawText.substring(0, 500) + (rawText.length > 500 ? '...' : ''),
        summarizedAt: new Date().toISOString(),
        success: false,
        processingTime: 0
      };

      // Step 1: Generate summary using ContentAnalyzer
      const analysisResult = await this.contentAnalyzer.analyzeContent({
        text,
        options: {
          summarize: true,
          extractKeywords: options.includeKeywords,
          detectLanguage: true,
          summaryLength: options.summaryLength,
          summaryType: options.summaryType ?? 'extractive',
          maxKeywords: options.maxKeywords,
          extractTopics: false,
          extractEntities: false,
          includeReadabilityMetrics: false,
          includeSentiment: false
        }
      });

      if (!analysisResult.summary) {
        throw new Error('Summary generation failed');
      }

      // Step 2: Set summary result
      result.summary = analysisResult.summary;

      // D1.3: If abstractive mode requested, attempt sampling-based enhancement.
      // If it can't run (no LLM/sampling available), fall back to the extractive
      // result but flag it explicitly rather than silently masking.
      // An omitted summaryType at the default 'medium' length prefers an
      // abstractive summary when an LLM is reachable, and otherwise keeps the
      // extractive one silently: the caller asked for no particular type, so
      // nothing was degraded. Text too short to compress (ratio 1) is left as is.
      const preferAbstractive = options.summaryType === undefined &&
        options.summaryLength === 'medium' && analysisResult.summary.compressionRatio < 1;
      if (preferAbstractive) {
        const abstractive = await this._abstractiveSummaryViaSampling(
          text, analysisResult.summary, options.summaryLength, analysisResult.language?.name
        );
        if (abstractive) result.summary = abstractive;
      } else if (options.summaryType === 'abstractive') {
        const abstractive = await this._abstractiveSummaryViaSampling(
          text, analysisResult.summary, options.summaryLength, analysisResult.language?.name
        );
        if (abstractive) {
          result.summary = abstractive;
        } else {
          result.summary = { ...result.summary, type: 'extractive' };
          result.degraded = true;
          result.degradedReason = 'Abstractive summarization unavailable (no LLM/sampling backend); returned extractive summary instead.';
        }
      }

      // Step 3: Extract key points if requested
      if (options.includeKeypoints) {
        result.keypoints = await this.extractKeyPoints(text, analysisResult.summary);
      }

      // Step 4: Add keywords if requested
      if (options.includeKeywords && analysisResult.keywords) {
        result.keywords = analysisResult.keywords;
      }

      // Step 5: Calculate statistics if requested
      if (options.includeStatistics) {
        result.statistics = {
          original: this.calculateTextStatistics(text),
          summary: this.calculateTextStatistics(result.summary.text)
        };
      }

      // Step 6: Set metadata
      result.metadata = {
        language: analysisResult.language?.code || options.language || 'unknown',
        processingMethod: options.summaryType ?? result.summary.type,
        confidenceScore: this.calculateConfidenceScore(text, result.summary.text)
      };

      result.processingTime = Date.now() - startTime;
      result.success = true;

      return result;

    } catch (error) {
      // A ZodError's message is its issue array as JSON; one line per issue reads better.
      const reason = error instanceof z.ZodError
        ? `Invalid input - ${error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`
        : error.message;
      return {
        originalText: params.text?.substring(0, 100) || 'unknown',
        summarizedAt: new Date().toISOString(),
        success: false,
        error: `Content summarization failed: ${reason}`,
        processingTime: Date.now() - startTime,
        summary: {
          text: '',
          sentences: [],
          type: 'failed',
          length: 'none',
          compressionRatio: 0
        },
        metadata: {
          processingMethod: 'failed',
          confidenceScore: 0
        }
      };
    }
  }

  /**
   * Generate an abstractive summary via the MCP SamplingClient fallback chain
   * (Ollama → OpenAI → Anthropic → MCP sampling). Returns a summary object in the
   * same shape as the extractive result, or null if no backend is available.
   * @param {string} text - Full original text
   * @param {Object} extractiveSummary - The extractive summary (for shape/fallback)
   * @param {string} summaryLength - 'short' | 'medium' | 'long'
   * @param {string} [languageName] - Detected language of the text, e.g. 'German'
   * @returns {Promise<Object|null>}
   */
  async _abstractiveSummaryViaSampling(text, extractiveSummary, summaryLength, languageName) {
    try {
      const SamplingClient = await getSamplingClient();
      const client = new SamplingClient({ mcpServer: this._mcpServer });

      const prompt = this.buildAbstractivePrompt(text, summaryLength, languageName);

      const { text: summaryText } = await client.complete(prompt, { maxTokens: 600 });
      if (!summaryText || !summaryText.trim()) {
        return null;
      }

      const cleaned = summaryText.trim();
      const sentences = splitSentences(cleaned);
      const compressionRatio = text.length > 0
        ? Math.round((cleaned.length / text.length) * 1000) / 1000
        : 0;

      return {
        text: cleaned,
        sentences,
        type: 'abstractive',
        length: summaryLength,
        compressionRatio
      };
    } catch {
      // No sampling/LLM backend available — caller falls back to extractive.
      return null;
    }
  }

  /**
   * Prompt for the abstractive summary. It names the language to write in: an
   * English instruction over German text got an English summary back (R24).
   * @param {string} text - Full original text
   * @param {string} summaryLength - 'short' | 'medium' | 'long'
   * @param {string} [languageName] - Detected language of the text
   * @returns {string}
   */
  buildAbstractivePrompt(text, summaryLength, languageName) {
    const lengthGuide = {
      short: '1-2 sentences',
      medium: '3-5 sentences',
      long: '6-10 sentences'
    }[summaryLength] || '3-5 sentences';

    const languageRule = languageName
      ? `Write the summary in ${languageName}, the language of the text — do not translate it. `
      : 'Write the summary in the same language as the text — do not translate it. ';

    return `Write a concise, fluent abstractive summary (${lengthGuide}) of the text below. ` +
      `Capture the main ideas in your own words. ${languageRule}` +
      `Respond with only the summary text.\n\n` +
      // Fenced: summarising a page is exactly the case where an instruction
      // planted in it would otherwise be read as part of the task.
      fenceUntrusted(text.slice(0, 12000), 'text');
  }

  /**
   * Strip leading navigation boilerplate from extracted page text.
   *
   * Conservative rule: scan only the leading lines, dropping each line that
   * looks navigation-ish — short (≤ 60 chars), few words (≤ 8), and free of
   * sentence-ending punctuation (.!?…。！？) — and stop at the first line of
   * real prose (anything longer, wordier, or punctuated). Prose that starts
   * mid-sentence survives: it is either punctuated, longer than the caps, or
   * protected by the size guard — if the strip would remove more than
   * min(600 chars, 20% of the text), nothing is stripped at all.
   *
   * One exception to the punctuation test: a line that matches NAVIGATION_PHRASES
   * exactly — case-insensitively, ignoring trailing terminators — is stripped
   * even though it is punctuated, so a skip link written "Jump to content." is
   * caught. That exception has to be a list rather than a rule, because
   * "Jump to content." and "It was cold." are identical on every feature this
   * function can measure (≤ 60 chars, ≤ 8 words, a single terminator in final
   * position, nothing punctuated in between). Anything general enough to catch
   * the first eats the second, and dropping a summary's opening sentence is the
   * worse failure. The cost is the usual one for a list: it catches the phrases
   * it names and no others.
   * @param {string} text - Text to clean
   * @returns {string} - Text without leading navigation chrome
   */
  stripLeadingBoilerplate(text) {
    const lines = text.split('\n');
    const maxStrip = Math.min(600, Math.floor(text.length * 0.2));
    let index = 0;
    let strippedChars = 0;
    let strippedLines = 0;

    while (index < lines.length) {
      const line = lines[index].trim();
      if (line.length === 0) {
        index++;
        continue;
      }
      const wordCount = line.split(/\s+/).length;
      const hasSentencePunctuation = /[.!?…。！？]/.test(line);
      const isNavigationPhrase = NAVIGATION_PHRASES.has(
        line.replace(/[.!?…。！？]+$/, '').trim().toLowerCase()
      );
      const isBoilerplate = line.length <= 60 && wordCount <= 8 &&
        (!hasSentencePunctuation || isNavigationPhrase);
      if (!isBoilerplate) break;

      strippedChars += line.length;
      if (strippedChars > maxStrip) {
        return text; // would eat too much — leave the text untouched
      }
      strippedLines++;
      index++;
    }

    return strippedLines > 0 ? lines.slice(index).join('\n') : text;
  }

  /**
   * Strip navigation and consent chrome from anywhere in extracted page text.
   * A line is dropped when it is:
   *   - a CHROME_LINES / NAVIGATION_PHRASES entry, or a cookie line that uses
   *     consent vocabulary;
   *   - a pipe/bullet menu ("Home | News | Sport"): 3+ segments of ≤ 4 words;
   *   - repeated on the page: a short label (≤ 4 words, unpunctuated) loses
   *     every copy — "In stock", "Add to basket", section names — while a
   *     longer repeated line keeps its first copy;
   *   - part of a nav run: 4+ consecutive lines that are each ≤ 30 chars,
   *     ≤ 4 words, unpunctuated and digit-free. The digit rule keeps listings
   *     whose short titles alternate with prices or counts.
   * If almost nothing survives (< 10 chars) the text is returned untouched.
   * @param {string} text - Text to clean
   * @returns {string} - Text without page chrome
   */
  stripPageBoilerplate(text) {
    const lines = text.split('\n');
    const key = (line) => line.trim().replace(/[.!?…。！？]+$/, '').trim().toLowerCase();
    const isShort = (line) => line.split(/\s+/).length <= 4 && !SENTENCE_PUNCTUATION.test(line);

    const counts = new Map();
    for (const line of lines) {
      const k = key(line);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }

    const seen = new Set();
    const drop = lines.map((raw) => {
      const line = raw.trim();
      if (!line) return false;
      const k = key(line);
      if (CHROME_LINES.has(k) || NAVIGATION_PHRASES.has(k)) return true;
      if (COOKIE_WORD.test(line) && CONSENT_WORD.test(line)) return true;
      const segments = line.split(/\s*[|•·]\s*/).filter(Boolean);
      if (segments.length >= 3 && segments.every((s) => s.split(/\s+/).length <= 4)) return true;
      if (counts.get(k) > 1 && (isShort(line) || seen.has(k))) return true;
      seen.add(k);
      return false;
    });

    // Runs are measured on the original lines, so a menu whose items were
    // already dropped as repeats still counts towards the run around them.
    const isNavLine = (line) => line.length <= 30 && isShort(line) && !/\d/.test(line);
    let run = [];
    const flush = () => {
      if (run.length >= 4) for (const i of run) drop[i] = true;
      run = [];
    };
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (isNavLine(line) || drop[i]) run.push(i);
      else flush();
    });
    flush();

    const cleaned = lines.filter((_, i) => !drop[i]).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned.length >= 10 ? cleaned : text;
  }

  /**
   * End each unpunctuated line with a full stop when the next line starts a
   * new unit (a capital, digit, quote or currency sign). Headlines, titles and
   * prices carry no terminator, so without this the sentence splitter glued a
   * whole column of them into one "sentence" — the books listing's summary
   * was a run of prices. A next line starting in lower case is a wrapped
   * sentence and is left alone; CJK has no capitals and is never touched.
   * @param {string} text
   * @returns {string}
   */
  terminateLines(text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (!line.trim() || /[.!?…。！？:;,]$/.test(line)) continue;
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && /^[\p{Lu}\p{N}£$€'"‘“(]/u.test(next.trim())) lines[i] = `${line}.`;
    }
    return lines.join('\n');
  }

  /**
   * Extract key points from original text and summary
   * @param {string} originalText - Original text
   * @param {Object} summary - Summary object
   * @returns {Promise<Array>} - Array of key points
   */
  async extractKeyPoints(originalText, summary) {
    try {
      // Simple key point extraction based on important sentences
      const sentences = splitSentences(originalText);
      
      // Score sentences based on various factors
      const scoredSentences = sentences.map(sentence => {
        const words = sentence.toLowerCase().split(/\s+/);
        
        // Factors that increase sentence importance
        let score = 0;
        
        // Length factor (medium-length sentences preferred)
        const wordCount = words.length;
        if (wordCount >= 10 && wordCount <= 25) {
          score += 2;
        } else if (wordCount >= 6 && wordCount <= 30) {
          score += 1;
        }

        // Keyword density (words that appear in summary)
        const summaryWords = summary.text.toLowerCase().split(/\s+/);
        const commonWords = words.filter(word => summaryWords.includes(word));
        score += commonWords.length * 0.5;

        // Position factor (sentences at beginning and end are often important)
        const position = sentences.indexOf(sentence);
        const totalSentences = sentences.length;
        if (position < totalSentences * 0.2 || position > totalSentences * 0.8) {
          score += 1;
        }

        // Numeric data or specific terms
        if (/\d+/.test(sentence)) score += 0.5;
        if (/\b(important|significant|key|main|primary|essential|critical)\b/i.test(sentence)) {
          score += 1;
        }

        return {
          sentence: sentence.trim(),
          score,
          position
        };
      });

      // Select top key points
      const topSentences = scoredSentences
        .filter(item => item.score > 1) // Minimum threshold
        .sort((a, b) => b.score - a.score)
        .slice(0, 5) // Top 5 key points
        .sort((a, b) => a.position - b.position) // Restore original order
        .map(item => item.sentence);

      return topSentences;

    } catch (error) {
      console.warn('Key point extraction failed:', error.message);
      return [];
    }
  }

  /**
   * Calculate text statistics
   * @param {string} text - Text to analyze
   * @returns {Object} - Text statistics
   */
  calculateTextStatistics(text) {
    const characters = text.length;
    // Same tokenizer as analyze_content: whitespace splitting counted a whole
    // Japanese paragraph as one word (R24).
    const words = this.contentAnalyzer.tokenizeWords(text);
    const sentences = splitSentences(text);
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    // Estimate reading time (average 200 words per minute)
    const readingTime = Math.ceil(words.length / 200);

    return {
      characters,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      readingTime
    };
  }

  /**
   * Calculate confidence score for summary quality
   * @param {string} originalText - Original text
   * @param {string} summaryText - Summary text
   * @returns {number} - Confidence score (0-1)
   */
  calculateConfidenceScore(originalText, summaryText) {
    try {
      if (!summaryText || summaryText.length === 0) {
        return 0;
      }

      const originalWords = originalText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const summaryWords = summaryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      if (originalWords.length === 0 || summaryWords.length === 0) {
        return 0;
      }

      // Calculate word overlap
      const uniqueOriginalWords = new Set(originalWords);
      const uniqueSummaryWords = new Set(summaryWords);
      const intersection = new Set([...uniqueOriginalWords].filter(word => uniqueSummaryWords.has(word)));
      
      const overlapRatio = intersection.size / Math.min(uniqueOriginalWords.size, uniqueSummaryWords.size);
      
      // Calculate compression ratio factor
      const compressionRatio = summaryText.length / originalText.length;
      const compressionScore = compressionRatio > 0.1 && compressionRatio < 0.8 ? 1 : 0.5;
      
      // Calculate length appropriateness
      const summaryWordCount = summaryWords.length;
      const lengthScore = summaryWordCount >= 10 && summaryWordCount <= 200 ? 1 : 0.7;
      
      // Combine factors
      const confidence = (overlapRatio * 0.5 + compressionScore * 0.3 + lengthScore * 0.2);
      
      return Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;

    } catch (error) {
      console.warn('Confidence score calculation failed:', error.message);
      return 0.5; // Default neutral confidence
    }
  }

  /**
   * Summarize multiple texts
   * @param {Array} texts - Array of texts to summarize
   * @param {Object} options - Summarization options
   * @returns {Promise<Array>} - Array of summarization results
   */
  async summarizeMultiple(texts, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = [];

    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, i + concurrency);
      const batchPromises = batch.map(text => {
        const params = typeof text === 'string' 
          ? { text, options }
          : { ...text, options: { ...options, ...text.options } };
        
        return this.execute(params).catch(error => ({
          originalText: params.text?.substring(0, 100) || 'unknown',
          success: false,
          error: error.message,
          summarizedAt: new Date().toISOString(),
          processingTime: 0,
          summary: {
            text: '',
            sentences: [],
            type: 'failed',
            length: 'none',
            compressionRatio: 0
          }
        }));
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate summary with custom length
   * @param {string} text - Text to summarize
   * @param {number} targetWords - Target word count for summary
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Custom summary result
   */
  async generateCustomLengthSummary(text, targetWords, options = {}) {
    // Determine length category based on target words
    let summaryLength;
    if (targetWords <= 50) summaryLength = 'short';
    else if (targetWords <= 150) summaryLength = 'medium';
    else summaryLength = 'long';

    return await this.execute({
      text,
      options: {
        ...options,
        summaryLength,
        targetWords
      }
    });
  }
}

export default SummarizeContentTool;