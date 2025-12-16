/**
 * Base Entity Service
 *
 * Abstract base class for all entity-specific services.
 * Provides convenience accessors to the shared ServiceContext
 * and common patterns used across entity operations.
 */

import { AutotaskClient } from 'autotask-node';
import { IServiceContext, PaginationConfig } from './service.context.js';
import { Logger } from '../../utils/logger.js';
import { AutotaskQueryOptions } from '../../types/autotask.js';
import { ErrorMapper, MappedError } from '../../utils/error-mapper.js';

/**
 * Abstract base class for entity services
 *
 * All entity services (CompanyService, TicketService, etc.) extend this class
 * to gain access to shared infrastructure via the ServiceContext.
 */
export abstract class BaseEntityService {
  protected readonly context: IServiceContext;

  constructor(context: IServiceContext) {
    this.context = context;
  }

  /**
   * Logger instance for this service
   */
  protected get logger(): Logger {
    return this.context.logger;
  }

  /**
   * Get the initialized AutotaskClient
   * Ensures lazy initialization is complete before returning
   */
  protected async getClient(): Promise<AutotaskClient> {
    return this.context.getClient();
  }

  /**
   * Execute API request with rate limiting
   *
   * All API calls should go through this method to ensure
   * proper rate limiting and threshold monitoring.
   *
   * @param request - The API request function to execute
   * @param endpoint - Optional endpoint name for logging/debugging
   */
  protected async executeWithRateLimit<T>(request: () => Promise<T>, endpoint?: string): Promise<T> {
    return this.context.executeWithRateLimit(request, endpoint);
  }

  /**
   * Resolve pagination options with safe defaults
   *
   * Behavior:
   * - undefined or 0 → use defaultPageSize (safe default)
   * - positive number → use value (capped at 500)
   * - -1 → unlimited results (explicit opt-in)
   *
   * @param options - Query options with optional pageSize
   * @param defaultPageSize - Default page size for this entity type
   */
  protected resolvePaginationOptions(options: AutotaskQueryOptions, defaultPageSize: number): PaginationConfig {
    return this.context.resolvePaginationOptions(options, defaultPageSize);
  }

  /**
   * Map errors to structured error responses
   *
   * @param error - The caught error
   * @param operation - The operation that failed (for context)
   */
  protected mapError(error: unknown, operation: string): MappedError {
    return ErrorMapper.mapAutotaskError(error, operation);
  }
}
