/**
 * Company Tools
 *
 * Tools for company and company note operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS, UPDATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { CompanySchemas } from '../../utils/validation/company.schemas.js';
import { NoteSchemas } from '../../utils/validation/note.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all company tools
 */
export const registerCompanyTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Companies
    {
      tool: {
        name: 'autotask_search_companies',
        description:
          "Search for companies in Autotask. **IMPORTANT: Returns ONLY first 50 matching companies by default** - if you need ALL companies matching your query, you MUST set pageSize: -1. Use filters to narrow results: 'searchTerm' searches company names (e.g., searchTerm: 'acme' finds companies with 'acme' in their name), 'isActive: true' filters to active companies only. Filters apply BEFORE pagination for efficient targeted searches.",
        inputSchema: zodToJsonSchema(CompanySchemas.SearchCompanies, {
          $refStrategy: 'none',
          target: 'jsonSchema7',
        }) as any,
        annotations: {
          title: 'Search Companies',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = CompanySchemas.SearchCompanies.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = validation.data;
          const startTime = Date.now();
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 50;
          const searchTerm = validatedArgs.searchTerm?.toLowerCase().trim();

          ctx.logger.info('search_companies query', {
            searchTerm: validatedArgs.searchTerm,
            isActive: validatedArgs.isActive,
            requestedPageSize,
            hasFilters: !!(validatedArgs.searchTerm || validatedArgs.isActive !== undefined),
          });

          const searchOptions = removeUndefined({
            ...validatedArgs,
            pageSize: requestedPageSize !== undefined ? requestedPageSize : defaultPageSize,
          });

          let result = await ctx.autotaskService.searchCompanies(searchOptions as any);

          const queryTime = Date.now() - startTime;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          ctx.logger.info('search_companies results', {
            resultCount: result.length,
            queryTimeMs: queryTime,
            wasTruncated: result.length >= effectivePageSize && effectivePageSize !== Infinity,
          });

          if (result.length > 100) {
            ctx.logger.warn(
              `Large result set returned: ${result.length} companies. Consider using more specific filters (searchTerm, isActive).`,
            );
          }

          let message: string;

          // Exact match prioritization
          if (searchTerm && result.length > 1) {
            const exactMatches = result.filter(
              (company: any) => company.companyName?.toLowerCase().trim() === searchTerm,
            );

            if (exactMatches.length === 1) {
              result = [exactMatches[0], ...result.filter((c: any) => c.id !== exactMatches[0].id)];
              message = `Found exact match: "${exactMatches[0].companyName}" (plus ${result.length - 1} similar results)`;
              return successResult({ companies: result, message });
            } else if (exactMatches.length > 1) {
              const otherMatches = result.filter((c: any) => !exactMatches.some((em: any) => em.id === c.id));
              result = [...exactMatches, ...otherMatches];
              message = `Found ${exactMatches.length} exact matches for "${validatedArgs.searchTerm}" (plus ${otherMatches.length} similar results)`;
              return successResult({ companies: result, message });
            }
          }

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;

          if (isTruncated) {
            message = `Returning ${result.length} companies (results may be truncated). To see all results, use pageSize: -1 or add filters (searchTerm, isActive).`;
          } else if (result.length === 0 && !searchTerm && requestedPageSize !== -1) {
            message = `No companies found. Try adding searchTerm parameter or use pageSize: -1 to fetch all companies.`;
          } else {
            message = `Found ${result.length} companies`;
          }

          return successResult({ companies: result, message });
        }, 'autotask_search_companies');
      },
    },

    // Create Company
    {
      tool: {
        name: 'autotask_create_company',
        description: 'Create a new company in Autotask',
        inputSchema: zodToJsonSchema(CompanySchemas.CreateCompany, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Company',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = CompanySchemas.CreateCompany.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createCompany(validatedArgs as any);
          return successResult({
            id: result,
            message: `Successfully created company with ID: ${result}`,
          });
        }, 'autotask_create_company');
      },
    },

    // Update Company
    {
      tool: {
        name: 'autotask_update_company',
        description: 'Update an existing company in Autotask',
        inputSchema: zodToJsonSchema(CompanySchemas.UpdateCompany, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Update Company',
          ...UPDATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = CompanySchemas.UpdateCompany.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const { id, ...updateFields } = validatedArgs;
          await ctx.autotaskService.updateCompany(id as number, updateFields as any);
          return successResult({
            message: `Successfully updated company ID: ${id}`,
          });
        }, 'autotask_update_company');
      },
    },

    // Get Company Note
    {
      tool: {
        name: 'autotask_get_company_note',
        description: 'Get a specific company note by company ID and note ID',
        inputSchema: zodToJsonSchema(NoteSchemas.GetCompanyNote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Get Company Note',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.GetCompanyNote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.getCompanyNote(
            validatedArgs.companyId as number,
            validatedArgs.noteId as number,
          );
          return successResult({
            note: result,
            message: `Company note retrieved successfully`,
          });
        }, 'autotask_get_company_note');
      },
    },

    // Search Company Notes
    {
      tool: {
        name: 'autotask_search_company_notes',
        description: 'Search for notes on a specific company. Returns 25 notes by default (max: 100).',
        inputSchema: zodToJsonSchema(NoteSchemas.SearchCompanyNotes, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Company Notes',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.SearchCompanyNotes.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchCompanyNotes(
            validatedArgs.companyId as number,
            { pageSize: validatedArgs.pageSize } as any,
          );

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} company notes (results may be truncated, API max: 100). Consider limiting the time range of your query.`
            : `Found ${result.length} company notes`;

          return successResult({ notes: result, message });
        }, 'autotask_search_company_notes');
      },
    },

    // Create Company Note
    {
      tool: {
        name: 'autotask_create_company_note',
        description: 'Create a new note for a company',
        inputSchema: zodToJsonSchema(NoteSchemas.CreateCompanyNote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Company Note',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.CreateCompanyNote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createCompanyNote(
            validatedArgs.companyId as number,
            {
              title: validatedArgs.title,
              description: validatedArgs.description,
              actionType: validatedArgs.actionType,
            } as any,
          );
          return successResult({
            id: result,
            message: `Successfully created company note with ID: ${result}`,
          });
        }, 'autotask_create_company_note');
      },
    },
  ];
};
