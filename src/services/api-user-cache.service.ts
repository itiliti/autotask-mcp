// API User Resource Cache
// Caches the resource ID for the API user to use as default when resource is required

import { promises as fs } from 'fs';
import { join } from 'path';
import { Logger } from '../utils/logger.js';

export interface ApiUserCache {
  email: string;
  resourceId: number;
  resourceName: string;
  lastUpdated: string;
}

export class ApiUserCacheService {
  private logger: Logger;
  private cacheFilePath: string;
  private cache: ApiUserCache | null = null;

  constructor(logger: Logger, cacheDir?: string) {
    this.logger = logger;
    // Store cache in user's home directory or specified directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    const baseCacheDir = cacheDir || join(homeDir, '.autotask-mcp');
    this.cacheFilePath = join(baseCacheDir, 'api-user-cache.json');
  }

  /**
   * Get cached resource ID for the API user
   * Returns null if cache doesn't exist or email doesn't match
   */
  async getCachedResourceId(currentEmail: string): Promise<number | null> {
    try {
      await this.loadCache();
      
      if (this.cache && this.cache.email === currentEmail) {
        this.logger.info(`Using cached resource ID ${this.cache.resourceId} for API user ${currentEmail}`);
        return this.cache.resourceId;
      }

      if (this.cache && this.cache.email !== currentEmail) {
        this.logger.info(`API user email changed from ${this.cache.email} to ${currentEmail}, cache invalidated`);
      }

      return null;
    } catch (error) {
      this.logger.debug('No valid cache found for API user resource ID:', error);
      return null;
    }
  }

  /**
   * Save resource ID to cache
   */
  async saveResourceId(email: string, resourceId: number, resourceName: string): Promise<void> {
    try {
      this.cache = {
        email,
        resourceId,
        resourceName,
        lastUpdated: new Date().toISOString(),
      };

      // Ensure directory exists
      const dir = join(this.cacheFilePath, '..');
      await fs.mkdir(dir, { recursive: true });

      // Write cache file
      await fs.writeFile(this.cacheFilePath, JSON.stringify(this.cache, null, 2), 'utf-8');
      
      this.logger.info(`Cached resource ID ${resourceId} for API user ${email} (${resourceName})`);
    } catch (error) {
      this.logger.warn('Failed to save API user cache:', error);
    }
  }

  /**
   * Get the cached resource (full object)
   */
  getCache(): ApiUserCache | null {
    return this.cache;
  }

  /**
   * Load cache from disk
   */
  private async loadCache(): Promise<void> {
    if (this.cache) {
      return; // Already loaded
    }

    try {
      const data = await fs.readFile(this.cacheFilePath, 'utf-8');
      this.cache = JSON.parse(data) as ApiUserCache;
      this.logger.debug('Loaded API user cache from disk');
    } catch (error) {
      // Cache file doesn't exist or is invalid, that's fine
      this.cache = null;
    }
  }

  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    try {
      await fs.unlink(this.cacheFilePath);
      this.cache = null;
      this.logger.info('API user cache cleared');
    } catch (error) {
      // File doesn't exist, that's fine
      this.logger.debug('No cache file to clear');
    }
  }
}
