/**
 * Entity Cache Service
 *
 * Aggressive caching for Autotask entities to minimize API calls.
 * Pre-populates common entities (Companies, Contacts, Contracts, Resources, Tickets)
 * on startup and maintains them using incremental updates based on modification dates.
 */

import { AutotaskClient } from 'autotask-node';
import { Logger } from '../utils/logger.js';
import { ENTITY_MODIFICATION_FIELDS, EntityType } from '../types/autotask.js';

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  data: T;
  cachedAt: Date;
  modifiedAt?: string; // The entity's modification date
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  entityType: string;
  count: number;
  lastRefresh: Date | null;
  nextRefresh: Date | null;
  hitRate: number;
}

/**
 * Entity Cache Service
 *
 * Manages in-memory caches for frequently accessed entities.
 * Refreshes based on modification dates rather than time-based expiry.
 */
export class EntityCacheService {
  private logger: Logger;
  private caches: Map<EntityType, Map<number, CacheEntry<any>>>;
  private lastFullRefresh: Map<EntityType, Date>;
  private lastIncrementalCheck: Map<EntityType, Date>;
  private cacheHits: Map<EntityType, number>;
  private cacheMisses: Map<EntityType, number>;
  private refreshInterval: number = 5 * 60 * 1000; // 5 minutes

  // Track highest IDs seen for efficient incremental queries
  private maxIds: Map<EntityType, number>;

  constructor(logger: Logger) {
    this.logger = logger;
    this.caches = new Map();
    this.lastFullRefresh = new Map();
    this.lastIncrementalCheck = new Map();
    this.cacheHits = new Map();
    this.cacheMisses = new Map();
    this.maxIds = new Map();

    // Initialize caches for all entity types
    const entities: EntityType[] = ['Companies', 'Contacts', 'Contracts', 'Resources', 'Tickets'];
    entities.forEach((entityType) => {
      this.caches.set(entityType, new Map());
      this.cacheHits.set(entityType, 0);
      this.cacheMisses.set(entityType, 0);
      this.maxIds.set(entityType, 0);
    });
  }

  /**
   * Pre-populate all caches on startup
   */
  async initialize(client: AutotaskClient): Promise<void> {
    this.logger.info('Pre-populating entity caches...');

    const startTime = Date.now();
    const entities: EntityType[] = ['Companies', 'Contacts', 'Contracts', 'Resources'];

    // Pre-populate reference entities first (not tickets)
    for (const entityType of entities) {
      try {
        await this.fullRefresh(client, entityType);
      } catch (error) {
        this.logger.error(`Failed to pre-populate ${entityType} cache:`, error);
      }
    }

    const elapsed = Date.now() - startTime;
    this.logger.info(`Entity caches initialized in ${elapsed}ms`);
  }

  /**
   * Perform a full refresh of an entity cache
   */
  private async fullRefresh(client: AutotaskClient, entityType: EntityType): Promise<void> {
    this.logger.debug(`Performing full refresh of ${entityType} cache`);

    const cache = this.caches.get(entityType)!;
    cache.clear();

    let maxId = 0;
    let page = 1;
    const pageSize = 500;
    let hasMore = true;

    while (hasMore) {
      const result = await (client as any)[entityType.toLowerCase()].list({
        pageSize,
        page,
      });

      const items = result.data || [];

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      // Cache each item
      items.forEach((item: any) => {
        if (item.id) {
          const modField = ENTITY_MODIFICATION_FIELDS[entityType];
          cache.set(item.id, {
            data: item,
            cachedAt: new Date(),
            modifiedAt: item[modField],
          });

          // Track max ID
          if (item.id > maxId) {
            maxId = item.id;
          }
        }
      });

      this.logger.debug(`${entityType}: Cached page ${page} (${items.length} items)`);

      if (items.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }

      // Safety limit
      if (page > 100) {
        this.logger.warn(`${entityType}: Stopped at page 100 for safety`);
        hasMore = false;
      }
    }

    this.maxIds.set(entityType, maxId);
    this.lastFullRefresh.set(entityType, new Date());

    this.logger.info(`${entityType}: Full refresh complete, cached ${cache.size} items (max ID: ${maxId})`);
  }

  /**
   * Perform an incremental refresh using modification dates
   */
  private async incrementalRefresh(client: AutotaskClient, entityType: EntityType): Promise<void> {
    const cache = this.caches.get(entityType)!;
    const lastCheck = this.lastIncrementalCheck.get(entityType);

    if (!lastCheck) {
      // No previous check, do full refresh
      await this.fullRefresh(client, entityType);
      return;
    }

    this.logger.debug(`Performing incremental refresh of ${entityType} since ${lastCheck.toISOString()}`);

    const modField = ENTITY_MODIFICATION_FIELDS[entityType];
    const sinceDate = lastCheck.toISOString();

    try {
      // Query for items modified since last check
      const result = await (client as any)[entityType.toLowerCase()].list({
        filter: [
          {
            field: modField,
            op: 'gte',
            value: sinceDate,
          },
        ],
        pageSize: 500,
      });

      const items = result.data || [];

      items.forEach((item: any) => {
        if (item.id) {
          cache.set(item.id, {
            data: item,
            cachedAt: new Date(),
            modifiedAt: item[modField],
          });

          // Update max ID if needed
          const currentMaxId = this.maxIds.get(entityType) || 0;
          if (item.id > currentMaxId) {
            this.maxIds.set(entityType, item.id);
          }
        }
      });

      this.lastIncrementalCheck.set(entityType, new Date());

      this.logger.debug(`${entityType}: Incremental refresh updated ${items.length} items`);
    } catch (error) {
      this.logger.error(`${entityType}: Incremental refresh failed:`, error);
    }
  }

  /**
   * Check if cache needs refresh (every 5 minutes for tickets before query)
   */
  async checkAndRefresh(client: AutotaskClient, entityType: EntityType): Promise<void> {
    const lastCheck = this.lastIncrementalCheck.get(entityType);
    const now = new Date();

    if (!lastCheck || now.getTime() - lastCheck.getTime() > this.refreshInterval) {
      await this.incrementalRefresh(client, entityType);
    }
  }

  /**
   * Get an entity from cache
   */
  get<T>(entityType: EntityType, id: number): T | null {
    const cache = this.caches.get(entityType);
    if (!cache) return null;

    const entry = cache.get(id);
    if (entry) {
      this.cacheHits.set(entityType, (this.cacheHits.get(entityType) || 0) + 1);
      return entry.data as T;
    }

    this.cacheMisses.set(entityType, (this.cacheMisses.get(entityType) || 0) + 1);
    return null;
  }

  /**
   * Get multiple entities from cache
   */
  getMany<T>(entityType: EntityType, ids: number[]): Map<number, T> {
    const results = new Map<number, T>();
    ids.forEach((id) => {
      const item = this.get<T>(entityType, id);
      if (item) {
        results.set(id, item);
      }
    });
    return results;
  }

  /**
   * Get all cached entities of a type
   */
  getAll<T>(entityType: EntityType): T[] {
    const cache = this.caches.get(entityType);
    if (!cache) return [];

    return Array.from(cache.values()).map((entry) => entry.data as T);
  }

  /**
   * Manually set a cache entry (for newly created/updated entities)
   */
  set(entityType: EntityType, id: number, data: any): void {
    const cache = this.caches.get(entityType);
    if (!cache) return;

    const modField = ENTITY_MODIFICATION_FIELDS[entityType];
    cache.set(id, {
      data,
      cachedAt: new Date(),
      modifiedAt: data[modField],
    });

    // Update max ID if needed
    const currentMaxId = this.maxIds.get(entityType) || 0;
    if (id > currentMaxId) {
      this.maxIds.set(entityType, id);
    }
  }

  /**
   * Remove an entity from cache
   */
  delete(entityType: EntityType, id: number): void {
    const cache = this.caches.get(entityType);
    if (!cache) return;

    cache.delete(id);
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.caches.forEach((cache) => cache.clear());
    this.lastFullRefresh.clear();
    this.lastIncrementalCheck.clear();
    this.maxIds.clear();
    this.logger.info('All entity caches cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats[] {
    const stats: CacheStats[] = [];

    this.caches.forEach((cache, entityType) => {
      const hits = this.cacheHits.get(entityType) || 0;
      const misses = this.cacheMisses.get(entityType) || 0;
      const total = hits + misses;
      const hitRate = total > 0 ? hits / total : 0;

      const lastRefresh = this.lastIncrementalCheck.get(entityType) || null;
      const nextRefresh = lastRefresh ? new Date(lastRefresh.getTime() + this.refreshInterval) : null;

      stats.push({
        entityType,
        count: cache.size,
        lastRefresh,
        nextRefresh,
        hitRate,
      });
    });

    return stats;
  }

  /**
   * Get the highest ID seen for an entity type
   */
  getMaxId(entityType: EntityType): number {
    return this.maxIds.get(entityType) || 0;
  }
}
