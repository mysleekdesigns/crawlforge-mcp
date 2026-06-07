/**
 * agent tool — NL prompt → autonomous search/navigate/extract → answer.
 *
 * Wraps AgentOrchestrator for MCP registration.
 * Mirrors the setMcpServer pattern from extractStructured.js.
 */

import { z } from 'zod';
import { AgentOrchestrator } from '../../core/AgentOrchestrator.js';
import { ElicitationHelper } from '../../core/ElicitationHelper.js';
import { getToolConfig } from '../../constants/config.js';

export const AgentInputSchema = z.object({
  prompt: z.string().min(1).max(2000).describe('Natural-language task or question'),
  urls: z.array(z.string().url()).max(20).optional().describe('Optional seed URLs to include (max 20)'),
  schema: z.record(z.any()).optional().describe('Optional JSON schema for structured output'),
  model: z.enum(['default', 'pro']).optional().default('default').describe('"default" = SamplingClient loop; "pro" = full ResearchOrchestrator'),
  maxSteps: z.number().min(1).max(10).optional().default(5).describe('Max fetch iterations (hard cap: 10)'),
  maxUrls: z.number().min(1).max(20).optional().default(10).describe('Max URLs to fetch (hard cap: 20)')
});

export class AgentTool {
  constructor(options = {}) {
    this._orchestrator = new AgentOrchestrator({
      mcpServer: null,
      searchConfig: getToolConfig('search_web') || {},
      llmConfig: options.llmConfig || {}
    });
    this._elicitation = new ElicitationHelper({});
  }

  /** Wire MCP server for SamplingClient + Elicitation (called from server.js). */
  setMcpServer(mcpServer) {
    this._orchestrator.setMcpServer(mcpServer);
    this._elicitation = new ElicitationHelper({ mcpServer });
  }

  async execute(params) {
    const validated = AgentInputSchema.parse(params);

    // Request confirmation before a pro run (expensive)
    if (validated.model === 'pro') {
      const proceed = await this._elicitation.confirm(
        'agent tool: pro model uses ResearchOrchestrator and may incur significant costs.',
        { model: 'pro', maxUrls: validated.maxUrls, note: 'External LLM API costs billed separately if keys are set.' }
      );
      if (!proceed) {
        return {
          success: false,
          cancelled: true,
          reason: 'User cancelled pro agent run.'
        };
      }
    }

    return this._orchestrator.run({
      prompt: validated.prompt,
      urls: validated.urls,
      schema: validated.schema,
      model: validated.model,
      maxSteps: validated.maxSteps,
      maxUrls: validated.maxUrls
    });
  }

  async destroy() {
    await this._orchestrator.destroy();
  }
}

export default AgentTool;
