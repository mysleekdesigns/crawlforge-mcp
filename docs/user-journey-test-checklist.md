# User Journey Testing Checklist

**Purpose:** Manual verification of complete npm install → setup → use flow
**Target:** CrawlForge.dev signup enforcement
**Estimated Time:** 15-20 minutes

---

## Pre-Testing Setup

### Environment Preparation

```bash
# 1. Clean slate - remove any existing config
rm -rf ~/.crawlforge

# 2. Uninstall if previously installed
npm uninstall -g crawlforge-mcp-server

# 3. Clear npm cache (optional)
npm cache clean --force
```

---

## Test Suite 1: First-Time User Journey

### Test 1.1: Fresh Installation

**Command:**
```bash
npm install -g crawlforge-mcp-server
```

**Expected Output:**
```
🎉 CrawlForge MCP Server installed!

Run "npx crawlforge-setup" to configure your API key and get started.
```

**✅ Pass Criteria:**
- Postinstall message displays
- Mentions `crawlforge-setup`
- Installation completes successfully

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 1.2: Run Server Without Setup

**Command:**
```bash
crawlforge
```

**Expected Output:**
```
╔═══════════════════════════════════════════════════════╗
║        CrawlForge MCP Server - Setup Required         ║
╚═══════════════════════════════════════════════════════╝

Welcome! This appears to be your first time using CrawlForge.

To get started, please run:
  npm run setup

Or set your API key via environment variable:
  export CRAWLFORGE_API_KEY="your_api_key_here"

Get your free API key at: https://www.crawlforge.dev/signup
(Includes 1,000 free credits!)
```

**✅ Pass Criteria:**
- Server does NOT start
- Beautiful ASCII art banner shown
- Signup URL displayed: https://www.crawlforge.dev/signup
- Exit code: 0 (clean exit)
- Mentions "1,000 free credits"

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 1.3: Run Setup with Empty API Key

**Command:**
```bash
npx crawlforge-setup
# Press Enter without typing anything
```

**Expected Output:**
```
❌ API key is required
Get your free API key at: https://www.crawlforge.dev/signup
```

**✅ Pass Criteria:**
- Setup fails gracefully
- Error message clear
- Signup URL repeated
- Exit code: 1 (error)

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 1.4: Run Setup with Invalid API Key

**Command:**
```bash
npx crawlforge-setup
# Enter: "invalid_fake_key_12345"
```

**Expected Output:**
```
🔄 Validating API key...

Setup failed. Please check your API key and try again.

Need help?
  • Documentation: https://www.crawlforge.dev/docs
  • Support: support@crawlforge.dev
```

**✅ Pass Criteria:**
- Backend validation attempt occurs
- Setup fails with clear error
- Support resources listed
- Signup URL mentioned in wizard intro

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 1.5: Visit Signup Page (Manual)

**Action:** Open browser to https://www.crawlforge.dev/signup

**✅ Pass Criteria:**
- Page loads successfully
- Signup form present
- Free tier advertised (1,000 credits)

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 1.6: Run Setup with Valid API Key

**Prerequisites:**
- You must have a real API key from https://www.crawlforge.dev/signup
- Or use test API key provided by development team

**Command:**
```bash
npx crawlforge-setup
# Enter your valid API key when prompted
```

**Expected Output:**
```
🔄 Validating API key...

────────────────────────────────────────────────────────

🎉 Setup complete! You can now use CrawlForge MCP Server.

Quick start:
  npm start              # Start the MCP server
  npm run test           # Test your setup

Need help? Visit: https://www.crawlforge.dev/docs
```

**✅ Pass Criteria:**
- Validation succeeds
- Success message shown
- Config saved to ~/.crawlforge/config.json
- Email/account details displayed (optional)

**Result:** [ ] PASS [ ] FAIL

**API Key Used:** _________________________________

**Notes:** _________________________________

---

### Test 1.7: Verify Config File Created

**Command:**
```bash
cat ~/.crawlforge/config.json
```

**Expected Structure:**
```json
{
  "apiKey": "your_api_key_here",
  "userId": "user_id",
  "email": "user@example.com",
  "createdAt": "2025-12-22T...",
  "version": "1.0.0"
}
```

**✅ Pass Criteria:**
- File exists
- Valid JSON structure
- Contains apiKey, userId, email
- File permissions readable (should recommend chmod 600)

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 1.8: Run Server After Setup

**Command:**
```bash
crawlforge
```

**Expected Output:**
```
CrawlForge MCP Server v3.0 running on stdio
Environment: production
Search enabled: true (provider: google)
Tools available: fetch_url, extract_text, extract_links, ...
```

**✅ Pass Criteria:**
- Server starts successfully
- Shows version 3.0.3 or later
- Lists 19 available tools
- No error messages

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

## Test Suite 2: Alternative Setup Methods

### Test 2.1: Environment Variable Setup

**Command:**
```bash
# First remove config
rm -rf ~/.crawlforge

# Set env var and run
export CRAWLFORGE_API_KEY="your_valid_key_here"
crawlforge
```

**Expected Output:**
```
🔧 Auto-configuring CrawlForge with provided API key...
✅ Setup complete!
CrawlForge MCP Server v3.0 running on stdio
...
```

**✅ Pass Criteria:**
- Auto-setup occurs
- Backend validation succeeds
- Server starts normally
- Config file created

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 2.2: Invalid Environment Variable

**Command:**
```bash
rm -rf ~/.crawlforge
export CRAWLFORGE_API_KEY="invalid_key"
crawlforge
```

**Expected Output:**
```
🔧 Auto-configuring CrawlForge with provided API key...
❌ Failed to authenticate with provided API key
Please check your API key or run: npm run setup
```

**✅ Pass Criteria:**
- Auto-setup fails
- Clear error message
- Server exits with error code
- Instructions to run setup shown

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

## Test Suite 3: Credit System Validation

### Test 3.1: Execute Basic Tool

**Prerequisites:** Valid setup completed

**Command:** (In MCP client like Cursor/Claude Code)
```
Use fetch_url tool with url: https://example.com
```

**✅ Pass Criteria:**
- Tool executes successfully
- Credit deduction occurs (1 credit)
- No error messages

**Result:** [ ] PASS [ ] FAIL

**Credits Before:** _________
**Credits After:** _________

**Notes:** _________________________________

---

### Test 3.2: Insufficient Credits Test

**Prerequisites:** Account with < 5 credits remaining

**Command:**
```
Use crawl_deep tool (requires 5 credits)
```

**Expected Output:**
```json
{
  "error": "Insufficient credits",
  "message": "This operation requires 5 credits. Please upgrade your plan at https://www.crawlforge.dev/pricing",
  "creditsRequired": 5
}
```

**✅ Pass Criteria:**
- Tool does NOT execute
- Clear error message
- Upgrade link included
- Correct credit requirement shown

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

## Test Suite 4: Security Validation

### Test 4.1: Modify Config File

**Command:**
```bash
# Change API key to invalid value
echo '{"apiKey":"fake_key","userId":"123","email":"test@test.com"}' > ~/.crawlforge/config.json

# Try to run server
crawlforge
```

**Expected Behavior:**
- Server may start
- First tool execution should fail on credit check
- Backend validates API key

**✅ Pass Criteria:**
- Invalid key detected on credit check
- Tool execution blocked
- Error message appropriate

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 4.2: Delete Config and Run Tool

**Command:**
```bash
rm -rf ~/.crawlforge
# Try to execute tool without config
```

**Expected Behavior:**
- Server shows setup required message
- No tool execution possible

**✅ Pass Criteria:**
- Properly blocked
- Clear setup instructions

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

## Test Suite 5: Error Message Quality

### Test 5.1: Network Failure Simulation

**Command:**
```bash
# Block access to api.crawlforge.dev (requires firewall/hosts modification)
# Then try setup or tool execution
```

**Expected Behavior:**
- Graceful error handling
- Clear network error message
- No crashes or hangs

**✅ Pass Criteria:**
- Handles network errors gracefully
- User-friendly error messages
- Appropriate timeouts

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

## Test Suite 6: Documentation Verification

### Test 6.1: Signup URL Consistency

**Check all locations:**

- [ ] package.json postinstall message
- [ ] setup.js wizard intro (line 32)
- [ ] setup.js empty key error (line 60)
- [ ] server.js setup required banner (line 85)
- [ ] Insufficient credits error (server.js line 120)

**✅ Pass Criteria:**
- All use: https://www.crawlforge.dev/signup
- Consistent messaging
- "1,000 free credits" mentioned

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

### Test 6.2: Free Credits Advertising

**Locations to check:**

- [ ] setup.js line 33: "(Includes 1,000 free credits to get started!)"
- [ ] server.js line 86: "(Includes 1,000 free credits!)"

**✅ Pass Criteria:**
- Consistent value (1,000)
- Prominent placement
- Encouraging tone

**Result:** [ ] PASS [ ] FAIL

**Notes:** _________________________________

---

## Summary Scorecard

### Overall Results

| Test Suite | Tests | Passed | Failed | Score |
|------------|-------|--------|--------|-------|
| Suite 1: First-Time User | 8 | _____ | _____ | ___% |
| Suite 2: Alternative Setup | 2 | _____ | _____ | ___% |
| Suite 3: Credit System | 2 | _____ | _____ | ___% |
| Suite 4: Security | 2 | _____ | _____ | ___% |
| Suite 5: Error Handling | 1 | _____ | _____ | ___% |
| Suite 6: Documentation | 2 | _____ | _____ | ___% |
| **TOTAL** | **17** | _____ | _____ | ___% |

### Pass/Fail Criteria

- **PASS:** 90% or higher (16/17 tests)
- **CONDITIONAL PASS:** 80-89% (14-15/17 tests)
- **FAIL:** Below 80% (< 14/17 tests)

### Overall Result: [ ] PASS [ ] CONDITIONAL PASS [ ] FAIL

---

## Issues Found

### Critical Issues (Blockers)

1. _____________________________________________________________
2. _____________________________________________________________

### Medium Issues (Should Fix)

1. _____________________________________________________________
2. _____________________________________________________________

### Minor Issues (Nice to Have)

1. _____________________________________________________________
2. _____________________________________________________________

---

## Recommendations

### Immediate Actions Required

1. _____________________________________________________________
2. _____________________________________________________________

### Optional Improvements

1. _____________________________________________________________
2. _____________________________________________________________

---

## Sign-Off

**Tester Name:** _______________________________

**Date:** _______________________________

**Environment:**
- OS: _______________________________
- Node Version: _______________________________
- Package Version: _______________________________

**Approved for Production:** [ ] YES [ ] NO [ ] WITH CONDITIONS

**Conditions (if any):** _____________________________________________

---

## Appendix: Test Data

### Valid Test API Keys

1. Key 1: _____________________________________________ (Credits: _____)
2. Key 2: _____________________________________________ (Credits: _____)

### Test Accounts Created

1. Email: __________________________ (Plan: ________, Credits: _____)
2. Email: __________________________ (Plan: ________, Credits: _____)

### URLs Tested

- Signup page: https://www.crawlforge.dev/signup
- API endpoint: https://api.crawlforge.dev
- Documentation: https://www.crawlforge.dev/docs
- Pricing page: https://www.crawlforge.dev/pricing

---

**Testing Checklist Complete**
