// Rate Limiter Service
// Manages API thread limiting and threshold monitoring per Autotask guidelines
// https://autotask.net/help/developerhelp/Content/APIs/General/ThreadLimiting.htm

import { Logger } from '../utils/logger.js';

export interface ThresholdInfo {
  requestCount: number;
  requestLimit: number;
  percentageUsed: number;
  timeRemaining: string;
}

export interface RateLimiterConfig {
  maxConcurrentRequests: number; // Default: 2 (per Autotask guidelines)
  thresholdCheckInterval: number; // Check every N API calls (default: 19)
  highUsageThreshold: number; // Percentage to trigger warnings (default: 50)
  criticalUsageThreshold: number; // Percentage to force immediate check (default: 80)
  minimumCallsRemaining: number; // Block requests when calls remaining < this (default: 100)
}

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class RateLimiterService {
  private logger: Logger;
  private config: RateLimiterConfig;
  private activeRequests: number = 0;
  private requestQueue: QueuedRequest<unknown>[] = [];
  private apiCallCount: number = 0; // Track API calls since last threshold check
  private currentThreshold: ThresholdInfo | null = null;
  private isHighUsage: boolean = false;
  private isLowCallsRemaining: boolean = false;
  private thresholdCheckPromise: Promise<ThresholdInfo | null> | null = null;

  constructor(logger: Logger, config?: Partial<RateLimiterConfig>) {
    this.logger = logger;
    this.config = {
      maxConcurrentRequests: config?.maxConcurrentRequests ?? 2,
      thresholdCheckInterval: config?.thresholdCheckInterval ?? 19, // Check every 19 API calls
      highUsageThreshold: config?.highUsageThreshold ?? 50,
      criticalUsageThreshold: config?.criticalUsageThreshold ?? 80,
      minimumCallsRemaining: config?.minimumCallsRemaining ?? 100,
    };
  }

  /**
   * Execute a request with rate limiting
   */
  async executeWithRateLimit<T>(
    request: () => Promise<T>,
    endpoint?: string
  ): Promise<T> {
    // Check if we have enough API calls remaining
    if (this.isLowCallsRemaining) {
      const remaining = this.currentThreshold 
        ? this.currentThreshold.requestLimit - this.currentThreshold.requestCount
        : 0;
      throw new Error(
        `API rate limit protection: Less than ${this.config.minimumCallsRemaining} calls remaining (${remaining} left). ` +
        `Please wait for the limit to reset. Time remaining: ${this.currentThreshold?.timeRemaining || 'unknown'}`
      );
    }

    // If last check showed usage ≥80% and we haven't checked recently, force a threshold check
    const isCriticalUsage = this.currentThreshold && 
      this.currentThreshold.percentageUsed >= this.config.criticalUsageThreshold;
    
    if (isCriticalUsage && this.apiCallCount === 0) {
      // Just completed a check or first call in critical zone - allow 9 calls before next check
      this.logger.debug(
        `Usage at ${this.currentThreshold!.percentageUsed.toFixed(1)}% (≥${this.config.criticalUsageThreshold}%) - will check again after 9 calls`
      );
    } else if (isCriticalUsage && this.apiCallCount >= 9) {
      // In critical zone and hit 9 call limit - force check now
      this.logger.debug(
        `Critical usage: forcing threshold check after 9 calls`
      );
      await this.maybeCheckThresholds(true);
    } else {
      // Normal flow: check thresholds every 19 API calls (the check itself counts as 1 call)
      await this.maybeCheckThresholds();
    }

    // If we're at capacity, queue the request
    if (this.activeRequests >= this.config.maxConcurrentRequests) {
      this.logger.debug(
        `Rate limit reached (${this.activeRequests}/${this.config.maxConcurrentRequests}), queueing request${endpoint ? ` for ${endpoint}` : ''}`
      );
      return this.queueRequest(request);
    }

    // Increment API call counter
    this.apiCallCount++;

    // Execute immediately
    return this.executeRequest(request, endpoint);
  }

  /**
   * Update threshold information from Autotask API
   */
  async updateThresholdInfo(thresholdInfo: ThresholdInfo): Promise<void> {
    this.currentThreshold = thresholdInfo;
    this.apiCallCount = 0; // Reset counter after check

    const wasHighUsage = this.isHighUsage;
    this.isHighUsage = thresholdInfo.percentageUsed >= this.config.highUsageThreshold;

    // Check if we're running low on API calls
    const callsRemaining = thresholdInfo.requestLimit - thresholdInfo.requestCount;
    const wasLowCalls = this.isLowCallsRemaining;
    this.isLowCallsRemaining = callsRemaining < this.config.minimumCallsRemaining;

    // Log threshold status
    this.logger.info(
      `API Usage: ${thresholdInfo.requestCount}/${thresholdInfo.requestLimit} (${thresholdInfo.percentageUsed.toFixed(1)}%) - ` +
      `Remaining: ${callsRemaining} calls - Time remaining: ${thresholdInfo.timeRemaining}`
    );

    // Critical: Block all requests if calls remaining < 100
    if (this.isLowCallsRemaining) {
      if (!wasLowCalls) {
        this.logger.error(
          `🚫 CRITICAL: Less than ${this.config.minimumCallsRemaining} API calls remaining (${callsRemaining} left)! ` +
          `All requests blocked until limit resets. Time remaining: ${thresholdInfo.timeRemaining}`
        );
      }
      return; // Don't adjust threads, just block everything
    } else if (wasLowCalls) {
      this.logger.info(
        `✓ API calls recovered above ${this.config.minimumCallsRemaining} threshold - resuming normal operations`
      );
    }

    // Warn if usage is high
    if (this.isHighUsage) {
      if (!wasHighUsage) {
        this.logger.warn(
          `⚠️  API usage above ${this.config.highUsageThreshold}% threshold - switching to single-thread mode to conserve rate limit`
        );
        // Reduce concurrent requests to 1
        this.config.maxConcurrentRequests = 1;
      }
    } else if (wasHighUsage) {
      // Usage dropped below threshold, restore normal operations
      this.logger.info(
        `✓ API usage back below ${this.config.highUsageThreshold}% - restoring normal thread count`
      );
      this.config.maxConcurrentRequests = 2;
    }
  }

  /**
   * Get current threshold information
   */
  getThresholdInfo(): ThresholdInfo | null {
    return this.currentThreshold;
  }

  /**
   * Get current rate limiter status
   */
  getStatus() {
    const callsRemaining = this.currentThreshold
      ? this.currentThreshold.requestLimit - this.currentThreshold.requestCount
      : null;
    
    return {
      activeRequests: this.activeRequests,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      queuedRequests: this.requestQueue.length,
      isHighUsage: this.isHighUsage,
      isBlocked: this.isLowCallsRemaining,
      apiCallsSinceCheck: this.apiCallCount,
      callsRemaining: callsRemaining,
      threshold: this.currentThreshold,
    };
  }

  /**
   * Check if we should fetch updated threshold information
   * Checks every 19 API calls (the check itself counts as 1 call = 20 total)
   * Or immediately if forceCheck is true (when usage ≥80%)
   */
  private async maybeCheckThresholds(forceCheck: boolean = false): Promise<void> {
    // Check every 19 API calls, or immediately if forced
    if (!forceCheck && this.apiCallCount < this.config.thresholdCheckInterval) {
      return;
    }

    // Don't start a new check if one is already in progress
    if (this.thresholdCheckPromise) {
      await this.thresholdCheckPromise;
      return;
    }

    // Signal that a check is needed (handled by AutotaskService)
    // The check will reset apiCallCount when updateThresholdInfo is called
  }

  /**
   * Signal that a threshold check is starting (from external caller)
   */
  startThresholdCheck(): void {
    // No-op, kept for compatibility
  }

  /**
   * Check if a threshold check is needed
   * Returns true if call count reached (19 normal, 9 if critical usage ≥80%)
   */
  shouldCheckThresholds(): boolean {
    const isCriticalUsage = this.currentThreshold 
      ? this.currentThreshold.percentageUsed >= this.config.criticalUsageThreshold
      : false;
    
    const threshold = isCriticalUsage ? 9 : this.config.thresholdCheckInterval;
    const callCountReached = this.apiCallCount >= threshold;
    
    return callCountReached && !this.thresholdCheckPromise;
  }

  /**
   * Execute a request immediately
   */
  private async executeRequest<T>(
    request: () => Promise<T>,
    endpoint?: string
  ): Promise<T> {
    this.activeRequests++;
    this.logger.debug(
      `Executing request (active: ${this.activeRequests}/${this.config.maxConcurrentRequests})${endpoint ? ` for ${endpoint}` : ''}`
    );

    try {
      const result = await request();
      return result;
    } finally {
      this.activeRequests--;
      this.logger.debug(
        `Request completed (active: ${this.activeRequests}/${this.config.maxConcurrentRequests})`
      );
      this.processQueue();
    }
  }

  /**
   * Queue a request for later execution
   */
  private queueRequest<T>(request: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push({
        execute: request as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.logger.debug(`Request queued (queue size: ${this.requestQueue.length})`);
    });
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    // Process as many queued requests as we have capacity for
    while (
      this.requestQueue.length > 0 &&
      this.activeRequests < this.config.maxConcurrentRequests
    ) {
      const queued = this.requestQueue.shift();
      if (queued) {
        this.logger.debug(
          `Processing queued request (remaining: ${this.requestQueue.length})`
        );
        this.executeRequest(queued.execute)
          .then(queued.resolve)
          .catch(queued.reject);
      }
    }
  }
}
