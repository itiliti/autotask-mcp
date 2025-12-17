# Smart Query Optimization Plan

**STATUS**: ✅ IMPLEMENTED AND ARCHIVED
**Date Archived**: 2025-12-17
**New Plan Location**: `.claude/plans/smart-query-optimization-plan.md`

---

## Overview

This plan addresses multiple issues identified in the smart query system:
1. Incorrect pagination limits (needs 1000 soft, 5000 hard instead of current 5000/50,000)
2. Filter inefficiency (6 separate 'ne' filters instead of 1 'not in' filter)
3. Enhancement inefficiency (individual lookups instead of batch operations)
4. Investigation of "30 pages" pagination issue

## Research Findings

### Current Pagination Limits

**QueryCounterService** ([src/services/core/query-counter.service.ts:40-45](src/services/core/query-counter.service.ts#L40-L45)):
```typescript
private readonly PAGE_SIZE = 500;
private readonly WARN_THRESHOLD = 2500; // 5 pages
private readonly MAX_RESULTS = 5000; // 10 pages
```

**TicketService Unlimited Mode** ([src/services/entities/ticket.service.ts:287-292](src/services/entities/ticket.service.ts#L287-L292)):
```typescript
if (currentPage > 100) {
  this.logger.warn('Pagination safety limit reached at 100 pages (50,000 tickets)');
  hasMorePages = false;
}
```

**Issue**: User wants soft limit of 1000 (trigger count query) and hard limit of 5000 (absolute max).

### Filter Inefficiency Found

**Location**: [src/services/entities/ticket.service.ts:126-132](src/services/entities/ticket.service.ts#L126-L132)

**Current Code**:
```typescript
const closedStatuses = [5, 20, 21, 24, 26, 27];
closedStatuses.forEach((statusId) => {
  filters.push({
    op: 'ne',
    field: 'status',
    value: statusId,
  });
});
```

**Problem**: Pushes 6 separate filters instead of using single 'not in' operator.

**Solution**: Replace with:
```typescript
filters.push({
  op: 'not in',
  field: 'status',
  value: CLOSED_TICKET_STATUSES, // [5, 20, 21, 24, 26, 27]
});
```

### Enhancement Optimization Opportunity

**MappingService Pattern** ([src/utils/mapping.service.ts:139-167](src/utils/mapping.service.ts#L139-L167)):
```typescript
async getCompanyNames(companyIds: number[]): Promise<(string | null)[]> {
  return Promise.all(companyIds.map(id => this.getCompanyName(id)));
}
```

**Problem**: Does individual lookups instead of batch operations.

**Solution**: Use EntityCacheService.getManyWithFallback() which already implements efficient batch fetching with 'in' operator ([src/services/entity-cache.service.ts:664-737](src/services/entity-cache.service.ts#L664-L737)).

### "30 Pages" Investigation

**Exploration Result**: No code path allows 30 pages in smart query mode. Maximum is:
- Smart query: 10 pages (5000 results) via [src/services/core/query-counter.service.ts:382](src/services/core/query-counter.service.ts#L382)
- Unlimited mode: 100 pages (50,000 results) via [src/services/entities/ticket.service.ts:287-292](src/services/entities/ticket.service.ts#L287-L292)

**Possible explanations**:
1. User observed unlimited mode with `pageSize: -1`
2. User observed reverse time-window search iterating through multiple windows
3. Logging may have shown page numbers within individual time windows

**Action**: Need user clarification on exact scenario that produced 30 pages.

## Implementation Plan

### Task 0: Fix Ticket Cache to Use lastTrackedModifiedDateTime (NEW REQUIREMENT)

**File**: [src/services/entity-cache.service.ts](src/services/entity-cache.service.ts)

**Problem**: Current implementation caches tickets based on `createDate` (line 446), but should use `lastTrackedModifiedDateTime` to capture recently modified tickets, not just newly created ones.

**New Caching Strategy**:
1. **Initial cache**: Fetch tickets modified in last 7 days
2. **Lazy loading**: When cache misses occur, fetch next 7 days of history (+ anything modified since last refresh)
3. **Goal**: Build up to 30 days of "active" tickets (30 days that have tickets in them, not just 30 calendar days)

**Changes**:

1. **Add tracking for ticket cache depth** (Add after line 72):
```typescript
// Track ticket cache depth (how many days back we've cached)
private ticketCacheDaysLoaded: number = 0;
private readonly TICKET_CACHE_INITIAL_DAYS = 7;
private readonly TICKET_CACHE_INCREMENT_DAYS = 7;
private readonly TICKET_CACHE_MAX_DAYS = 30; // Max days of active tickets to cache
```

2. **Update refreshRecentTickets to use lastTrackedModifiedDateTime** (Lines 429-501):
```typescript
/**
 * Refresh recent tickets (last 7 days by modification date)
 *
 * Fetches tickets modified in the last 7 days, then can lazily load
 * additional 7-day windows on demand until reaching 30 days of active tickets.
 */
private async refreshRecentTickets(client: AutotaskClient, daysBack: number = 7): Promise<void> {
  this.logger.debug(`Refreshing tickets modified in last ${daysBack} days`);

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysBack);

  const cache = this.caches.get('Tickets')!;

  try {
    let page = 1;
    let hasMore = true;
    let fetchedCount = 0;

    while (hasMore) {
      const result = await (client as any).tickets.list({
        filter: [
          {
            field: 'lastTrackedModifiedDateTime',
            op: 'gte',
            value: targetDate.toISOString(),
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

    // Update tracking
    if (daysBack > this.ticketCacheDaysLoaded) {
      this.ticketCacheDaysLoaded = daysBack;
    }
    this.lastIncrementalCheck.set('Tickets', new Date());

    // Save updated cache
    this.saveCache('Tickets');

    this.logger.info(`Tickets: Refreshed ${fetchedCount} tickets modified in last ${daysBack} days (cache depth: ${this.ticketCacheDaysLoaded} days)`);
  } catch (error) {
    this.logger.error('Tickets: Failed to refresh recent tickets:', error);
  }
}
```

3. **Add method to lazy-load more ticket history** (New method after refreshRecentTickets):
```typescript
/**
 * Lazy-load additional ticket history (7 more days)
 *
 * Called when cache misses occur and we haven't reached the 30-day limit.
 * Fetches the next 7-day window PLUS anything modified since last refresh.
 */
async lazyLoadMoreTickets(client: AutotaskClient): Promise<void> {
  if (this.ticketCacheDaysLoaded >= this.TICKET_CACHE_MAX_DAYS) {
    this.logger.debug('Tickets: Already at max cache depth (30 days), skipping lazy load');
    return;
  }

  const newDaysBack = Math.min(
    this.ticketCacheDaysLoaded + this.TICKET_CACHE_INCREMENT_DAYS,
    this.TICKET_CACHE_MAX_DAYS
  );

  this.logger.info(`Tickets: Lazy-loading additional history (${this.ticketCacheDaysLoaded} → ${newDaysBack} days)`);

  // Fetch tickets from the NEW window (previous load point to new load point)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - newDaysBack);

  const endDate = new Date();
  endDate.setDate(endDate.getDate() - this.ticketCacheDaysLoaded);

  const cache = this.caches.get('Tickets')!;

  try {
    let page = 1;
    let hasMore = true;
    let fetchedCount = 0;

    while (hasMore) {
      // Use OR filter: modified in new window OR modified since last check
      const lastCheck = this.lastIncrementalCheck.get('Tickets');
      const filters: any[] = [
        {
          field: 'lastTrackedModifiedDateTime',
          op: 'gte',
          value: startDate.toISOString(),
        },
      ];

      // Also include anything modified since last refresh (to catch updates)
      if (lastCheck) {
        filters.push({
          field: 'lastTrackedModifiedDateTime',
          op: 'gte',
          value: lastCheck.toISOString(),
        });
      }

      const result = await (client as any).tickets.list({
        filter: filters,
        pageSize: 500,
        page,
      });

      const tickets = result.data || [];

      if (tickets.length === 0) {
        hasMore = false;
        break;
      }

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
        this.logger.warn('Tickets: Stopped at page 50 during lazy load');
        hasMore = false;
      }
    }

    this.ticketCacheDaysLoaded = newDaysBack;
    this.lastIncrementalCheck.set('Tickets', new Date());
    this.saveCache('Tickets');

    this.logger.info(`Tickets: Lazy-loaded ${fetchedCount} tickets (cache now at ${this.ticketCacheDaysLoaded} days)`);
  } catch (error) {
    this.logger.error('Tickets: Lazy load failed:', error);
  }
}
```

4. **Update getWithFallback to trigger lazy loading** (Lines 272-313):
```typescript
async getWithFallback<T>(client: AutotaskClient, entityType: EntityType, id: number): Promise<T | null> {
  // Try cache first
  const cached = this.get<T>(entityType, id);
  if (cached) return cached;

  // Cache miss
  const hasFullCache = entityType !== 'Tickets';
  const maxId = this.maxIds.get(entityType) || 0;

  // For full caches, only query API if ID is within range or beyond max
  if (hasFullCache && maxId > 0 && id > maxId) {
    this.logger.debug(`${entityType}: ID ${id} beyond maxId ${maxId}, skipping API call`);
    return null;
  }

  // Try API fetch
  try {
    this.logger.debug(`${entityType}: Cache miss for ID ${id}, querying API`);
    const result = await (client as any)[entityType.toLowerCase()].get(id);
    const item = result.data as T;

    if (item) {
      // Cache the result
      this.set(entityType, id, item);

      // For tickets: trigger lazy load if under 30 days
      if (entityType === 'Tickets' && this.ticketCacheDaysLoaded < this.TICKET_CACHE_MAX_DAYS) {
        // Non-blocking lazy load in background
        this.lazyLoadMoreTickets(client).catch((error) => {
          this.logger.error('Background lazy load failed:', error);
        });
      } else if (hasFullCache) {
        // For reference entities: trigger incremental refresh
        this.triggerIncrementalRefresh(client, entityType);
      }

      return item;
    }

    return null;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    this.logger.error(`${entityType}: Failed to fetch ID ${id} from API:`, error);
    return null;
  }
}
```

5. **Update constructor to initialize tracking** (Line 100):
```typescript
constructor(logger: Logger, cacheDir?: string) {
  this.logger = logger;
  this.caches = new Map();
  this.lastFullRefresh = new Map();
  this.lastIncrementalCheck = new Map();
  this.cacheHits = new Map();
  this.cacheMisses = new Map();
  this.maxIds = new Map();
  this.ticketCacheDaysLoaded = 0; // Add this line

  // ... rest of constructor
}
```

6. **Update cache persistence to include days loaded** (Lines 158-188):
```typescript
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
      daysLoaded: entityType === 'Tickets' ? this.ticketCacheDaysLoaded : undefined, // Add this
    };

    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
    fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));

    this.logger.debug(`${entityType}: Saved ${cache.size} items to cache`);
  } catch (error) {
    this.logger.error(`${entityType}: Failed to save cache:`, error);
  }
}
```

7. **Update CacheMetadata interface** (Lines 44-48):
```typescript
interface CacheMetadata {
  lastUpdate: string; // ISO timestamp
  maxId: number;
  count: number;
  daysLoaded?: number; // For Tickets: how many days back we've cached
}
```

8. **Update loadCache to restore days loaded** (Lines 119-153):
```typescript
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

    // Restore ticket cache depth
    if (entityType === 'Tickets' && metadata.daysLoaded) {
      this.ticketCacheDaysLoaded = metadata.daysLoaded;
    }

    this.logger.info(`${entityType}: Loaded ${cache.size} items from cache (max ID: ${metadata.maxId}${entityType === 'Tickets' && metadata.daysLoaded ? `, ${metadata.daysLoaded} days` : ''})`);
    return true;
  } catch (error) {
    this.logger.error(`${entityType}: Failed to load cache:`, error);
    return false;
  }
}
```

**Summary**: This changes the ticket caching strategy to:
- Start with 7 days of modified tickets (not created tickets)
- Automatically load more history (7 days at a time) when cache misses occur
- Stop at 30 days of active ticket history
- Always include recently modified tickets in each refresh

### Task 1: Fix Pagination Limits in QueryCounterService

**File**: [src/services/core/query-counter.service.ts](src/services/core/query-counter.service.ts)

**Changes**:

1. **Update constants** (Lines 40-42):
```typescript
private readonly PAGE_SIZE = 500;
private readonly SOFT_LIMIT = 1000; // 2 pages - triggers count query
private readonly HARD_LIMIT = 5000; // 10 pages - absolute maximum
```

2. **Add soft limit check with count query** (Lines 90-104):
```typescript
async executeSmartQuery<T extends { id?: number }>(...): Promise<QueryResult<T>> {
  // Get total count for small result sets
  let totalCount = await this.getCount(client, entity, baseFilters);

  // Direct fetch for small result sets (<= 500)
  if (totalCount <= this.PAGE_SIZE) {
    // ... existing direct fetch logic
  }

  // Soft limit check: If we expect >1000 results, verify it won't exceed hard limit
  if (totalCount > this.SOFT_LIMIT) {
    this.logger.info(`${entity}: Count ${totalCount} exceeds soft limit ${this.SOFT_LIMIT}, checking hard limit`);

    if (totalCount > this.HARD_LIMIT) {
      this.logger.warn(`${entity}: Count ${totalCount} exceeds hard limit ${this.HARD_LIMIT}`);

      // Fetch first 2 pages only and warn
      const items = await this.fetchPages(baseFilters, fetcher, 2);

      return {
        items,
        totalCount,
        strategy: 'paginated',
        message: `Showing first ${items.length} of ${totalCount} results (2 pages).`,
        warning: `Large result set (${totalCount} records). Add date range or other filters to narrow results. Would require ${Math.ceil(totalCount / this.PAGE_SIZE)} pages to fetch all.`,
      };
    }
  }

  // Continue with existing logic...
}
```

3. **Update standard paginated fetch** (Lines 375-410):
```typescript
private async executePaginatedFetch<T extends { id?: number }>(...): Promise<QueryResult<T>> {
  const items: T[] = [];
  const maxPages = Math.min(Math.ceil(totalCount / this.PAGE_SIZE), 10); // Keep 10-page max (5000)

  for (let page = 1; page <= maxPages; page++) {
    const pageItems = await fetcher(baseFilters, this.PAGE_SIZE, page);
    items.push(...pageItems);

    this.logger.debug(`${entity}: Fetched page ${page}/${maxPages} (${pageItems.length} items)`);

    if (pageItems.length < this.PAGE_SIZE) {
      break; // No more results
    }
  }

  const message =
    totalCount <= this.HARD_LIMIT
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
```

4. **Add helper method for multi-page fetching**:
```typescript
private async fetchPages<T>(
  filters: any[],
  fetcher: (filters: any[], pageSize: number, page?: number) => Promise<T[]>,
  maxPages: number
): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const pageItems = await fetcher(filters, this.PAGE_SIZE, page);
    items.push(...pageItems);

    if (pageItems.length < this.PAGE_SIZE) {
      break; // No more results
    }
  }

  return items;
}
```

### Task 2: Update Unlimited Mode in TicketService

**File**: [src/services/entities/ticket.service.ts](src/services/entities/ticket.service.ts)

**Changes**:

1. **Replace 100-page safety limit with 10-page limit** (Lines 287-292):
```typescript
// Old code:
if (currentPage > 100) {
  this.logger.warn('Pagination safety limit reached at 100 pages (50,000 tickets)');
  hasMorePages = false;
}

// New code:
if (currentPage > 10) {
  this.logger.warn('Pagination hard limit reached at 10 pages (5,000 tickets)');
  this.logger.info('Add more specific filters (date range, company, status) to narrow results');
  hasMorePages = false;
}
```

2. **Add soft limit warning** (After line 270):
```typescript
// After fetching page 2 (1000 total results)
if (currentPage === 2 && tickets.length >= 1000) {
  this.logger.info(`Soft limit reached (1,000 tickets). Continuing to hard limit (5,000) but consider adding filters.`);
}
```

### Task 3: Optimize Status Filter

**File**: [src/services/entities/ticket.service.ts](src/services/entities/ticket.service.ts)

**Changes**:

1. **Replace forEach with single filter** (Lines 126-132):
```typescript
// Old code:
const closedStatuses = [5, 20, 21, 24, 26, 27];
closedStatuses.forEach((statusId) => {
  filters.push({
    op: 'ne',
    field: 'status',
    value: statusId,
  });
});

// New code:
filters.push({
  op: 'not in',
  field: 'status',
  value: CLOSED_TICKET_STATUSES, // Use constant from types/autotask.ts
});
```

2. **Add import** (Line 10):
```typescript
import { CLOSED_TICKET_STATUSES } from '../types/autotask.js';
```

### Task 4: Optimize Enhancement in MappingService

**File**: [src/utils/mapping.service.ts](src/utils/mapping.service.ts)

**Changes**:

1. **Replace individual lookups with batch fetching** (Lines 139-167):
```typescript
// Old code:
async getCompanyNames(companyIds: number[]): Promise<(string | null)[]> {
  return Promise.all(companyIds.map(id => this.getCompanyName(id)));
}

// New code:
async getCompanyNames(companyIds: number[]): Promise<(string | null)[]> {
  const uniqueIds = [...new Set(companyIds)];
  const client = await this.autotaskService.getClient();

  // Use batch fetching with cache fallback
  const companyMap = await this.autotaskService.getEntityCache().getManyWithFallback<Company>(
    client,
    'Companies',
    uniqueIds
  );

  // Cache the results
  companyMap.forEach((company, id) => {
    if (company.companyName) {
      this.cache.companies.set(id, company.companyName);
    }
  });

  // Return in original order (preserving duplicates)
  return companyIds.map(id => {
    const company = companyMap.get(id);
    return company?.companyName || null;
  });
}
```

2. **Apply same pattern to getResourceNames** (Similar changes).

3. **Add getClient method to AutotaskService if not present**:
```typescript
async getClient(): Promise<AutotaskClient> {
  return this.serviceContext.getClient();
}
```

### Task 5: Make Enhancement Selective

**File**: [src/handlers/enhanced.tool.handler.ts](src/handlers/enhanced.tool.handler.ts)

**Current Behavior**: Enhances all returned records automatically.

**New Behavior Options**:

**Option A**: Add configuration flag to control enhancement:
```typescript
interface EnhancementConfig {
  enhanceAll: boolean; // Default: false
  enhanceFields?: ('companyName' | 'assignedResourceName' | 'contactName')[];
}
```

**Option B**: Make enhancement opt-in per tool:
```typescript
// In tool annotations:
annotations: {
  title: 'Search Tickets',
  ...READ_ONLY_ANNOTATIONS,
  enhance: {
    enabled: true,
    fields: ['companyName', 'assignedResourceName']
  }
}
```

**Option C**: Keep current behavior but optimize batch fetching (already addressed in Task 4).

**Recommendation**: Option C - current automatic enhancement is fine if batch fetching is efficient. The real issue was individual lookups, not enhancement itself.

### Task 6: Update Tool Description

**File**: [src/handlers/tools/ticket.tools.ts](src/handlers/tools/ticket.tools.ts)

**Changes**:

1. **Update autotask_search_tickets description** (Lines 36-47):
```typescript
description:
  'Search for tickets in Autotask with intelligent query optimization. ' +
  '**Smart Query Strategies**: Automatically selects optimal approach: ' +
  '(1) Direct fetch for ≤500 results, ' +
  '(2) Soft limit at 1,000 results checks if hard limit will be exceeded, ' +
  '(3) Reverse time-window search for "latest" queries (searches 30→90→180→365 days until results found), ' +
  '(4) Binary search for large time windows (>2500 results), ' +
  '(5) Hard limit at 5,000 results (10 pages maximum). ' +
  '**For "how many" questions**: Use autotask_query_count instead of fetching all records. ' +
  '**Pagination**: Returns up to 500 tickets by default. Set pageSize: -1 for unlimited (hard limited to 5,000). ' +
  '**Filters**: Use searchTerm, companyID, status, assignedResourceID, date ranges (createDateFrom/To, lastActivityDateFrom/To). ' +
  '**Large result sets**: Add date range or other filters to narrow results. ' +
  'For full ticket data, use autotask_get_ticket_details.',
```

## Testing Strategy

### Unit Tests

1. **QueryCounterService**:
   - Test soft limit triggers count query
   - Test hard limit returns only 2 pages with warning
   - Test standard pagination caps at 10 pages

2. **TicketService**:
   - Test 'not in' filter generates correct API request
   - Test unlimited mode stops at 10 pages
   - Test soft limit warning appears at page 2

3. **MappingService**:
   - Test batch fetching with mixed cache hits/misses
   - Test deduplication of company IDs
   - Test order preservation with duplicates

### Integration Tests

1. **Pagination Scenarios**:
   - Query returning 500 results → direct fetch
   - Query returning 1,500 results → soft limit check, full fetch (3 pages)
   - Query returning 6,000 results → soft limit check, hard limit kick in, return 1,000 with warning
   - Latest query with 10,000+ results → reverse window search

2. **Filter Optimization**:
   - Search for "open" tickets → verify single 'not in' filter in API request
   - Compare API response time before/after optimization

3. **Enhancement**:
   - Search 100 tickets with 20 unique companies → verify 1 batch API call (not 20)
   - Verify cache is populated after batch fetch

## Open Questions for User

1. **30-page scenario**: What exact query/scenario produced the 30-page observation? Was it:
   - Unlimited mode (`pageSize: -1`)?
   - Multiple time windows in reverse search?
   - Something else?

2. **Enhancement selectivity**: Should enhancement be:
   - Always enabled (current) with optimized batch fetching?
   - Configurable per tool?
   - Opt-in based on query needs?

3. **Reverse sorting**: User mentioned researching "ways to efficiently handle reverse sorting when there is no option in the api" - which entity/scenario needs reverse sorting? Current implementation:
   - Uses `lastActivityDate` descending for "latest" queries
   - Binary search finds most recent time segments
   - Is additional reverse sorting needed?

## Rollout Plan

### Phase 1: Critical Fixes (Immediate)
- Task 3: Optimize status filter (single 'not in')
- Task 1: Fix pagination limits (soft 1,000, hard 5,000)
- Task 2: Update unlimited mode limit (10 pages)

### Phase 2: Performance Optimization (Next)
- Task 4: Optimize MappingService batch fetching
- Task 6: Update tool descriptions

### Phase 3: Testing and Validation
- Unit tests for all changes
- Integration tests for pagination scenarios
- Performance comparison before/after

### Phase 4: Documentation
- Update CLAUDE.md with new limits
- Document 'in'/'not in' operator usage pattern
- Add batch fetching examples

## Success Metrics

- **Pagination**: No queries exceed 5,000 results unless explicitly allowed
- **Filter efficiency**: Open ticket queries use 1 filter instead of 6
- **Enhancement performance**: Batch operations reduce API calls by 80%+ for multi-record enhancement
- **User feedback**: Confirm "30 pages" issue resolved

## API Response Structure Notes

Based on research, Autotask API responses have:
- `response.data`: Array of items (the actual results)
- `requestCount`: How many results were requested (pageSize parameter)
- `count`: How many results were actually returned
- `nextPageUrl`: Present if more results available (not used in current implementation)

Current implementation relies on:
1. Count queries (`/query/count` endpoint) for smart decisions
2. Page parameter for explicit pagination
3. Comparing returned array length to pageSize to detect last page

**Recommendation**: Continue current approach - it's working correctly. The `nextPageUrl` field could be used as additional validation but isn't necessary.
