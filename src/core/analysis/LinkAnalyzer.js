import { URL } from 'url';
import { normalizeUrl } from '../../utils/urlNormalizer.js';

/**
 * LinkAnalyzer - Comprehensive link analysis system with graph builder
 * 
 * Features:
 * - Directed graph data structure for link relationships
 * - Parent-child relationship tracking
 * - Link importance calculation (simplified PageRank)
 * - Circular reference detection and handling
 * - Path analysis (shortest paths, common ancestors)
 * - Graph export capabilities
 * - Performance optimized for large link networks
 */
export class LinkAnalyzer {
  constructor(options = {}) {
    const {
      dampingFactor = 0.85,    // PageRank damping factor
      maxIterations = 100,     // Max PageRank iterations
      convergenceThreshold = 0.0001, // PageRank convergence threshold
      defaultImportance = 1.0, // Default node importance
      enableCaching = true,    // Enable calculation caching
      maxCacheSize = 10000     // Max cache entries
    } = options;

    // Graph data structures
    this.nodes = new Map();           // url -> node data
    this.outboundLinks = new Map();   // url -> Set of outbound URLs
    this.inboundLinks = new Map();    // url -> Set of inbound URLs
    this.linkMetadata = new Map();    // `from|to` -> link metadata
    
    // Analysis results cache
    this.cache = enableCaching ? new Map() : null;
    this.maxCacheSize = maxCacheSize;
    
    // PageRank parameters
    this.dampingFactor = dampingFactor;
    this.maxIterations = maxIterations;
    this.convergenceThreshold = convergenceThreshold;
    this.defaultImportance = defaultImportance;
    
    // Performance tracking
    this.stats = {
      nodesCount: 0,
      linksCount: 0,
      lastAnalysisTime: null,
      totalAnalyses: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // Cycle detection cache
    this.cycleCache = new Map();
    this.pathCache = new Map();
  }

  /**
   * Add a link to the graph
   * @param {string} from - Source URL
   * @param {string} to - Target URL
   * @param {Object} metadata - Link metadata (anchor text, context, etc.)
   */
  addLink(from, to, metadata = {}) {
    const normalizedFrom = normalizeUrl(from);
    const normalizedTo = normalizeUrl(to);
    
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
      return false;
    }
    
    // Initialize nodes if they don't exist
    this.ensureNode(normalizedFrom);
    this.ensureNode(normalizedTo);
    
    // Add outbound link
    if (!this.outboundLinks.has(normalizedFrom)) {
      this.outboundLinks.set(normalizedFrom, new Set());
    }
    this.outboundLinks.get(normalizedFrom).add(normalizedTo);
    
    // Add inbound link
    if (!this.inboundLinks.has(normalizedTo)) {
      this.inboundLinks.set(normalizedTo, new Set());
    }
    this.inboundLinks.get(normalizedTo).add(normalizedFrom);
    
    // Store link metadata
    const linkKey = `${normalizedFrom}|${normalizedTo}`;
    const existingMetadata = this.linkMetadata.get(linkKey) || {};
    this.linkMetadata.set(linkKey, {
      ...existingMetadata,
      ...metadata,
      firstSeen: existingMetadata.firstSeen || new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      count: (existingMetadata.count || 0) + 1
    });
    
    // Update statistics
    this.stats.linksCount = this.linkMetadata.size;
    
    // Clear caches that depend on graph structure
    this.clearStructuralCaches();
    
    return true;
  }

  /**
   * Ensure a node exists in the graph
   * @param {string} url - URL to ensure exists
   */
  ensureNode(url) {
    const normalizedUrl = normalizeUrl(url);
    if (!this.nodes.has(normalizedUrl)) {
      try {
        const urlObj = new URL(normalizedUrl);
        this.nodes.set(normalizedUrl, {
          url: normalizedUrl,
          domain: urlObj.hostname,
          path: urlObj.pathname,
          importance: this.defaultImportance,
          depth: 0,
          discovered: new Date().toISOString(),
          metadata: {}
        });
        this.stats.nodesCount = this.nodes.size;
      } catch (error) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get all inbound links for a URL
   * @param {string} url - Target URL
   * @returns {Array} Array of source URLs
   */
  getInboundLinks(url) {
    const normalizedUrl = normalizeUrl(url);
    const inbound = this.inboundLinks.get(normalizedUrl);
    return inbound ? Array.from(inbound) : [];
  }

  /**
   * Get all outbound links for a URL
   * @param {string} url - Source URL
   * @returns {Array} Array of target URLs
   */
  getOutboundLinks(url) {
    const normalizedUrl = normalizeUrl(url);
    const outbound = this.outboundLinks.get(normalizedUrl);
    return outbound ? Array.from(outbound) : [];
  }

  /**
   * Calculate link importance using simplified PageRank algorithm
   * @param {Object} options - Calculation options
   * @returns {Map} Map of URL to importance score
   */
  calculateImportance(options = {}) {
    const cacheKey = 'importance_' + JSON.stringify(options);
    if (this.cache && this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    const startTime = Date.now();
    const {
      dampingFactor = this.dampingFactor,
      maxIterations = this.maxIterations,
      convergenceThreshold = this.convergenceThreshold
    } = options;
    
    const nodes = Array.from(this.nodes.keys());
    const nodeCount = nodes.length;
    
    if (nodeCount === 0) {
      return new Map();
    }
    
    // Initialize PageRank values
    let pageRank = new Map();
    let newPageRank = new Map();
    const initialValue = 1.0 / nodeCount;
    
    for (const node of nodes) {
      pageRank.set(node, initialValue);
      newPageRank.set(node, initialValue);
    }
    
    let iteration = 0;
    let hasConverged = false;
    
    while (iteration < maxIterations && !hasConverged) {
      hasConverged = true;
      
      for (const node of nodes) {
        let sum = 0;
        const inboundNodes = this.getInboundLinks(node);
        
        for (const inboundNode of inboundNodes) {
          const outboundCount = this.getOutboundLinks(inboundNode).length;
          if (outboundCount > 0) {
            sum += pageRank.get(inboundNode) / outboundCount;
          }
        }
        
        const newValue = (1 - dampingFactor) / nodeCount + dampingFactor * sum;
        newPageRank.set(node, newValue);
        
        // Check convergence
        if (Math.abs(newValue - pageRank.get(node)) > convergenceThreshold) {
          hasConverged = false;
        }
      }
      
      // Swap maps for next iteration
      [pageRank, newPageRank] = [newPageRank, pageRank];
      iteration++;
    }
    
    // Update node importance scores
    for (const [url, score] of pageRank) {
      const node = this.nodes.get(url);
      if (node) {
        node.importance = score;
      }
    }
    
    // Cache results
    if (this.cache) {
      this.setCacheEntry(cacheKey, pageRank);
      this.stats.cacheMisses++;
    }
    
    this.stats.lastAnalysisTime = Date.now() - startTime;
    this.stats.totalAnalyses++;
    
    return pageRank;
  }

  /**
   * Detect circular reference chains in the graph
   * @param {Object} options - Detection options
   * @returns {Array} Array of cycle objects
   */
  detectCycles(options = {}) {
    const cacheKey = 'cycles_' + JSON.stringify(options);
    if (this.cache && this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    const {
      maxCycleLength = 10,
      includeMetadata = false
    } = options;
    
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];
    
    const dfs = (node) => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart);
          cycle.push(node); // Complete the cycle
          
          if (cycle.length <= maxCycleLength) {
            const cycleObj = {
              nodes: cycle,
              length: cycle.length - 1, // Don't count repeated node
              strength: this.calculateCycleStrength(cycle)
            };
            
            if (includeMetadata) {
              cycleObj.metadata = this.getCycleMetadata(cycle);
            }
            
            cycles.push(cycleObj);
          }
        }
        return;
      }
      
      if (visited.has(node)) {
        return;
      }
      
      visited.add(node);
      recursionStack.add(node);
      path.push(node);
      
      const outbound = this.getOutboundLinks(node);
      for (const neighbor of outbound) {
        dfs(neighbor);
      }
      
      recursionStack.delete(node);
      path.pop();
    };
    
    // Start DFS from each unvisited node
    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
    
    // Remove duplicate cycles
    const uniqueCycles = this.deduplicateCycles(cycles);
    
    // Cache results
    if (this.cache) {
      this.setCacheEntry(cacheKey, uniqueCycles);
      this.stats.cacheMisses++;
    }
    
    return uniqueCycles;
  }

  /**
   * Find relationship path between two URLs
   * @param {string} url1 - Starting URL
   * @param {string} url2 - Target URL
   * @param {Object} options - Path finding options
   * @returns {Object|null} Path object or null if no path exists
   */
  getRelationshipPath(url1, url2, options = {}) {
    const normalizedUrl1 = normalizeUrl(url1);
    const normalizedUrl2 = normalizeUrl(url2);
    
    if (!this.nodes.has(normalizedUrl1) || !this.nodes.has(normalizedUrl2)) {
      return null;
    }
    
    const cacheKey = `path_${normalizedUrl1}_${normalizedUrl2}_${JSON.stringify(options)}`;
    if (this.cache && this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    const {
      maxDepth = 10,
      bidirectional = true,
      includeMetadata = false
    } = options;
    
    let result = null;
    
    if (bidirectional) {
      // Try both directions and return the shortest path
      const path1to2 = this.findShortestPath(normalizedUrl1, normalizedUrl2, maxDepth);
      const path2to1 = this.findShortestPath(normalizedUrl2, normalizedUrl1, maxDepth);
      
      if (path1to2 && path2to1) {
        result = path1to2.length <= path2to1.length ? 
          { path: path1to2, direction: 'forward' } :
          { path: path2to1.reverse(), direction: 'reverse' };
      } else if (path1to2) {
        result = { path: path1to2, direction: 'forward' };
      } else if (path2to1) {
        result = { path: path2to1.reverse(), direction: 'reverse' };
      }
    } else {
      const path = this.findShortestPath(normalizedUrl1, normalizedUrl2, maxDepth);
      if (path) {
        result = { path, direction: 'forward' };
      }
    }
    
    if (result && includeMetadata) {
      result.metadata = this.getPathMetadata(result.path);
    }
    
    // Cache results
    if (this.cache) {
      this.setCacheEntry(cacheKey, result);
      this.stats.cacheMisses++;
    }
    
    return result;
  }

  /**
   * Find shortest path between two nodes using BFS
   * @param {string} start - Start URL
   * @param {string} end - End URL
   * @param {number} maxDepth - Maximum search depth
   * @returns {Array|null} Path array or null
   */
  findShortestPath(start, end, maxDepth) {
    if (start === end) {
      return [start];
    }
    
    const queue = [[start]];
    const visited = new Set([start]);
    
    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];
      
      if (path.length > maxDepth) {
        continue;
      }
      
      const neighbors = this.getOutboundLinks(current);
      for (const neighbor of neighbors) {
        if (neighbor === end) {
          return [...path, neighbor];
        }
        
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    
    return null;
  }

  /**
   * Export graph in various formats
   * @param {string} format - Export format ('json', 'dot', 'csv', 'adjacency')
   * @param {Object} options - Export options
   * @returns {string|Object} Exported data
   */
  exportGraph(format = 'json', options = {}) {
    const {
      includeMetadata = true,
      includeImportance = true,
      minImportance = 0
    } = options;
    
    switch (format.toLowerCase()) {
      case 'json':
        return this.exportJSON(includeMetadata, includeImportance, minImportance);
      case 'dot':
        return this.exportDOT(includeMetadata, includeImportance, minImportance);
      case 'csv':
        return this.exportCSV(includeMetadata, includeImportance, minImportance);
      case 'adjacency':
        return this.exportAdjacencyMatrix();
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Export graph as JSON
   */
  exportJSON(includeMetadata, includeImportance, minImportance) {
    const nodes = [];
    const links = [];
    
    // Export nodes
    for (const [url, nodeData] of this.nodes) {
      if (includeImportance && nodeData.importance < minImportance) {
        continue;
      }
      
      const node = {
        id: url,
        url: url,
        domain: nodeData.domain,
        path: nodeData.path
      };
      
      if (includeImportance) {
        node.importance = nodeData.importance;
      }
      
      if (includeMetadata) {
        node.metadata = nodeData.metadata;
        node.discovered = nodeData.discovered;
      }
      
      nodes.push(node);
    }
    
    // Export links
    for (const [linkKey, linkData] of this.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      if (includeImportance) {
        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);
        if ((fromNode && fromNode.importance < minImportance) || 
            (toNode && toNode.importance < minImportance)) {
          continue;
        }
      }
      
      const link = {
        source: from,
        target: to,
        count: linkData.count
      };
      
      if (includeMetadata) {
        link.metadata = {
          anchorText: linkData.anchorText,
          context: linkData.context,
          firstSeen: linkData.firstSeen,
          lastSeen: linkData.lastSeen
        };
      }
      
      links.push(link);
    }
    
    return {
      nodes,
      links,
      statistics: this.getStatistics(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Export graph in DOT format (Graphviz)
   */
  exportDOT(includeMetadata, includeImportance, minImportance) {
    let dot = 'digraph LinkGraph {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=ellipse];\n\n';
    
    // Add nodes
    for (const [url, nodeData] of this.nodes) {
      if (includeImportance && nodeData.importance < minImportance) {
        continue;
      }
      
      const nodeId = this.getDOTNodeId(url);
      const domain = nodeData.domain;
      const importance = includeImportance ? nodeData.importance.toFixed(3) : '';
      
      dot += `  ${nodeId} [label="${domain}${importance ? '\\n' + importance : ''}"];\n`;
    }
    
    dot += '\n';
    
    // Add edges
    for (const [linkKey] of this.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      if (includeImportance) {
        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);
        if ((fromNode && fromNode.importance < minImportance) || 
            (toNode && toNode.importance < minImportance)) {
          continue;
        }
      }
      
      const fromId = this.getDOTNodeId(from);
      const toId = this.getDOTNodeId(to);
      dot += `  ${fromId} -> ${toId};\n`;
    }
    
    dot += '}';
    return dot;
  }

  /**
   * Export graph as CSV
   */
  exportCSV(includeMetadata, includeImportance, minImportance) {
    const headers = ['source', 'target', 'count'];
    if (includeImportance) {
      headers.push('source_importance', 'target_importance');
    }
    if (includeMetadata) {
      headers.push('anchor_text', 'first_seen', 'last_seen');
    }
    
    let csv = headers.join(',') + '\n';
    
    for (const [linkKey, linkData] of this.linkMetadata) {
      const [from, to] = linkKey.split('|');
      
      if (includeImportance) {
        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);
        if ((fromNode && fromNode.importance < minImportance) || 
            (toNode && toNode.importance < minImportance)) {
          continue;
        }
      }
      
      const row = [from, to, linkData.count];
      
      if (includeImportance) {
        const fromImportance = this.nodes.get(from)?.importance || 0;
        const toImportance = this.nodes.get(to)?.importance || 0;
        row.push(fromImportance.toFixed(4), toImportance.toFixed(4));
      }
      
      if (includeMetadata) {
        row.push(
          this.escapeCSV(linkData.anchorText || ''),
          linkData.firstSeen || '',
          linkData.lastSeen || ''
        );
      }
      
      csv += row.join(',') + '\n';
    }
    
    return csv;
  }

  /**
   * Export adjacency matrix
   */
  exportAdjacencyMatrix() {
    const nodes = Array.from(this.nodes.keys()).sort();
    const size = nodes.length;
    const matrix = Array(size).fill(null).map(() => Array(size).fill(0));
    
    const nodeIndex = new Map();
    nodes.forEach((node, index) => {
      nodeIndex.set(node, index);
    });
    
    for (const [linkKey] of this.linkMetadata) {
      const [from, to] = linkKey.split('|');
      const fromIndex = nodeIndex.get(from);
      const toIndex = nodeIndex.get(to);
      
      if (fromIndex !== undefined && toIndex !== undefined) {
        matrix[fromIndex][toIndex] = 1;
      }
    }
    
    return {
      nodes,
      matrix,
      size
    };
  }

  /**
   * Get comprehensive graph statistics
   */
  getStatistics() {
    const importance = this.calculateImportance();
    const cycles = this.detectCycles();
    
    const stats = {
      ...this.stats,
      nodes: this.nodes.size,
      links: this.linkMetadata.size,
      density: this.nodes.size > 1 ? 
        (this.linkMetadata.size / (this.nodes.size * (this.nodes.size - 1))) : 0,
      avgOutboundLinks: 0,
      avgInboundLinks: 0,
      maxOutboundLinks: 0,
      maxInboundLinks: 0,
      cycles: cycles.length,
      stronglyConnectedComponents: this.countStronglyConnectedComponents(),
      importanceDistribution: this.getImportanceDistribution(importance),
      domainDistribution: this.getDomainDistribution(),
      pathLengthDistribution: this.getPathLengthDistribution()
    };
    
    // Calculate link statistics
    let totalOutbound = 0;
    let totalInbound = 0;
    let maxOut = 0;
    let maxIn = 0;
    
    for (const node of this.nodes.keys()) {
      const outCount = this.getOutboundLinks(node).length;
      const inCount = this.getInboundLinks(node).length;
      
      totalOutbound += outCount;
      totalInbound += inCount;
      maxOut = Math.max(maxOut, outCount);
      maxIn = Math.max(maxIn, inCount);
    }
    
    stats.avgOutboundLinks = this.nodes.size > 0 ? totalOutbound / this.nodes.size : 0;
    stats.avgInboundLinks = this.nodes.size > 0 ? totalInbound / this.nodes.size : 0;
    stats.maxOutboundLinks = maxOut;
    stats.maxInboundLinks = maxIn;
    
    return stats;
  }

  /**
   * Helper method to calculate cycle strength
   */
  calculateCycleStrength(cycle) {
    let strength = 0;
    for (let i = 0; i < cycle.length - 1; i++) {
      const linkKey = `${cycle[i]}|${cycle[i + 1]}`;
      const linkData = this.linkMetadata.get(linkKey);
      strength += linkData ? linkData.count : 1;
    }
    return strength / (cycle.length - 1);
  }

  /**
   * Helper method to get cycle metadata
   */
  getCycleMetadata(cycle) {
    const metadata = [];
    for (let i = 0; i < cycle.length - 1; i++) {
      const linkKey = `${cycle[i]}|${cycle[i + 1]}`;
      const linkData = this.linkMetadata.get(linkKey);
      metadata.push({
        from: cycle[i],
        to: cycle[i + 1],
        anchorText: linkData?.anchorText,
        count: linkData?.count || 1
      });
    }
    return metadata;
  }

  /**
   * Helper method to get path metadata
   */
  getPathMetadata(path) {
    const metadata = [];
    for (let i = 0; i < path.length - 1; i++) {
      const linkKey = `${path[i]}|${path[i + 1]}`;
      const linkData = this.linkMetadata.get(linkKey);
      metadata.push({
        from: path[i],
        to: path[i + 1],
        anchorText: linkData?.anchorText,
        count: linkData?.count || 1
      });
    }
    return metadata;
  }

  /**
   * Helper method to deduplicate cycles
   */
  deduplicateCycles(cycles) {
    const seen = new Set();
    return cycles.filter(cycle => {
      const normalized = this.normalizeCycle(cycle.nodes);
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
  }

  /**
   * Normalize cycle for deduplication
   */
  normalizeCycle(nodes) {
    // Find the lexicographically smallest node as starting point
    let minIndex = 0;
    for (let i = 1; i < nodes.length - 1; i++) {
      if (nodes[i] < nodes[minIndex]) {
        minIndex = i;
      }
    }
    
    // Rotate cycle to start with smallest node
    const normalized = [
      ...nodes.slice(minIndex, -1),
      ...nodes.slice(0, minIndex),
      nodes[minIndex]
    ];
    
    return normalized.join('->');
  }

  /**
   * Count strongly connected components using Tarjan's algorithm
   */
  countStronglyConnectedComponents() {
    let index = 0;
    let componentCount = 0;
    const stack = [];
    const indices = new Map();
    const lowLinks = new Map();
    const onStack = new Set();
    
    const strongConnect = (node) => {
      indices.set(node, index);
      lowLinks.set(node, index);
      index++;
      stack.push(node);
      onStack.add(node);
      
      const neighbors = this.getOutboundLinks(node);
      for (const neighbor of neighbors) {
        if (!indices.has(neighbor)) {
          strongConnect(neighbor);
          lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(neighbor)));
        } else if (onStack.has(neighbor)) {
          lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(neighbor)));
        }
      }
      
      if (lowLinks.get(node) === indices.get(node)) {
        componentCount++;
        let component;
        do {
          component = stack.pop();
          onStack.delete(component);
        } while (component !== node);
      }
    };
    
    for (const node of this.nodes.keys()) {
      if (!indices.has(node)) {
        strongConnect(node);
      }
    }
    
    return componentCount;
  }

  /**
   * Get importance distribution statistics
   */
  getImportanceDistribution(importanceMap) {
    const values = Array.from(importanceMap.values()).sort((a, b) => b - a);
    
    if (values.length === 0) {
      return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
    }
    
    const min = values[values.length - 1];
    const max = values[0];
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const median = values.length % 2 === 0 ?
      (values[Math.floor(values.length / 2) - 1] + values[Math.floor(values.length / 2)]) / 2 :
      values[Math.floor(values.length / 2)];
    
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return { min, max, mean, median, stdDev };
  }

  /**
   * Get domain distribution
   */
  getDomainDistribution() {
    const domains = new Map();
    for (const node of this.nodes.values()) {
      domains.set(node.domain, (domains.get(node.domain) || 0) + 1);
    }
    return Object.fromEntries(domains);
  }

  /**
   * Get path length distribution
   */
  getPathLengthDistribution() {
    const lengths = new Map();
    for (const node of this.nodes.values()) {
      const pathLength = node.path.split('/').filter(s => s).length;
      lengths.set(pathLength, (lengths.get(pathLength) || 0) + 1);
    }
    return Object.fromEntries(lengths);
  }

  /**
   * Helper methods for caching
   */
  setCacheEntry(key, value) {
    if (!this.cache) return;
    
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }

  clearStructuralCaches() {
    if (!this.cache) return;
    
    for (const key of this.cache.keys()) {
      if (key.startsWith('cycles_') || key.startsWith('path_') || key.startsWith('importance_')) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Helper methods for export formats
   */
  getDOTNodeId(url) {
    return `"${url.replace(/"/g, '\\"')}"`;
  }

  escapeCSV(value) {
    if (typeof value !== 'string') return value;
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Clear all data
   */
  clear() {
    this.nodes.clear();
    this.outboundLinks.clear();
    this.inboundLinks.clear();
    this.linkMetadata.clear();
    
    if (this.cache) {
      this.cache.clear();
    }
    
    this.stats = {
      nodesCount: 0,
      linksCount: 0,
      lastAnalysisTime: null,
      totalAnalyses: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * Merge another LinkAnalyzer into this one
   */
  merge(other) {
    if (!(other instanceof LinkAnalyzer)) {
      throw new Error('Can only merge with another LinkAnalyzer instance');
    }
    
    // Merge nodes
    for (const [url, nodeData] of other.nodes) {
      if (!this.nodes.has(url)) {
        this.nodes.set(url, { ...nodeData });
      } else {
        // Update with more recent data
        const existing = this.nodes.get(url);
        if (new Date(nodeData.discovered) > new Date(existing.discovered)) {
          this.nodes.set(url, { ...existing, ...nodeData });
        }
      }
    }
    
    // Merge links
    for (const [linkKey, linkData] of other.linkMetadata) {
      const [from, to] = linkKey.split('|');
      this.addLink(from, to, linkData);
    }
    
    this.stats.nodesCount = this.nodes.size;
    this.stats.linksCount = this.linkMetadata.size;
    
    return this;
  }
}

export default LinkAnalyzer;