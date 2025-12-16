/**
 * Quote Tools
 *
 * Tools for quote operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { QuoteSchemas } from '../../utils/validation/quote.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all quote tools
 */
export const registerQuoteTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Get Quote
    {
      tool: {
        name: 'autotask_get_quote',
        description: 'Get a quote by ID',
        inputSchema: zodToJsonSchema(QuoteSchemas.GetQuote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Get Quote',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = QuoteSchemas.GetQuote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.getQuote(validatedArgs.quoteId as number);
          return successResult({
            quote: result,
            message: `Quote retrieved successfully`,
          });
        }, 'autotask_get_quote');
      },
    },

    // Search Quotes
    {
      tool: {
        name: 'autotask_search_quotes',
        description:
          'Search for quotes in Autotask. Returns 25 quotes by default (max: 100). Use filters (companyId, contactId, opportunityId, searchTerm) to narrow results.',
        inputSchema: zodToJsonSchema(QuoteSchemas.SearchQuotes, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Quotes',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = QuoteSchemas.SearchQuotes.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchQuotes(validatedArgs as any);

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} quotes (results may be truncated, API max: 100). Add filters (companyId, contactId, opportunityId, searchTerm) to narrow results.`
            : `Found ${result.length} quotes`;

          return successResult({ quotes: result, message });
        }, 'autotask_search_quotes');
      },
    },

    // Create Quote
    {
      tool: {
        name: 'autotask_create_quote',
        description: 'Create a new quote in Autotask',
        inputSchema: zodToJsonSchema(QuoteSchemas.CreateQuote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Quote',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = QuoteSchemas.CreateQuote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createQuote({
            name: validatedArgs.name,
            description: validatedArgs.description,
            companyID: validatedArgs.companyId,
            contactID: validatedArgs.contactId,
            opportunityID: validatedArgs.opportunityId,
            effectiveDate: validatedArgs.effectiveDate,
            expirationDate: validatedArgs.expirationDate,
          } as any);
          return successResult({
            id: result,
            message: `Successfully created quote with ID: ${result}`,
          });
        }, 'autotask_create_quote');
      },
    },
  ];
};
