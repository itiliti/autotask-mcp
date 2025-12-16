/**
 * Contract Tools
 *
 * Tools for contract operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { ContractSchemas } from '../../utils/validation/contract.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all contract tools
 */
export const registerContractTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Contracts
    {
      tool: {
        name: 'autotask_search_contracts',
        description:
          'Search for contracts in Autotask. **IMPORTANT: Returns ONLY first 25 matching contracts by default** - if you need ALL contracts matching your query, you MUST set pageSize: -1. Use filters (searchTerm, companyID, status) to narrow results.',
        inputSchema: zodToJsonSchema(ContractSchemas.SearchContracts, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Contracts',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = ContractSchemas.SearchContracts.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchContracts(validatedArgs as any);

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;
          const message = isTruncated
            ? `Returning ${result.length} contracts (results may be truncated). To see all results, use pageSize: -1 or add filters (searchTerm, companyID, status).`
            : `Found ${result.length} contracts`;

          return successResult({ contracts: result, message });
        }, 'autotask_search_contracts');
      },
    },
  ];
};
