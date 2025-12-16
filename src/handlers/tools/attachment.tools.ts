/**
 * Attachment Tools
 *
 * Tools for ticket attachment operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { AttachmentSchemas } from '../../utils/validation/attachment.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all attachment tools
 */
export const registerAttachmentTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Get Ticket Attachment
    {
      tool: {
        name: 'autotask_get_ticket_attachment',
        description: 'Get a specific ticket attachment by ticket ID and attachment ID. Set includeData: true to retrieve binary content.',
        inputSchema: zodToJsonSchema(AttachmentSchemas.GetTicketAttachment, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Get Ticket Attachment',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = AttachmentSchemas.GetTicketAttachment.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.getTicketAttachment(
            validatedArgs.ticketId as number,
            validatedArgs.attachmentId as number,
            validatedArgs.includeData,
          );
          return successResult({
            attachment: result,
            message: `Ticket attachment retrieved successfully`,
          });
        }, 'autotask_get_ticket_attachment');
      },
    },

    // Search Ticket Attachments
    {
      tool: {
        name: 'autotask_search_ticket_attachments',
        description:
          'Search for attachments on a specific ticket. Returns 10 attachments by default (max: 50). Attachments can be large.',
        inputSchema: zodToJsonSchema(AttachmentSchemas.SearchTicketAttachments, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Ticket Attachments',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = AttachmentSchemas.SearchTicketAttachments.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 10;
          const effectivePageSize = requestedPageSize || defaultPageSize; // No unlimited mode for attachments

          const result = await ctx.autotaskService.searchTicketAttachments(
            validatedArgs.ticketId as number,
            { pageSize: validatedArgs.pageSize } as any,
          );

          const isTruncated = result.length >= effectivePageSize && effectivePageSize < 50;
          const message = isTruncated
            ? `Returning ${result.length} ticket attachments (results may be truncated, max: 50). Attachments are large - use small pageSize values.`
            : `Found ${result.length} ticket attachments`;

          return successResult({ attachments: result, message });
        }, 'autotask_search_ticket_attachments');
      },
    },
  ];
};
