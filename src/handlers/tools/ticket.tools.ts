/**
 * Ticket Tools
 *
 * Tools for ticket and ticket note operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS, UPDATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { TicketSchemas } from '../../utils/validation/ticket.schemas.js';
import { NoteSchemas } from '../../utils/validation/note.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TicketUpdateValidator } from '../../services/ticket-update.validator.js';
import { ErrorMapper } from '../../utils/error-mapper.js';

/**
 * Register all ticket tools
 */
export const registerTicketTools: ToolRegistrar = (_context): ToolDefinition[] => {
  // Lazy-initialized validator
  let validator: TicketUpdateValidator | null = null;

  const getValidator = (ctx: any): TicketUpdateValidator => {
    if (!validator) {
      const metadataCache = ctx.autotaskService.getMetadataCache();
      validator = new TicketUpdateValidator(metadataCache);
    }
    return validator;
  };

  return [
    // Search Tickets
    {
      tool: {
        name: 'autotask_search_tickets',
        description:
          'Search for tickets in Autotask. **IMPORTANT: Returns ONLY first 50 matching tickets by default** - if you need ALL tickets matching your query, you MUST set pageSize: -1. Use filters (searchTerm, companyID, status, assignedResourceID) to narrow results. For full ticket data, use get_ticket_details.',
        inputSchema: zodToJsonSchema(TicketSchemas.SearchTickets, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Tickets',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = TicketSchemas.SearchTickets.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const { companyID, ...otherArgs } = validatedArgs;
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 50;
          const effectivePageSize = requestedPageSize === -1 ? Infinity : requestedPageSize || defaultPageSize;

          const ticketSearchOptions = {
            ...otherArgs,
            ...(companyID !== undefined && { companyId: companyID }),
          };
          const result = await ctx.autotaskService.searchTickets(ticketSearchOptions as any);

          const isTruncated = result.length >= effectivePageSize && effectivePageSize !== Infinity;
          const message = isTruncated
            ? `Returning ${result.length} tickets (results may be truncated). To see all results, use pageSize: -1 or add filters (searchTerm, companyID, status, assignedResourceID).`
            : `Found ${result.length} tickets`;

          return successResult({ tickets: result, message });
        }, 'autotask_search_tickets');
      },
    },

    // Get Ticket Details
    {
      tool: {
        name: 'autotask_get_ticket_details',
        description: 'Get detailed information for a specific ticket by ID. Use this for full ticket data when needed.',
        inputSchema: zodToJsonSchema(TicketSchemas.GetTicketDetails, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Get Ticket Details',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = TicketSchemas.GetTicketDetails.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = validation.data;
          const result = await ctx.autotaskService.getTicket(validatedArgs.ticketID, validatedArgs.fullDetails);
          return successResult({
            ticket: result,
            message: `Ticket details retrieved successfully`,
          });
        }, 'autotask_get_ticket_details');
      },
    },

    // Create Ticket
    {
      tool: {
        name: 'autotask_create_ticket',
        description: 'Create a new ticket in Autotask',
        inputSchema: zodToJsonSchema(TicketSchemas.CreateTicket, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Ticket',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = TicketSchemas.CreateTicket.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createTicket(validatedArgs as any);
          return successResult({
            id: result,
            message: `Successfully created ticket with ID: ${result}`,
          });
        }, 'autotask_create_ticket');
      },
    },

    // Update Ticket
    {
      tool: {
        name: 'autotask_update_ticket',
        description: 'Update an existing ticket in Autotask using PATCH semantics for core fields',
        inputSchema: zodToJsonSchema(TicketSchemas.UpdateTicket, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Update Ticket',
          ...UPDATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        // Update ticket has special validation - handle errors manually
        try {
          const validation = TicketSchemas.UpdateTicket.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const { ticketId, status, priority, queueID, title, description, resolution, dueDateTime } = validatedArgs;

          // Build update request (include lastActivityDate if it exists in args for backward compatibility)
          const updateRequest = removeUndefined({
            id: ticketId as number,
            assignedResourceID: (args as any).assignedResourceID,
            status,
            priority,
            queueID,
            title,
            description,
            resolution,
            dueDateTime,
            lastActivityDate: (args as any).lastActivityDate,
          });

          // Ensure metadata cache is initialized before validation (Layer 2)
          await ctx.autotaskService.ensureMetadataCacheInitialized();

          // Layer 2: Business logic validation using TicketUpdateValidator
          const validatorInstance = getValidator(ctx);
          const validated = validatorInstance.validateTicketUpdate(updateRequest as any);

          if (!validated.validation.isValid) {
            const mappedError = ErrorMapper.mapValidationErrors(validated.validation.errors, 'update_ticket');
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ isError: true, error: mappedError }),
                },
              ],
              isError: true,
            };
          }

          const { id: _ignored, ...updateFields } = validated.payload;
          const updatedTicket = await ctx.autotaskService.updateTicket(ticketId as number, updateFields);

          return successResult({
            ticketId,
            updatedFields: Object.keys(updateFields),
            ticket: updatedTicket,
            message: `Ticket ${ticketId} updated successfully`,
          });
        } catch (error) {
          const mappedError = ErrorMapper.mapAutotaskError(error, 'update_ticket');
          ctx.logger.error(`Ticket update failed [${mappedError.correlationId}]:`, mappedError);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ isError: true, error: mappedError }),
              },
            ],
            isError: true,
          };
        }
      },
    },

    // Get Ticket Note
    {
      tool: {
        name: 'autotask_get_ticket_note',
        description: 'Get a specific ticket note by ticket ID and note ID',
        inputSchema: zodToJsonSchema(NoteSchemas.GetTicketNote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Get Ticket Note',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.GetTicketNote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.getTicketNote(
            validatedArgs.ticketId as number,
            validatedArgs.noteId as number,
          );
          return successResult({
            note: result,
            message: `Ticket note retrieved successfully`,
          });
        }, 'autotask_get_ticket_note');
      },
    },

    // Search Ticket Notes
    {
      tool: {
        name: 'autotask_search_ticket_notes',
        description: 'Search for notes on a specific ticket. Returns 25 notes by default (max: 100).',
        inputSchema: zodToJsonSchema(NoteSchemas.SearchTicketNotes, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Ticket Notes',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.SearchTicketNotes.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchTicketNotes(
            validatedArgs.ticketId as number,
            { pageSize: validatedArgs.pageSize } as any,
          );

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} ticket notes (results may be truncated, API max: 100). Consider limiting the time range of your query.`
            : `Found ${result.length} ticket notes`;

          return successResult({ notes: result, message });
        }, 'autotask_search_ticket_notes');
      },
    },

    // Create Ticket Note
    {
      tool: {
        name: 'autotask_create_ticket_note',
        description: 'Create a new note for a ticket',
        inputSchema: zodToJsonSchema(NoteSchemas.CreateTicketNote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Ticket Note',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        // Create ticket note has special validation - handle errors manually
        try {
          const zodValidation = NoteSchemas.CreateTicketNote.safeParse(args);
          if (!zodValidation.success) {
            throw zodValidation.error;
          }

          const structurallyValid = removeUndefined(zodValidation.data);

          // Layer 2: Business logic validation (content sanitization, publish level validation)
          await ctx.autotaskService.ensureMetadataCacheInitialized();
          const validatorInstance = getValidator(ctx);

          const noteValidation = validatorInstance.validateTicketNote({
            ticketID: structurallyValid.ticketId,
            title: structurallyValid.title,
            description: structurallyValid.description,
            publish: structurallyValid.publish,
          } as any);

          if (!noteValidation.validation.isValid) {
            const mappedError = ErrorMapper.mapValidationErrors(noteValidation.validation.errors, 'create_ticket_note');
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ isError: true, error: mappedError }),
                },
              ],
              isError: true,
            };
          }

          // Use validated and sanitized payload
          const result = await ctx.autotaskService.createTicketNote(noteValidation.payload);
          return successResult({
            note: result,
            message: `Note created successfully for ticket ${structurallyValid.ticketId}`,
          });
        } catch (error) {
          const mappedError = ErrorMapper.mapAutotaskError(error, 'create_ticket_note');
          ctx.logger.error(`Ticket note creation failed [${mappedError.correlationId}]:`, mappedError);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ isError: true, error: mappedError }),
              },
            ],
            isError: true,
          };
        }
      },
    },
  ];
};
