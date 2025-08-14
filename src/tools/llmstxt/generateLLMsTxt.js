import { z } from 'zod';
import { LLMsTxtAnalyzer } from '../../core/LLMsTxtAnalyzer.js';
import { Logger } from '../../utils/Logger.js';
import { getBaseUrl } from '../../utils/urlNormalizer.js';

const logger = new Logger('GenerateLLMsTxtTool');

const GenerateLLMsTxtSchema = z.object({
  url: z.string().url().describe('The website URL to analyze and generate LLMs.txt for'),
  
  analysisOptions: z.object({
    maxDepth: z.number().min(1).max(5).optional().default(3).describe('Maximum crawl depth for analysis'),
    maxPages: z.number().min(10).max(500).optional().default(100).describe('Maximum pages to analyze'),
    detectAPIs: z.boolean().optional().default(true).describe('Whether to detect API endpoints'),
    analyzeContent: z.boolean().optional().default(true).describe('Whether to analyze content types'),
    checkSecurity: z.boolean().optional().default(true).describe('Whether to check security boundaries'),
    respectRobots: z.boolean().optional().default(true).describe('Whether to respect robots.txt')
  }).optional().default({}),

  outputOptions: z.object({
    includeDetailed: z.boolean().optional().default(true).describe('Generate detailed LLMs-full.txt'),
    includeAnalysis: z.boolean().optional().default(false).describe('Include raw analysis data'),
    contactEmail: z.string().email().optional().describe('Contact email for the LLMs.txt'),
    organizationName: z.string().optional().describe('Organization name'),
    customGuidelines: z.array(z.string()).optional().describe('Additional custom guidelines'),
    customRestrictions: z.array(z.string()).optional().describe('Additional restrictions')
  }).optional().default({}),

  complianceLevel: z.enum(['basic', 'standard', 'strict']).optional().default('standard').describe('Compliance level for generated guidelines'),
  
  format: z.enum(['both', 'llms-txt', 'llms-full-txt']).optional().default('both').describe('Which files to generate')
});

/**
 * GenerateLLMsTxtTool - Generate standard-compliant LLMs.txt and LLMs-full.txt files
 * 
 * This tool analyzes websites comprehensively and generates LLMs.txt files that define
 * how AI models should interact with the site, including:
 * 
 * - Usage guidelines and boundaries
 * - Rate limiting recommendations  
 * - Allowed/disallowed paths
 * - API endpoints and preferred access methods
 * - Content classification and restrictions
 * - Contact information and support details
 */
export class GenerateLLMsTxtTool {
  constructor(options = {}) {
    this.options = {
      timeout: options.timeout || 30000,
      userAgent: options.userAgent || 'LLMs.txt-Generator/1.0',
      ...options
    };

    this.analyzer = new LLMsTxtAnalyzer({
      timeout: this.options.timeout,
      userAgent: this.options.userAgent
    });
  }

  async execute(params) {
    const startTime = Date.now();
    logger.info('Starting LLMs.txt generation...');

    try {
      const validated = GenerateLLMsTxtSchema.parse(params);
      const { url, analysisOptions, outputOptions, complianceLevel, format } = validated;

      const baseUrl = getBaseUrl(url);
      
      // Step 1: Comprehensive Website Analysis
      logger.info(`Analyzing website: ${baseUrl}`);
      const analysis = await this.analyzer.analyzeWebsite(url, analysisOptions);

      // Step 2: Generate LLMs.txt Content
      const llmsTxtContent = this.generateLLMsTxt(analysis, outputOptions, complianceLevel);

      // Step 3: Generate LLMs-full.txt Content (if requested)
      let llmsFullTxtContent = null;
      if (format === 'both' || format === 'llms-full-txt') {
        llmsFullTxtContent = this.generateLLMsFullTxt(analysis, outputOptions, complianceLevel);
      }

      const result = {
        baseUrl,
        generatedAt: new Date().toISOString(),
        analysisStats: {
          pagesAnalyzed: analysis.structure.totalPages || 0,
          apisDetected: analysis.apis.length,
          securityAreasFound: analysis.securityAreas.length,
          analysisTimeMs: analysis.metadata.analysisTimeMs,
          totalTimeMs: Date.now() - startTime
        },
        files: {},
        recommendations: this.generateRecommendations(analysis),
        complianceLevel,
        warnings: this.generateWarnings(analysis)
      };

      // Add generated content based on format
      if (format === 'both' || format === 'llms-txt') {
        result.files['llms.txt'] = llmsTxtContent;
      }
      if (format === 'both' || format === 'llms-full-txt') {
        result.files['llms-full.txt'] = llmsFullTxtContent;
      }

      // Include raw analysis if requested
      if (outputOptions.includeAnalysis) {
        result.analysis = analysis;
      }

      logger.info(`LLMs.txt generation completed in ${Date.now() - startTime}ms`);
      return result;

    } catch (error) {
      logger.error(`LLMs.txt generation failed: ${error.message}`);
      throw new Error(`LLMs.txt generation failed: ${error.message}`);
    }
  }

  /**
   * Generate standard LLMs.txt content
   */
  generateLLMsTxt(analysis, outputOptions, complianceLevel) {
    const lines = [];
    const baseUrl = analysis.metadata.baseUrl;

    // Header
    lines.push('# LLMs.txt');
    lines.push(`# AI Model Usage Guidelines for ${baseUrl}`);
    lines.push(`# Generated on ${new Date().toISOString()}`);
    lines.push('');

    // Contact Information
    if (outputOptions.contactEmail || outputOptions.organizationName) {
      lines.push('# Contact Information');
      if (outputOptions.organizationName) {
        lines.push(`# Organization: ${outputOptions.organizationName}`);
      }
      if (outputOptions.contactEmail) {
        lines.push(`# Contact: ${outputOptions.contactEmail}`);
      }
      lines.push('');
    }

    // Usage Policy
    lines.push('# Usage Policy');
    lines.push('User-agent: *');
    
    // Rate limiting based on analysis
    if (analysis.rateLimit) {
      lines.push(`Crawl-delay: ${Math.ceil(analysis.rateLimit.recommendedDelay / 1000)}`);
      lines.push(`Request-rate: ${analysis.rateLimit.recommendedRPM}/60`);
    }

    lines.push('');

    // Disallowed paths based on security analysis
    if (analysis.securityAreas && analysis.securityAreas.length > 0) {
      lines.push('# Restricted Areas');
      for (const area of analysis.securityAreas) {
        const path = area.path || new URL(area.url).pathname;
        lines.push(`Disallow: ${path}`);
      }
      lines.push('');
    }

    // Common restriction patterns based on compliance level
    lines.push('# Standard Restrictions');
    const standardRestrictions = this.getStandardRestrictions(complianceLevel);
    for (const restriction of standardRestrictions) {
      lines.push(`Disallow: ${restriction}`);
    }
    lines.push('');

    // API Information
    if (analysis.apis && analysis.apis.length > 0) {
      lines.push('# Preferred Data Access');
      lines.push('# Use these APIs instead of scraping when possible:');
      for (const api of analysis.apis) {
        if (api.type !== 'documentation') {
          lines.push(`# API: ${api.url} (${api.type})`);
        }
      }
      lines.push('');
    }

    // Custom guidelines
    if (outputOptions.customGuidelines && outputOptions.customGuidelines.length > 0) {
      lines.push('# Custom Guidelines');
      for (const guideline of outputOptions.customGuidelines) {
        lines.push(`# ${guideline}`);
      }
      lines.push('');
    }

    // Custom restrictions
    if (outputOptions.customRestrictions && outputOptions.customRestrictions.length > 0) {
      lines.push('# Additional Restrictions');
      for (const restriction of outputOptions.customRestrictions) {
        lines.push(`Disallow: ${restriction}`);
      }
      lines.push('');
    }

    // Sitemap reference
    if (analysis.structure && analysis.structure.sitemap) {
      lines.push('# Site Structure');
      lines.push(`Sitemap: ${baseUrl}/sitemap.xml`);
      lines.push('');
    }

    // Footer
    lines.push('# This file was generated by LLMs.txt Generator');
    lines.push('# For detailed guidelines, see llms-full.txt');

    return lines.join('\n');
  }

  /**
   * Generate detailed LLMs-full.txt content
   */
  generateLLMsFullTxt(analysis, outputOptions, complianceLevel) {
    const lines = [];
    const baseUrl = analysis.metadata.baseUrl;

    // Header
    lines.push('# LLMs-full.txt');
    lines.push(`# Comprehensive AI Model Usage Guidelines for ${baseUrl}`);
    lines.push(`# Generated on ${new Date().toISOString()}`);
    lines.push('');

    // Table of Contents
    lines.push('## Table of Contents');
    lines.push('1. Overview and Contact Information');
    lines.push('2. Rate Limiting and Technical Guidelines');
    lines.push('3. Content Access Policy');
    lines.push('4. API and Data Sources');
    lines.push('5. Security and Privacy Guidelines');
    lines.push('6. Compliance and Legal Requirements');
    lines.push('7. Best Practices and Examples');
    lines.push('8. Support and Contact Information');
    lines.push('');

    // Section 1: Overview
    lines.push('## 1. Overview and Contact Information');
    lines.push('');
    if (outputOptions.organizationName) {
      lines.push(`**Organization:** ${outputOptions.organizationName}`);
    }
    if (outputOptions.contactEmail) {
      lines.push(`**Contact:** ${outputOptions.contactEmail}`);
    }
    lines.push(`**Website:** ${baseUrl}`);
    lines.push(`**Compliance Level:** ${complianceLevel}`);
    lines.push('');
    lines.push('This document provides comprehensive guidelines for AI models accessing this website.');
    lines.push('All automated access should follow these guidelines to ensure responsible usage.');
    lines.push('');

    // Section 2: Rate Limiting
    lines.push('## 2. Rate Limiting and Technical Guidelines');
    lines.push('');
    if (analysis.rateLimit) {
      lines.push('### Recommended Rate Limits');
      lines.push(`- **Delay between requests:** ${analysis.rateLimit.recommendedDelay}ms minimum`);
      lines.push(`- **Maximum concurrent requests:** ${analysis.rateLimit.maxConcurrency}`);
      lines.push(`- **Requests per minute:** ${analysis.rateLimit.recommendedRPM} maximum`);
      lines.push('');
      lines.push('### Technical Justification');
      lines.push(`${analysis.rateLimit.reasoning}`);
      lines.push(`Average response time: ${analysis.rateLimit.averageResponseTime}ms`);
      lines.push('');
    }

    lines.push('### User Agent Requirements');
    lines.push('- Use descriptive User-Agent strings identifying your AI model/service');
    lines.push('- Include contact information in User-Agent when possible');
    lines.push('- Example: "MyAI-Bot/1.0 (+https://example.com/bot-info)"');
    lines.push('');

    // Section 3: Content Access Policy
    lines.push('## 3. Content Access Policy');
    lines.push('');
    
    if (analysis.contentTypes) {
      lines.push('### Content Classification');
      lines.push(`- **Public content pages:** ${analysis.contentTypes.public.length} identified`);
      lines.push(`- **Restricted content:** ${analysis.contentTypes.restricted.length} areas`);
      lines.push(`- **Interactive forms:** ${analysis.contentTypes.forms.length} detected`);
      lines.push(`- **Media files:** ${analysis.contentTypes.media.length} found`);
      lines.push('');
    }

    lines.push('### Allowed Content Types');
    lines.push('- Public articles, blog posts, and informational content');
    lines.push('- Product information and descriptions');
    lines.push('- Published documentation and help content');
    lines.push('- Publicly available media with proper attribution');
    lines.push('');

    lines.push('### Restricted Content');
    lines.push('- User-generated content requiring authentication');
    lines.push('- Personal information and private data');
    lines.push('- Form submissions and interactive content');
    lines.push('- Administrative and configuration areas');
    lines.push('');

    // Section 4: APIs and Data Sources
    lines.push('## 4. API and Data Sources');
    lines.push('');
    
    if (analysis.apis && analysis.apis.length > 0) {
      lines.push('### Available APIs');
      for (const api of analysis.apis) {
        lines.push(`- **${api.type}:** ${api.url}`);
        if (api.description) {
          lines.push(`  - Description: ${api.description}`);
        }
        if (api.contentType) {
          lines.push(`  - Content-Type: ${api.contentType}`);
        }
      }
      lines.push('');
      lines.push('**Recommendation:** Use APIs instead of web scraping when available for better performance and reliability.');
    } else {
      lines.push('### No Public APIs Detected');
      lines.push('No public APIs were found during analysis. Web scraping may be necessary but should follow all guidelines in this document.');
    }
    lines.push('');

    // Section 5: Security and Privacy
    lines.push('## 5. Security and Privacy Guidelines');
    lines.push('');
    
    if (analysis.securityAreas && analysis.securityAreas.length > 0) {
      lines.push('### Restricted Areas Detected');
      const securityAreasByType = {};
      for (const area of analysis.securityAreas) {
        if (!securityAreasByType[area.type]) {
          securityAreasByType[area.type] = [];
        }
        securityAreasByType[area.type].push(area.path);
      }
      
      for (const [type, paths] of Object.entries(securityAreasByType)) {
        lines.push(`**${type.charAt(0).toUpperCase() + type.slice(1)} Areas:**`);
        for (const path of paths) {
          lines.push(`- ${path}`);
        }
        lines.push('');
      }
    }

    lines.push('### Privacy Requirements');
    lines.push('- Do not collect, store, or process personal information');
    lines.push('- Respect user privacy and data protection regulations');
    lines.push('- Avoid accessing user-specific content or accounts');
    lines.push('- Do not attempt to bypass authentication mechanisms');
    lines.push('');

    // Section 6: Compliance
    lines.push('## 6. Compliance and Legal Requirements');
    lines.push('');
    lines.push('### Data Protection Compliance');
    lines.push('- **GDPR:** Respect European data protection requirements');
    lines.push('- **CCPA:** Follow California Consumer Privacy Act guidelines');
    lines.push('- **COPPA:** Extra caution with any content that might involve minors');
    lines.push('');
    lines.push('### Terms of Service');
    lines.push('- Review and comply with website Terms of Service');
    lines.push('- Respect intellectual property and copyright');
    lines.push('- Provide proper attribution when using content');
    lines.push('');

    // Section 7: Best Practices
    lines.push('## 7. Best Practices and Examples');
    lines.push('');
    lines.push('### Recommended Practices');
    lines.push('1. **Start with robots.txt:** Always check and follow robots.txt directives');
    lines.push('2. **Use structured data:** Look for JSON-LD, microdata, and other structured formats');
    lines.push('3. **Respect meta tags:** Pay attention to meta robots tags and directives');
    lines.push('4. **Cache responsibly:** Cache content appropriately to reduce server load');
    lines.push('5. **Handle errors gracefully:** Implement proper error handling and retries');
    lines.push('');

    if (analysis.structure && analysis.structure.robotsTxt) {
      lines.push('### Robots.txt Status');
      lines.push('A robots.txt file was found and should be respected. Key directives:');
      const robotsLines = analysis.structure.robotsTxt.split('\n').slice(0, 10);
      for (const line of robotsLines) {
        if (line.trim() && !line.startsWith('#')) {
          lines.push(`- ${line.trim()}`);
        }
      }
      lines.push('');
    }

    lines.push('### Example Usage Patterns');
    lines.push('```');
    lines.push('# Good: Respectful crawling with delays');
    lines.push('for url in urls:');
    lines.push('    response = fetch(url, headers={"User-Agent": "MyBot/1.0"})');
    lines.push(`    time.sleep(${Math.ceil((analysis.rateLimit?.recommendedDelay || 1000) / 1000)})`);
    lines.push('    process(response)');
    lines.push('');
    lines.push('# Bad: Aggressive crawling without delays');
    lines.push('# for url in urls:');
    lines.push('#     response = fetch(url)  # No delay, no user agent');
    lines.push('#     process(response)');
    lines.push('```');
    lines.push('');

    // Section 8: Support
    lines.push('## 8. Support and Contact Information');
    lines.push('');
    if (outputOptions.contactEmail) {
      lines.push(`**Primary Contact:** ${outputOptions.contactEmail}`);
    }
    lines.push('');
    lines.push('### Reporting Issues');
    lines.push('If you encounter issues or need clarification on these guidelines:');
    lines.push('1. Check this document for guidance');
    lines.push('2. Review the basic llms.txt file');
    lines.push('3. Contact us using the information above');
    lines.push('');
    lines.push('### Updates');
    lines.push('These guidelines may be updated periodically. Check the generation date above');
    lines.push('and consider regenerating this file if accessing the site after significant changes.');
    lines.push('');

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('**Generated by:** LLMs.txt Generator v1.0');
    lines.push('**Analysis Date:** ' + analysis.metadata.analyzedAt);
    lines.push('**Analysis Coverage:** ' + (analysis.structure.totalPages || 'N/A') + ' pages analyzed');
    if (analysis.errors && analysis.errors.length > 0) {
      lines.push('**Note:** Some analysis errors occurred. Contact support if needed.');
    }

    return lines.join('\n');
  }

  /**
   * Get standard restriction patterns based on compliance level
   */
  getStandardRestrictions(complianceLevel) {
    const basic = [
      '/admin',
      '/wp-admin',
      '/login',
      '/user',
      '/account'
    ];

    const standard = [
      ...basic,
      '/private',
      '/internal',
      '/config',
      '/settings',
      '/auth',
      '/oauth',
      '/signin',
      '/*?password=*',
      '/*?token=*'
    ];

    const strict = [
      ...standard,
      '/api/*/private',
      '/dashboard',
      '/profile',
      '/*?session=*',
      '/*?key=*',
      '/cms',
      '/administrator',
      '/*.env',
      '/*.config'
    ];

    switch (complianceLevel) {
      case 'basic': return basic;
      case 'strict': return strict;
      default: return standard;
    }
  }

  /**
   * Generate deployment and implementation recommendations
   */
  generateRecommendations(analysis) {
    const recommendations = [];

    // Rate limiting recommendations
    if (analysis.rateLimit && analysis.rateLimit.averageResponseTime > 2000) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Server response times are slow. Consider very conservative rate limiting.'
      });
    }

    // Security recommendations
    if (analysis.securityAreas && analysis.securityAreas.length > 5) {
      recommendations.push({
        type: 'security',
        priority: 'medium',
        message: 'Multiple security areas detected. Review restrictions carefully.'
      });
    }

    // API recommendations
    if (analysis.apis && analysis.apis.length > 0) {
      recommendations.push({
        type: 'integration',
        priority: 'high',
        message: 'APIs detected. Strongly recommend using APIs instead of scraping.'
      });
    }

    // Structure recommendations
    if (analysis.structure && analysis.structure.totalPages > 1000) {
      recommendations.push({
        type: 'scale',
        priority: 'medium',
        message: 'Large website detected. Consider focused crawling strategies.'
      });
    }

    return recommendations;
  }

  /**
   * Generate warnings about potential issues
   */
  generateWarnings(analysis) {
    const warnings = [];

    // Analysis errors
    if (analysis.errors && analysis.errors.length > 0) {
      warnings.push({
        type: 'analysis',
        message: `${analysis.errors.length} errors occurred during analysis. Guidelines may be incomplete.`
      });
    }

    // Missing robots.txt
    if (!analysis.structure || !analysis.structure.robotsTxt) {
      warnings.push({
        type: 'robots',
        message: 'No robots.txt found. Extra caution recommended.'
      });
    }

    // High security areas
    if (analysis.securityAreas && analysis.securityAreas.length > 10) {
      warnings.push({
        type: 'security',
        message: 'Many restricted areas detected. This site may not be suitable for broad crawling.'
      });
    }

    return warnings;
  }
}

export default GenerateLLMsTxtTool;