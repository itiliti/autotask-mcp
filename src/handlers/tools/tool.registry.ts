/**
 * Tool Registry
 *
 * Provides a registry pattern for MCP tools, replacing the monolithic switch statement
 * in tool.handler.ts with a modular, extensible approach.
 */

import { AutotaskService } from '../../services/autotask.service.js';
import { Logger } from '../../utils/logger.js';
import { McpTool, McpToolResult } from '../../types/mcp.js';

/**
 * Context provided to tool handlers
 */
export interface ToolContext {
  autotaskService: AutotaskService;
  logger: Logger;
}

/**
 * Handler function type for tool execution
 */
export type ToolHandler = (args: Record<string, any>, context: ToolContext) => Promise<McpToolResult>;

/**
 * Tool definition with metadata and handler
 */
export interface ToolDefinition {
  tool: McpTool;
  handler: ToolHandler;
}

/**
 * Tool registration function type
 */
export type ToolRegistrar = (context: ToolContext) => ToolDefinition[];

/**
 * Tool Registry
 *
 * Manages tool definitions and handlers in a modular way.
 * Tools can be registered individually or in groups via registrar functions.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  /**
   * Register a single tool
   */
  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.tool.name)) {
      this.context.logger.warn(`Tool ${definition.tool.name} already registered, overwriting`);
    }
    this.tools.set(definition.tool.name, definition);
  }

  /**
   * Register multiple tools from a registrar function
   */
  registerAll(registrar: ToolRegistrar): void {
    const definitions = registrar(this.context);
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  /**
   * Get all registered tool definitions (for listTools)
   */
  getTools(): McpTool[] {
    return Array.from(this.tools.values()).map((def) => def.tool);
  }

  /**
   * Get a handler for a specific tool
   */
  getHandler(toolName: string): ToolHandler | undefined {
    return this.tools.get(toolName)?.handler;
  }

  /**
   * Check if a tool is registered
   */
  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get the number of registered tools
   */
  get size(): number {
    return this.tools.size;
  }
}
