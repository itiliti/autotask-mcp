/**
 * Configuration Item Tools
 *
 * Tools for configuration item (CI) operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, withErrorHandling, PAGE_SIZE_MEDIUM } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';

/**
 * Register all configuration item tools
 */
export const registerConfigItemTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Configuration Items
    {
      tool: {
        name: 'autotask_search_configuration_items',
        description:
          'Search for configuration items (CIs) in Autotask. **IMPORTANT: Returns ONLY first 25 matching items by default** - if you need ALL items matching your query, you MUST set pageSize: -1. Use filters (searchTerm, companyID, isActive, productID) to narrow results.',
        inputSchema: {
          type: 'object',
          properties: {
            searchTerm: { type: 'string', description: 'Search term to match against CI name or reference' },
            companyID: { type: 'number', description: 'Filter by company ID' },
            isActive: { type: 'boolean', description: 'Filter active/inactive CIs' },
            productID: { type: 'number', description: 'Filter by product ID' },
            pageSize: PAGE_SIZE_MEDIUM,
          },
          required: [],
        },
        annotations: {
          title: 'Search Configuration Items',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const requestedPageSize = args.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchConfigurationItems(args);

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;
          const message = isTruncated
            ? `Returning ${result.length} configuration items (results may be truncated). To see all results, use pageSize: -1 or add filters (searchTerm, companyID, isActive, productID).`
            : `Found ${result.length} configuration items`;

          return successResult({ configurationItems: result, message });
        }, 'autotask_search_configuration_items');
      },
    },
  ];
};
