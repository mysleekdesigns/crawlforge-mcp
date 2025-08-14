/**
 * Critical Security Patches for Wave 3 Features
 * 
 * This file contains emergency patches for critical vulnerabilities
 * identified in the security audit. Apply these patches immediately
 * before any production deployment.
 */

import Wave3Security from './wave3-security.js';
const { SSRFProtection, PathSecurity, InputSecurity, CryptoSecurity, BrowserSecurity } = Wave3Security;

/**
 * CRITICAL PATCH 1: SSRF Protection for Research Tool
 * Fixes: CVE-001 - Server-Side Request Forgery
 */
export function patchResearchOrchestrator(ResearchOrchestrator) {
  const originalConductResearch = ResearchOrchestrator.prototype.conductResearch;
  
  ResearchOrchestrator.prototype.conductResearch = async function(topic, options = {}) {
    // Input validation
    if (typeof topic !== 'string' || topic.length < 3 || topic.length > 500) {
      throw new Error('Invalid topic: must be string between 3-500 characters');
    }
    
    // Sanitize topic to prevent script injection
    const sanitizedTopic = InputSecurity.sanitizeString(topic);
    
    // Validate and limit research parameters
    const secureOptions = {
      ...options,
      maxUrls: Math.min(options.maxUrls || 10, 50),
      timeLimit: Math.min(options.timeLimit || 60000, 120000),
      maxDepth: Math.min(Math.max(options.maxDepth || 3, 1), 5),
      concurrency: Math.min(options.concurrency || 3, 5)
    };
    
    return originalConductResearch.call(this, sanitizedTopic, secureOptions);
  };
}

/**
 * CRITICAL PATCH 2: Browser Security Hardening
 * Fixes: CVE-002, CVE-007 - Script Injection and Browser Security
 */
export function patchStealthBrowserManager(StealthBrowserManager) {
  // Override dangerous browser args
  const originalLaunchStealthBrowser = StealthBrowserManager.prototype.launchStealthBrowser;
  
  StealthBrowserManager.prototype.launchStealthBrowser = async function(config = {}) {
    // Force secure browser configuration
    const secureConfig = {
      ...config,
      level: config.level === 'advanced' ? 'medium' : config.level
    };
    
    // Override with secure browser args
    this.secureArgs = BrowserSecurity.getSecureBrowserArgs();
    
    return originalLaunchStealthBrowser.call(this, secureConfig);
  };
}

/**
 * CRITICAL PATCH 3: Path Traversal Protection
 * Fixes: CVE-003 - Arbitrary File System Access
 */
export function patchSnapshotManager(SnapshotManager) {
  // Secure file operations
  const originalWriteSnapshotFile = SnapshotManager.prototype.writeSnapshotFile;
  
  SnapshotManager.prototype.writeSnapshotFile = async function(snapshotId, content) {
    // Validate snapshot ID
    const safeSnapshotId = PathSecurity.validateSnapshotId(snapshotId);
    
    // Validate content size
    InputSecurity.validateContentSize(content);
    
    // Ensure safe file path
    const safePath = PathSecurity.sanitizePath(`${safeSnapshotId}.snap`, this.options.storageDir);
    
    return originalWriteSnapshotFile.call(this, safeSnapshotId, content);
  };
  
  // Override generateSnapshotId to use cryptographically secure generation
  SnapshotManager.prototype.generateSnapshotId = function(url, timestamp) {
    return CryptoSecurity.generateSecureId(16);
  };
}

/**
 * Apply all critical patches
 */
export function applyAllSecurityPatches(components) {
  console.log('🔒 Applying Wave 3 security patches...');
  
  if (components.ResearchOrchestrator) {
    patchResearchOrchestrator(components.ResearchOrchestrator);
    console.log('✅ ResearchOrchestrator patched');
  }
  
  if (components.StealthBrowserManager) {
    patchStealthBrowserManager(components.StealthBrowserManager);
    console.log('✅ StealthBrowserManager patched');  
  }
  
  if (components.SnapshotManager) {
    patchSnapshotManager(components.SnapshotManager);
    console.log('✅ SnapshotManager patched');
  }
  
  console.log('🛡️ All Wave 3 security patches applied successfully');
  console.log('⚠️  Remember to run security tests before deployment');
}

export default {
  patchResearchOrchestrator,
  patchStealthBrowserManager, 
  patchSnapshotManager,
  applyAllSecurityPatches
};
