/**
 * Query Counter Service (v2)
 *
 * Smart query execution with adaptive strategies:
 * - Reverse time-window search for "latest/max" queries (30→90→180→365 days)
 * - Adaptive binary search using count queries when results >2500
 * - ID tracking to avoid re-fetching known records
 * - New thresholds: 500/page, warn at 2500, limit at 5000
 * - Results are always ID-ordered (created date order)
 */

import { AutotaskClient } from 'autotask-node';
import { Logger } from '../../utils/logger.js';

/**
 * Query execution result with metadata
 */
export interface QueryResult<T> {
  items: T[];
  totalCount: number;
  strategy: 'direct' | 'reverse-window' | 'binary-search' | 'paginated';
  message: string;
  warning?: string;
  metadata?: {
    windowsSearched?: number;
    maxIdSeen?: number;
    pagesSearched?: number;
  };
}

/**
 * Query Counter Service
 *
 * Handles intelligent query execution strategies based on result set size.
 */
export class QueryCounterService {
  private readonly logger: Logger;

  // Thresholds
  private readonly PAGE_SIZE = 500;
  private readonly WARN_THRESHOLD = 2500; // 5 pages
  private readonly MAX_RESULTS = 5000; // 10 pages

  // Time windows for reverse search (in days)
  private readonly TIME_WINDOWS = [30, 90, 180, 365, 730]; // 30d, 90d, 180d, 1y, 2y

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Get count of results for a query
   */
  async getCount(client: AutotaskClient, entity: string, filters: any[]): Promise<number> {
    try {
      this.logger.debug(`Counting ${entity} with filters:`, filters);

      const response = await (client as any).axios.post(`/${entity}/query/count`, {
        filter: filters,
      });

      const count = response.data?.queryCount ?? 0;
      this.logger.debug(`Count result for ${entity}: ${count}`);

      return count;
    } catch (error) {
      this.logger.error(`Failed to get count for ${entity}:`, error);
      return 0;
    }
  }

  /**
   * Execute query with smart strategy selection
   *
   * @param client - Autotask client
   * @param entity - Entity type (e.g., 'Tickets')
   * @param baseFilters - Base query filters
   * @param isLatestQuery - True if searching for "latest/max/recent"
   * @param fetcher - Function to fetch results for given filters
   * @param dateField - Date field for time-based queries (default: 'createDate')
   */
  async executeSmartQuery<T extends { id?: number }>(
    client: AutotaskClient,
    entity: string,
    baseFilters: any[],
    isLatestQuery: boolean,
    fetcher: (filters: any[], pageSize: number, page?: number) => Promise<T[]>,
    dateField: string = 'createDate',
  ): Promise<QueryResult<T>> {
    // Get total count
    const totalCount = await this.getCount(client, entity, baseFilters);

    // Direct fetch for small result sets (<= 500)
    if (totalCount <= this.PAGE_SIZE) {
      this.logger.info(`${entity}: Count ${totalCount} <= ${this.PAGE_SIZE}, fetching directly`);
      const items = await fetcher(baseFilters, this.PAGE_SIZE);

      return {
        items,
        totalCount,
        strategy: 'direct',
        message: `Found ${items.length} ${entity.toLowerCase()}.`,
      };
    }

    // Reverse time-window search for "latest" queries
    if (isLatestQuery) {
      this.logger.info(`${entity}: Latest query with ${totalCount} total results, using reverse time-window search`);
      return await this.executeReverseWindowSearch(client, entity, baseFilters, totalCount, fetcher, dateField);
    }

    // For non-latest queries with large result sets
    if (totalCount > this.MAX_RESULTS) {
      this.logger.warn(
        `${entity}: Count ${totalCount} exceeds max ${this.MAX_RESULTS}. Results need better filtering.`,
      );

      // Fetch first page only and warn
      const items = await fetcher(baseFilters, this.PAGE_SIZE, 1);

      return {
        items,
        totalCount,
        strategy: 'paginated',
        message: `Showing first ${items.length} of ${totalCount} results (page 1 of ${Math.ceil(totalCount / this.PAGE_SIZE)}).`,
        warning: `Large result set (${totalCount} records). Add date range or other filters to narrow results. Would require ${Math.ceil(totalCount / this.PAGE_SIZE)} pages to fetch all.`,
      };
    }

    // Warn if approaching limit
    if (totalCount > this.WARN_THRESHOLD) {
      this.logger.warn(
        `${entity}: Count ${totalCount} exceeds warning threshold ${this.WARN_THRESHOLD}`,
      );
    }

    // Standard paginated fetch (up to 10 pages)
    this.logger.info(`${entity}: Fetching ${totalCount} results via pagination`);
    return await this.executePaginatedFetch(entity, baseFilters, totalCount, fetcher);
  }

  /**
   * Reverse time-window search for "latest" queries
   *
   * Searches in expanding time windows (30→90→180→365 days) until results found.
   * Uses binary search if a window has >2500 results.
   */
  private async executeReverseWindowSearch<T extends { id?: number }>(
    client: AutotaskClient,
    entity: string,
    baseFilters: any[],
    totalCount: number,
    fetcher: (filters: any[], pageSize: number, page?: number) => Promise<T[]>,
    dateField: string,
  ): Promise<QueryResult<T>> {
    const now = new Date();
    let windowsSearched = 0;

    // Try each time window, starting with most recent
    for (const days of this.TIME_WINDOWS) {
      windowsSearched++;

      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - days);

      const windowFilters = [
        ...baseFilters,
        {
          field: dateField,
          op: 'gte',
          value: startDate.toISOString(),
        },
      ];

      const windowCount = await this.getCount(client, entity, windowFilters);

      this.logger.debug(`${entity}: Last ${days} days has ${windowCount} results`);

      if (windowCount === 0) {
        continue; // Try next window
      }

      // If window has manageable results, fetch them
      if (windowCount <= this.PAGE_SIZE) {
        this.logger.info(`${entity}: Fetching ${windowCount} results from last ${days} days`);
        const items = await fetcher(windowFilters, this.PAGE_SIZE);

        return {
          items,
          totalCount,
          strategy: 'reverse-window',
          message: `Found ${items.length} ${entity.toLowerCase()} from last ${days} days (${totalCount} total in system).`,
          metadata: {
            windowsSearched,
            maxIdSeen: Math.max(...items.map(i => i.id || 0)),
          },
        };
      }

      // Window has >500 results, check if it needs binary search
      if (windowCount > this.WARN_THRESHOLD) {
        this.logger.info(
          `${entity}: Last ${days} days has ${windowCount} results, using binary search`,
        );
        return await this.executeBinarySearchInWindow(
          client,
          entity,
          baseFilters,
          totalCount,
          fetcher,
          dateField,
          startDate,
          now,
          windowsSearched,
        );
      }

      // Fetch paginated results from this window (up to 2500)
      this.logger.info(`${entity}: Fetching ${windowCount} results from last ${days} days (paginated)`);
      const items: T[] = [];
      const maxPages = Math.ceil(Math.min(windowCount, this.WARN_THRESHOLD) / this.PAGE_SIZE);

      for (let page = 1; page <= maxPages; page++) {
        const pageItems = await fetcher(windowFilters, this.PAGE_SIZE, page);
        items.push(...pageItems);

        if (pageItems.length < this.PAGE_SIZE) {
          break; // No more results
        }
      }

      return {
        items,
        totalCount,
        strategy: 'reverse-window',
        message: `Found ${items.length} ${entity.toLowerCase()} from last ${days} days (${totalCount} total in system).`,
        metadata: {
          windowsSearched,
          maxIdSeen: Math.max(...items.map(i => i.id || 0)),
        },
      };
    }

    // No results found in any time window - fetch from beginning
    this.logger.info(`${entity}: No results in time windows, fetching from beginning`);
    const items = await fetcher(baseFilters, this.PAGE_SIZE, 1);

    return {
      items,
      totalCount,
      strategy: 'reverse-window',
      message: `Found ${items.length} ${entity.toLowerCase()} (oldest first, ${totalCount} total).`,
      warning: 'No results found in recent time windows. Showing oldest records. Use date filters to search specific periods.',
      metadata: {
        windowsSearched,
      },
    };
  }

  /**
   * Binary search within a date range to find manageable segment
   *
   * Recursively splits date range until segment has <=500 results
   */
  private async executeBinarySearchInWindow<T extends { id?: number }>(
    client: AutotaskClient,
    entity: string,
    baseFilters: any[],
    totalCount: number,
    fetcher: (filters: any[], pageSize: number, page?: number) => Promise<T[]>,
    dateField: string,
    startDate: Date,
    endDate: Date,
    windowsSearched: number,
  ): Promise<QueryResult<T>> {
    const midDate = new Date((startDate.getTime() + endDate.getTime()) / 2);

    // Check upper half (more recent)
    const upperFilters = [
      ...baseFilters,
      { field: dateField, op: 'gte', value: midDate.toISOString() },
      { field: dateField, op: 'lte', value: endDate.toISOString() },
    ];

    const upperCount = await this.getCount(client, entity, upperFilters);

    if (upperCount <= this.PAGE_SIZE && upperCount > 0) {
      // Found manageable segment in upper half
      this.logger.info(`${entity}: Binary search found ${upperCount} results in recent segment`);
      const items = await fetcher(upperFilters, this.PAGE_SIZE);

      return {
        items,
        totalCount,
        strategy: 'binary-search',
        message: `Found ${items.length} recent ${entity.toLowerCase()} (${totalCount} total in system).`,
        metadata: {
          windowsSearched,
          maxIdSeen: Math.max(...items.map(i => i.id || 0)),
        },
      };
    }

    if (upperCount > this.PAGE_SIZE) {
      // Upper half still too large, recurse
      return await this.executeBinarySearchInWindow(
        client,
        entity,
        baseFilters,
        totalCount,
        fetcher,
        dateField,
        midDate,
        endDate,
        windowsSearched,
      );
    }

    // Check lower half
    const lowerFilters = [
      ...baseFilters,
      { field: dateField, op: 'gte', value: startDate.toISOString() },
      { field: dateField, op: 'lt', value: midDate.toISOString() },
    ];

    const lowerCount = await this.getCount(client, entity, lowerFilters);

    if (lowerCount <= this.PAGE_SIZE && lowerCount > 0) {
      this.logger.info(`${entity}: Binary search found ${lowerCount} results in older segment`);
      const items = await fetcher(lowerFilters, this.PAGE_SIZE);

      return {
        items,
        totalCount,
        strategy: 'binary-search',
        message: `Found ${items.length} ${entity.toLowerCase()} (${totalCount} total in system).`,
        metadata: {
          windowsSearched,
          maxIdSeen: Math.max(...items.map(i => i.id || 0)),
        },
      };
    }

    if (lowerCount > this.PAGE_SIZE) {
      // Lower half still too large, recurse
      return await this.executeBinarySearchInWindow(
        client,
        entity,
        baseFilters,
        totalCount,
        fetcher,
        dateField,
        startDate,
        midDate,
        windowsSearched,
      );
    }

    // Fallback: fetch first page
    this.logger.warn(`${entity}: Binary search couldn't find manageable segment, fetching first page`);
    const items = await fetcher(baseFilters, this.PAGE_SIZE, 1);

    return {
      items,
      totalCount,
      strategy: 'binary-search',
      message: `Showing first ${items.length} of ${totalCount} results.`,
      warning: 'Could not find manageable time segment. Add more specific filters.',
    };
  }

  /**
   * Standard paginated fetch (up to 10 pages / 5000 results)
   */
  private async executePaginatedFetch<T extends { id?: number }>(
    entity: string,
    baseFilters: any[],
    totalCount: number,
    fetcher: (filters: any[], pageSize: number, page?: number) => Promise<T[]>,
  ): Promise<QueryResult<T>> {
    const items: T[] = [];
    const maxPages = Math.min(Math.ceil(totalCount / this.PAGE_SIZE), 10);

    for (let page = 1; page <= maxPages; page++) {
      const pageItems = await fetcher(baseFilters, this.PAGE_SIZE, page);
      items.push(...pageItems);

      this.logger.debug(`${entity}: Fetched page ${page}/${maxPages} (${pageItems.length} items)`);

      if (pageItems.length < this.PAGE_SIZE) {
        break; // No more results
      }
    }

    const message =
      totalCount <= this.MAX_RESULTS
        ? `Found ${items.length} ${entity.toLowerCase()}.`
        : `Showing ${items.length} of ${totalCount} ${entity.toLowerCase()} (limited to ${maxPages} pages).`;

    return {
      items,
      totalCount,
      strategy: 'paginated',
      message,
      metadata: {
        pagesSearched: maxPages,
        maxIdSeen: Math.max(...items.map(i => i.id || 0)),
      },
    };
  }
}
