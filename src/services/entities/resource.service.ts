/**
 * Resource Service
 *
 * Handles resource-related operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskResource, AutotaskQueryOptions } from '../../types/autotask.js';

export class ResourceService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a resource by ID
   */
  async getResource(id: number): Promise<AutotaskResource | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting resource with ID: ${id}`);
      const result = await client.resources.get(id);
      return (result.data as AutotaskResource) || null;
    } catch (error) {
      this.logger.error(`Failed to get resource ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for resources with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of resources
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 resources (safe default for larger records)
   * - pageSize: N (1-500): Returns up to N resources
   * - pageSize: -1: Returns ALL resources (use with caution)
   */
  async searchResources(options: AutotaskQueryOptions = {}): Promise<AutotaskResource[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching resources with options:', options);

      // Resolve pagination with safe defaults (25 for larger records)
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);

      // Build filter array for API query
      const filters: any[] = [];

      // Add email filter if provided (search by username OR full email)
      if ((options as any).email) {
        const email = (options as any).email;
        const username = email.includes('@') ? email.split('@')[0] : email;

        // Search for either username (before @) or full email
        filters.push({
          op: 'or',
          items: [
            {
              op: 'eq',
              field: 'userName',
              value: username,
            },
            {
              op: 'eq',
              field: 'email',
              value: email,
            },
          ],
        });
      }

      // Default filter if none provided (required by Autotask API)
      if (filters.length === 0 && !options.filter) {
        filters.push({
          op: 'gte',
          field: 'id',
          value: 0,
        });
      }

      // Determine final filter to use
      const finalFilter = filters.length > 0 ? filters : options.filter;

      if (unlimited) {
        // Unlimited mode: fetch ALL resources via pagination
        const allResources: AutotaskResource[] = [];
        const batchSize = 500;
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages) {
          const searchBody = {
            filter: finalFilter,
            MaxRecords: batchSize,
          };

          this.logger.debug(`Fetching resources page ${currentPage} with body:`, searchBody);

          // Use direct POST to /Resources/query endpoint (autotask-node library uses wrong method)
          const response = await (client as any).axios.post('/Resources/query', searchBody);

          // Validate response structure
          if (!response.data || !response.data.items) {
            this.logger.warn('Unexpected response format from Resources/query:', response.data);
            hasMorePages = false;
            break;
          }

          const resources = response.data.items as AutotaskResource[];

          if (resources.length === 0) {
            hasMorePages = false;
          } else {
            allResources.push(...resources);

            if (resources.length < batchSize) {
              hasMorePages = false;
            } else {
              currentPage++;
            }
          }

          // Safety check to prevent infinite loops
          if (currentPage > 20) {
            this.logger.warn('Resource pagination safety limit reached at 20 pages (10,000 resources)');
            hasMorePages = false;
          }
        }

        this.logger.info(`Retrieved ${allResources.length} resources across ${currentPage} pages (unlimited mode)`);
        return allResources;
      } else {
        // Limited mode: fetch single page
        const searchBody = {
          filter: finalFilter,
          MaxRecords: pageSize!,
        };

        this.logger.debug('Making direct API call to Resources/query with body:', searchBody);

        // Use direct POST to /Resources/query endpoint (autotask-node library uses wrong method)
        const response = await (client as any).axios.post('/Resources/query', searchBody);

        // Validate response structure
        if (!response.data || !response.data.items) {
          this.logger.warn('Unexpected response format from Resources/query:', response.data);
          return [];
        }

        let resources = response.data.items as AutotaskResource[];

        // Safety cap: Autotask API sometimes ignores pageSize, enforce client-side
        if (resources.length > pageSize!) {
          this.logger.warn(
            `API returned ${resources.length} resources but pageSize was ${pageSize}. Truncating to requested limit.`,
          );
          resources = resources.slice(0, pageSize!);
        }

        this.logger.info(`Retrieved ${resources.length} resources (pageSize: ${pageSize})`);
        return resources;
      }
    } catch (error) {
      this.logger.error('Failed to search resources:', error);
      throw error;
    }
  }
}
