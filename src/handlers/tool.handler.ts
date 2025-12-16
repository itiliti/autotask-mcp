/**
 * Autotask Tool Handler
 *
 * Handles MCP tool calls for Autotask operations using a modular registry pattern.
 * Tools are organized into domain-specific modules in the tools/ directory.
 */

import { AutotaskService } from '../services/autotask.service.js';
import { Logger } from '../utils/logger.js';
import { McpTool, McpToolResult } from '../types/mcp.js';
import { ToolRegistry, getEnabledToolRegistrars, getEnabledModules } from './tools/index.js';

export class AutotaskToolHandler {
  protected autotaskService: AutotaskService;
  protected logger: Logger;
  private registry: ToolRegistry;

  constructor(autotaskService: AutotaskService, logger: Logger) {
    this.autotaskService = autotaskService;
    this.logger = logger;

    // Initialize the tool registry with all tool modules
    this.registry = new ToolRegistry({
      autotaskService: this.autotaskService,
      logger: this.logger,
    });

    // Register tools from enabled modules only (respects AUTOTASK_ENABLED_TOOLS / AUTOTASK_DISABLED_TOOLS)
    const enabledRegistrars = getEnabledToolRegistrars();
    for (const registrar of enabledRegistrars) {
      this.registry.registerAll(registrar);
    }

    const enabledModules = getEnabledModules();
    this.logger.info(`Tool registry initialized with ${this.registry.size} tools from ${enabledModules.length} modules: ${enabledModules.join(', ')}`);
  }

  /**
   * List all available tools
   */
  async listTools(): Promise<McpTool[]> {
    this.logger.debug('Listing available Autotask tools');
    return this.registry.getTools();
  }

  /**
   * Call a specific tool with arguments
   */
  async callTool(name: string, args: Record<string, any>): Promise<McpToolResult> {
    this.logger.info(`Calling tool: ${name}`);
    this.logger.debug(`Tool arguments:`, args);

    const handler = this.registry.getHandler(name);

    if (!handler) {
      this.logger.error(`Unknown tool: ${name}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler(args, {
        autotaskService: this.autotaskService,
        logger: this.logger,
      });

      this.logger.debug(`Tool ${name} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Tool ${name} failed:`, error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: `Tool ${name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  }
}
