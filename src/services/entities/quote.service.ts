/**
 * Quote Service
 *
 * Handles quote-related operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskQuote, AutotaskQueryOptionsExtended } from '../../types/autotask.js';

export class QuoteService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a quote by ID
   */
  async getQuote(id: number): Promise<AutotaskQuote | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting quote with ID: ${id}`);
      const result = await client.quotes.get(id);
      return (result.data as AutotaskQuote) || null;
    } catch (error) {
      this.logger.error(`Failed to get quote ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for quotes with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of quotes
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 quotes (safe default)
   * - pageSize: N (1-500): Returns up to N quotes
   * - pageSize: -1: Returns up to 500 quotes
   */
  async searchQuotes(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskQuote[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching quotes with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);

      // Build filter based on provided options
      const filters: any[] = [];
      if (options.companyId !== undefined) {
        filters.push({
          field: 'accountId',
          op: 'eq',
          value: options.companyId,
        });
      }
      if (options.contactId) {
        filters.push({
          field: 'contactId',
          op: 'eq',
          value: options.contactId,
        });
      }
      if (options.opportunityId) {
        filters.push({
          field: 'opportunityId',
          op: 'eq',
          value: options.opportunityId,
        });
      }
      if (options.searchTerm) {
        filters.push({
          field: 'description',
          op: 'contains',
          value: options.searchTerm,
        });
      }

      const queryOptions = {
        filter: filters.length > 0 ? filters : [{ field: 'id', op: 'gte', value: 0 }],
        pageSize: unlimited ? 500 : pageSize!,
      };

      const result = await client.quotes.list(queryOptions);
      const quotes = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${quotes.length} quotes (pageSize: ${pageSize || 'unlimited'})`);
      return quotes as AutotaskQuote[];
    } catch (error) {
      this.logger.error('Failed to search quotes:', error);
      throw error;
    }
  }

  /**
   * Create a new quote
   */
  async createQuote(quote: Partial<AutotaskQuote>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating quote:', quote);
      const result = await client.quotes.create(quote as any);
      const quoteId = (result.data as any)?.id;
      this.logger.info(`Quote created with ID: ${quoteId}`);
      return quoteId;
    } catch (error) {
      this.logger.error('Failed to create quote:', error);
      throw error;
    }
  }
}
