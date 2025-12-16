/**
 * Invoice Service
 *
 * Handles invoice-related operations in Autotask.
 * Currently read-only.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskInvoice, AutotaskQueryOptions } from '../../types/autotask.js';

export class InvoiceService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get an invoice by ID
   */
  async getInvoice(id: number): Promise<AutotaskInvoice | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting invoice with ID: ${id}`);
      const result = await client.invoices.get(id);
      return (result.data as AutotaskInvoice) || null;
    } catch (error) {
      this.logger.error(`Failed to get invoice ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for invoices with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of invoices
   *
   * Pagination behavior:
   * - No pageSize specified: Returns 25 invoices (safe default)
   * - pageSize: N (1-500): Returns up to N invoices
   * - pageSize: -1: Returns ALL invoices (use with caution)
   */
  async searchInvoices(options: AutotaskQueryOptions = {}): Promise<AutotaskInvoice[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching invoices with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);

      const queryOptions = {
        ...options,
        pageSize: unlimited ? 500 : pageSize!,
      };

      const result = await client.invoices.list(queryOptions as any);
      const invoices = (result.data as AutotaskInvoice[]) || [];

      this.logger.info(`Retrieved ${invoices.length} invoices (pageSize: ${pageSize || 'unlimited'})`);
      return invoices;
    } catch (error) {
      this.logger.error('Failed to search invoices:', error);
      throw error;
    }
  }
}
