/**
 * Query Counter Service
 *
 * Provides count-based query segmentation for large result sets.
 * When result counts exceed thresholds, automatically segments queries
 * by time periods (year/month) to provide manageable result sets.
 */

import { AutotaskClient } from 'autotask-node';
import { Logger } from '../../utils/logger.js';

/**
 * Result of a count query
 */
export interface QueryCountResult {
  count: number;
  exceedsThreshold: boolean;
  suggestedSegments?: DateSegment[];
}

/**
 * Date segment for time-based query segmentation
 */
export interface DateSegment {
  startDate: string; // ISO date
  endDate: string; // ISO date
  label: string; // e.g., "2024", "2024-12", "2024-Q4"
}

/**
 * Result from a segmented query execution
 */
export interface SegmentedQueryResult<T> {
  items: T[];
  totalCount: number;
  segments: SegmentResult[];
  isSegmented: boolean;
  message: string;
}

/**
 * Information about a single segment's results
 */
export interface SegmentResult {
  label: string;
  count: number;
  fetched: boolean;
}

/**
 * Configuration for query segmentation
 */
export interface SegmentationConfig {
  threshold: number; // Max results before segmentation
  dateField: string; // Field to segment on (e.g., 'createDate', 'lastActivityDate')
  entity: string; // Entity type (e.g., 'Tickets', 'Notes')
}

/**
 * Query Counter Service
 *
 * Handles counting query results and generating time-based segments
 * when result sets exceed manageable thresholds.
 */
export class QueryCounterService {
  private readonly logger: Logger;
  private readonly defaultThreshold = 200;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Get count of results for a query
   *
   * @param client - Autotask client instance
   * @param entity - Entity type (e.g., 'Tickets')
   * @param filters - Query filters
   * @returns Promise<number> - Count of matching records
   */
  async getCount(client: AutotaskClient, entity: string, filters: any[]): Promise<number> {
    try {
      this.logger.debug(`Getting count for ${entity} with filters:`, filters);

      // Use Autotask count endpoint: POST /v1.0/{Entity}/query/count
      const response = await (client as any).axios.post(`/${entity}/query/count`, {
        filter: filters,
      });

      const count = response.data?.queryCount ?? 0;
      this.logger.debug(`Count result for ${entity}: ${count}`);

      return count;
    } catch (error) {
      this.logger.error(`Failed to get count for ${entity}:`, error);
      // If count fails, return 0 and let normal query proceed
      return 0;
    }
  }

  /**
   * Generate time-based segments for a date range
   *
   * Generates yearly segments going backward from current date.
   * If a year segment would still exceed threshold, subdivides into months.
   *
   * @param totalCount - Total number of records
   * @param dateField - Field to segment on
   * @param threshold - Max results per segment
   * @returns Array of date segments
   */
  generateTimeSegments(totalCount: number, dateField: string, threshold: number = this.defaultThreshold): DateSegment[] {
    const segments: DateSegment[] = [];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-11

    // Estimate how many segments we need
    // Simple heuristic: divide total by threshold, add some buffer
    const estimatedSegmentsNeeded = Math.ceil(totalCount / threshold);

    // Start with current year/month and work backward
    let year = currentYear;
    let month = currentMonth;

    // Generate segments going backward in time
    // Start with monthly segments for recent data
    for (let i = 0; i < estimatedSegmentsNeeded && i < 36; i++) {
      // Limit to 36 months (3 years)
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0, 23, 59, 59); // Last day of month

      segments.push({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        label: `${year}-${String(month + 1).padStart(2, '0')}`,
      });

      // Move to previous month
      month--;
      if (month < 0) {
        month = 11;
        year--;
      }
    }

    this.logger.debug(`Generated ${segments.length} time segments for ${dateField}`);
    return segments;
  }

  /**
   * Execute a segmented query
   *
   * Fetches the first segment that contains results, provides metadata
   * about all segments for caller guidance.
   *
   * @param client - Autotask client
   * @param config - Segmentation configuration
   * @param baseFilters - Base query filters (without date range)
   * @param fetcher - Function to fetch results for a given set of filters
   * @returns Promise<SegmentedQueryResult<T>> - Results with segmentation metadata
   */
  async executeSegmentedQuery<T>(
    client: AutotaskClient,
    config: SegmentationConfig,
    baseFilters: any[],
    fetcher: (filters: any[]) => Promise<T[]>,
  ): Promise<SegmentedQueryResult<T>> {
    const { threshold, dateField, entity } = config;

    // Get total count
    const totalCount = await this.getCount(client, entity, baseFilters);

    // If count is below threshold, no segmentation needed
    if (totalCount <= threshold) {
      this.logger.debug(`Count ${totalCount} is below threshold ${threshold}, no segmentation needed`);
      const items = await fetcher(baseFilters);

      return {
        items,
        totalCount,
        segments: [],
        isSegmented: false,
        message: `Found ${totalCount} results.`,
      };
    }

    // Generate time segments
    const segments = this.generateTimeSegments(totalCount, dateField, threshold);
    const segmentResults: SegmentResult[] = [];

    // Try to fetch from the first (most recent) segment
    let fetchedItems: T[] = [];
    let fetchedSegment: DateSegment | null = null;

    for (const segment of segments) {
      // Add date range filter for this segment
      const segmentFilters = [
        ...baseFilters,
        {
          op: 'gte',
          field: dateField,
          value: segment.startDate,
        },
        {
          op: 'lte',
          field: dateField,
          value: segment.endDate,
        },
      ];

      // Get count for this segment
      const segmentCount = await this.getCount(client, entity, segmentFilters);

      segmentResults.push({
        label: segment.label,
        count: segmentCount,
        fetched: false,
      });

      // Fetch from first segment with results
      if (!fetchedSegment && segmentCount > 0) {
        this.logger.debug(`Fetching results from segment ${segment.label} (${segmentCount} results)`);
        fetchedItems = await fetcher(segmentFilters);
        fetchedSegment = segment;
        segmentResults[segmentResults.length - 1].fetched = true;
      }
    }

    // Build helpful message
    const message = fetchedSegment
      ? `Found ${totalCount} total results. Showing ${fetchedItems.length} from ${fetchedSegment.label}. ` +
        `Use ${dateField}From/${dateField}To filters for other periods.`
      : `Found ${totalCount} total results but none in recent segments. Use ${dateField}From/${dateField}To filters to search specific periods.`;

    return {
      items: fetchedItems,
      totalCount,
      segments: segmentResults,
      isSegmented: true,
      message,
    };
  }

  /**
   * Check if a query needs segmentation
   *
   * @param client - Autotask client
   * @param entity - Entity type
   * @param filters - Query filters
   * @param threshold - Count threshold
   * @returns Promise<QueryCountResult> - Count and segmentation recommendation
   */
  async checkSegmentation(
    client: AutotaskClient,
    entity: string,
    filters: any[],
    threshold: number = this.defaultThreshold,
  ): Promise<QueryCountResult> {
    const count = await this.getCount(client, entity, filters);
    const exceedsThreshold = count > threshold;

    const result: QueryCountResult = {
      count,
      exceedsThreshold,
    };

    if (exceedsThreshold) {
      result.suggestedSegments = this.generateTimeSegments(count, 'createDate', threshold);
    }

    return result;
  }
}
