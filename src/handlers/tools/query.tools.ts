/**
 * Query Tools
 *
 * Tools for query operations like counting records.
 */

import { z } from 'zod';
import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Query Count Input Schema
 */
const QueryCountInputSchema = z
  .object({
    entity: z
      .enum(['Tickets', 'Companies', 'Contacts', 'Contracts', 'Resources', 'TimeEntries', 'Projects'])
      .describe('Entity type to count'),
    searchTerm: z.string().optional().describe('Search term to filter results'),
    companyID: z.number().optional().describe('Filter by company ID'),
    status: z.number().optional().describe('Filter by status ID (entity-specific)'),
    assignedResourceID: z.number().optional().describe('Filter by assigned resource ID (for Tickets)'),
    isActive: z.boolean().optional().describe('Filter by active status'),
    createDateFrom: z
      .string()
      .optional()
      .describe('Filter items created on or after this date/time (ISO 8601 format)'),
    createDateTo: z
      .string()
      .optional()
      .describe('Filter items created on or before this date/time (ISO 8601 format)'),
    lastActivityDateFrom: z
      .string()
      .optional()
      .describe('Filter items with activity on or after this date/time (ISO 8601 format)'),
    lastActivityDateTo: z
      .string()
      .optional()
      .describe('Filter items with activity on or before this date/time (ISO 8601 format)'),
  })
  .strict();

/**
 * Register all query tools
 */
export const registerQueryTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Query Count
    {
      tool: {
        name: 'autotask_query_count',
        description:
          'Get the count of records matching query criteria WITHOUT fetching the actual data. ' +
          'Use this when you need to answer "how many" questions or determine result set size before fetching. ' +
          'Much faster than fetching all records. Supports same filters as search operations.',
        inputSchema: zodToJsonSchema(QueryCountInputSchema, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Query Count',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = QueryCountInputSchema.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = validation.data;
          const { entity, ...filterArgs } = validatedArgs;

          // Build filters based on entity type
          const filters: any[] = [];

          // Common filters
          if (filterArgs.companyID !== undefined) {
            filters.push({
              field: 'companyID',
              op: 'eq',
              value: filterArgs.companyID,
            });
          }

          if (filterArgs.status !== undefined) {
            filters.push({
              field: 'status',
              op: 'eq',
              value: filterArgs.status,
            });
          }

          if (filterArgs.isActive !== undefined) {
            filters.push({
              field: 'isActive',
              op: 'eq',
              value: filterArgs.isActive,
            });
          }

          // Date filters
          if (filterArgs.createDateFrom !== undefined) {
            filters.push({
              field: 'createDate',
              op: 'gte',
              value: filterArgs.createDateFrom,
            });
          }

          if (filterArgs.createDateTo !== undefined) {
            filters.push({
              field: 'createDate',
              op: 'lte',
              value: filterArgs.createDateTo,
            });
          }

          if (filterArgs.lastActivityDateFrom !== undefined) {
            filters.push({
              field: 'lastActivityDate',
              op: 'gte',
              value: filterArgs.lastActivityDateFrom,
            });
          }

          if (filterArgs.lastActivityDateTo !== undefined) {
            filters.push({
              field: 'lastActivityDate',
              op: 'lte',
              value: filterArgs.lastActivityDateTo,
            });
          }

          // Entity-specific filters
          if (entity === 'Tickets') {
            if (filterArgs.searchTerm) {
              filters.push({
                field: 'ticketNumber',
                op: 'beginsWith',
                value: filterArgs.searchTerm,
              });
            }

            if (filterArgs.assignedResourceID !== undefined) {
              filters.push({
                field: 'assignedResourceID',
                op: 'eq',
                value: filterArgs.assignedResourceID,
              });
            }
          }

          // Execute count query
          const count = await ctx.autotaskService.queryCount(entity, filters);

          return successResult({
            entity,
            count,
            filters: filterArgs,
            message: `Found ${count} ${entity} matching the criteria`,
          });
        }, 'autotask_query_count');
      },
    },
  ];
};
