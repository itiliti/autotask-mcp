/**
 * Ticket Service
 *
 * Handles ticket and ticket note operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import {
  AutotaskTicket,
  AutotaskTicketNote,
  AutotaskQueryOptionsExtended,
  TicketUpdateFields,
} from '../../types/autotask.js';
import { ErrorMapper } from '../../utils/error-mapper.js';
import { QueryCounterService } from '../core/query-counter.service.js';

export class TicketService extends BaseEntityService {
  private queryCounter: QueryCounterService;

  constructor(context: IServiceContext) {
    super(context);
    this.queryCounter = new QueryCounterService(context.logger);
  }

  /**
   * Get a ticket by ID
   */
  async getTicket(id: number, fullDetails: boolean = false): Promise<AutotaskTicket | null> {
    const client = await this.getClient();

    return this.context.executeWithRateLimit(async () => {
      try {
        this.logger.debug(`Getting ticket with ID: ${id}, fullDetails: ${fullDetails}`);

        const result = await client.tickets.get(id);
        const ticket = result.data as AutotaskTicket;

        if (!ticket) {
          return null;
        }

        // Apply optimization unless full details requested
        return fullDetails ? ticket : this.optimizeTicketData(ticket);
      } catch (error) {
        this.logger.error(`Failed to get ticket ${id}:`, error);
        throw error;
      }
    }, 'Tickets');
  }

  /**
   * Search for tickets with smart query optimization
   *
   * @param options - Search options with optional pageSize
   * @returns Array of optimized tickets
   *
   * Smart Query Strategies (v2.1.0+):
   * - Direct fetch: count ≤ 500, fetch immediately
   * - Reverse time-window: For "latest" queries, searches 30→90→180→365 days until results found
   * - Binary search: For large time windows (>2500), recursively splits date range
   * - Paginated fetch: Standard fetch up to 10 pages (5000 results)
   *
   * Pagination behavior:
   * - No pageSize specified: Uses smart query optimization (default 500 per page)
   * - pageSize: N (1-500): Returns up to N tickets
   * - pageSize: -1: Returns ALL tickets (bypasses smart query, use with caution)
   *
   * Note: All tickets are aggressively optimized to reduce response size.
   * Use get_ticket_details for full ticket data.
   */
  async searchTickets(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskTicket[]> {
    const client = await this.getClient();

    return this.context.executeWithRateLimit(async () => {
      try {
        this.logger.debug('Searching tickets with options:', options);

        // Define essential fields to request from API (reduces response size significantly)
        const essentialFields = [
          'id',
          'ticketNumber',
          'title',
          'description',
          'status',
          'priority',
          'companyID',
          'contactID',
          'assignedResourceID',
          'createDate',
          'lastActivityDate',
          'dueDateTime',
          'completedDate',
          'estimatedHours',
          'ticketType',
          'source',
          'issueType',
          'subIssueType',
          'resolution',
        ];

        // Build proper filter array for Autotask API
        const filters: any[] = [];

        // Handle searchTerm - search in ticket number and title
        if (options.searchTerm) {
          filters.push({
            op: 'beginsWith',
            field: 'ticketNumber',
            value: options.searchTerm,
          });
        }

        // Handle status filter with accurate open/closed ticket definition
        if (options.status !== undefined) {
          filters.push({
            op: 'eq',
            field: 'status',
            value: options.status,
          });
        } else {
          // For "open" tickets, exclude all closed status IDs:
          // 5 = Complete, 20 = Inactive, 21 = Cancelled, 24 = Rejected, 26 = Internal Rejected, 27 = Client Rejected
          // Build a filter that excludes all closed statuses
          const closedStatuses = [5, 20, 21, 24, 26, 27];
          closedStatuses.forEach((statusId) => {
            filters.push({
              op: 'ne',
              field: 'status',
              value: statusId,
            });
          });
        }

        // Handle assignedResourceID filter or unassigned filter
        if (options.unassigned === true) {
          // Search for tickets with no assigned resource (null assignedResourceID)
          filters.push({
            op: 'eq',
            field: 'assignedResourceID',
            value: null,
          });
        } else if (options.assignedResourceID !== undefined) {
          filters.push({
            op: 'eq',
            field: 'assignedResourceID',
            value: options.assignedResourceID,
          });
        }

        // Only add company filter if explicitly provided
        if (options.companyId !== undefined) {
          filters.push({
            op: 'eq',
            field: 'companyID',
            value: options.companyId,
          });
        }

        // Handle createDate range filters
        if (options.createDateFrom !== undefined) {
          filters.push({
            op: 'gte',
            field: 'createDate',
            value: options.createDateFrom,
          });
        }

        if (options.createDateTo !== undefined) {
          filters.push({
            op: 'lte',
            field: 'createDate',
            value: options.createDateTo,
          });
        }

        // Handle lastActivityDate range filters
        if (options.lastActivityDateFrom !== undefined) {
          filters.push({
            op: 'gte',
            field: 'lastActivityDate',
            value: options.lastActivityDateFrom,
          });
        }

        if (options.lastActivityDateTo !== undefined) {
          filters.push({
            op: 'lte',
            field: 'lastActivityDate',
            value: options.lastActivityDateTo,
          });
        }

        // Detect if this is a "latest" query (no date filters = user wants most recent)
        const hasDateFilters =
          options.createDateFrom !== undefined ||
          options.createDateTo !== undefined ||
          options.lastActivityDateFrom !== undefined ||
          options.lastActivityDateTo !== undefined;
        const isLatestQuery = !hasDateFilters;

        // Check if unlimited mode was requested
        const { unlimited } = this.resolvePaginationOptions(options, 500);

        // Use smart query optimization unless unlimited mode
        if (!unlimited) {
          // Use smart query with adaptive strategies
          const result = await this.queryCounter.executeSmartQuery<AutotaskTicket>(
            client,
            'Tickets',
            filters,
            isLatestQuery,
            async (queryFilters: any[], pageSize: number, page?: number) => {
              // Fetch tickets with given filters
              const queryOptions: any = {
                filter: queryFilters,
                pageSize,
                includeFields: essentialFields,
              };

              if (page !== undefined) {
                queryOptions.page = page;
              }

              this.logger.debug(`Fetching tickets page ${page ?? 1} with pageSize ${pageSize}`);

              const response = await client.tickets.list(queryOptions);
              let tickets = (response.data as AutotaskTicket[]) || [];

              // Safety cap: Autotask API sometimes ignores pageSize, enforce client-side
              if (tickets.length > pageSize) {
                this.logger.warn(
                  `API returned ${tickets.length} tickets but pageSize was ${pageSize}. Truncating to requested limit.`,
                );
                tickets = tickets.slice(0, pageSize);
              }

              // Optimize tickets
              return tickets.map((ticket) => this.optimizeTicketDataAggressive(ticket));
            },
            'lastActivityDate', // Use lastActivityDate for time-based segmentation
          );

          // Log the result metadata
          this.logger.info(`${result.message} (strategy: ${result.strategy})`);
          if (result.warning) {
            this.logger.warn(result.warning);
          }
          if (result.metadata) {
            this.logger.debug('Query metadata:', result.metadata);
          }

          return result.items;
        } else {
          // Unlimited mode: fetch ALL tickets via pagination
          const allTickets: AutotaskTicket[] = [];
          const batchSize = 500;
          let currentPage = 1;
          let hasMorePages = true;

          while (hasMorePages) {
            const queryOptions = {
              filter: filters,
              pageSize: batchSize,
              page: currentPage,
              includeFields: essentialFields,
            };

            this.logger.debug(`Fetching tickets page ${currentPage} with filter:`, filters);

            const result = await client.tickets.list(queryOptions);
            const tickets = (result.data as AutotaskTicket[]) || [];

            if (tickets.length === 0) {
              hasMorePages = false;
            } else {
              // Transform tickets to optimize data size
              const optimizedTickets = tickets.map((ticket) => this.optimizeTicketDataAggressive(ticket));
              allTickets.push(...optimizedTickets);

              if (tickets.length < batchSize) {
                hasMorePages = false;
              } else {
                currentPage++;
              }
            }

            // Safety check to prevent infinite loops
            if (currentPage > 100) {
              this.logger.warn('Pagination safety limit reached at 100 pages (50,000 tickets)');
              hasMorePages = false;
            }
          }

          this.logger.info(`Retrieved ${allTickets.length} tickets across ${currentPage} pages (unlimited mode)`);
          return allTickets;
        }
      } catch (error) {
        this.logger.error('Failed to search tickets:', error);
        throw error;
      }
    }, 'Tickets');
  }

  /**
   * Aggressively optimize ticket data by keeping only essential fields
   * Since the API returns all 76 fields (~2KB per ticket), we need to be very selective
   */
  private optimizeTicketDataAggressive(ticket: AutotaskTicket): AutotaskTicket {
    // Keep only the most essential fields to minimize response size
    const optimized: AutotaskTicket = {};

    if (ticket.id !== undefined) optimized.id = ticket.id;
    if (ticket.ticketNumber !== undefined) optimized.ticketNumber = ticket.ticketNumber;
    if (ticket.title !== undefined) optimized.title = ticket.title;

    // Handle description with truncation
    if (ticket.description !== undefined && ticket.description !== null) {
      optimized.description =
        ticket.description.length > 200
          ? ticket.description.substring(0, 200) + '... [truncated - use get_ticket_details for full text]'
          : ticket.description;
    }

    if (ticket.status !== undefined) optimized.status = ticket.status;
    if (ticket.priority !== undefined) optimized.priority = ticket.priority;
    if (ticket.companyID !== undefined) optimized.companyID = ticket.companyID;
    if (ticket.contactID !== undefined) optimized.contactID = ticket.contactID;
    if (ticket.assignedResourceID !== undefined) optimized.assignedResourceID = ticket.assignedResourceID;
    if (ticket.createDate !== undefined) optimized.createDate = ticket.createDate;
    if (ticket.lastActivityDate !== undefined) optimized.lastActivityDate = ticket.lastActivityDate;
    if (ticket.dueDateTime !== undefined) optimized.dueDateTime = ticket.dueDateTime;
    if (ticket.completedDate !== undefined) optimized.completedDate = ticket.completedDate;
    if (ticket.estimatedHours !== undefined) optimized.estimatedHours = ticket.estimatedHours;
    if (ticket.ticketType !== undefined) optimized.ticketType = ticket.ticketType;
    if (ticket.source !== undefined) optimized.source = ticket.source;
    if (ticket.issueType !== undefined) optimized.issueType = ticket.issueType;
    if (ticket.subIssueType !== undefined) optimized.subIssueType = ticket.subIssueType;

    // Handle resolution with truncation
    if (ticket.resolution !== undefined && ticket.resolution !== null) {
      optimized.resolution =
        ticket.resolution.length > 100
          ? ticket.resolution.substring(0, 100) + '... [truncated - use get_ticket_details for full text]'
          : ticket.resolution;
    }

    return optimized;
  }

  /**
   * Optimize ticket data by truncating large text fields and removing unnecessary data
   * This is the less aggressive version used by getTicket
   */
  private optimizeTicketData(ticket: AutotaskTicket): AutotaskTicket {
    const maxDescriptionLength = 500;
    const maxNotesLength = 300;

    return {
      ...ticket,
      // Truncate description if too long
      description:
        ticket.description && ticket.description.length > maxDescriptionLength
          ? ticket.description.substring(0, maxDescriptionLength) + '... [truncated]'
          : ticket.description,

      // Remove or truncate potentially large fields
      resolution:
        ticket.resolution && ticket.resolution.length > maxNotesLength
          ? ticket.resolution.substring(0, maxNotesLength) + '... [truncated]'
          : ticket.resolution,

      // Remove arrays that might contain large amounts of data
      userDefinedFields: [],

      // Keep only essential custom fields, truncate if present
      ...(ticket.purchaseOrderNumber && {
        purchaseOrderNumber:
          ticket.purchaseOrderNumber.length > 50
            ? ticket.purchaseOrderNumber.substring(0, 50) + '...'
            : ticket.purchaseOrderNumber,
      }),
    };
  }

  /**
   * Create a new ticket
   */
  async createTicket(ticket: Partial<AutotaskTicket>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating ticket:', ticket);
      const result = await client.tickets.create(ticket as any);
      const ticketId = (result.data as any)?.id;
      this.logger.info(`Ticket created with ID: ${ticketId}`);
      return ticketId;
    } catch (error) {
      this.logger.error('Failed to create ticket:', error);
      throw error;
    }
  }

  /**
   * Update a ticket with validation via metadata cache
   */
  async updateTicket(id: number, updates: TicketUpdateFields): Promise<AutotaskTicket> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Updating ticket ${id}:`, updates);

      // Build PATCH payload with PascalCase field names for Autotask REST API
      const payload: any = {};

      if (updates.assignedResourceID !== undefined) {
        payload.AssignedResourceID = updates.assignedResourceID;
      }
      if (updates.status !== undefined) {
        payload.Status = updates.status;
      }
      if (updates.priority !== undefined) {
        payload.Priority = updates.priority;
      }
      if (updates.queueID !== undefined) {
        payload.QueueID = updates.queueID;
      }
      if (updates.title !== undefined) {
        payload.Title = updates.title;
      }
      if (updates.description !== undefined) {
        payload.Description = updates.description;
      }
      if (updates.resolution !== undefined) {
        payload.Resolution = updates.resolution;
      }
      if (updates.dueDateTime !== undefined) {
        payload.DueDateTime = updates.dueDateTime;
      }
      if (updates.lastActivityDate !== undefined) {
        payload.LastActivityDate = updates.lastActivityDate;
      }

      // Use the client's update method
      const result = await client.tickets.update(id, payload);

      this.logger.info(`Ticket ${id} updated successfully`);
      return result.data as AutotaskTicket;
    } catch (error) {
      // Map error to structured response with guidance
      const mappedError = ErrorMapper.mapAutotaskError(error, 'update_ticket');

      this.logger.error(`Failed to update ticket ${id}:`, {
        error: mappedError,
        ticketId: id,
        correlationId: mappedError.correlationId,
      });

      // Re-throw with mapped error structure
      const enhancedError = new Error(mappedError.message);
      (enhancedError as any).code = mappedError.code;
      (enhancedError as any).guidance = mappedError.guidance;
      (enhancedError as any).correlationId = mappedError.correlationId;
      throw enhancedError;
    }
  }

  // ============================================================================
  // TICKET NOTE OPERATIONS
  // ============================================================================

  /**
   * Get a ticket note by ID
   */
  async getTicketNote(ticketId: number, noteId: number): Promise<AutotaskTicketNote | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting ticket note - TicketID: ${ticketId}, NoteID: ${noteId}`);
      // Use generic notes endpoint with filtering
      const result = await client.notes.list({
        filter: [
          { field: 'ticketId', op: 'eq', value: ticketId },
          { field: 'id', op: 'eq', value: noteId },
        ],
      });
      const notes = (result.data as any[]) || [];
      return notes.length > 0 ? (notes[0] as AutotaskTicketNote) : null;
    } catch (error) {
      this.logger.error(`Failed to get ticket note ${noteId} for ticket ${ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Search for ticket notes
   */
  async searchTicketNotes(ticketId: number, options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskTicketNote[]> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Searching ticket notes for ticket ${ticketId}:`, options);

      // Set reasonable limits for notes
      const optimizedOptions = {
        filter: [{ field: 'ticketId', op: 'eq', value: ticketId }],
        pageSize: options.pageSize || 25,
      };

      const result = await client.notes.list(optimizedOptions);
      const notes = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${notes.length} ticket notes`);
      return notes as AutotaskTicketNote[];
    } catch (error) {
      this.logger.error(`Failed to search ticket notes for ticket ${ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Create a ticket note
   */
  async createTicketNote(note: Partial<AutotaskTicketNote>): Promise<AutotaskTicketNote> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Creating ticket note:`, note);

      // ========================================
      // REQUIRED FIELDS VALIDATION
      // ========================================
      // Per Autotask TicketNotes API documentation:
      // https://autotask.net/help/developerhelp/Content/APIs/REST/Entities/TicketNotesEntity.htm

      // 1. ticketID - REQUIRED
      if (!note.ticketID) {
        const error = new Error('ticketID is required to create a ticket note');
        this.logger.error('Ticket note creation failed - missing ticketID:', error);
        throw error;
      }

      // 2. description - REQUIRED (note content)
      if (!note.description || note.description.trim().length === 0) {
        const error = new Error('description is required and cannot be empty');
        this.logger.error('Ticket note creation failed - missing description:', error);
        throw error;
      }

      // 3. Enforce description length check (max 32000 chars)
      if (note.description.length > 32000) {
        const error = new Error(
          `Note description exceeds maximum length of 32000 characters. ` +
            `Current length: ${note.description.length}`,
        );
        this.logger.error('Ticket note creation failed - description too long:', error);
        throw error;
      }

      // 4. publish - REQUIRED (default to Internal Only if not specified)
      const publish = note.publish ?? 1; // Default to 1 (Internal Only)

      // Enforce valid publish levels (1=Internal, 2=All Autotask Users, 3=Everyone)
      if (publish !== 1 && publish !== 2 && publish !== 3) {
        const error = new Error(
          `Invalid publish level: ${publish}. Must be 1 (Internal Only), 2 (All Autotask Users), or 3 (Everyone)`,
        );
        this.logger.error('Ticket note creation failed - invalid publish level:', error);
        throw error;
      }

      // 5. noteType - Set default if not provided (1 = General note)
      const noteType = note.noteType ?? 1;

      // Build PascalCase payload for Autotask REST API
      // Note: TicketID is NOT in the payload - it's part of the child resource URL
      const payload: any = {
        Description: note.description.trim(),
        Publish: publish,
        NoteType: noteType,
      };

      // Title is conditionally required based on ticket category settings
      // Include it if provided
      if (note.title && note.title.trim().length > 0) {
        payload.Title = note.title.trim();
      }

      // creatorResourceID - Optional, allows specifying which resource created the note
      // If not provided, API will use the authenticated API user
      if (note.creatorResourceID !== undefined) {
        payload.CreatorResourceID = note.creatorResourceID;
      }

      // Use the correct child resource endpoint: /Tickets/{parentId}/Notes
      // Per Autotask REST API, ticket notes are created as child resources
      this.logger.debug(`Posting to /Tickets/${note.ticketID}/Notes with payload:`, payload);
      const result = await (client as any).axios.post(`/Tickets/${note.ticketID}/Notes`, payload);

      // Extract the created note from response
      // Child resource endpoints may return: { item: {...} }, { itemId: X }, or just the item
      let createdNote: AutotaskTicketNote;
      if (result.data.item) {
        createdNote = result.data.item;
      } else if (result.data.itemId) {
        // Response only contains ID - construct minimal note object
        createdNote = {
          id: result.data.itemId,
          ticketID: note.ticketID,
          ...payload,
        } as AutotaskTicketNote;
      } else {
        createdNote = result.data as AutotaskTicketNote;
      }

      this.logger.info(`Ticket note created with ID: ${createdNote.id || 'unknown'}`);
      this.logger.debug('Full response data:', result.data);

      this.logger.info(`Ticket note created with ID: ${createdNote.id}`);
      return createdNote;
    } catch (error) {
      // Map error to structured response with guidance
      const mappedError = ErrorMapper.mapAutotaskError(error, 'create_ticket_note');

      this.logger.error(`Failed to create ticket note:`, {
        error: mappedError,
        ticketId: note.ticketID,
        correlationId: mappedError.correlationId,
      });

      // Re-throw with mapped error structure
      const enhancedError = new Error(mappedError.message);
      (enhancedError as any).code = mappedError.code;
      (enhancedError as any).guidance = mappedError.guidance;
      (enhancedError as any).correlationId = mappedError.correlationId;
      throw enhancedError;
    }
  }
}
