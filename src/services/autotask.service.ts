// Autotask Service Layer
// Wraps the autotask-node client with our specific types and error handling

import { AutotaskClient } from 'autotask-node';
import { RateLimiterService, ThresholdInfo } from './rate-limiter.service.js';
import { ServiceContext, IServiceContext } from './core/service.context.js';
import { ContractService } from './entities/contract.service.js';
import { InvoiceService } from './entities/invoice.service.js';
import { CompanyService } from './entities/company.service.js';
import { ContactService } from './entities/contact.service.js';
import { ResourceService } from './entities/resource.service.js';
import { ConfigurationItemService } from './entities/configuration-item.service.js';
import { QuoteService } from './entities/quote.service.js';
import { ExpenseService } from './entities/expense.service.js';
import { TimeEntryService } from './entities/time-entry.service.js';
import {
  AutotaskCompany,
  AutotaskContact,
  AutotaskTicket,
  AutotaskTimeEntry,
  AutotaskProject,
  AutotaskResource,
  AutotaskConfigurationItem,
  AutotaskContract,
  AutotaskInvoice,
  AutotaskTask,
  AutotaskQueryOptions,
  AutotaskTicketNote,
  AutotaskProjectNote,
  AutotaskCompanyNote,
  AutotaskTicketAttachment,
  AutotaskExpenseReport,
  AutotaskExpenseItem,
  AutotaskQuote,
  AutotaskBillingCode,
  AutotaskDepartment,
  AutotaskQueryOptionsExtended,
  TicketUpdateFields,
} from '../types/autotask';
import { McpServerConfig } from '../types/mcp';
import { Logger } from '../utils/logger';
import { TicketMetadataCache } from './ticket-metadata.cache.js';
import { ErrorMapper } from '../utils/error-mapper.js';
import { ApiUserCacheService } from './api-user-cache.service.js';

export class AutotaskService {
  private client: AutotaskClient | null = null;
  private logger: Logger;
  private config: McpServerConfig;
  private initializationPromise: Promise<void> | null = null;
  private metadataCache: TicketMetadataCache;
  private rateLimiter: RateLimiterService;
  private apiUserCache: ApiUserCacheService;
  private defaultResourceId: number | null = null;

  // Service context and entity services (lazy-initialized)
  private _serviceContext: IServiceContext | null = null;
  private _contractService: ContractService | null = null;
  private _invoiceService: InvoiceService | null = null;
  private _companyService: CompanyService | null = null;
  private _contactService: ContactService | null = null;
  private _resourceService: ResourceService | null = null;
  private _configurationItemService: ConfigurationItemService | null = null;
  private _quoteService: QuoteService | null = null;
  private _expenseService: ExpenseService | null = null;
  private _timeEntryService: TimeEntryService | null = null;

  constructor(config: McpServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.metadataCache = new TicketMetadataCache(logger);
    this.rateLimiter = new RateLimiterService(logger, {
      maxConcurrentRequests: 2,
      thresholdCheckInterval: 19, // Check every 19 API calls
      highUsageThreshold: 50, // Warn at 50% usage
      criticalUsageThreshold: 80, // Force check at 80% usage
      minimumCallsRemaining: 100, // Block when <100 calls remaining
    });
    this.apiUserCache = new ApiUserCacheService(logger);
  }

  /**
   * Initialize the Autotask client with credentials
   */
  async initialize(): Promise<void> {
    try {
      const { username, secret, integrationCode, apiUrl } = this.config.autotask;

      if (!username || !secret || !integrationCode) {
        throw new Error('Missing required Autotask credentials: username, secret, and integrationCode are required');
      }

      this.logger.info('Initializing Autotask client...');

      // Only include apiUrl if it's defined
      const authConfig: any = {
        username,
        secret,
        integrationCode,
      };

      if (apiUrl) {
        authConfig.apiUrl = apiUrl;
      }

      this.client = await AutotaskClient.create(authConfig);

      this.logger.info('Autotask client initialized successfully');

      // Initialize metadata cache
      this.metadataCache.setClient(this.client);
      await this.metadataCache.initialize();

      // Initialize default resource ID (API user)
      await this.initializeDefaultResourceId();
    } catch (error) {
      this.logger.error('Failed to initialize Autotask client:', error);
      throw error;
    }
  }

  /**
   * Ensure client is initialized (with lazy initialization)
   */
  private async ensureClient(): Promise<AutotaskClient> {
    if (!this.client) {
      await this.ensureInitialized();
    }
    return this.client!;
  }

  /**
   * Ensure the client is initialized, handling concurrent calls
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      // Already initializing, wait for it to complete
      await this.initializationPromise;
      return;
    }

    if (this.client) {
      // Already initialized
      return;
    }

    // Start initialization
    this.initializationPromise = this.initialize();
    await this.initializationPromise;
  }

  /**
   * Get the metadata cache instance
   */
  getMetadataCache(): TicketMetadataCache {
    return this.metadataCache;
  }

  /**
   * Ensure metadata cache is initialized (required before validation)
   */
  async ensureMetadataCacheInitialized(): Promise<void> {
    // Ensure client is initialized first (which initializes the cache)
    await this.ensureClient();
  }

  /**
   * Check API usage thresholds and update rate limiter
   * https://autotask.net/help/developerhelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm
   */
  private async checkThresholds(): Promise<ThresholdInfo | null> {
    try {
      const client = await this.ensureClient();
      this.rateLimiter.startThresholdCheck();

      // Call the thresholdInformation endpoint
      const response = await (client as any).request({
        method: 'GET',
        url: '/v1.0/Internal/thresholdInformation',
      });

      if (response && response.data) {
        const data = response.data;
        
        // Parse threshold information
        const thresholdInfo: ThresholdInfo = {
          requestCount: data.requestCount || 0,
          requestLimit: data.requestLimit || 10000,
          percentageUsed: data.requestLimit > 0 
            ? (data.requestCount / data.requestLimit) * 100 
            : 0,
          timeRemaining: data.timeRemaining || 'Unknown',
        };

        // Update rate limiter with threshold info
        await this.rateLimiter.updateThresholdInfo(thresholdInfo);
        
        return thresholdInfo;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to check API thresholds:', error);
      return null;
    }
  }

  /**
   * Get current rate limiter status (for monitoring/debugging)
   */
  getRateLimiterStatus() {
    return this.rateLimiter.getStatus();
  }

  /**
   * Initialize the default resource ID from the API user email
   * Uses cache to avoid lookups on every startup
   * 
   * NOTE: Currently skipping cache to debug incorrect cached resourceID
   */
  private async initializeDefaultResourceId(): Promise<void> {
    try {
      const apiUserEmail = this.config.autotask.username;
      
      if (!apiUserEmail) {
        this.logger.warn('No API user email configured, cannot initialize default resource ID');
        return;
      }
      
      // TEMPORARILY SKIP CACHE - debugging incorrect cached resourceID
      // const cachedResourceId = await this.apiUserCache.getCachedResourceId(apiUserEmail);
      // if (cachedResourceId) {
      //   this.defaultResourceId = cachedResourceId;
      //   this.logger.info(`Default resource ID: ${cachedResourceId} (from cache)`);
      //   return;
      // }

      // Look up resource by email using API filter
      this.logger.info(`Looking up resource ID for API user: ${apiUserEmail} (cache bypassed)`);
      let resources = await this.searchResources({ email: apiUserEmail, pageSize: 1 } as any);
      
      if (resources.length > 0) {
        this.logger.info(`Found resource by email search:`, {
          id: resources[0].id,
          email: resources[0].email,
          userName: resources[0].userName,
          firstName: resources[0].firstName,
          lastName: resources[0].lastName,
        });
      }
      
      // If no resource found by email, fall back to first active resource
      // (API user email may not match any resource email in Autotask)
      if (resources.length === 0) {
        this.logger.info('No resource found with API user email, falling back to first active resource');
        resources = await this.searchResources({ pageSize: 1 } as any);
        
        if (resources.length > 0) {
          this.logger.info(`Fallback found resource:`, {
            id: resources[0].id,
            email: resources[0].email,
            userName: resources[0].userName,
            firstName: resources[0].firstName,
            lastName: resources[0].lastName,
          });
        }
      }
      
      const apiUserResource = resources.length > 0 ? resources[0] : null;

      if (apiUserResource && apiUserResource.id) {
        this.defaultResourceId = apiUserResource.id;
        const resourceName = `${apiUserResource.firstName || ''} ${apiUserResource.lastName || ''}`.trim() || 'Unknown';
        
        // DON'T cache for now - debugging
        // await this.apiUserCache.saveResourceId(apiUserEmail, apiUserResource.id, resourceName);
        
        this.logger.info(`Default resource ID: ${this.defaultResourceId} (${resourceName}) - NOT CACHED`);
      } else {
        this.logger.warn(`Could not find any active resource in Autotask`);
      }
    } catch (error) {
      this.logger.warn('Failed to initialize default resource ID:', error);
      // Non-fatal - operations can still work without default resource
    }
  }

  /**
   * Get the default resource ID (API user)
   * Returns null if not initialized or not found
   */
  getDefaultResourceId(): number | null {
    return this.defaultResourceId;
  }

  /**
   * Get API user cache information
   */
  getApiUserCache() {
    return this.apiUserCache.getCache();
  }

  /**
   * Execute API request with rate limiting and threshold monitoring
   */
  private async executeWithRateLimit<T>(
    request: () => Promise<T>,
    endpoint?: string
  ): Promise<T> {
    // Check if we should update thresholds
    if (this.rateLimiter.shouldCheckThresholds()) {
      // Fire and forget - don't block the request
      this.checkThresholds().catch((error) => {
        this.logger.debug('Threshold check failed (non-blocking):', error);
      });
    }

    // Execute request with rate limiting
    return this.rateLimiter.executeWithRateLimit(request, endpoint);
  }
   * Resolve pagination options with safe defaults
   *
   * @param options - Query options with optional pageSize
   * @param defaultPageSize - Default page size to use (entity-specific)
   * @returns Resolved pagination configuration
   *
   * Behavior:
   * - undefined or 0 → use defaultPageSize (safe default)
   * - positive number → use value (capped at 500)
   * - -1 → unlimited results (explicit opt-in)
   *
   * @example
   * resolvePaginationOptions({}, 50) // → { pageSize: 50, unlimited: false }
   * resolvePaginationOptions({ pageSize: 100 }, 50) // → { pageSize: 100, unlimited: false }
   * resolvePaginationOptions({ pageSize: -1 }, 50) // → { pageSize: null, unlimited: true }
   */
  private resolvePaginationOptions(
    options: AutotaskQueryOptions,
    defaultPageSize: number,
  ): { pageSize: number | null; unlimited: boolean } {
    const requestedPageSize = options.pageSize;

    // Case 1: Unlimited results explicitly requested (-1)
    if (requestedPageSize === -1) {
      this.logger.warn(
        'Fetching unlimited results may cause performance issues. Consider using filters or explicit pageSize limit.',
      );
      return { pageSize: null, unlimited: true };
    }

    // Case 2: Explicit positive value provided
    if (requestedPageSize !== undefined && requestedPageSize > 0) {
      const cappedPageSize = Math.min(requestedPageSize, 500);
      if (requestedPageSize > 500) {
        this.logger.warn(`Requested pageSize ${requestedPageSize} exceeds maximum 500, capping at 500`);
      }
      return { pageSize: cappedPageSize, unlimited: false };
    }

    // Case 3: Undefined or 0 → apply safe default
    this.logger.debug(
      `Applying default pageSize: ${defaultPageSize} (specify pageSize explicitly or use -1 for unlimited)`,
    );
    return { pageSize: defaultPageSize, unlimited: false };
  }

  // ============================================================================
  // SERVICE CONTEXT AND ENTITY SERVICES
  // ============================================================================

  /**
   * Get or create the shared service context
   * Used by entity services to access shared infrastructure
   */
  private getServiceContext(): IServiceContext {
    if (!this._serviceContext) {
      this._serviceContext = new ServiceContext({
        getClient: () => this.ensureClient(),
        logger: this.logger,
        rateLimiter: this.rateLimiter,
        metadataCache: this.metadataCache,
        apiUserCache: this.apiUserCache,
        config: this.config,
        executeWithRateLimit: <T>(request: () => Promise<T>, endpoint?: string) =>
          this.executeWithRateLimit(request, endpoint),
        resolvePaginationOptions: (options, defaultPageSize) =>
          this.resolvePaginationOptions(options, defaultPageSize),
      });
    }
    return this._serviceContext;
  }

  /**
   * Get the ContractService instance (lazy-initialized)
   */
  private get contractService(): ContractService {
    if (!this._contractService) {
      this._contractService = new ContractService(this.getServiceContext());
    }
    return this._contractService;
  }

  /**
   * Get the InvoiceService instance (lazy-initialized)
   */
  private get invoiceService(): InvoiceService {
    if (!this._invoiceService) {
      this._invoiceService = new InvoiceService(this.getServiceContext());
    }
    return this._invoiceService;
  }

  /**
   * Get the CompanyService instance (lazy-initialized)
   */
  private get companyService(): CompanyService {
    if (!this._companyService) {
      this._companyService = new CompanyService(this.getServiceContext());
    }
    return this._companyService;
  }

  /**
   * Get the ContactService instance (lazy-initialized)
   */
  private get contactService(): ContactService {
    if (!this._contactService) {
      this._contactService = new ContactService(this.getServiceContext());
    }
    return this._contactService;
  }

  /**
   * Get the ResourceService instance (lazy-initialized)
   */
  private get resourceService(): ResourceService {
    if (!this._resourceService) {
      this._resourceService = new ResourceService(this.getServiceContext());
    }
    return this._resourceService;
  }

  /**
   * Get the ConfigurationItemService instance (lazy-initialized)
   */
  private get configurationItemService(): ConfigurationItemService {
    if (!this._configurationItemService) {
      this._configurationItemService = new ConfigurationItemService(this.getServiceContext());
    }
    return this._configurationItemService;
  }

  /**
   * Get the QuoteService instance (lazy-initialized)
   */
  private get quoteService(): QuoteService {
    if (!this._quoteService) {
      this._quoteService = new QuoteService(this.getServiceContext());
    }
    return this._quoteService;
  }

  /**
   * Get the ExpenseService instance (lazy-initialized)
   */
  private get expenseService(): ExpenseService {
    if (!this._expenseService) {
      this._expenseService = new ExpenseService(this.getServiceContext());
    }
    return this._expenseService;
  }

  /**
   * Get the TimeEntryService instance (lazy-initialized)
   */
  private get timeEntryService(): TimeEntryService {
    if (!this._timeEntryService) {
      this._timeEntryService = new TimeEntryService(this.getServiceContext());
    }
    return this._timeEntryService;
  }

  // ============================================================================
  // ENTITY OPERATIONS
  // ============================================================================

  // Company operations - delegated to CompanyService
  async getCompany(id: number): Promise<AutotaskCompany | null> {
    return this.companyService.getCompany(id);
  }

  async searchCompanies(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskCompany[]> {
    return this.companyService.searchCompanies(options);
  }

  async createCompany(company: Partial<AutotaskCompany>): Promise<number> {
    return this.companyService.createCompany(company);
  }

  async updateCompany(id: number, updates: Partial<AutotaskCompany>): Promise<void> {
    return this.companyService.updateCompany(id, updates);
  }

  // Contact operations - delegated to ContactService
  async getContact(id: number): Promise<AutotaskContact | null> {
    return this.contactService.getContact(id);
  }

  async searchContacts(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskContact[]> {
    return this.contactService.searchContacts(options);
  }

  async createContact(contact: Partial<AutotaskContact>): Promise<number> {
    return this.contactService.createContact(contact);
  }

  async updateContact(id: number, updates: Partial<AutotaskContact>): Promise<void> {
    return this.contactService.updateContact(id, updates);
  }

  // Ticket operations
  async getTicket(id: number, fullDetails: boolean = false): Promise<AutotaskTicket | null> {
    const client = await this.ensureClient();

    return this.executeWithRateLimit(async () => {
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
   * Search for tickets with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of optimized tickets
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 50 tickets (safe default)
   * - pageSize: N (1-500): Returns up to N tickets
   * - pageSize: -1: Returns ALL tickets (use with caution)
   *
   * Note: All tickets are aggressively optimized to reduce response size.
   * Use get_ticket_details for full ticket data.
   */
  async searchTickets(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskTicket[]> {
    const client = await this.ensureClient();

    return this.executeWithRateLimit(async () => {
      try {
        this.logger.debug('Searching tickets with options:', options);

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
        closedStatuses.forEach(statusId => {
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

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 50);

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

      if (unlimited) {
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
      } else {
        // Limited mode: fetch single page
        const queryOptions = {
          filter: filters,
          pageSize: pageSize!,
          includeFields: essentialFields,
        };

        this.logger.debug('Single page ticket request:', queryOptions);

        const result = await client.tickets.list(queryOptions);
        let tickets = (result.data as AutotaskTicket[]) || [];

        // Safety cap: Autotask API sometimes ignores pageSize, enforce client-side
        if (tickets.length > pageSize!) {
          this.logger.warn(
            `API returned ${tickets.length} tickets but pageSize was ${pageSize}. Truncating to requested limit.`,
          );
          tickets = tickets.slice(0, pageSize!);
        }

        const optimizedTickets = tickets.map((ticket) => this.optimizeTicketDataAggressive(ticket));

        this.logger.info(`Retrieved ${optimizedTickets.length} tickets (pageSize: ${pageSize})`);
        return optimizedTickets;
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

  async createTicket(ticket: Partial<AutotaskTicket>): Promise<number> {
    const client = await this.ensureClient();

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
    const client = await this.ensureClient();

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

  // Time entry operations - delegated to TimeEntryService
  async createTimeEntry(timeEntry: Partial<AutotaskTimeEntry>): Promise<number> {
    return this.timeEntryService.createTimeEntry(timeEntry);
  }

  async getTimeEntries(options: AutotaskQueryOptions = {}): Promise<AutotaskTimeEntry[]> {
    return this.timeEntryService.getTimeEntries(options);
  }

  // Project operations
  async getProject(id: number): Promise<AutotaskProject | null> {
    const client = await this.ensureClient();

    return this.executeWithRateLimit(async () => {
      try {
        this.logger.debug(`Getting project with ID: ${id}`);
        const result = await client.projects.get(id);
        return (result.data as unknown as AutotaskProject) || null;
      } catch (error) {
        this.logger.error(`Failed to get project ${id}:`, error);
        throw error;
      }
    }, 'Projects');
  }

  /**
   * Search for projects with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of optimized projects
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 projects (safe default)
   * - pageSize: N (1-100): Returns up to N projects (capped at 100 for this endpoint)
   * - pageSize: -1: Returns up to 100 projects (API limit)
   *
   * Note: This method uses direct API calls due to autotask-node library limitations.
   */
  async searchProjects(options: AutotaskQueryOptions = {}): Promise<AutotaskProject[]> {
    const client = await this.ensureClient();

    try {
      this.logger.debug('Searching projects with options:', options);

      // Resolve pagination with safe defaults (capped at 100 for projects API)
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);
      const finalPageSize = Math.min(unlimited ? 100 : pageSize!, 100); // Projects API max is 100

      // WORKAROUND: The autotask-node library's projects.list() method is broken
      // It uses GET with query params instead of POST with body like the working companies endpoint
      // We'll bypass it and make the correct API call directly

      // Essential fields for optimized response size
      const essentialFields = [
        'id',
        'projectName',
        'projectNumber',
        'description',
        'status',
        'projectType',
        'department',
        'companyID',
        'projectManagerResourceID',
        'startDateTime',
        'endDateTime',
        'actualHours',
        'estimatedHours',
        'laborEstimatedRevenue',
        'createDate',
        'completedDate',
        'contractID',
        'originalEstimatedRevenue',
      ];

      // Prepare search body in the same format as working companies endpoint
      const searchBody: any = {};

      // Ensure there's a filter - Autotask API requires a filter
      if (
        !options.filter ||
        (Array.isArray(options.filter) && options.filter.length === 0) ||
        (!Array.isArray(options.filter) && Object.keys(options.filter).length === 0)
      ) {
        searchBody.filter = [
          {
            op: 'gte',
            field: 'id',
            value: 0,
          },
        ];
      } else {
        // If filter is provided as an object, convert to array format expected by API
        if (!Array.isArray(options.filter)) {
          const filterArray = [];
          for (const [field, value] of Object.entries(options.filter)) {
            filterArray.push({
              op: 'eq',
              field: field,
              value: value,
            });
          }
          searchBody.filter = filterArray;
        } else {
          searchBody.filter = options.filter;
        }
      }

      // Add other search parameters
      if (options.sort) searchBody.sort = options.sort;
      if (options.page) searchBody.page = options.page;

      // Apply resolved pageSize
      searchBody.pageSize = finalPageSize;

      // Add field limiting for optimization
      if (essentialFields.length > 0) {
        searchBody.includeFields = essentialFields;
      }

      this.logger.debug('Making direct API call to Projects/query with body:', searchBody);

      // Make the correct API call directly using the axios instance from the client
      const response = await (client as any).axios.post('/Projects/query', searchBody);

      // Extract projects from response (should be in response.data.items format)
      let projects: AutotaskProject[] = [];
      if (response.data && response.data.items) {
        projects = response.data.items;
      } else if (Array.isArray(response.data)) {
        projects = response.data;
      } else {
        this.logger.warn('Unexpected response format from Projects/query:', response.data);
        projects = [];
      }

      // Transform projects to optimize data size
      const optimizedProjects = projects.map((project) => this.optimizeProjectData(project));

      this.logger.info(`Retrieved ${optimizedProjects.length} projects (pageSize: ${finalPageSize})`);
      return optimizedProjects;
    } catch (error: any) {
      // Check if it's the same 405 error pattern
      if (error.response && error.response.status === 405) {
        this.logger.warn(
          'Projects endpoint may not support listing via API (405 Method Not Allowed). This is common with some Autotask configurations.',
        );
        return [];
      }
      this.logger.error('Failed to search projects:', error);
      throw error;
    }
  }

  /**
   * Optimize project data by truncating large text fields
   */
  private optimizeProjectData(project: AutotaskProject): AutotaskProject {
    const maxDescriptionLength = 500;

    const optimizedDescription = project.description
      ? project.description.length > maxDescriptionLength
        ? project.description.substring(0, maxDescriptionLength) + '... [truncated]'
        : project.description
      : '';

    return {
      ...project,
      description: optimizedDescription,
      // Remove potentially large arrays
      userDefinedFields: [],
    };
  }

  async createProject(project: Partial<AutotaskProject>): Promise<number> {
    const client = await this.ensureClient();

    try {
      this.logger.debug('Creating project:', project);
      const result = await client.projects.create(project as any);
      const projectId = (result.data as any)?.id;
      this.logger.info(`Project created with ID: ${projectId}`);
      return projectId;
    } catch (error) {
      this.logger.error('Failed to create project:', error);
      throw error;
    }
  }

  async updateProject(id: number, updates: Partial<AutotaskProject>): Promise<void> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Updating project ${id}:`, updates);
      await client.projects.update(id, updates as any);
      this.logger.info(`Project ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update project ${id}:`, error);
      throw error;
    }
  }

  // Resource operations - delegated to ResourceService
  async getResource(id: number): Promise<AutotaskResource | null> {
    return this.resourceService.getResource(id);
  }

  async searchResources(options: AutotaskQueryOptions = {}): Promise<AutotaskResource[]> {
    return this.resourceService.searchResources(options);
  }

  // Opportunity operations (Note: opportunities endpoint may not be available in autotask-node)
  // async getOpportunity(id: number): Promise<AutotaskOpportunity | null> {
  //   const client = await this.ensureClient();
  //
  //   try {
  //     this.logger.debug(`Getting opportunity with ID: ${id}`);
  //     const result = await client.opportunities.get(id);
  //     return result.data as AutotaskOpportunity || null;
  //   } catch (error) {
  //     this.logger.error(`Failed to get opportunity ${id}:`, error);
  //     throw error;
  //   }
  // }

  // async searchOpportunities(options: AutotaskQueryOptions = {}): Promise<AutotaskOpportunity[]> {
  //   const client = await this.ensureClient();
  //
  //   try {
  //     this.logger.debug('Searching opportunities with options:', options);
  //     const result = await client.opportunities.list(options as any);
  //     return (result.data as AutotaskOpportunity[]) || [];
  //   } catch (error) {
  //     this.logger.error('Failed to search opportunities:', error);
  //     throw error;
  //   }
  // }

  // async createOpportunity(opportunity: Partial<AutotaskOpportunity>): Promise<number> {
  //   const client = await this.ensureClient();
  //
  //   try {
  //     this.logger.debug('Creating opportunity:', opportunity);
  //     const result = await client.opportunities.create(opportunity as any);
  //     const opportunityId = (result.data as any)?.id;
  //     this.logger.info(`Opportunity created with ID: ${opportunityId}`);
  //     return opportunityId;
  //   } catch (error) {
  //     this.logger.error('Failed to create opportunity:', error);
  //     throw error;
  //   }
  // }

  // async updateOpportunity(id: number, updates: Partial<AutotaskOpportunity>): Promise<void> {
  //   const client = await this.ensureClient();
  //
  //   try {
  //     this.logger.debug(`Updating opportunity ${id}:`, updates);
  //     await client.opportunities.update(id, updates as any);
  //     this.logger.info(`Opportunity ${id} updated successfully`);
  //   } catch (error) {
  //     this.logger.error(`Failed to update opportunity ${id}:`, error);
  //     throw error;
  //   }
  // }

  // Configuration Item operations - delegated to ConfigurationItemService
  async getConfigurationItem(id: number): Promise<AutotaskConfigurationItem | null> {
    return this.configurationItemService.getConfigurationItem(id);
  }

  async searchConfigurationItems(options: AutotaskQueryOptions = {}): Promise<AutotaskConfigurationItem[]> {
    return this.configurationItemService.searchConfigurationItems(options);
  }

  async createConfigurationItem(configItem: Partial<AutotaskConfigurationItem>): Promise<number> {
    return this.configurationItemService.createConfigurationItem(configItem);
  }

  async updateConfigurationItem(id: number, updates: Partial<AutotaskConfigurationItem>): Promise<void> {
    return this.configurationItemService.updateConfigurationItem(id, updates);
  }

  // Product operations (Note: products endpoint may not be available in autotask-node)
  // async getProduct(id: number): Promise<AutotaskProduct | null> {
  //   const client = await this.ensureClient();
  //
  //   try {
  //     this.logger.debug(`Getting product with ID: ${id}`);
  //     const result = await client.products.get(id);
  //     return result.data as AutotaskProduct || null;
  //   } catch (error) {
  //     this.logger.error(`Failed to get product ${id}:`, error);
  //     throw error;
  //   }
  // }

  // async searchProducts(options: AutotaskQueryOptions = {}): Promise<AutotaskProduct[]> {
  //   const client = await this.ensureClient();
  //
  //   try {
  //     this.logger.debug('Searching products with options:', options);
  //     const result = await client.products.list(options as any);
  //     return (result.data as AutotaskProduct[]) || [];
  //   } catch (error) {
  //     this.logger.error('Failed to search products:', error);
  //     throw error;
  //   }
  // }

  // Contract operations - delegated to ContractService
  async getContract(id: number): Promise<AutotaskContract | null> {
    return this.contractService.getContract(id);
  }

  async searchContracts(options: AutotaskQueryOptions = {}): Promise<AutotaskContract[]> {
    return this.contractService.searchContracts(options);
  }

  // Invoice operations - delegated to InvoiceService
  async getInvoice(id: number): Promise<AutotaskInvoice | null> {
    return this.invoiceService.getInvoice(id);
  }

  async searchInvoices(options: AutotaskQueryOptions = {}): Promise<AutotaskInvoice[]> {
    return this.invoiceService.searchInvoices(options);
  }

  // Task operations
  async getTask(id: number): Promise<AutotaskTask | null> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Getting task with ID: ${id}`);
      const result = await client.tasks.get(id);
      return (result.data as unknown as AutotaskTask) || null;
    } catch (error) {
      this.logger.error(`Failed to get task ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for tasks with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of optimized tasks
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 tasks (safe default)
   * - pageSize: N (1-100): Returns up to N tasks (capped at 100)
   * - pageSize: -1: Returns up to 100 tasks (API limit)
   *
   * Note: Tasks are optimized with field limiting for reduced response size.
   */
  async searchTasks(options: AutotaskQueryOptions = {}): Promise<AutotaskTask[]> {
    const client = await this.ensureClient();

    try {
      this.logger.debug('Searching tasks with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);
      const finalPageSize = Math.min(unlimited ? 100 : pageSize!, 100); // Tasks API max is 100

      // Define essential task fields to minimize response size
      const essentialFields = [
        'id',
        'title',
        'description',
        'status',
        'projectID',
        'assignedResourceID',
        'creatorResourceID',
        'createDateTime',
        'startDateTime',
        'endDateTime',
        'estimatedHours',
        'hoursToBeScheduled',
        'remainingHours',
        'percentComplete',
        'priorityLabel',
        'taskType',
        'lastActivityDateTime',
        'completedDateTime',
      ];

      // Set default pagination and field limits
      const optimizedOptions = {
        ...options,
        includeFields: essentialFields,
        pageSize: finalPageSize,
      };

      const result = await client.tasks.list(optimizedOptions as any);
      const tasks = (result.data as unknown as AutotaskTask[]) || [];

      // Transform tasks to optimize data size
      const optimizedTasks = tasks.map((task) => this.optimizeTaskData(task));

      this.logger.info(`Retrieved ${optimizedTasks.length} tasks (pageSize: ${finalPageSize})`);
      return optimizedTasks;
    } catch (error) {
      this.logger.error('Failed to search tasks:', error);
      throw error;
    }
  }

  /**
   * Optimize task data by truncating large text fields
   */
  private optimizeTaskData(task: AutotaskTask): AutotaskTask {
    const maxDescriptionLength = 400;

    const optimizedDescription = task.description
      ? task.description.length > maxDescriptionLength
        ? task.description.substring(0, maxDescriptionLength) + '... [truncated]'
        : task.description
      : '';

    return {
      ...task,
      description: optimizedDescription,
      // Remove potentially large arrays
      userDefinedFields: [],
    };
  }

  async createTask(task: Partial<AutotaskTask>): Promise<number> {
    const client = await this.ensureClient();

    try {
      this.logger.debug('Creating task:', task);
      const result = await client.tasks.create(task as any);
      const taskId = (result.data as any)?.id;
      this.logger.info(`Task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.logger.error('Failed to create task:', error);
      throw error;
    }
  }

  async updateTask(id: number, updates: Partial<AutotaskTask>): Promise<void> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Updating task ${id}:`, updates);
      await client.tasks.update(id, updates as any);
      this.logger.info(`Task ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update task ${id}:`, error);
      throw error;
    }
  }

  // Utility methods
  async testConnection(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      // Try to list companies with limit of 1 as a connection test
      await client.accounts.list({ pageSize: 1 } as any);
      this.logger.info('Connection test successful');
      return true;
    } catch (error) {
      this.logger.error('Connection test failed:', error);
      return false;
    }
  }

  // =====================================================
  // NEW ENTITY METHODS - Phase 1: High-Priority Entities
  // =====================================================

  // Note entities - Using the generic notes endpoint
  async getTicketNote(ticketId: number, noteId: number): Promise<AutotaskTicketNote | null> {
    const client = await this.ensureClient();

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

  async searchTicketNotes(ticketId: number, options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskTicketNote[]> {
    const client = await this.ensureClient();

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

  async createTicketNote(note: Partial<AutotaskTicketNote>): Promise<AutotaskTicketNote> {
    const client = await this.ensureClient();

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
          `Invalid publish level: ${publish}. Must be 1 (Internal Only), 2 (All Autotask Users), or 3 (Everyone)`
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

  async getProjectNote(projectId: number, noteId: number): Promise<AutotaskProjectNote | null> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Getting project note - ProjectID: ${projectId}, NoteID: ${noteId}`);
      const result = await client.notes.list({
        filter: [
          { field: 'projectId', op: 'eq', value: projectId },
          { field: 'id', op: 'eq', value: noteId },
        ],
      });
      const notes = (result.data as any[]) || [];
      return notes.length > 0 ? (notes[0] as AutotaskProjectNote) : null;
    } catch (error) {
      this.logger.error(`Failed to get project note ${noteId} for project ${projectId}:`, error);
      throw error;
    }
  }

  async searchProjectNotes(
    projectId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskProjectNote[]> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Searching project notes for project ${projectId}:`, options);

      const optimizedOptions = {
        filter: [{ field: 'projectId', op: 'eq', value: projectId }],
        pageSize: options.pageSize || 25,
      };

      const result = await client.notes.list(optimizedOptions);
      const notes = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${notes.length} project notes`);
      return notes as AutotaskProjectNote[];
    } catch (error) {
      this.logger.error(`Failed to search project notes for project ${projectId}:`, error);
      throw error;
    }
  }

  async createProjectNote(projectId: number, note: Partial<AutotaskProjectNote>): Promise<number> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Creating project note for project ${projectId}:`, note);
      const noteData = {
        ...note,
        projectId: projectId,
      };
      const result = await client.notes.create(noteData as any);
      const noteId = (result.data as any)?.id;
      this.logger.info(`Project note created with ID: ${noteId}`);
      return noteId;
    } catch (error) {
      this.logger.error(`Failed to create project note for project ${projectId}:`, error);
      throw error;
    }
  }

  // Company note operations - delegated to CompanyService
  async getCompanyNote(companyId: number, noteId: number): Promise<AutotaskCompanyNote | null> {
    return this.companyService.getCompanyNote(companyId, noteId);
  }

  async searchCompanyNotes(
    companyId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskCompanyNote[]> {
    return this.companyService.searchCompanyNotes(companyId, options);
  }

  async createCompanyNote(companyId: number, note: Partial<AutotaskCompanyNote>): Promise<number> {
    return this.companyService.createCompanyNote(companyId, note);
  }

  // Attachment entities - Using the generic attachments endpoint
  async getTicketAttachment(
    ticketId: number,
    attachmentId: number,
    includeData: boolean = false,
  ): Promise<AutotaskTicketAttachment | null> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(
        `Getting ticket attachment - TicketID: ${ticketId}, AttachmentID: ${attachmentId}, includeData: ${includeData}`,
      );

      // Search for attachment by parent ID and attachment ID
      const result = await client.attachments.list({
        filter: [
          { field: 'parentId', op: 'eq', value: ticketId },
          { field: 'id', op: 'eq', value: attachmentId },
        ],
      });

      const attachments = (result.data as any[]) || [];
      return attachments.length > 0 ? (attachments[0] as AutotaskTicketAttachment) : null;
    } catch (error) {
      this.logger.error(`Failed to get ticket attachment ${attachmentId} for ticket ${ticketId}:`, error);
      throw error;
    }
  }

  async searchTicketAttachments(
    ticketId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskTicketAttachment[]> {
    const client = await this.ensureClient();

    try {
      this.logger.debug(`Searching ticket attachments for ticket ${ticketId}:`, options);

      const optimizedOptions = {
        filter: [{ field: 'parentId', op: 'eq', value: ticketId }],
        pageSize: options.pageSize || 10,
      };

      const result = await client.attachments.list(optimizedOptions);
      const attachments = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${attachments.length} ticket attachments`);
      return attachments as AutotaskTicketAttachment[];
    } catch (error) {
      this.logger.error(`Failed to search ticket attachments for ticket ${ticketId}:`, error);
      throw error;
    }
  }

  // Expense operations - delegated to ExpenseService
  async getExpenseReport(id: number): Promise<AutotaskExpenseReport | null> {
    return this.expenseService.getExpenseReport(id);
  }

  async searchExpenseReports(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskExpenseReport[]> {
    return this.expenseService.searchExpenseReports(options);
  }

  async createExpenseReport(report: Partial<AutotaskExpenseReport>): Promise<number> {
    return this.expenseService.createExpenseReport(report);
  }

  async getExpenseItem(expenseId: number, itemId: number): Promise<AutotaskExpenseItem | null> {
    return this.expenseService.getExpenseItem(expenseId, itemId);
  }

  async searchExpenseItems(
    expenseId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskExpenseItem[]> {
    return this.expenseService.searchExpenseItems(expenseId, options);
  }

  async createExpenseItem(expenseId: number, item: Partial<AutotaskExpenseItem>): Promise<number> {
    return this.expenseService.createExpenseItem(expenseId, item);
  }

  // Quote operations - delegated to QuoteService
  async getQuote(id: number): Promise<AutotaskQuote | null> {
    return this.quoteService.getQuote(id);
  }

  async searchQuotes(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskQuote[]> {
    return this.quoteService.searchQuotes(options);
  }

  async createQuote(quote: Partial<AutotaskQuote>): Promise<number> {
    return this.quoteService.createQuote(quote);
  }

  // BillingCode and Department entities are not directly available in autotask-node
  // These would need to be implemented via custom API calls or alternative endpoints
  async getBillingCode(_id: number): Promise<AutotaskBillingCode | null> {
    throw new Error('Billing codes API not directly available in autotask-node library');
  }

  async searchBillingCodes(_options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskBillingCode[]> {
    throw new Error('Billing codes API not directly available in autotask-node library');
  }

  async getDepartment(_id: number): Promise<AutotaskDepartment | null> {
    throw new Error('Departments API not directly available in autotask-node library');
  }

  async searchDepartments(_options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskDepartment[]> {
    throw new Error('Departments API not directly available in autotask-node library');
  }
}
