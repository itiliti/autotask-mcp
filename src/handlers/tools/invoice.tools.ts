/**
 * Invoice Tools
 *
 * Tools for invoice operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, withErrorHandling, PAGE_SIZE_MEDIUM } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';

/**
 * Register all invoice tools
 */
export const registerInvoiceTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Invoices
    {
      tool: {
        name: 'autotask_search_invoices',
        description:
          'Search for invoices in Autotask. **IMPORTANT: Returns ONLY first 25 matching invoices by default** - if you need ALL invoices matching your query, you MUST set pageSize: -1. Use filters (companyID, invoiceNumber, isVoided) to narrow results.',
        inputSchema: {
          type: 'object',
          properties: {
            companyID: { type: 'number', description: 'Filter by company ID' },
            invoiceNumber: { type: 'string', description: 'Filter by invoice number' },
            isVoided: { type: 'boolean', description: 'Filter voided invoices' },
            pageSize: PAGE_SIZE_MEDIUM,
          },
          required: [],
        },
        annotations: {
          title: 'Search Invoices',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const requestedPageSize = args.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchInvoices(args);

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;
          const message = isTruncated
            ? `Returning ${result.length} invoices (results may be truncated). To see all results, use pageSize: -1 or add filters (companyID, invoiceNumber, isVoided).`
            : `Found ${result.length} invoices`;

          return successResult({ invoices: result, message });
        }, 'autotask_search_invoices');
      },
    },
  ];
};
