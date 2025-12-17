# Smart Query Optimization Implementation Plan

**Date Created**: 2025-12-17
**Status**: Ready for Implementation
**Plan File**: `.claude/plans/pure-napping-quokka.md`

## Overview

This document outlines the implementation plan for optimizing the smart query system in the autotask-mcp project. The plan addresses multiple issues including pagination limits, filter inefficiency, cache optimization, and enhancement improvements.

## Issues to Address

1. **Incorrect pagination limits** - Current: 5000/50,000, Needed: 1000 soft/5000 hard
2. **Filter inefficiency** - 6 separate 'ne' filters instead of 1 'not in' filter
3. **Cache strategy** - Using `createDate` instead of `lastTrackedModifiedDateTime`
4. **Enhancement inefficiency** - Individual lookups instead of batch operations
5. **30 pages pagination issue** - Need clarification on exact scenario

## Implementation Tasks

### Task 0: Fix Ticket Cache to Use lastTrackedModifiedDateTime

**Priority**: HIGH
**File**: `src/services/entity-cache.service.ts`

**Problem**: Current implementation caches tickets based on `createDate` (line 446), but should use `lastTrackedModifiedDateTime` to capture recently modified tickets, not just newly created ones.

**New Caching Strategy**:
1. Initial cache: Fetch tickets modified in last 7 days
2. Lazy loading: When cache misses occur, fetch next 7 days of history (+ anything modified since last refresh)
3. Goal: Build up to 30 days of "active" tickets (30 days that have tickets in them)

**Changes Required**:

1. Add tracking fields (after line 72):
```typescript
private ticketCacheDaysLoaded: number = 0;
private readonly TICKET_CACHE_INITIAL_DAYS = 7;
private readonly TICKET_CACHE_INCREMENT_DAYS = 7;
private readonly TICKET_CACHE_MAX_DAYS = 30;
```

2. Update `refreshRecentTickets` to use `lastTrackedModifiedDateTime`
3. Add `lazyLoadMoreTickets()` method for incremental loading
4. Update `getWithFallback()` to trigger lazy loading for tickets
5. Update `CacheMetadata` interface to include `daysLoaded?`
6. Update `saveCache()` and `loadCache()` to persist/restore days loaded
7. Initialize `ticketCacheDaysLoaded` in constructor

### Task 1: Fix Pagination Limits in QueryCounterService

**Priority**: HIGH
**File**: `src/services/core/query-counter.service.ts`

**Changes**:

1. Update constants (lines 40-42):
```typescript
private readonly PAGE_SIZE = 500;
private readonly SOFT_LIMIT = 1000; // 2 pages - triggers count query
private readonly HARD_LIMIT = 5000; // 10 pages - absolute maximum
```

2. Add soft limit check in `executeSmartQuery()`:
   - Check if totalCount > SOFT_LIMIT
   - If exceeds HARD_LIMIT, fetch only 2 pages with warning
   - Otherwise continue with smart query

3. Update `executePaginatedFetch()` to use HARD_LIMIT constant

4. Add `fetchPages()` helper method for multi-page fetching

### Task 2: Update Unlimited Mode in TicketService

**Priority**: HIGH
**File**: `src/services/entities/ticket.service.ts`

**Changes**:

1. Replace 100-page safety limit with 10-page limit (lines 287-292):
```typescript
if (currentPage > 10) {
  this.logger.warn('Pagination hard limit reached at 10 pages (5,000 tickets)');
  this.logger.info('Add more specific filters (date range, company, status) to narrow results');
  hasMorePages = false;
}
```

2. Add soft limit warning after fetching page 2:
```typescript
if (currentPage === 2 && tickets.length >= 1000) {
  this.logger.info(`Soft limit reached (1,000 tickets). Continuing to hard limit (5,000) but consider adding filters.`);
}
```

### Task 3: Optimize Status Filter

**Priority**: MEDIUM
**File**: `src/services/entities/ticket.service.ts`

**Changes**:

1. Replace `forEach` loop with single filter (lines 126-132):
```typescript
// OLD:
const closedStatuses = [5, 20, 21, 24, 26, 27];
closedStatuses.forEach((statusId) => {
  filters.push({ op: 'ne', field: 'status', value: statusId });
});

// NEW:
filters.push({
  op: 'not in',
  field: 'status',
  value: CLOSED_TICKET_STATUSES,
});
```

2. Add import (line 10):
```typescript
import { CLOSED_TICKET_STATUSES } from '../types/autotask.js';
```

### Task 4: Optimize Enhancement in MappingService

**Priority**: MEDIUM
**File**: `src/utils/mapping.service.ts`

**Changes**:

1. Replace individual lookups with batch fetching in `getCompanyNames()`:
```typescript
async getCompanyNames(companyIds: number[]): Promise<(string | null)[]> {
  const uniqueIds = [...new Set(companyIds)];
  const client = await this.autotaskService.getClient();

  const companyMap = await this.autotaskService.getEntityCache().getManyWithFallback<Company>(
    client,
    'Companies',
    uniqueIds
  );

  companyMap.forEach((company, id) => {
    if (company.companyName) {
      this.cache.companies.set(id, company.companyName);
    }
  });

  return companyIds.map(id => {
    const company = companyMap.get(id);
    return company?.companyName || null;
  });
}
```

2. Apply same pattern to `getResourceNames()`

3. Add `getClient()` method to AutotaskService if needed

### Task 5: Enhancement Selectivity

**Priority**: LOW
**File**: `src/handlers/enhanced.tool.handler.ts`

**Recommendation**: Keep current automatic enhancement with optimized batch fetching (Task 4). The issue was individual lookups, not enhancement itself.

### Task 6: Update Tool Description

**Priority**: LOW
**File**: `src/handlers/tools/ticket.tools.ts`

**Changes**:

Update `autotask_search_tickets` description (lines 36-47):
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
   - Test soft limit (1000) triggers count query
   - Test hard limit (5000) returns only 2 pages with warning
   - Test standard pagination caps at 10 pages

2. **TicketService**:
   - Test 'not in' filter generates correct API request
   - Test unlimited mode stops at 10 pages
   - Test soft limit warning at page 2

3. **MappingService**:
   - Test batch fetching with mixed cache hits/misses
   - Test deduplication of company IDs
   - Test order preservation with duplicates

4. **EntityCacheService**:
   - Test lazy loading triggers at correct intervals
   - Test cache depth tracking (7→14→21→30 days)
   - Test daysLoaded persists to disk

### Integration Tests

1. **Pagination Scenarios**:
   - 500 results → direct fetch
   - 1,500 results → soft limit check, full fetch (3 pages)
   - 6,000 results → soft limit check, hard limit, return 1,000 with warning
   - Latest query with 10,000+ results → reverse window search

2. **Filter Optimization**:
   - Search "open" tickets → verify single 'not in' filter
   - Compare API response time before/after

3. **Enhancement**:
   - Search 100 tickets with 20 unique companies → verify 1 batch call
   - Verify cache populated after batch fetch

4. **Cache Lazy Loading**:
   - Initial load → 7 days of tickets
   - Cache miss → triggers 14-day load
   - Continue until 30 days reached

## Rollout Plan

### Phase 1: Critical Fixes (Immediate)
- Task 3: Optimize status filter (single 'not in')
- Task 1: Fix pagination limits (soft 1,000, hard 5,000)
- Task 2: Update unlimited mode limit (10 pages)

### Phase 2: Cache Optimization (Next)
- Task 0: Ticket cache lazy loading with lastTrackedModifiedDateTime

### Phase 3: Performance Optimization
- Task 4: Optimize MappingService batch fetching
- Task 6: Update tool descriptions

### Phase 4: Testing and Validation
- Unit tests for all changes
- Integration tests for pagination scenarios
- Performance comparison before/after

### Phase 5: Documentation
- Update CLAUDE.md with new limits
- Document 'in'/'not in' operator usage pattern
- Add batch fetching examples

## Open Questions

1. **30-page scenario**: What exact query/scenario produced the 30-page observation?
   - Unlimited mode (`pageSize: -1`)?
   - Multiple time windows in reverse search?
   - Something else?

2. **Enhancement selectivity**: Should enhancement be:
   - Always enabled (current) with optimized batch fetching?
   - Configurable per tool?
   - Opt-in based on query needs?

3. **Reverse sorting**: Which entity/scenario needs reverse sorting?
   - Current uses `lastActivityDate` descending for "latest" queries
   - Binary search finds most recent time segments
   - Is additional reverse sorting needed?

## Success Metrics

- **Pagination**: No queries exceed 5,000 results unless explicitly allowed
- **Filter efficiency**: Open ticket queries use 1 filter instead of 6
- **Enhancement performance**: Batch operations reduce API calls by 80%+
- **Cache efficiency**: Lazy loading reduces initial load time by 50%+
- **User feedback**: Confirm "30 pages" issue resolved

## Technical Notes

### API Response Structure
- `response.data`: Array of items (actual results)
- `requestCount`: Requested count (pageSize parameter)
- `count`: Actual count returned
- `nextPageUrl`: Present if more results available (not currently used)

### Current Implementation
- Uses count queries (`/query/count`) for smart decisions
- Page parameter for explicit pagination
- Compares returned array length to pageSize to detect last page

### Recommendation
Continue current approach - it's working correctly. The `nextPageUrl` field could be used as additional validation but isn't necessary.

## Related Files

### Core Files Modified
- `src/services/entity-cache.service.ts` - Ticket cache lazy loading
- `src/services/core/query-counter.service.ts` - Pagination limits
- `src/services/entities/ticket.service.ts` - Filter optimization, unlimited mode
- `src/utils/mapping.service.ts` - Batch enhancement
- `src/handlers/tools/ticket.tools.ts` - Tool descriptions

### Supporting Files
- `src/types/autotask.ts` - CLOSED_TICKET_STATUSES constant
- `src/services/core/service.context.ts` - Context interface
- `src/handlers/enhanced.tool.handler.ts` - Enhancement logic

## Implementation Notes

- All changes maintain backward compatibility
- No breaking changes to public APIs
- Logging added for debugging and monitoring
- Error handling preserved throughout
- Rate limiting respected in all scenarios

## Next Steps

1. Review plan with team
2. Clarify open questions with user
3. Begin Phase 1 implementation
4. Write unit tests in parallel
5. Conduct integration testing
6. Document changes
7. Deploy to staging
8. Monitor performance metrics
9. Deploy to production

---

**Plan Status**: ✅ Ready for Implementation
**Estimated Effort**: 2-3 days development + 1 day testing
**Risk Level**: Medium (core functionality changes)
**Rollback Plan**: Git revert commits, redeploy previous version
