# Fix Plan: track_changes Tool - ChangeTracker.js Corruption

## Problem Summary

The `track_changes` tool is currently disabled because the `src/core/ChangeTracker.js` file is corrupted. Starting at line 451, the file contains literal `\n` escape sequences instead of actual newline characters, making it invalid JavaScript syntax.

**Error Message:**
```
SyntaxError: Invalid or unexpected token
    at compileSourceTextModule (node:internal/modules/esm/utils:351:16)
```

**Location:** `src/core/ChangeTracker.js:451`

**Impact:**
- Server won't start if track_changes tool is enabled
- Reduces available tools from 19 to 18
- Website claims 19 tools but only 18 are functional

## Root Cause

The file appears to have been corrupted during a copy/paste or text processing operation where newline characters were accidentally converted to the literal string `\n` instead of actual line breaks. This makes the JavaScript parser treat large portions of code as a single string literal.

## Fix Options

### Option 1: Restore from Git History (RECOMMENDED - 5 minutes)

**Steps:**
1. Check git history for last working version:
   ```bash
   git log --oneline src/core/ChangeTracker.js
   ```

2. View the last good version:
   ```bash
   git show <commit-hash>:src/core/ChangeTracker.js
   ```

3. Restore the file:
   ```bash
   git checkout <commit-hash> -- src/core/ChangeTracker.js
   ```

4. Test the fix:
   ```bash
   BYPASS_API_KEY=true node server.js
   ```

**Pros:**
- Fastest solution
- Guaranteed to restore working code
- Preserves original implementation

**Cons:**
- Requires git history to contain uncorrupted version
- May lose recent changes if any were made after corruption

### Option 2: Manual Fix - Find and Replace (15-30 minutes)

**Steps:**
1. Open `src/core/ChangeTracker.js` in a text editor

2. Find all literal `\n` sequences and replace with actual newlines:
   - In most editors: Find `\\n  ` (backslash-n-space-space) and replace with actual newline
   - May need to do this in multiple passes

3. Look for these specific patterns starting at line 451:
   ```javascript
   }\n  }\n  \n  /**
   ```
   Should be:
   ```javascript
   }
     }

     /**
   ```

4. Check for proper indentation (the file uses 2-space indentation)

5. Verify syntax with Node.js:
   ```bash
   node --check src/core/ChangeTracker.js
   ```

6. Test the fix:
   ```bash
   BYPASS_API_KEY=true node server.js
   ```

**Pros:**
- Keeps any recent changes
- No dependency on git history

**Cons:**
- Time-consuming
- Error-prone (easy to miss some sequences)
- May introduce new formatting issues

### Option 3: Rewrite from Scratch (2-4 hours)

Only if Options 1 and 2 fail.

**Steps:**
1. Review the existing implementation to understand the intended functionality
2. Create new `src/core/ChangeTracker.js` with proper structure
3. Implement all required methods
4. Write tests
5. Integrate with server.js

**Pros:**
- Clean slate
- Opportunity to improve implementation
- No corruption issues

**Cons:**
- Very time-consuming
- Risk of introducing bugs
- Need to understand complex change tracking logic

## Recommended Approach

**Start with Option 1 (Git Restore):**

```bash
# 1. Check if uncorrupted version exists in git
git log --all --full-history -- src/core/ChangeTracker.js

# 2. Look at the most recent commits
git log -5 --oneline src/core/ChangeTracker.js

# 3. Check the diff to see when corruption happened
git diff HEAD~5 HEAD -- src/core/ChangeTracker.js | grep '\\n'

# 4. If found, restore from before corruption
git checkout <good-commit-hash> -- src/core/ChangeTracker.js

# 5. Verify the file is valid
node --check src/core/ChangeTracker.js

# 6. Test with the server
BYPASS_API_KEY=true timeout 5 node server.js 2>&1 | grep "Tools available"
```

**Expected Output After Fix:**
```
Tools available: fetch_url, extract_text, extract_links, extract_metadata, scrape_structured, crawl_deep, map_site, search_web, extract_content, process_document, summarize_content, analyze_content, batch_scrape, scrape_with_actions, deep_research, track_changes, generate_llms_txt, stealth_mode, localization
```

## Post-Fix Checklist

After fixing the file, uncomment the following in `server.js`:

### 1. Import statement (line 19-20):
```javascript
// Change from:
// import { TrackChangesTool } from "./src/tools/tracking/trackChanges.js";

// To:
import { TrackChangesTool } from "./src/tools/tracking/trackChanges.js";
```

### 2. Tool initialization (line 164-165):
```javascript
// Change from:
// const trackChangesTool = new TrackChangesTool();

// To:
const trackChangesTool = new TrackChangesTool();
```

### 3. Tool registration (line 1411-1535):
```javascript
// Remove the opening /* comment marker at line 1411
// Remove the closing */ comment marker at line 1535
```

### 4. Cleanup array (line 1893):
```javascript
// Change from:
// trackChangesTool, // temporarily disabled - file corrupted

// To:
trackChangesTool,
```

### 5. Tools display (line 1857):
```javascript
// Change from:
const trackingTools = ''; // track_changes temporarily disabled - file corrupted

// To:
const trackingTools = ', track_changes';
```

## Verification Steps

After all changes:

1. **Syntax Check:**
   ```bash
   node --check server.js
   node --check src/core/ChangeTracker.js
   ```

2. **Server Startup Test:**
   ```bash
   BYPASS_API_KEY=true timeout 5 node server.js 2>&1 | head -20
   ```

3. **Tool Count Verification:**
   ```bash
   BYPASS_API_KEY=true timeout 5 node server.js 2>&1 | grep -o "track_changes"
   ```

4. **Run Full Test Suite:**
   ```bash
   npm test
   npm run test:tools
   ```

5. **Test track_changes Tool:**
   ```bash
   # Create a simple test script to verify the tool works
   node test-track-changes.js
   ```

## Expected Timeline

- **Option 1 (Git Restore):** 5-10 minutes
- **Option 2 (Manual Fix):** 15-30 minutes
- **Option 3 (Rewrite):** 2-4 hours

## Success Criteria

- ✅ `node --check src/core/ChangeTracker.js` passes without errors
- ✅ Server starts successfully with track_changes tool enabled
- ✅ Server logs show 19 tools available (18 base + search_web)
- ✅ All existing tests pass
- ✅ No JavaScript syntax errors in console

## Additional Notes

### File Details
- **Path:** `src/core/ChangeTracker.js`
- **Corruption starts:** Line 451
- **Total lines:** Unknown (large file)
- **Language:** JavaScript ES6+ (uses async/await, classes)
- **Dependencies:** cheerio, diff, EventEmitter

### Related Files
- `src/tools/tracking/trackChanges.js` - Tool wrapper (should be OK)
- `server.js` - Main server file with tool registration
- `CLAUDE.md` - Documentation referencing the tool

### Prevention

To prevent this issue in the future:
1. Add git pre-commit hook to check for literal `\n` sequences
2. Use linting tools (ESLint) to catch syntax errors before commit
3. Add syntax checking to CI/CD pipeline
4. Regular backup of working codebase

## Support Resources

- **Git Documentation:** https://git-scm.com/docs
- **Node.js Syntax Checking:** https://nodejs.org/api/cli.html#--check
- **Change Tracking Implementation:** See Phase 2.4 notes in CLAUDE.md

---

**Priority:** HIGH - This blocks achieving the advertised "19 tools" feature count

**Estimated Effort:** 5-30 minutes (depending on git history availability)

**Owner:** To be assigned

**Status:** Documented - Ready for fix
