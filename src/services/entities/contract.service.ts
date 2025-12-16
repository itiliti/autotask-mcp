/**
 * Contract Service
 *
 * Handles contract-related operations in Autotask.
 * Currently read-only as contracts are complex entities.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskContract, AutotaskQueryOptions } from '../../types/autotask.js';

export class ContractService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a contract by ID
   */
  async getContract(id: number): Promise<AutotaskContract | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting contract with ID: ${id}`);
      const result = await client.contracts.get(id);
      return (result.data as unknown as AutotaskContract) || null;
    } catch (error) {
      this.logger.error(`Failed to get contract ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for contracts with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of contracts
   *
   * Pagination behavior:
   * - No pageSize specified: Returns 25 contracts (safe default)
   * - pageSize: N (1-500): Returns up to N contracts
   * - pageSize: -1: Returns ALL contracts (use with caution)
   */
  async searchContracts(options: AutotaskQueryOptions = {}): Promise<AutotaskContract[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching contracts with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);

      const queryOptions = {
        ...options,
        pageSize: unlimited ? 500 : pageSize!,
      };

      const result = await client.contracts.list(queryOptions as any);
      const contracts = (result.data as unknown as AutotaskContract[]) || [];

      this.logger.info(`Retrieved ${contracts.length} contracts (pageSize: ${pageSize || 'unlimited'})`);
      return contracts;
    } catch (error) {
      this.logger.error('Failed to search contracts:', error);
      throw error;
    }
  }
}
