/**
 * Configuration Item Service
 *
 * Handles configuration item (CI) operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskConfigurationItem, AutotaskQueryOptions } from '../../types/autotask.js';

export class ConfigurationItemService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a configuration item by ID
   */
  async getConfigurationItem(id: number): Promise<AutotaskConfigurationItem | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting configuration item with ID: ${id}`);
      const result = await client.configurationItems.get(id);
      return (result.data as AutotaskConfigurationItem) || null;
    } catch (error) {
      this.logger.error(`Failed to get configuration item ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for configuration items with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of configuration items
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 configuration items (safe default)
   * - pageSize: N (1-500): Returns up to N items
   * - pageSize: -1: Returns ALL items (use with caution)
   */
  async searchConfigurationItems(options: AutotaskQueryOptions = {}): Promise<AutotaskConfigurationItem[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching configuration items with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);

      const queryOptions = {
        ...options,
        pageSize: unlimited ? 500 : pageSize!,
      };

      const result = await client.configurationItems.list(queryOptions as any);
      const items = (result.data as AutotaskConfigurationItem[]) || [];

      this.logger.info(`Retrieved ${items.length} configuration items (pageSize: ${pageSize || 'unlimited'})`);
      return items;
    } catch (error) {
      this.logger.error('Failed to search configuration items:', error);
      throw error;
    }
  }

  /**
   * Create a new configuration item
   */
  async createConfigurationItem(configItem: Partial<AutotaskConfigurationItem>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating configuration item:', configItem);
      const result = await client.configurationItems.create(configItem as any);
      const configItemId = (result.data as any)?.id;
      this.logger.info(`Configuration item created with ID: ${configItemId}`);
      return configItemId;
    } catch (error) {
      this.logger.error('Failed to create configuration item:', error);
      throw error;
    }
  }

  /**
   * Update an existing configuration item
   */
  async updateConfigurationItem(id: number, updates: Partial<AutotaskConfigurationItem>): Promise<void> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Updating configuration item ${id}:`, updates);
      await client.configurationItems.update(id, updates as any);
      this.logger.info(`Configuration item ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update configuration item ${id}:`, error);
      throw error;
    }
  }
}
