# Task Delegation Patterns

## Parallel Task Execution

When launching sub-agents, maximize parallelization:

```
Good: Launch mcp-implementation AND testing-validation simultaneously
Bad: Wait for implementation to complete before starting tests
```

### Task Dependencies

Only serialize when there are actual dependencies:

1. **Independent (parallelize):**
   - Documentation updates
   - Security audits
   - Performance testing

2. **Dependent (serialize):**
   - Implementation → Testing
   - Code changes → Deployment

## Delegation Templates

### Feature Implementation

```
1. Launch mcp-implementation: "Implement [feature] following MCP SDK patterns"
2. Launch api-documenter (parallel): "Document [feature] API with examples"
3. After implementation: Launch testing-validation
4. After tests pass: Launch security-auditor
```

### Bug Fix

```
1. Research: Use Task(Explore) to find affected code
2. Launch mcp-implementation with specific fix instructions
3. Launch testing-validation to verify fix
```

### Release Preparation

```
1. Launch security-auditor: Full security review
2. Launch testing-validation (parallel): Complete test suite
3. Launch api-documenter (parallel): Update docs
4. After all pass: Launch deployment-manager
```

## Communication Patterns

### Detailed Task Prompts

Always provide sub-agents with:
- Specific file locations
- Expected outcomes
- Quality criteria
- Credit constraints (if applicable)

### Result Consolidation

When receiving sub-agent results:
1. Verify completeness against requirements
2. Check for conflicts between outputs
3. Ensure consistency across components
4. Update progress tracking
