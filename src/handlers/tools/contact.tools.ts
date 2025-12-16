/**
 * Contact Tools
 *
 * Tools for contact operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { ContactSchemas } from '../../utils/validation/contact.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all contact tools
 */
export const registerContactTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Contacts
    {
      tool: {
        name: 'autotask_search_contacts',
        description:
          'Search for contacts in Autotask. **IMPORTANT: Returns ONLY first 50 matching contacts by default** - if you need ALL contacts matching your query, you MUST set pageSize: -1. Use filters (searchTerm, companyID, isActive) to narrow results.',
        inputSchema: zodToJsonSchema(ContactSchemas.SearchContacts, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Contacts',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = ContactSchemas.SearchContacts.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 50;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchContacts(validatedArgs as any);

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;
          const message = isTruncated
            ? `Returning ${result.length} contacts (results may be truncated). To see all results, use pageSize: -1 or add filters (searchTerm, companyID, isActive).`
            : `Found ${result.length} contacts`;

          return successResult({ contacts: result, message });
        }, 'autotask_search_contacts');
      },
    },

    // Create Contact
    {
      tool: {
        name: 'autotask_create_contact',
        description: 'Create a new contact in Autotask',
        inputSchema: zodToJsonSchema(ContactSchemas.CreateContact, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Contact',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = ContactSchemas.CreateContact.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createContact(validatedArgs as any);
          return successResult({
            id: result,
            message: `Successfully created contact with ID: ${result}`,
          });
        }, 'autotask_create_contact');
      },
    },
  ];
};
