/**
 * Wave 3 Security Test Suite
 * Validates security patches and tests for vulnerabilities
 */

import Wave3Security from './wave3-security.js';
const { SecurityTesting, SSRFProtection, PathSecurity, InputSecurity } = Wave3Security;

/**
 * Test SSRF Protection
 */
export async function testSSRFProtection() {
  console.log('🧪 Testing SSRF Protection...');
  
  const maliciousUrls = [
    'http://localhost:3000/admin',
    'http://127.0.0.1:22', 
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'ftp://internal.server.com',
    'http://10.0.0.1/secret',
    'https://metadata.google.internal/'
  ];
  
  const results = SecurityTesting.testSecurityFunction(
    SSRFProtection.validateUrl.bind(SSRFProtection),
    maliciousUrls
  );
  
  const blocked = results.filter(r => r.blocked).length;
  const total = results.length;
  
  console.log(`✅ SSRF Test: ${blocked}/${total} malicious URLs blocked`);
  
  if (blocked !== total) {
    console.error('❌ SSRF Protection insufficient!');
    results.filter(r => !r.blocked).forEach(r => {
      console.error(`  🚨 Not blocked: ${r.payload}`);
    });
  }
  
  return { passed: blocked === total, blocked, total };
}

/**
 * Test Path Traversal Protection  
 */
export function testPathTraversal() {
  console.log('🧪 Testing Path Traversal Protection...');
  
  const maliciousPaths = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\config\\sam',
    '/etc/shadow', 
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '....//....//....//etc/passwd',
    '../../../../../../../etc/passwd',
    '..\\..\\..\\..\\..\\..\\/etc/passwd'
  ];
  
  const results = SecurityTesting.testSecurityFunction(
    PathSecurity.validateSnapshotId.bind(PathSecurity),
    maliciousPaths
  );
  
  const blocked = results.filter(r => r.blocked).length;
  const total = results.length;
  
  console.log(`✅ Path Traversal Test: ${blocked}/${total} malicious paths blocked`);
  
  if (blocked !== total) {
    console.error('❌ Path Traversal Protection insufficient!');
    results.filter(r => !r.blocked).forEach(r => {
      console.error(`  🚨 Not blocked: ${r.payload}`);
    });
  }
  
  return { passed: blocked === total, blocked, total };
}

/**
 * Test Input Validation
 */
export function testInputValidation() {
  console.log('🧪 Testing Input Validation...');
  
  const maliciousInputs = [
    '<script>alert("XSS")</script>',
    'javascript:alert("XSS")',
    '<img src="x" onerror="alert(\'XSS\')">',
    '<svg onload="alert(\'XSS\')"></svg>',
    '${7*7}',
    '#{7*7}',
    '{{7*7}}',
    '<%= 7*7 %>'
  ];
  
  const results = maliciousInputs.map(input => {
    try {
      const sanitized = InputSecurity.sanitizeHtml(input);
      const isBlocked = !sanitized.includes('<script') && 
                       !sanitized.includes('javascript:') &&
                       !sanitized.includes('onerror=') &&
                       !sanitized.includes('onload=');
      return { input, blocked: isBlocked, sanitized };
    } catch (error) {
      return { input, blocked: true, error: error.message };
    }
  });
  
  const blocked = results.filter(r => r.blocked).length;
  const total = results.length;
  
  console.log(`✅ Input Validation Test: ${blocked}/${total} malicious inputs neutralized`);
  
  return { passed: blocked === total, blocked, total };
}

/**
 * Test Resource Limits
 */
export function testResourceLimits() {
  console.log('🧪 Testing Resource Limits...');
  
  const tests = [
    {
      name: 'Large Content',
      test: () => {
        const largeContent = 'x'.repeat(100 * 1024 * 1024); // 100MB
        try {
          InputSecurity.validateContentSize(largeContent);
          return false; // Should have thrown
        } catch (error) {
          return error.message.includes('Content too large');
        }
      }
    },
    {
      name: 'Long String',
      test: () => {
        const longString = 'x'.repeat(20000);
        try {
          InputSecurity.sanitizeString(longString, 10000);
          return false; // Should have thrown
        } catch (error) {
          return error.message.includes('String too long');
        }
      }
    },
    {
      name: 'Large Array',
      test: () => {
        const largeArray = new Array(200).fill('item');
        try {
          InputSecurity.sanitizeArray(largeArray, 100);
          return false; // Should have thrown
        } catch (error) {
          return error.message.includes('Array too long');
        }
      }
    }
  ];
  
  let passed = 0;
  tests.forEach(test => {
    if (test.test()) {
      console.log(`  ✅ ${test.name}: PASS`);
      passed++;
    } else {
      console.log(`  ❌ ${test.name}: FAIL`);
    }
  });
  
  console.log(`✅ Resource Limits Test: ${passed}/${tests.length} tests passed`);
  
  return { passed: passed === tests.length, passedCount: passed, total: tests.length };
}

/**
 * Test Cryptographic Functions
 */
export function testCryptographicSecurity() {
  console.log('🧪 Testing Cryptographic Security...');
  
  const tests = [
    {
      name: 'Secure ID Generation',
      test: () => {
        const id1 = Wave3Security.CryptoSecurity.generateSecureId();
        const id2 = Wave3Security.CryptoSecurity.generateSecureId();
        
        // Should be different
        if (id1 === id2) return false;
        
        // Should be hex and right length
        if (!/^[a-f0-9]{64}$/.test(id1)) return false;
        if (!/^[a-f0-9]{64}$/.test(id2)) return false;
        
        return true;
      }
    },
    {
      name: 'Timing Safe Comparison',
      test: () => {
        const hash1 = 'abcd1234';
        const hash2 = 'abcd1234';
        const hash3 = 'efgh5678';
        
        // Same hashes should match
        if (!Wave3Security.CryptoSecurity.timingSafeCompare(hash1, hash2)) return false;
        
        // Different hashes should not match
        if (Wave3Security.CryptoSecurity.timingSafeCompare(hash1, hash3)) return false;
        
        return true;
      }
    },
    {
      name: 'Webhook Signature',
      test: () => {
        const payload = JSON.stringify({ test: 'data' });
        const secret = 'test-secret';
        
        const signature1 = Wave3Security.CryptoSecurity.generateWebhookSignature(payload, secret);
        const signature2 = Wave3Security.CryptoSecurity.generateWebhookSignature(payload, secret);
        
        // Should be consistent
        if (signature1 !== signature2) return false;
        
        // Should validate correctly
        if (!Wave3Security.CryptoSecurity.validateWebhookSignature(payload, signature1, secret)) return false;
        
        // Should reject wrong signature
        if (Wave3Security.CryptoSecurity.validateWebhookSignature(payload, 'wrong', secret)) return false;
        
        return true;
      }
    }
  ];
  
  let passed = 0;
  tests.forEach(test => {
    if (test.test()) {
      console.log(`  ✅ ${test.name}: PASS`);
      passed++;
    } else {
      console.log(`  ❌ ${test.name}: FAIL`);
    }
  });
  
  console.log(`✅ Cryptographic Security Test: ${passed}/${tests.length} tests passed`);
  
  return { passed: passed === tests.length, passedCount: passed, total: tests.length };
}

/**
 * Run Full Security Test Suite
 */
export async function runFullSecurityTests() {
  console.log('🛡️  Running Wave 3 Security Test Suite...\n');
  
  const results = [];
  
  // Test SSRF Protection
  results.push(await testSSRFProtection());
  console.log('');
  
  // Test Path Traversal Protection
  results.push(testPathTraversal());
  console.log('');
  
  // Test Input Validation
  results.push(testInputValidation());
  console.log('');
  
  // Test Resource Limits
  results.push(testResourceLimits());
  console.log('');
  
  // Test Cryptographic Security
  results.push(testCryptographicSecurity());
  console.log('');
  
  // Summary
  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;
  
  console.log('🎯 Security Test Summary:');
  console.log(`   Passed: ${totalPassed}/${totalTests} test suites`);
  
  if (totalPassed === totalTests) {
    console.log('✅ ALL SECURITY TESTS PASSED! Wave 3 appears secure.');
  } else {
    console.log('❌ SECURITY TESTS FAILED! Do not deploy to production.');
    console.log('   Review failed tests and apply additional patches.');
  }
  
  return {
    allPassed: totalPassed === totalTests,
    passed: totalPassed,
    total: totalTests,
    results
  };
}

/**
 * Quick Security Health Check
 */
export function quickSecurityCheck() {
  console.log('🚀 Quick Security Health Check...');
  
  const checks = [
    {
      name: 'SSRF Protection Available',
      check: () => typeof SSRFProtection.validateUrl === 'function'
    },
    {
      name: 'Path Security Available', 
      check: () => typeof PathSecurity.validateSnapshotId === 'function'
    },
    {
      name: 'Input Sanitization Available',
      check: () => typeof InputSecurity.sanitizeString === 'function'
    },
    {
      name: 'Crypto Security Available',
      check: () => typeof Wave3Security.CryptoSecurity.generateSecureId === 'function'
    }
  ];
  
  let passed = 0;
  checks.forEach(check => {
    if (check.check()) {
      console.log(`  ✅ ${check.name}`);
      passed++;
    } else {
      console.log(`  ❌ ${check.name}`);
    }
  });
  
  console.log(`\n🎯 Health Check: ${passed}/${checks.length} security functions available`);
  
  return passed === checks.length;
}

// Export test functions
export default {
  testSSRFProtection,
  testPathTraversal,
  testInputValidation,
  testResourceLimits,
  testCryptographicSecurity,
  runFullSecurityTests,
  quickSecurityCheck
};
