/**
 * Entity Cache Service
 *
 * Aggressive caching for Autotask entities to minimize API calls.
 * - Persists cache to disk between runs
 * - Pre-populates reference entities (Companies, Contacts, Contracts, Resources) fully
 * - Pre-populates only last 7 days of Tickets
 * - Validates cached items against modification dates on startup
 * - Incremental updates based on modification dates (5min interval)
 */

import { AutotaskClient } from 'autotask-node';
import { Logger } from '../utils/logger.js';
import { ENTITY_MODIFICATION_FIELDS, EntityType } from '../types/autotask.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
 * Persisted cache metadata
 */
interface CacheMetadata {
  lastUpdate: string; // ISO timestamp
  maxId: number;
  count: number;
}

/**
 * Entity Cache Service
 *
 * Manages in-memory caches for frequently accessed entities with disk persistence.
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
  private cacheDir: string;

  // Track highest IDs seen for efficient incremental queries
  private maxIds: Map<EntityType, number>;

  // Track initialization state
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(logger: Logger, cacheDir?: string) {
    this.logger = logger;
    this.caches = new Map();
    this.lastFullRefresh = new Map();
    this.lastIncrementalCheck = new Map();
    this.cacheHits = new Map();
    this.cacheMisses = new Map();
    this.maxIds = new Map();

    // Default cache directory: ~/.autotask-mcp/cache
    this.cacheDir = cacheDir || path.join(os.homedir(), '.autotask-mcp', 'cache');

    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      this.logger.info(`Created cache directory: ${this.cacheDir}`);
    }

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
   * Get cache file path for an entity type
   */
  private getCacheFilePath(entityType: EntityType): string {
    return path.join(this.cacheDir, `${entityType.toLowerCase()}.json`);
  }

  /**
   * Get metadata file path for an entity type
   */
  private getMetadataFilePath(entityType: EntityType): string {
    return path.join(this.cacheDir, `${entityType.toLowerCase()}.meta.json`);
  }

  /**
   * Load cache from disk
   */
  private loadCache(entityType: EntityType): boolean {
    try {
      const cacheFile = this.getCacheFilePath(entityType);
      const metaFile = this.getMetadataFilePath(entityType);

      if (!fs.existsSync(cacheFile) || !fs.existsSync(metaFile)) {
        return false;
      }

      const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const metadata: CacheMetadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

      const cache = this.caches.get(entityType)!;

      // Restore cache entries
      Object.entries(cacheData).forEach(([idStr, entry]: [string, any]) => {
        const id = parseInt(idStr, 10);
        cache.set(id, {
          data: entry.data,
          cachedAt: new Date(entry.cachedAt),
          modifiedAt: entry.modifiedAt,
        });
      });

      // Restore metadata
      this.maxIds.set(entityType, metadata.maxId);
      this.lastIncrementalCheck.set(entityType, new Date(metadata.lastUpdate));

      this.logger.info(`${entityType}: Loaded ${cache.size} items from cache (max ID: ${metadata.maxId})`);
      return true;
    } catch (error) {
      this.logger.error(`${entityType}: Failed to load cache:`, error);
      return false;
    }
  }

  /**
   * Save cache to disk
   */
  private saveCache(entityType: EntityType): void {
    try {
      const cacheFile = this.getCacheFilePath(entityType);
      const metaFile = this.getMetadataFilePath(entityType);
      const cache = this.caches.get(entityType)!;

      // Convert cache to plain object
      const cacheData: Record<string, any> = {};
      cache.forEach((entry, id) => {
        cacheData[id] = {
          data: entry.data,
          cachedAt: entry.cachedAt.toISOString(),
          modifiedAt: entry.modifiedAt,
        };
      });

      // Create metadata
      const metadata: CacheMetadata = {
        lastUpdate: (this.lastIncrementalCheck.get(entityType) || new Date()).toISOString(),
        maxId: this.maxIds.get(entityType) || 0,
        count: cache.size,
      };

      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
      fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));

      this.logger.debug(`${entityType}: Saved ${cache.size} items to cache`);
    } catch (error) {
      this.logger.error(`${entityType}: Failed to save cache:`, error);
    }
  }

  /**
   * Pre-populate all caches on startup (non-blocking)
   *
   * Immediately loads persisted caches from disk, then performs validation
   * and updates in the background. Service starts immediately with stale
   * cache data if available, or with empty cache if not.
   */
  async initialize(client: AutotaskClient): Promise<void> {
    if (this.isInitializing || this.isInitialized) {
      // Already initializing or initialized, return existing promise or resolve immediately
      return this.initializationPromise || Promise.resolve();
    }

    this.isInitializing = true;

    // Step 1: Load persisted caches synchronously (fast, doesn't block)
    this.logger.info('Loading entity caches from disk...');
    const entities: EntityType[] = ['Companies', 'Contacts', 'Contracts', 'Resources', 'Tickets'];

    let loadedCount = 0;
    entities.forEach((entityType) => {
      const loaded = this.loadCache(entityType);
      if (loaded) {
        loadedCount++;
      }
    });

    this.logger.info(`Loaded ${loadedCount}/${entities.length} caches from disk (service ready)`);

    // Step 2: Start background validation and refresh (non-blocking)
    this.initializationPromise = this.initializeInBackground(client);

    // Service is ready immediately with stale/empty cache
    this.isInitialized = true;
    this.isInitializing = false;

    // Don't await - let it run in background
    this.initializationPromise.catch((error) => {
      this.logger.error('Background cache initialization failed:', error);
    });
  }

  /**
   * Background initialization - validates and updates caches without blocking startup
   */
  private async initializeInBackground(client: AutotaskClient): Promise<void> {
    this.logger.info('Starting background cache validation and update...');
    const startTime = Date.now();

    try {
      // Reference entities: Validate and update in background
      const referenceEntities: EntityType[] = ['Companies', 'Contacts', 'Contracts', 'Resources'];
      for (const entityType of referenceEntities) {
        try {
          const cache = this.caches.get(entityType)!;
          if (cache.size > 0) {
            // Have cached data, validate and update
            await this.validateAndUpdate(client, entityType);
          } else {
            // No cache, do full refresh
            await this.fullRefresh(client, entityType);
          }
        } catch (error) {
          this.logger.error(`Failed to refresh ${entityType} cache:`, error);
        }
      }

      // Tickets: Validate existing cache, then fetch recent tickets
      try {
        const ticketCache = this.caches.get('Tickets')!;
        if (ticketCache.size > 0) {
          // Validate cached tickets
          await this.validateAndUpdate(client, 'Tickets');
        }
        // Always fetch fresh tickets from last 7 days
        await this.refreshRecentTickets(client);
      } catch (error) {
        this.logger.error('Failed to refresh Tickets cache:', error);
      }

      const elapsed = Date.now() - startTime;
      this.logger.info(`Background cache refresh completed in ${elapsed}ms`);
    } catch (error) {
      this.logger.error('Background cache initialization encountered errors:', error);
    }
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
    this.lastIncrementalCheck.set(entityType, new Date());

    // Save to disk
    this.saveCache(entityType);

    this.logger.info(`${entityType}: Full refresh complete, cached ${cache.size} items (max ID: ${maxId})`);
  }

  /**
   * Validate cached items and update those that have been modified
   */
  private async validateAndUpdate(client: AutotaskClient, entityType: EntityType): Promise<void> {
    const cache = this.caches.get(entityType)!;
    const lastCheck = this.lastIncrementalCheck.get(entityType);

    if (!lastCheck || cache.size === 0) {
      return;
    }

    this.logger.debug(`${entityType}: Validating ${cache.size} cached items since ${lastCheck.toISOString()}`);

    const modField = ENTITY_MODIFICATION_FIELDS[entityType];
    const sinceDate = lastCheck.toISOString();

    try {
      // Fetch all items modified since last check
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await (client as any)[entityType.toLowerCase()].list({
          filter: [
            {
              field: modField,
              op: 'gte',
              value: sinceDate,
            },
          ],
          pageSize: 500,
          page,
        });

        const items = result.data || [];

        if (items.length === 0) {
          hasMore = false;
          break;
        }

        // Update cache with modified items
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

        if (items.length < 500) {
          hasMore = false;
        } else {
          page++;
        }

        // Safety limit
        if (page > 20) {
          this.logger.warn(`${entityType}: Stopped validation at page 20`);
          hasMore = false;
        }
      }

      this.lastIncrementalCheck.set(entityType, new Date());

      // Save updated cache
      this.saveCache(entityType);

      this.logger.info(`${entityType}: Validation complete`);
    } catch (error) {
      this.logger.error(`${entityType}: Validation failed:`, error);
    }
  }

  /**
   * Refresh recent tickets (last 7 days)
   */
  private async refreshRecentTickets(client: AutotaskClient): Promise<void> {
    this.logger.debug('Refreshing tickets from last 7 days');

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const cache = this.caches.get('Tickets')!;

    try {
      let page = 1;
      let hasMore = true;
      let fetchedCount = 0;

      while (hasMore) {
        const result = await (client as any).tickets.list({
          filter: [
            {
              field: 'createDate',
              op: 'gte',
              value: sevenDaysAgo.toISOString(),
            },
          ],
          pageSize: 500,
          page,
        });

        const tickets = result.data || [];

        if (tickets.length === 0) {
          hasMore = false;
          break;
        }

        // Cache recent tickets
        tickets.forEach((ticket: any) => {
          if (ticket.id) {
            cache.set(ticket.id, {
              data: ticket,
              cachedAt: new Date(),
              modifiedAt: ticket.lastTrackedModifiedDateTime,
            });

            const currentMaxId = this.maxIds.get('Tickets') || 0;
            if (ticket.id > currentMaxId) {
              this.maxIds.set('Tickets', ticket.id);
            }

            fetchedCount++;
          }
        });

        if (tickets.length < 500) {
          hasMore = false;
        } else {
          page++;
        }

        // Safety limit
        if (page > 50) {
          this.logger.warn('Tickets: Stopped at page 50 for recent tickets');
          hasMore = false;
        }
      }

      this.lastIncrementalCheck.set('Tickets', new Date());

      // Save updated cache
      this.saveCache('Tickets');

      this.logger.info(`Tickets: Refreshed ${fetchedCount} recent tickets (last 7 days)`);
    } catch (error) {
      this.logger.error('Tickets: Failed to refresh recent tickets:', error);
    }
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

      // Save if we updated anything
      if (items.length > 0) {
        this.saveCache(entityType);
      }

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
   * Note: Does not immediately persist - call saveAllCaches() to persist
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
   * Save all caches to disk
   */
  saveAllCaches(): void {
    const entities: EntityType[] = ['Companies', 'Contacts', 'Contracts', 'Resources', 'Tickets'];
    entities.forEach((entityType) => {
      this.saveCache(entityType);
    });
    this.logger.debug('All caches saved to disk');
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
