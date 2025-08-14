# Deep Research Tool Documentation

## Overview

The Deep Research Tool is an advanced MCP tool that conducts comprehensive multi-stage research with intelligent query expansion, source verification, conflict detection, and information synthesis. It orchestrates complex research workflows to provide thorough, credible, and well-analyzed information on any given topic.

## Features

### Core Capabilities
- **Multi-stage Research Process**: Systematic approach from broad exploration to specific investigation
- **Intelligent Query Expansion**: Automatic generation of research-focused query variations
- **Source Credibility Assessment**: Evaluates source reliability using multiple criteria
- **Conflict Detection**: Identifies contradictions and inconsistencies in information
- **Information Synthesis**: Combines findings from multiple sources into coherent insights
- **Research Activity Tracking**: Detailed logging of research process and decisions

### Advanced Features
- **Configurable Research Approaches**: Broad, focused, academic, current events, or comparative
- **Time-limited Sessions**: Prevents runaway research processes (30s to 5min)
- **Source Type Filtering**: Target specific types of sources (academic, government, news, etc.)
- **Multiple Output Formats**: Comprehensive, summary, citations only, or conflicts focus
- **Webhook Notifications**: Real-time updates for long-running research
- **Concurrent Session Management**: Multiple research sessions with queue management

## Usage

### Basic Usage

```javascript
// MCP Tool Call
{
  "topic": "climate change impacts on agriculture",
  "maxDepth": 3,
  "maxUrls": 25,
  "researchApproach": "academic",
  "outputFormat": "comprehensive"
}
```

### Advanced Configuration

```javascript
{
  "topic": "artificial intelligence ethics frameworks",
  "maxDepth": 5,
  "maxUrls": 100,
  "timeLimit": 180000, // 3 minutes
  "researchApproach": "comparative",
  "sourceTypes": ["academic", "government", "wiki"],
  "credibilityThreshold": 0.6,
  "enableConflictDetection": true,
  "enableSourceVerification": true,
  "outputFormat": "comprehensive",
  "queryExpansion": {
    "enableSynonyms": true,
    "enableSpellCheck": true,
    "enableContextual": true,
    "maxVariations": 10
  },
  "concurrency": 8,
  "webhook": {
    "url": "https://your-server.com/webhook",
    "events": ["completed", "failed"],
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

## Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `topic` | string | Research topic or question (3-500 characters) |

### Research Scope

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxDepth` | number | 5 | Research depth levels (1-10) |
| `maxUrls` | number | 50 | Maximum URLs to process (1-1000) |
| `timeLimit` | number | 120000 | Time limit in milliseconds (30s-5min) |
| `researchApproach` | enum | 'broad' | Research strategy (see approaches below) |

### Source Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sourceTypes` | array | ['any'] | Target source types |
| `credibilityThreshold` | number | 0.3 | Minimum source credibility (0-1) |
| `includeRecentOnly` | boolean | false | Focus on recent content only |

### Analysis Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enableConflictDetection` | boolean | true | Detect information conflicts |
| `enableSourceVerification` | boolean | true | Verify source credibility |
| `enableSynthesis` | boolean | true | Synthesize information |

### Output Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputFormat` | enum | 'comprehensive' | Output format (see formats below) |
| `includeRawData` | boolean | false | Include raw research data |
| `includeActivityLog` | boolean | false | Include detailed activity log |

## Research Approaches

### Broad (Default)
- Comprehensive coverage of the topic
- Multiple query variations
- Diverse source types
- Balanced depth and breadth

### Focused
- Targeted investigation
- Limited scope for speed
- Fewer sources, higher relevance
- Quick turnaround

### Academic
- Prioritizes scholarly sources
- Higher credibility threshold
- Emphasis on peer-reviewed content
- Authority-weighted ranking

### Current Events
- Focuses on recent information
- News and current sources
- Freshness-weighted ranking
- Time-sensitive content

### Comparative
- Enables conflict detection
- Multiple perspective analysis
- Contradiction identification
- Balanced viewpoint synthesis

## Output Formats

### Comprehensive (Default)
Complete research results including:
- Key findings with supporting evidence
- Source credibility assessments
- Consensus areas and conflicts
- Research gaps and recommendations
- Performance metrics

### Summary
Condensed results including:
- Top 5 key findings
- Top 5 sources
- Main conflicts (up to 3)
- Primary recommendations
- Credibility overview

### Citations Only
Source-focused output:
- Complete source list with metadata
- Citation summary statistics
- Domain and source type analysis
- Credibility distribution

### Conflicts Focus
Conflict analysis emphasis:
- Detailed conflict information
- Conflict resolution recommendations
- Consensus area identification
- Validation priorities

## Response Structure

### Successful Response
```json
{
  "success": true,
  "sessionId": "deep_research_12345_abc123",
  "researchSummary": {
    "totalSources": 25,
    "verifiedSources": 18,
    "keyFindings": 8,
    "conflictsFound": 2,
    "consensusAreas": 5
  },
  "findings": [...],
  "supportingEvidence": [...],
  "consensus": [...],
  "conflicts": [...],
  "researchGaps": [...],
  "recommendations": [...],
  "credibilityAssessment": {...},
  "performance": {...},
  "metadata": {...}
}
```

### Error Response
```json
{
  "success": false,
  "error": "Research time limit exceeded",
  "recommendations": [
    {
      "type": "increase_time_limit",
      "description": "Consider increasing time limit beyond 120000ms",
      "suggestedValue": 240000
    }
  ]
}
```

## Research Process Flow

### Stage 1: Topic Exploration
1. Parse and analyze research topic
2. Generate expanded query variations
3. Apply research-specific transformations
4. Rank queries by research relevance

### Stage 2: Initial Source Gathering
1. Execute searches with expanded queries
2. Collect initial source candidates
3. Apply source type filtering
4. Rank by research value and credibility

### Stage 3: Deep Source Exploration
1. Extract content from promising sources
2. Analyze content quality and relevance
3. Calculate readability scores
4. Track extraction success metrics

### Stage 4: Source Verification
1. Assess domain authority
2. Evaluate content quality indicators
3. Check for authority markers
4. Calculate overall credibility scores

### Stage 5: Information Synthesis
1. Extract key claims and facts
2. Group related information
3. Detect conflicts and contradictions
4. Identify consensus areas
5. Generate synthesis recommendations

### Stage 6: Result Compilation
1. Format results per output preferences
2. Generate performance metrics
3. Compile activity logs
4. Create final recommendations

## Error Handling

### Common Errors and Solutions

| Error Type | Description | Recommended Action |
|------------|-------------|-------------------|
| Time Limit Exceeded | Research took too long | Increase `timeLimit` or reduce scope |
| Network Issues | Connection problems | Retry with increased delays |
| Rate Limiting | Too many requests | Reduce `concurrency` setting |
| Invalid Parameters | Bad input validation | Check parameter types and ranges |
| Insufficient Sources | Too few quality sources | Lower `credibilityThreshold` |

### Error Recovery Recommendations
The tool automatically suggests recovery strategies:
- Time limit adjustments
- Scope reduction recommendations  
- Network retry strategies
- Concurrency optimizations
- Fallback research approaches

## Performance Considerations

### Optimization Tips
1. **Balance scope vs speed**: Lower maxDepth/maxUrls for faster results
2. **Use focused approach**: For quick investigations
3. **Adjust concurrency**: Based on network capacity
4. **Enable caching**: For repeated similar research
5. **Set appropriate time limits**: Based on urgency needs

### Resource Usage
- **Memory**: Typically 100-500MB for standard research
- **Network**: High bandwidth usage during source gathering
- **CPU**: Moderate usage for content processing
- **Time**: 30 seconds to 5 minutes depending on scope

## Integration Examples

### Basic Research
```javascript
const params = {
  topic: "renewable energy storage solutions",
  researchApproach: "broad",
  outputFormat: "summary"
};
```

### Academic Investigation  
```javascript
const params = {
  topic: "machine learning bias in healthcare",
  researchApproach: "academic",
  sourceTypes: ["academic", "government"],
  credibilityThreshold: 0.7,
  outputFormat: "comprehensive"
};
```

### Conflict Analysis
```javascript
const params = {
  topic: "covid vaccine effectiveness studies",
  researchApproach: "comparative", 
  enableConflictDetection: true,
  outputFormat: "conflicts_focus"
};
```

### Time-Sensitive Research
```javascript
const params = {
  topic: "latest AI regulatory developments",
  researchApproach: "current_events",
  includeRecentOnly: true,
  timeLimit: 60000 // 1 minute
};
```

## Monitoring and Management

### Session Management
- Track active research sessions
- Monitor session status and progress
- Cancel long-running sessions if needed
- Queue management for concurrent limits

### Performance Metrics
- Source discovery rates
- Content extraction success rates
- Credibility assessment statistics
- Time and resource usage tracking

### Health Monitoring
- Active session counts
- Memory usage monitoring
- Queue depth tracking
- Error rate monitoring

## Best Practices

### Topic Formulation
1. Be specific but not overly narrow
2. Use clear, unambiguous language
3. Include key terms and concepts
4. Avoid overly broad topics for focused research

### Parameter Tuning
1. Start with defaults and adjust based on results
2. Increase depth for comprehensive research
3. Reduce scope for time-critical investigations
4. Match approach to research needs

### Quality Assurance
1. Review conflict reports carefully
2. Verify high-impact findings independently
3. Consider source diversity in conclusions
4. Use credibility assessments as guidance

### Performance Optimization
1. Enable caching for repeated research
2. Use appropriate concurrency levels  
3. Set realistic time limits
4. Monitor resource usage patterns

## Troubleshooting

### No Results Found
- Check if topic is too specific
- Lower credibility threshold
- Expand source types
- Try broader research approach

### Poor Quality Results
- Increase credibility threshold
- Focus on academic/government sources
- Use academic research approach
- Enable source verification

### Timeout Issues
- Increase time limit
- Reduce max URLs or depth
- Use focused approach
- Decrease concurrency

### High Conflict Reports
- Enable synthesis for resolution
- Review source credibility
- Consider comparative approach
- Manually verify key conflicts

This documentation provides comprehensive guidance for using the Deep Research Tool effectively for various research scenarios.