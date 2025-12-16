/**
 * Time Entry Tools
 *
 * Tools for time entry operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { CREATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { TimeSchemas } from '../../utils/validation/time.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all time entry tools
 */
export const registerTimeTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Create Time Entry
    {
      tool: {
        name: 'autotask_create_time_entry',
        description: 'Create a time entry in Autotask',
        inputSchema: zodToJsonSchema(TimeSchemas.CreateTimeEntry, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Time Entry',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = TimeSchemas.CreateTimeEntry.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createTimeEntry(validatedArgs as any);
          return successResult({
            id: result,
            message: `Successfully created time entry with ID: ${result}`,
          });
        }, 'autotask_create_time_entry');
      },
    },
  ];
};
