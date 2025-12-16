/**
 * Base Tool Utilities
 *
 * Shared utilities for tool handlers including validation helpers,
 * result formatters, and common constants.
 */

import { McpToolResult } from '../../types/mcp.js';
import { ZodError, ZodSchema } from 'zod';
import { formatZodError } from '../../utils/validation/error-formatter.js';
import { ErrorMapper } from '../../utils/error-mapper.js';

/**
 * Legacy PAGE_SIZE constants for tools without Zod schemas
 * (Expense Reports, Configuration Items, Invoices)
 */
export const PAGE_SIZE_MEDIUM = {
  type: 'number',
  description:
    'Number of results to return. **IMPORTANT: If omitted, returns ONLY FIRST 25 results!** Set to -1 to get ALL matching results (may be slow). Max: 500.',
  minimum: -1,
  maximum: 500,
};

export const PAGE_SIZE_LIMITED = {
  type: 'number',
  description:
    'Number of results to return. **IMPORTANT: If omitted, returns ONLY FIRST 25 results!** Set to -1 to get up to 100 results (API limited). Max: 100.',
  minimum: -1,
  maximum: 100,
};

/**
 * Create a success result
 */
export function successResult(content: any): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(content, null, 2) }],
  };
}

/**
 * Create an error result
 */
export function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

/**
 * Validate arguments with a Zod schema
 * Returns validated args or throws formatted error
 */
export function validateArgs<T>(schema: ZodSchema<T>, args: Record<string, any>): T {
  return schema.parse(args);
}

/**
 * Remove undefined values from validated arguments
 *
 * Zod schemas with optional fields return types like `string | undefined`,
 * but service methods expect exact optional types due to exactOptionalPropertyTypes.
 * This helper strips undefined values to maintain type compatibility.
 */
export function removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as any)[key] = value;
    }
  }
  return result;
}

/**
 * Wrap a handler function with standard error handling
 */
export async function withErrorHandling(
  fn: () => Promise<McpToolResult>,
  toolName: string,
): Promise<McpToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) {
      const validationError = formatZodError(error, toolName);
      return {
        content: [{ type: 'text', text: JSON.stringify(validationError, null, 2) }],
        isError: true,
      };
    }
    const mappedError = ErrorMapper.mapAutotaskError(error, toolName);
    return errorResult(`${toolName} failed: ${mappedError.message}`);
  }
}
