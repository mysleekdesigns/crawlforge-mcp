import { OpenAIProvider } from './OpenAIProvider.js';
import { extractionFormat } from '../../utils/extractionFormat.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OllamaProvider } from './OllamaProvider.js';
import { Logger } from '../../utils/Logger.js';
import { isJudgementModel } from '../../utils/ollamaConfig.js';

/**
 * LLM Manager
 * Manages multiple LLM providers and provides unified interface
 */
export class LLMManager {
  constructor(options = {}) {
    this.logger = new Logger({ component: 'LLMManager' });
    this.providers = new Map();
    this.defaultProvider = null;
    this.fallbackProvider = null;
    // Ollama needs no credential, so its presence can only be settled by an
    // HTTP probe. Cached here for the lifetime of the manager; see ready().
    this._ollamaProbe = null;

    this.initializeProviders(options);
  }

  /**
   * Initialize available LLM providers
   */
  initializeProviders(options) {
    const {
      openai = {},
      anthropic = {},
      ollama = {},
      defaultProvider = 'auto'
    } = options;

    // Initialize OpenAI provider
    if (openai.apiKey || process.env.OPENAI_API_KEY) {
      const openaiProvider = new OpenAIProvider(openai);
      this.providers.set('openai', openaiProvider);
      this.logger.info('OpenAI provider initialized');
    }

    // Initialize Anthropic provider
    if (anthropic.apiKey || process.env.ANTHROPIC_API_KEY) {
      const anthropicProvider = new AnthropicProvider(anthropic);
      this.providers.set('anthropic', anthropicProvider);
      this.logger.info('Anthropic provider initialized');
    }

    // Initialize Ollama provider. Unlike the cloud providers there is no API
    // key to gate on — a local Ollama is the zero-config default — so it is
    // registered optimistically and dropped by ready() if the host is not
    // reachable. Without this, a machine running Ollama but holding no cloud
    // keys reported "no LLM providers available" and every caller silently
    // downgraded to keyword/CSS extraction.
    if (ollama.enabled !== false && process.env.DISABLE_OLLAMA !== 'true') {
      this.providers.set('ollama', new OllamaProvider(ollama));
      this.logger.info('Ollama provider initialized');
    }

    // Set default provider
    this.setDefaultProvider(defaultProvider);
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(providerName) {
    if (providerName === 'auto') {
      // Auto-select in order of preference: a cloud provider is only present
      // when its key was deliberately configured, so it outranks the
      // zero-config local Ollama.
      const preference = ['openai', 'anthropic', 'ollama'].filter(name => this.providers.has(name));
      this.defaultProvider = preference[0] || null;
      this.fallbackProvider = preference[1] || null;
    } else if (this.providers.has(providerName)) {
      this.defaultProvider = providerName;
      // Set fallback to other available provider
      for (const [name, provider] of this.providers) {
        if (name !== providerName) {
          this.fallbackProvider = name;
          break;
        }
      }
    }

    if (this.defaultProvider) {
      this.logger.info(`Default LLM provider set to: ${this.defaultProvider}`);
      if (this.fallbackProvider) {
        this.logger.info(`Fallback LLM provider: ${this.fallbackProvider}`);
      }
    } else {
      this.logger.warn('No LLM providers available');
    }
  }

  /**
   * Get a provider instance
   */
  getProvider(name = null) {
    const providerName = name || this.defaultProvider;
    if (!providerName) {
      throw new Error('No LLM provider available');
    }
    
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`LLM provider '${providerName}' not found`);
    }
    
    return provider;
  }

  /**
   * Generate completion with fallback support
   */
  async generateCompletion(prompt, options = {}) {
    const { provider = null, ...llmOptions } = options;
    
    try {
      const llmProvider = this.getProvider(provider);
      return await llmProvider.generateCompletion(prompt, llmOptions);
    } catch (error) {
      this.logger.warn(`Primary provider failed: ${error.message}`);
      
      // Try fallback provider if available
      if (this.fallbackProvider && (!provider || provider === this.defaultProvider)) {
        try {
          this.logger.info(`Trying fallback provider: ${this.fallbackProvider}`);
          const fallbackLLM = this.getProvider(this.fallbackProvider);
          return await fallbackLLM.generateCompletion(prompt, llmOptions);
        } catch (fallbackError) {
          this.logger.error(`Fallback provider also failed: ${fallbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Whether conflict detection may run: only a model measured not to invent
   * contradictions between sources that agree is asked (JUDGEMENT_MODELS in
   * ollamaConfig.js). A cloud provider is assumed capable — the measurement
   * that gated this off was of a 4B local model, and cloud models were not
   * measured; that assumption is deliberate. A pinned OLLAMA_DEFAULT_MODEL is
   * judged by the same list, so pinning the extraction winner keeps the gate
   * closed rather than routing around the measurement.
   */
  async canJudgeContradictions() {
    if (!this.defaultProvider) return false;
    if (this.defaultProvider !== 'ollama') return true;
    try {
      return isJudgementModel(await this.getProvider('ollama').resolveModel('judgement'));
    } catch {
      return false;
    }
  }

  /**
   * Generate embeddings with fallback support
   */
  async generateEmbedding(text, options = {}) {
    const { provider = null } = options;
    
    try {
      const llmProvider = this.getProvider(provider);
      return await llmProvider.generateEmbedding(text);
    } catch (error) {
      this.logger.warn(`Primary provider embedding failed: ${error.message}`);
      
      // Try fallback provider if available
      if (this.fallbackProvider && (!provider || provider === this.defaultProvider)) {
        try {
          this.logger.info(`Trying fallback provider for embedding: ${this.fallbackProvider}`);
          const fallbackLLM = this.getProvider(this.fallbackProvider);
          return await fallbackLLM.generateEmbedding(text);
        } catch (fallbackError) {
          this.logger.error(`Fallback provider embedding also failed: ${fallbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Calculate semantic similarity
   */
  async calculateSimilarity(text1, text2, options = {}) {
    const { provider = null } = options;
    
    try {
      const llmProvider = this.getProvider(provider);
      return await llmProvider.calculateSimilarity(text1, text2);
    } catch (error) {
      this.logger.warn(`Primary provider similarity failed: ${error.message}`);
      
      // Try fallback provider if available
      if (this.fallbackProvider && (!provider || provider === this.defaultProvider)) {
        try {
          this.logger.info(`Trying fallback provider for similarity: ${this.fallbackProvider}`);
          const fallbackLLM = this.getProvider(this.fallbackProvider);
          return await fallbackLLM.calculateSimilarity(text1, text2);
        } catch (fallbackError) {
          this.logger.error(`Fallback provider similarity also failed: ${fallbackError.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Generate query expansion suggestions
   */
  async expandQuery(query, options = {}) {
    const {
      maxExpansions = 5,
      includeContextual = true,
      includeSynonyms = true,
      includeRelated = true
    } = options;

    const systemPrompt = `You are a query expansion expert. Generate relevant search query variations for research purposes.

Rules:
1. Return only the query variations, one per line
2. Focus on research-oriented variations
3. Include different perspectives and angles
4. Maintain semantic relevance
5. Keep queries concise and searchable
6. Maximum ${maxExpansions} variations`;

    let prompt = `Original query: "${query}"\n\nGenerate ${maxExpansions} research-focused query variations:`;

    if (includeContextual) {
      prompt += '\n- Include contextual variations';
    }
    if (includeSynonyms) {
      prompt += '\n- Include synonym-based variations';
    }
    if (includeRelated) {
      prompt += '\n- Include related concept variations';
    }

    try {
      const response = await this.generateCompletion(prompt, {
        systemPrompt,
        maxTokens: 300,
        temperature: 0.8
      });

      return response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('-') && !line.includes(':'))
        .slice(0, maxExpansions);
    } catch (error) {
      this.logger.warn('LLM query expansion failed, using fallback', { error: error.message });
      return this.fallbackQueryExpansion(query, maxExpansions);
    }
  }

  /**
   * Analyze content relevance to a topic
   */
  async analyzeRelevance(content, topic, options = {}) {
    const { maxContentLength = 2000 } = options;
    
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + '...'
      : content;

    const systemPrompt = `You are a content relevance analyzer. Evaluate how relevant the given content is to the specified research topic.

Return a JSON object with:
{
  "relevanceScore": 0.0-1.0,
  "keyPoints": ["point1", "point2", ...],
  "topicAlignment": "description of alignment",
  "credibilityIndicators": ["indicator1", "indicator2", ...]
}

Be brief: at most 5 items per array, one short sentence each.`;

    const prompt = `Research Topic: "${topic}"

Content to analyze:
${truncatedContent}

Analyze the relevance of this content to the research topic:`;

    try {
      // Same discipline as synthesizeFindings: constrain the output shape
      // (small local models otherwise wrap the JSON in markdown fences —
      // the raw JSON.parse here failed on every Ollama run), strip fences,
      // validate the load-bearing field, and retry a truncated response
      // once before falling back.
      const relevanceSchema = {
        type: 'object',
        properties: {
          relevanceScore: { type: 'number' },
          keyPoints: { type: 'array', items: { type: 'string' } },
          topicAlignment: { type: 'string' },
          credibilityIndicators: { type: 'array', items: { type: 'string' } }
        },
        required: ['relevanceScore']
      };

      let lastError;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.generateCompletion(prompt, {
            systemPrompt,
            maxTokens: 800,
            temperature: 0.3,
            format: relevanceSchema
          });

          const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          const analysis = JSON.parse(cleaned);
          if (!analysis || typeof analysis.relevanceScore !== 'number') {
            throw new Error('Relevance response missing relevanceScore');
          }
          return {
            relevanceScore: Math.max(0, Math.min(1, analysis.relevanceScore)),
            keyPoints: analysis.keyPoints || [],
            topicAlignment: analysis.topicAlignment || '',
            credibilityIndicators: analysis.credibilityIndicators || []
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    } catch (error) {
      this.logger.warn('LLM relevance analysis failed, using fallback', { error: error.message });
      return this.fallbackRelevanceAnalysis(content, topic);
    }
  }

  /**
   * Generate research synthesis
   */
  async synthesizeFindings(findings, topic, options = {}) {
    const { maxFindings = 10, includeConflicts = true } = options;
    
    const limitedFindings = findings.slice(0, maxFindings);
    
    const systemPrompt = `You are a research synthesis expert. Create a comprehensive synthesis of research findings on a given topic.

Generate a JSON response with:
{
  "summary": "overall summary",
  "keyInsights": ["insight1", "insight2", ...],
  "themes": ["theme1", "theme2", ...],
  "confidence": 0.0-1.0,
  "gaps": ["gap1", "gap2", ...],
  "recommendations": ["rec1", "rec2", ...]
}

Be brief: summary at most 3 sentences; each array at most 5 items, one short sentence each.`;

    const findingsText = limitedFindings
      .map((finding, index) => {
        // A finding can be a whole flattened page section (sitemap dumps run
        // 1500+ chars). Passing it whole bloats the prompt and pulls a long
        // answer that overruns the token budget, truncating the JSON.
        const text = String(finding.finding || finding.text || finding);
        return `${index + 1}. ${text.length > 300 ? text.slice(0, 300) + '…' : text}`;
      })
      .join('\n');

    const prompt = `Research Topic: "${topic}"

Research Findings:
${findingsText}

Synthesize these findings into a comprehensive analysis:`;

    try {
      // Constrain the output shape (Ollama structured outputs; other providers
      // ignore `format`). Small local models otherwise wrap the JSON in
      // markdown fences, drift the key names, or emit an empty object — any of
      // which blanked the synthesis users see.
      const synthesisSchema = {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          keyInsights: { type: 'array', items: { type: 'string' } },
          themes: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          gaps: { type: 'array', items: { type: 'string' } },
          recommendations: { type: 'array', items: { type: 'string' } }
        },
        required: ['summary', 'keyInsights', 'themes', 'confidence']
      };

      // Two attempts: small local models occasionally overrun the token
      // budget mid-string, and a truncated response cannot be parsed. 1600
      // tokens gives the brevity-capped answer ~2x headroom (800 truncated
      // roughly two runs in three on real findings).
      let lastError;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.generateCompletion(prompt, {
            systemPrompt,
            maxTokens: 1600,
            temperature: 0.4,
            format: synthesisSchema
          });

          // Strip markdown code fences if present
          const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          if (!parsed || typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
            throw new Error('Synthesis response missing summary');
          }
          return parsed;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    } catch (error) {
      this.logger.warn('LLM synthesis failed, using fallback', { error: error.message });
      return this.fallbackSynthesis(findings, topic);
    }
  }

  /**
   * Score how much each claim sentence states something about the research topic.
   *
   * Exists because sentence-shape and genre heuristics cannot answer the
   * question that matters here. Two of them were built for deep_research and
   * reverted: both had to read the publisher rather than the sentence, and one
   * source still produced five distinct registers of the same off-topic
   * sentence — pitch, ranking, offering, feature list, comparison — each of
   * which was synthesized into a research conclusion. What separates
   * "automated browsers are detected by TLS fingerprinting" from "our platform
   * handles fingerprinting for you" is not vocabulary, which they share; it is
   * whether the sentence asserts something about the subject or describes a
   * thing built around it. That is a semantic judgement, so it is made here.
   *
   * The response is index-keyed rather than positional because a positional
   * one made the whole gate inert. Requiring exactly N scores in order looked
   * safe and was not: a small local model asked for 35 scores returned 39,
   * both attempts failed the length check, the method returned [], and no
   * claim was ever scored in production. Carrying the index with each score
   * removes the failure mode — a miscount now costs the extra entries, not
   * the run.
   *
   * @param {string[]} claims - Claim sentences.
   * @param {string} topic - The research topic.
   * @returns {Promise<number[]|Array<number|null>>} An array of exactly
   *   `claims.length` entries in input order: a score in [0,1] where the model
   *   scored the claim, `null` where it did not. Callers treat a non-number as
   *   "unscored, never filter", so a partial result is worth more than none.
   *   Empty array only on hard failure — unparseable output, no scores array,
   *   or nothing usable anywhere in the run.
   */
  async scoreClaimRelevance(claims, topic, options = {}) {
    // Small batches deliberately: a 4B model tracks ten-odd sentences far more
    // reliably than forty, and several small calls degrade better than one
    // large one — a batch that fails now costs its own claims, not all of them.
    const { maxClaimLength = 240, batchSize = 12 } = options;

    if (!Array.isArray(claims) || claims.length === 0) {
      return [];
    }

    const systemPrompt = `You rate how strongly each numbered sentence states something about a research topic.

Return a JSON object:
{"scores": [{"i": 0, "score": 0.8}, {"i": 1, "score": 0.2}]}

"i" is the sentence number exactly as shown; the first sentence is 0. Include one entry for every sentence.

Rate high when the sentence asserts something about the topic itself — how it works, what it does, a mechanism, a measurement, a cause or an effect.
Rate low when the sentence describes a commercial offering rather than the subject — its features, plans, pricing, coverage or why to choose it — even when it uses the topic's vocabulary. A product built around a subject is not a statement about that subject.
Rate low for navigation text, boilerplate, author or publication metadata.

Return the entries and nothing else.`;

    const scoreSchema = {
      type: 'object',
      properties: {
        scores: {
          type: 'array',
          items: {
            type: 'object',
            properties: { i: { type: 'integer' }, score: { type: 'number' } },
            required: ['i', 'score']
          }
        }
      },
      required: ['scores']
    };

    const scores = new Array(claims.length).fill(null);
    let anyScored = false;

    for (let start = 0; start < claims.length; start += batchSize) {
      const batch = claims.slice(start, start + batchSize).map(claim => {
        const text = String(claim ?? '');
        return text.length > maxClaimLength ? text.slice(0, maxClaimLength) + '…' : text;
      });

      const prompt = `Research topic: "${topic}"

Sentences (numbered from 0):
${batch.map((text, index) => `${index}. ${text}`).join('\n')}

Rate these ${batch.length} sentences:`;

      // Same discipline as analyzeRelevance: constrain the output shape,
      // strip fences, validate the load-bearing field, retry once.
      let batchScores = null;
      let lastError;
      for (let attempt = 0; attempt < 2 && !batchScores; attempt++) {
        try {
          const response = await this.generateCompletion(prompt, {
            systemPrompt,
            maxTokens: 100 + batch.length * 20,
            temperature: 0.1,
            format: scoreSchema,
            role: 'judgement'
          });

          const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed?.scores)) {
            throw new Error('Relevance response missing scores');
          }

          const mapped = new Array(batch.length).fill(null);
          let usable = 0;
          for (const entry of parsed.scores) {
            if (!entry || typeof entry !== 'object') continue;
            // Strictly a real integer: Number(null) is 0 and Number(true) is 1,
            // either of which would land a score on a claim it does not belong
            // to. An unusable entry is skipped, never realigned.
            const index = entry.i;
            if (typeof index !== 'number' || !Number.isInteger(index)) continue;
            if (index < 0 || index >= batch.length || mapped[index] !== null) continue;

            const value = entry.score;
            const score = typeof value === 'number' ? value
              : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
            if (!Number.isFinite(score)) continue;

            mapped[index] = Math.max(0, Math.min(1, score));
            usable++;
          }
          if (usable === 0) {
            throw new Error('No usable scores in response');
          }
          batchScores = mapped;
        } catch (error) {
          lastError = error;
        }
      }

      if (batchScores) {
        for (let i = 0; i < batch.length; i++) scores[start + i] = batchScores[i];
        anyScored = true;
      } else {
        // This batch stays null and the run continues. Unscored claims are
        // never filtered, so losing one batch costs less than losing the gate.
        this.logger.warn('LLM claim relevance batch unscored', { error: lastError.message });
      }
    }

    if (!anyScored) {
      this.logger.warn('LLM claim relevance scoring failed; gate skipped');
      return [];
    }

    return scores;
  }

  /**
   * Group claim sentences that assert the same thing about the topic.
   *
   * Exists because the lexical key it replaces (a claim's own first three
   * sorted keywords) splits paraphrases: "an edge network uses TLS
   * fingerprinting to detect automated browsers" and "automated browsers are
   * detected by an edge network through TLS fingerprinting" keyed
   * differently, so 27 real claims produced 27 groups and conflict/consensus
   * detection — which needs
   * a group of 2+ from 2+ sources — was structurally unreachable. A
   * keyword-overlap threshold sweep did not fix it: at every setting it found
   * at most one cross-source merge, and that merge was spurious (two unrelated
   * sentences sharing {best, scrapers, 2026}). Same-meaning is semantic, so it
   * is judged here.
   *
   * @param {string[]} claims - Claim sentences.
   * @param {string} topic - The research topic.
   * @returns {Promise<number[][]>} Groups of indices into `claims`. Every index
   *   in 0..claims.length-1 appears exactly once — the caller treats this as a
   *   partition and does not re-check it. Empty array on any failure, which is
   *   the caller's signal to fall back to keyword grouping.
   */
  async groupClaimsBySimilarity(claims, topic, options = {}) {
    const { maxClaimLength = 240, maxClaims = 60 } = options;

    // Nothing to group below two claims, and the caller's keyword fallback
    // reaches the same answer without a round trip.
    if (!Array.isArray(claims) || claims.length < 2) {
      return [];
    }

    // One call, always: claims past the cap are left out of the prompt and the
    // normalization below appends them as singletons. Chunking would be worse
    // than useless here — a paraphrase pair split across two calls can never
    // be found.
    const batch = claims.slice(0, maxClaims).map(claim => {
      const text = String(claim ?? '');
      return text.length > maxClaimLength ? text.slice(0, maxClaimLength) + '…' : text;
    });

    const systemPrompt = `You group sentences that assert the same thing about a research topic.

Return a JSON object:
{"groups": [[0, 3], [1], [2, 4]]}

Each number is a sentence number. Every sentence number appears exactly once across all groups.
Group two sentences together only when they assert the same fact however differently worded — a restatement, a reversed subject and object, or a paraphrase sharing no words still belongs with its original.
Keep sentences apart when they describe different mechanisms, different subjects or different measurements. A shared word is not a shared claim.
Most sentences belong in a group of their own.

Return the groups and nothing else.`;

    const groupSchema = {
      type: 'object',
      properties: {
        groups: { type: 'array', items: { type: 'array', items: { type: 'integer' } } }
      },
      required: ['groups']
    };

    const prompt = `Research topic: "${topic}"

Sentences (numbered from 0):
${batch.map((text, index) => `${index}. ${text}`).join('\n')}

Group these ${batch.length} sentences:`;

    try {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.generateCompletion(prompt, {
            systemPrompt,
            maxTokens: 200 + batch.length * 10,
            temperature: 0.1,
            format: groupSchema,
            role: 'judgement'
          });

          const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed?.groups) || parsed.groups.length === 0) {
            throw new Error('Grouping response missing groups');
          }
          return this.partitionClaimIndices(parsed.groups, claims.length);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    } catch (error) {
      this.logger.warn('LLM claim grouping failed, using fallback', { error: error.message });
      return [];
    }
  }

  /**
   * Force a model's group list into a true partition of 0..count-1.
   *
   * The caller consumes these indices directly, so a duplicated index would
   * double-count a claim's support and a missing one would drop a finding
   * outright. A model that renumbers from 1, repeats an index or invents one
   * is normal and must not corrupt the result, so the guarantee is enforced
   * here rather than trusted from the response.
   */
  partitionClaimIndices(groups, count) {
    const seen = new Set();
    const partition = [];

    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      const cleaned = [];
      for (const value of group) {
        // Strictly a real integer: Number(null) is 0 and Number(true) is 1, so
        // coercing would attach claim 0 or 1 to a group the model never put it
        // in, inventing corroboration that consensus then counts.
        if (typeof value !== 'number' || !Number.isInteger(value)) continue;
        if (value < 0 || value >= count || seen.has(value)) continue;
        seen.add(value);
        cleaned.push(value);
      }
      if (cleaned.length > 0) partition.push(cleaned);
    }

    for (let index = 0; index < count; index++) {
      if (!seen.has(index)) partition.push([index]);
    }

    return partition;
  }

  /**
   * Decide which claim pairs genuinely contradict each other.
   *
   * Exists because the lexical detector it replaces reported 42 conflicts on a
   * live run and none of the sampled six were real. Its premise — one claim
   * carries a negative word and the other a positive one, therefore they
   * disagree — cannot be made to work: real claims are long multi-sentence
   * blobs, so nearly every pair contains both. It paired "modern anti-bot
   * systems do not just block IP addresses, they fingerprint the TLS
   * handshake" against a claim that such systems match known signatures — two
   * sentences that agree, split only by the token "not" — and paired an
   * article's own table of contents against its prose. Contradiction is a
   * relation between propositions, not between words, so it is judged here.
   *
   * @param {Array<{a: string, b: string}>} pairs - Claim pairs already judged
   *   to be about the same assertion.
   * @param {string} topic - The research topic.
   * @returns {Promise<number[]>} Indices into `pairs` that contradict, ascending
   *   and deduplicated. An empty array means either "none contradict" or "the
   *   check could not run" — deliberately the same value, because the caller
   *   fails closed and reports no conflicts either way. Nothing downstream
   *   needs to tell the two apart, and reporting a conflict that was never
   *   established is the failure mode this method exists to remove.
   */
  async findContradictions(pairs, topic, options = {}) {
    const { maxClaimLength = 240, maxPairs = 30, batchSize = 8 } = options;

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return [];
    }

    // Batched in small chunks, and deliberately not in one call. Measured
    // 2026-08-28: this same prompt judged 7 pairs with zero false positives on
    // three consecutive runs, but judging a live run's ~30 pairs in one call
    // returned 29 "contradictions" of which none were real. A 4B local model
    // loses the thread across a long pair list exactly as it loses count on a
    // long score list. Pairs past the cap go unexamined rather than costing
    // more round trips — under-reporting a conflict is the same direction as
    // every other failure here, and the caller already fails closed.
    const truncate = value => {
      const text = String(value ?? '');
      return text.length > maxClaimLength ? text.slice(0, maxClaimLength) + '…' : text;
    };
    const capped = pairs.slice(0, maxPairs).map(pair => ({
      a: truncate(pair?.a),
      b: truncate(pair?.b)
    }));

    const systemPrompt = `You decide which numbered pairs of sentences genuinely contradict each other.

Return a JSON object:
{"contradictions": [0, 4]}

List a pair only when both sentences cannot be true at the same time — the same proposition asserted with opposite polarity, or incompatible values for the same quantity.

These are not contradictions:
- two sentences about the same subject that emphasise different aspects
- one sentence adding scope, detail or an example the other leaves out
- a heading or table-of-contents line beside prose from the same document
- a negative word in one sentence and a positive word in the other; wording is not polarity

Most pairs contradict nothing, and an empty list is the correct answer for most inputs.

Return the list and nothing else.`;

    const contradictionSchema = {
      type: 'object',
      properties: {
        contradictions: { type: 'array', items: { type: 'integer' } }
      },
      required: ['contradictions']
    };

    // Ask in BOTH polarities and keep only what survives both.
    //
    // Asking "which pairs contradict?" alone does not work at any batch size,
    // measured 2026-08-28 against a live run's claims: 30 pairs in one call
    // gave 29 false positives, chunks of 8 gave 13, and one pair per call gave
    // 28 — worst of all, because with nothing to compare against the model
    // affirms whatever it is shown. That is acquiescence ("yes") bias, a
    // documented and general LLM failure mode, not a defect of this prompt.
    //
    // The fix is the standard control for it: put the question the other way
    // round as well. A pair is reported only when the model calls it
    // contradictory AND does not also call it consistent. Because the bias
    // pushes toward "yes" in both passes, a pair named in both is one the
    // model is not actually discriminating, and it is dropped. This is the
    // same bidirectional-agreement idea that semantic-entropy work uses for
    // equivalence, applied to opposition.
    const judgeChunks = async (systemPrompt, question, key) => {
      const named = new Set();

      for (let offset = 0; offset < capped.length; offset += batchSize) {
        const batch = capped.slice(offset, offset + batchSize);

        const schema = {
          type: 'object',
          properties: { [key]: { type: 'array', items: { type: 'integer' } } },
          required: [key]
        };

        const prompt = `Research topic: "${topic}"

Sentence pairs (numbered from 0):
${batch.map((pair, index) => `${index}.\nA: ${pair.a}\nB: ${pair.b}`).join('\n\n')}

${question.replace('${n}', String(batch.length))}`;

        try {
          let judged = null;
          let lastError;
          for (let attempt = 0; attempt < 2 && !judged; attempt++) {
            try {
              const response = await this.generateCompletion(prompt, {
                systemPrompt,
                maxTokens: 100 + batch.length * 6,
                temperature: 0.1,
                format: schema,
                role: 'judgement'
              });

              const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
              const parsed = JSON.parse(cleaned);
              // An empty array is a real answer and the expected one here — it
              // must not be retried as though it were malformed.
              if (!Array.isArray(parsed?.[key])) {
                throw new Error(`Response missing ${key}`);
              }
              judged = parsed[key];
            } catch (error) {
              lastError = error;
            }
          }
          if (!judged) throw lastError;

          for (const value of judged) {
            // Strictly a real integer: Number(null) is 0 and Number(true) is 1,
            // so coercing here would name pair 0 or pair 1 the model never did.
            if (typeof value !== 'number' || !Number.isInteger(value)) continue;
            if (value < 0 || value >= batch.length) continue;
            named.add(offset + value);
          }
        } catch (error) {
          // Fail closed for this chunk only. On the contradiction pass that
          // means no conflicts from it; on the consistency pass it means no
          // vetoes, so a chunk that fails there cannot manufacture one.
          this.logger.warn('LLM pairwise judgement failed for a batch', {
            pass: key,
            error: error.message
          });
        }
      }

      return named;
    };

    const contradicts = await judgeChunks(
      systemPrompt,
      'Which of these ${n} pairs contradict?',
      'contradictions'
    );

    // Nothing survived the first pass, so the veto pass cannot change the
    // answer — skip its calls entirely.
    if (contradicts.size === 0) return [];

    const consistentSystemPrompt = `You decide which numbered pairs of sentences are consistent with each other.

Return a JSON object:
{"consistent": [0, 4]}

List a pair when both sentences could be true at the same time.

These ARE consistent:
- two sentences about the same subject that emphasise different aspects
- one sentence adding scope, detail or an example the other leaves out
- a heading or table-of-contents line beside prose from the same document
- two sentences about entirely different subjects

Only a pair asserting the same thing with opposite polarity, or incompatible
values for the same quantity, is inconsistent.

Return the list and nothing else.`;

    const consistent = await judgeChunks(
      consistentSystemPrompt,
      'Which of these ${n} pairs are consistent?',
      'consistent'
    );

    const found = [...contradicts].filter(index => !consistent.has(index));
    return found.sort((a, b) => a - b);
  }

  /**
   * Extract structured data from content using LLM and a JSON Schema
   * Follows the same pattern as analyzeRelevance()
   */
  async extractStructured(content, schema, options = {}) {
    const { maxContentLength = 6000, prompt: userPrompt = '', maxTokens = 1000 } = options;

    const truncatedContent = content.length > maxContentLength
      ? content.substring(0, maxContentLength) + '...'
      : content;

    // Scale maxTokens with schema complexity
    const schemaFields = Object.keys(schema.properties || {}).length;
    const scaledTokens = Math.min(2000, Math.max(maxTokens, schemaFields * 100 + 500));

    const systemPrompt = `You are a structured data extraction expert. Extract data from the provided content and return ONLY valid JSON that conforms to the given JSON Schema. Use null for any field the content does not state — never guess, infer, or fill a value from memory. Do not include any explanation or markdown — only the raw JSON object.`;

    const schemaStr = JSON.stringify(schema, null, 2);
    const guidance = userPrompt ? `\n\nExtraction guidance: ${userPrompt}` : '';

    const extractionPrompt = `JSON Schema to extract:
${schemaStr}${guidance}

Content to extract from:
${truncatedContent}

Extract the data and return valid JSON:`;

    try {
      const response = await this.generateCompletion(extractionPrompt, {
        systemPrompt,
        maxTokens: scaledTokens,
        temperature: 0.1,
        // Constrain the output to the caller's shape with every field
        // nullable, so a model shown content that does not state a field can
        // answer null instead of being decoded into an invented string. Small
        // local models otherwise wrap the JSON in prose and the parse throws.
        format: extractionFormat(schema)
      });

      // Strip markdown code fences if present
      const cleaned = response.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      // Lightweight validation
      const validation = this.validateAgainstSchema(parsed, schema);
      return {
        data: parsed,
        method: 'llm',
        valid: validation.valid,
        validationErrors: validation.errors
      };
    } catch (error) {
      this.logger.warn('LLM structured extraction failed, using fallback', { error: error.message });
      // Report which path produced the data. Callers previously labelled this
      // result "llm", so a failed LLM call was returned as a high-confidence
      // LLM extraction.
      return { ...this.fallbackStructuredExtraction(content, schema), error: error.message };
    }
  }

  /**
   * Validate a parsed object against a simple JSON Schema
   */
  validateAgainstSchema(data, schema) {
    const errors = [];
    const properties = schema.properties || {};
    const required = schema.required || [];

    for (const field of required) {
      // The decoder is told to answer null for a field the content never
      // states, so a null here is "not filled in", the same as absent.
      if (!(field in data) || data[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    for (const [key, fieldSchema] of Object.entries(properties)) {
      if (key in data) {
        const value = data[key];
        // A null in a field the schema does not require is the honest answer
        // for content that never states it, not a type error (typeof null is
        // 'object', which used to read as "expected number, got object").
        if (value === null) continue;
        const expectedType = fieldSchema.type;
        if (expectedType) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== expectedType) {
            errors.push(`Field "${key}": expected ${expectedType}, got ${actualType}`);
          }
        }
        if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
          errors.push(`Field "${key}": value "${value}" not in enum ${JSON.stringify(fieldSchema.enum)}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Fallback structured extraction without LLM — keyword/regex matching for primitives
   */
  fallbackStructuredExtraction(content, schema) {
    const extracted = {};
    const properties = schema.properties || {};

    for (const [key, fieldSchema] of Object.entries(properties)) {
      const keyPattern = new RegExp(key.replace(/_/g, '[\\s_-]'), 'i');
      const lineMatch = content.split('\n').find(line => keyPattern.test(line));

      if (lineMatch) {
        const valueMatch = lineMatch.match(/:\s*(.+)$/);
        const rawValue = valueMatch ? valueMatch[1].trim() : null;

        if (rawValue) {
          if (fieldSchema.type === 'number') {
            const num = parseFloat(rawValue.replace(/[^0-9.-]/g, ''));
            if (!isNaN(num)) extracted[key] = num;
          } else if (fieldSchema.type === 'boolean') {
            extracted[key] = /true|yes|1/i.test(rawValue);
          } else {
            extracted[key] = rawValue;
          }
        }
      }
    }

    return {
      data: extracted,
      method: 'keyword_fallback',
      valid: false,
      validationErrors: ['Used fallback extraction — no LLM provider available']
    };
  }

  /**
   * Fallback query expansion without LLM
   */
  fallbackQueryExpansion(query, maxExpansions) {
    const variations = [];
    const words = query.toLowerCase().split(/\s+/);
    
    // Question variations
    variations.push(`what is ${query}`);
    variations.push(`how does ${query} work`);
    variations.push(`${query} research`);
    variations.push(`${query} analysis`);
    variations.push(`latest ${query}`);
    
    return variations.slice(0, maxExpansions);
  }

  /**
   * Fallback relevance analysis without LLM
   */
  fallbackRelevanceAnalysis(content, topic) {
    const topicWords = topic.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase().split(/\s+/);
    
    const matches = topicWords.filter(word => 
      contentWords.some(cWord => cWord.includes(word) || word.includes(cWord))
    );
    
    const relevanceScore = matches.length / topicWords.length;
    
    return {
      relevanceScore: Math.min(1, relevanceScore),
      keyPoints: [content.substring(0, 100) + '...'],
      topicAlignment: `Found ${matches.length}/${topicWords.length} topic keywords`,
      credibilityIndicators: []
    };
  }

  /**
   * Fallback synthesis without LLM
   */
  fallbackSynthesis(findings, topic) {
    return {
      summary: `Collected ${findings.length} findings related to ${topic}`,
      keyInsights: findings.slice(0, 3).map(f => f.finding || f.text || f),
      themes: ['general research'],
      confidence: 0.5,
      gaps: ['Limited synthesis without LLM'],
      recommendations: ['Use LLM provider for detailed synthesis']
    };
  }

  /**
   * Check if any LLM provider is available
   */
  isAvailable() {
    return this.providers.size > 0;
  }

  /**
   * Resolve whether an LLM can actually be reached, probing Ollama once and
   * caching the answer. Callers that branch on LLM-vs-fallback should await
   * this rather than read isAvailable(), which reports Ollama optimistically
   * because its availability cannot be determined synchronously.
   *
   * An unreachable Ollama is de-registered, so isAvailable() becomes accurate
   * from that point on.
   * @returns {Promise<boolean>}
   */
  async ready() {
    const ollama = this.providers.get('ollama');
    if (ollama) {
      if (this._ollamaProbe === null) {
        this._ollamaProbe = ollama.isAvailable();
      }
      const reachable = await this._ollamaProbe;
      if (!reachable) {
        this.providers.delete('ollama');
        if (this.defaultProvider === 'ollama' || this.fallbackProvider === 'ollama') {
          this.setDefaultProvider('auto');
        }
        this.logger.warn('Ollama is not reachable; provider de-registered');
      }
    }
    return this.isAvailable();
  }

  /**
   * Get available providers metadata
   */
  getProvidersMetadata() {
    const metadata = {};
    for (const [name, provider] of this.providers) {
      metadata[name] = provider.getMetadata();
    }
    return metadata;
  }

  /**
   * Health check for all providers
   */
  async healthCheck() {
    const health = {};
    
    for (const [name, provider] of this.providers) {
      try {
        const isAvailable = await provider.isAvailable();
        health[name] = {
          available: isAvailable,
          metadata: provider.getMetadata()
        };
      } catch (error) {
        health[name] = {
          available: false,
          error: error.message
        };
      }
    }
    
    return health;
  }
}