/**
 * Resource Tools
 *
 * Tools for resource (user) operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { ResourceSchemas } from '../../utils/validation/resource.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all resource tools
 */
export const registerResourceTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Resources
    {
      tool: {
        name: 'autotask_search_resources',
        description:
          'Search for resources (users/technicians) in Autotask. **IMPORTANT: Returns ONLY first 25 matching resources by default** - if you need ALL resources matching your query, you MUST set pageSize: -1. Use filters (searchTerm, isActive, resourceType) to narrow results.',
        inputSchema: zodToJsonSchema(ResourceSchemas.SearchResources, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Resources',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = ResourceSchemas.SearchResources.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchResources(validatedArgs as any);

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;
          const message = isTruncated
            ? `Returning ${result.length} resources (results may be truncated). To see all results, use pageSize: -1 or add filters (searchTerm, isActive, resourceType).`
            : `Found ${result.length} resources`;

          return successResult({ resources: result, message });
        }, 'autotask_search_resources');
      },
    },
  ];
};
