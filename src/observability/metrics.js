/**
 * Prometheus metrics — dependency-free implementation.
 *
 * Why no prom-client? CrawlForge is shipped via npm and runs in stdio mode
 * by default. Pulling in prom-client (and its dependency tree) just to
 * expose four counters/gauges is overkill. This 150 LOC implementation
 * conforms to the Prometheus exposition format 0.0.4.
 *
 * Disabled by default. Enable via `CRAWLFORGE_METRICS=true` in HTTP mode.
 *
 * Counters/gauges exposed:
 *   - crawlforge_tool_requests_total{tool,outcome}
 *   - crawlforge_tool_errors_total{tool,error_class}
 *   - crawlforge_tool_duration_ms{tool}    (histogram, summed)
 *   - crawlforge_credits_consumed_total{tool}
 *   - crawlforge_browser_pool_in_use       (gauge)
 *   - crawlforge_browser_pool_capacity     (gauge)
 */

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export function createMetricsRegistry() {
  const counters = new Map();   // name|labels -> number
  const gauges = new Map();     // name|labels -> number
  const histograms = new Map(); // name|labels -> { count, sum, buckets:{le->count} }

  const HISTOGRAM_BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

  function key(name, labels) {
    const labelStr = Object.entries(labels ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${escapeLabel(String(v))}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  return {
    contentType: CONTENT_TYPE,

    incCounter(name, labels, by = 1) {
      const k = key(name, labels);
      counters.set(k, (counters.get(k) ?? 0) + by);
    },

    setGauge(name, labels, value) {
      gauges.set(key(name, labels), value);
    },

    observeHistogram(name, labels, valueMs) {
      const k = key(name, labels);
      let h = histograms.get(k);
      if (!h) {
        h = { count: 0, sum: 0, buckets: Object.fromEntries(HISTOGRAM_BUCKETS_MS.map(b => [b, 0])) };
        histograms.set(k, h);
      }
      h.count += 1;
      h.sum += valueMs;
      for (const b of HISTOGRAM_BUCKETS_MS) {
        if (valueMs <= b) h.buckets[b] += 1;
      }
    },

    async render() {
      const lines = [];

      // Counters
      const counterNames = new Set();
      for (const k of counters.keys()) counterNames.add(k.split('{')[0]);
      for (const name of counterNames) {
        lines.push(`# HELP ${name} ${describe(name)}`);
        lines.push(`# TYPE ${name} counter`);
        for (const [k, v] of counters.entries()) {
          if (k.split('{')[0] === name) lines.push(`${k} ${v}`);
        }
      }

      // Gauges
      const gaugeNames = new Set();
      for (const k of gauges.keys()) gaugeNames.add(k.split('{')[0]);
      for (const name of gaugeNames) {
        lines.push(`# HELP ${name} ${describe(name)}`);
        lines.push(`# TYPE ${name} gauge`);
        for (const [k, v] of gauges.entries()) {
          if (k.split('{')[0] === name) lines.push(`${k} ${v}`);
        }
      }

      // Histograms
      const histNames = new Set();
      for (const k of histograms.keys()) histNames.add(k.split('{')[0]);
      for (const name of histNames) {
        lines.push(`# HELP ${name} ${describe(name)}`);
        lines.push(`# TYPE ${name} histogram`);
        for (const [k, h] of histograms.entries()) {
          if (k.split('{')[0] !== name) continue;
          // Reconstruct base labels (everything inside { })
          const baseLabels = k.includes('{') ? k.slice(k.indexOf('{') + 1, -1) : '';
          const sep = baseLabels ? ',' : '';
          for (const b of HISTOGRAM_BUCKETS_MS) {
            lines.push(`${name}_bucket{${baseLabels}${sep}le="${b}"} ${h.buckets[b]}`);
          }
          lines.push(`${name}_bucket{${baseLabels}${sep}le="+Inf"} ${h.count}`);
          lines.push(`${name}_sum${baseLabels ? `{${baseLabels}}` : ''} ${h.sum}`);
          lines.push(`${name}_count${baseLabels ? `{${baseLabels}}` : ''} ${h.count}`);
        }
      }

      return lines.join('\n') + '\n';
    },

    // Snapshot for tests
    _snapshot() {
      return {
        counters: Object.fromEntries(counters.entries()),
        gauges: Object.fromEntries(gauges.entries()),
        histograms: Object.fromEntries(histograms.entries())
      };
    }
  };
}

const HELP = {
  crawlforge_tool_requests_total: 'Total number of MCP tool invocations',
  crawlforge_tool_errors_total: 'Total number of MCP tool errors',
  crawlforge_tool_duration_ms: 'MCP tool invocation duration in milliseconds',
  crawlforge_credits_consumed_total: 'Total CrawlForge credits consumed',
  crawlforge_browser_pool_in_use: 'Number of browser contexts currently leased from the pool',
  crawlforge_browser_pool_capacity: 'Maximum browser context pool capacity'
};

function describe(name) {
  return HELP[name] ?? name;
}

function escapeLabel(v) {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}
