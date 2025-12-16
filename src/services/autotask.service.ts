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
import { ProjectService } from './entities/project.service.js';
import { TaskService } from './entities/task.service.js';
import { TicketService } from './entities/ticket.service.js';
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
  private _projectService: ProjectService | null = null;
  private _taskService: TaskService | null = null;
  private _ticketService: TicketService | null = null;

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

  /**
   * Get the ProjectService instance (lazy-initialized)
   */
  private get projectService(): ProjectService {
    if (!this._projectService) {
      this._projectService = new ProjectService(this.getServiceContext());
    }
    return this._projectService;
  }

  /**
   * Get the TaskService instance (lazy-initialized)
   */
  private get taskService(): TaskService {
    if (!this._taskService) {
      this._taskService = new TaskService(this.getServiceContext());
    }
    return this._taskService;
  }

  /**
   * Get the TicketService instance (lazy-initialized)
   */
  private get ticketService(): TicketService {
    if (!this._ticketService) {
      this._ticketService = new TicketService(this.getServiceContext());
    }
    return this._ticketService;
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

  // Ticket operations - delegated to TicketService
  async getTicket(id: number, fullDetails: boolean = false): Promise<AutotaskTicket | null> {
    return this.ticketService.getTicket(id, fullDetails);
  }

  async searchTickets(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskTicket[]> {
    return this.ticketService.searchTickets(options);
  }

  async createTicket(ticket: Partial<AutotaskTicket>): Promise<number> {
    return this.ticketService.createTicket(ticket);
  }

  async updateTicket(id: number, updates: TicketUpdateFields): Promise<AutotaskTicket> {
    return this.ticketService.updateTicket(id, updates);
  }

  // Time entry operations - delegated to TimeEntryService
  async createTimeEntry(timeEntry: Partial<AutotaskTimeEntry>): Promise<number> {
    return this.timeEntryService.createTimeEntry(timeEntry);
  }

  async getTimeEntries(options: AutotaskQueryOptions = {}): Promise<AutotaskTimeEntry[]> {
    return this.timeEntryService.getTimeEntries(options);
  }

  // Project operations - delegated to ProjectService
  async getProject(id: number): Promise<AutotaskProject | null> {
    return this.projectService.getProject(id);
  }

  async searchProjects(options: AutotaskQueryOptions = {}): Promise<AutotaskProject[]> {
    return this.projectService.searchProjects(options);
  }

  async createProject(project: Partial<AutotaskProject>): Promise<number> {
    return this.projectService.createProject(project);
  }

  async updateProject(id: number, updates: Partial<AutotaskProject>): Promise<void> {
    return this.projectService.updateProject(id, updates);
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

  // Task operations - delegated to TaskService
  async getTask(id: number): Promise<AutotaskTask | null> {
    return this.taskService.getTask(id);
  }

  async searchTasks(options: AutotaskQueryOptions = {}): Promise<AutotaskTask[]> {
    return this.taskService.searchTasks(options);
  }

  async createTask(task: Partial<AutotaskTask>): Promise<number> {
    return this.taskService.createTask(task);
  }

  async updateTask(id: number, updates: Partial<AutotaskTask>): Promise<void> {
    return this.taskService.updateTask(id, updates);
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

  // Ticket note operations - delegated to TicketService
  async getTicketNote(ticketId: number, noteId: number): Promise<AutotaskTicketNote | null> {
    return this.ticketService.getTicketNote(ticketId, noteId);
  }

  async searchTicketNotes(ticketId: number, options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskTicketNote[]> {
    return this.ticketService.searchTicketNotes(ticketId, options);
  }

  async createTicketNote(note: Partial<AutotaskTicketNote>): Promise<AutotaskTicketNote> {
    return this.ticketService.createTicketNote(note);
  }

  // Project note operations - delegated to ProjectService
  async getProjectNote(projectId: number, noteId: number): Promise<AutotaskProjectNote | null> {
    return this.projectService.getProjectNote(projectId, noteId);
  }

  async searchProjectNotes(
    projectId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskProjectNote[]> {
    return this.projectService.searchProjectNotes(projectId, options);
  }

  async createProjectNote(projectId: number, note: Partial<AutotaskProjectNote>): Promise<number> {
    return this.projectService.createProjectNote(projectId, note);
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
