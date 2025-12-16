/**
 * Expense Service
 *
 * Handles expense report and expense item operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import {
  AutotaskExpenseReport,
  AutotaskExpenseItem,
  AutotaskQueryOptionsExtended,
} from '../../types/autotask.js';

export class ExpenseService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get an expense report by ID
   */
  async getExpenseReport(id: number): Promise<AutotaskExpenseReport | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting expense report with ID: ${id}`);
      const result = await client.expenses.get(id);
      return (result.data as unknown as AutotaskExpenseReport) || null;
    } catch (error) {
      this.logger.error(`Failed to get expense report ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for expense reports with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of expense reports
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 expense reports (safe default)
   * - pageSize: N (1-500): Returns up to N reports
   * - pageSize: -1: Returns up to 500 reports
   */
  async searchExpenseReports(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskExpenseReport[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching expense reports with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);

      // Build filter based on provided options
      const filters: any[] = [];
      if (options.submitterId) {
        filters.push({
          field: 'resourceId',
          op: 'eq',
          value: options.submitterId,
        });
      }
      if (options.status) {
        filters.push({ field: 'status', op: 'eq', value: options.status });
      }

      const queryOptions = {
        filter: filters.length > 0 ? filters : [{ field: 'id', op: 'gte', value: 0 }],
        pageSize: unlimited ? 500 : pageSize!,
      };

      const result = await client.expenses.list(queryOptions);
      const reports = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${reports.length} expense reports (pageSize: ${pageSize || 'unlimited'})`);
      return reports as AutotaskExpenseReport[];
    } catch (error) {
      this.logger.error('Failed to search expense reports:', error);
      throw error;
    }
  }

  /**
   * Create a new expense report
   */
  async createExpenseReport(report: Partial<AutotaskExpenseReport>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating expense report:', report);
      const result = await client.expenses.create(report as any);
      const reportId = (result.data as any)?.id;
      this.logger.info(`Expense report created with ID: ${reportId}`);
      return reportId;
    } catch (error) {
      this.logger.error('Failed to create expense report:', error);
      throw error;
    }
  }

  // For expense items, we'll need to use a different approach since they're child entities
  // This is a placeholder - actual implementation may vary based on API structure
  async getExpenseItem(_expenseId: number, _itemId: number): Promise<AutotaskExpenseItem | null> {
    // This would need to be implemented based on the actual API structure for child items
    throw new Error('Expense items API not yet implemented - requires child entity handling');
  }

  async searchExpenseItems(
    _expenseId: number,
    _options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskExpenseItem[]> {
    // This would need to be implemented based on the actual API structure for child items
    throw new Error('Expense items API not yet implemented - requires child entity handling');
  }

  async createExpenseItem(_expenseId: number, _item: Partial<AutotaskExpenseItem>): Promise<number> {
    // This would need to be implemented based on the actual API structure for child items
    throw new Error('Expense items API not yet implemented - requires child entity handling');
  }
}
