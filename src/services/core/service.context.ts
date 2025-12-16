/**
 * Service Context
 *
 * Shared context object that provides entity services with access to:
 * - AutotaskClient instance
 * - Logger
 * - Rate limiter
 * - Metadata cache
 * - Common helper methods (pagination, rate limiting)
 *
 * This context is injected into all entity services, allowing them to
 * share infrastructure without circular dependencies.
 */

import { AutotaskClient } from 'autotask-node';
import { Logger } from '../../utils/logger.js';
import { RateLimiterService } from '../rate-limiter.service.js';
import { TicketMetadataCache } from '../ticket-metadata.cache.js';
import { ApiUserCacheService } from '../api-user-cache.service.js';
import { McpServerConfig } from '../../types/mcp.js';
import { AutotaskQueryOptions } from '../../types/autotask.js';

/**
 * Pagination resolution result
 */
export interface PaginationConfig {
  pageSize: number | null;
  unlimited: boolean;
}

/**
 * ServiceContext interface - defines what entity services can access
 */
export interface IServiceContext {
  /** Get the initialized AutotaskClient */
  getClient(): Promise<AutotaskClient>;

  /** Logger instance */
  readonly logger: Logger;

  /** Rate limiter service */
  readonly rateLimiter: RateLimiterService;

  /** Ticket metadata cache */
  readonly metadataCache: TicketMetadataCache;

  /** API user cache service */
  readonly apiUserCache: ApiUserCacheService;

  /** Server configuration */
  readonly config: McpServerConfig;

  /**
   * Execute API request with rate limiting
   * @param request - The API request function to execute
   * @param endpoint - Optional endpoint name for logging
   */
  executeWithRateLimit<T>(request: () => Promise<T>, endpoint?: string): Promise<T>;

  /**
   * Resolve pagination options with safe defaults
   * @param options - Query options with optional pageSize
   * @param defaultPageSize - Default page size for the entity type
   */
  resolvePaginationOptions(options: AutotaskQueryOptions, defaultPageSize: number): PaginationConfig;
}

/**
 * ServiceContext implementation
 *
 * Created by AutotaskService and passed to entity services.
 * Provides controlled access to shared infrastructure.
 */
export class ServiceContext implements IServiceContext {
  private _getClient: () => Promise<AutotaskClient>;
  private _executeWithRateLimit: <T>(request: () => Promise<T>, endpoint?: string) => Promise<T>;
  private _resolvePaginationOptions: (options: AutotaskQueryOptions, defaultPageSize: number) => PaginationConfig;

  readonly logger: Logger;
  readonly rateLimiter: RateLimiterService;
  readonly metadataCache: TicketMetadataCache;
  readonly apiUserCache: ApiUserCacheService;
  readonly config: McpServerConfig;

  constructor(params: {
    getClient: () => Promise<AutotaskClient>;
    logger: Logger;
    rateLimiter: RateLimiterService;
    metadataCache: TicketMetadataCache;
    apiUserCache: ApiUserCacheService;
    config: McpServerConfig;
    executeWithRateLimit: <T>(request: () => Promise<T>, endpoint?: string) => Promise<T>;
    resolvePaginationOptions: (options: AutotaskQueryOptions, defaultPageSize: number) => PaginationConfig;
  }) {
    this._getClient = params.getClient;
    this.logger = params.logger;
    this.rateLimiter = params.rateLimiter;
    this.metadataCache = params.metadataCache;
    this.apiUserCache = params.apiUserCache;
    this.config = params.config;
    this._executeWithRateLimit = params.executeWithRateLimit;
    this._resolvePaginationOptions = params.resolvePaginationOptions;
  }

  async getClient(): Promise<AutotaskClient> {
    return this._getClient();
  }

  executeWithRateLimit<T>(request: () => Promise<T>, endpoint?: string): Promise<T> {
    return this._executeWithRateLimit(request, endpoint);
  }

  resolvePaginationOptions(options: AutotaskQueryOptions, defaultPageSize: number): PaginationConfig {
    return this._resolvePaginationOptions(options, defaultPageSize);
  }
}
