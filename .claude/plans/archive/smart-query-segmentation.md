# Plan: Smart Query Segmentation for Large Result Sets

## Problem Statement
When users search for "latest" or "last" tickets/notes/attachments, we cannot search from the beginning as there are hundreds of thousands of records. Current behavior returns truncated results without smart guidance.

**Solution**: Implement count-based query segmentation using Autotask's count API to determine result set size, then segment queries by time period when results exceed threshold.

---

## Key Requirements

1. **Count before search**: Run count query before actual search for tickets, notes, attachments
2. **Time-based segmentation**: If count > 200, segment by year (then month) going backward from current date
3. **Parameter requirements**:
   - Notes: Require parent ID (ticketId/projectId/accountId) - already enforced
   - Attachments: Require parentId - already enforced
4. **Response hints**: Include segmentation metadata in response so callers understand the data pattern
5. **Autotask filter operators**: eq, ne, beginsWith, contains, gte, lte, gt, lt, in, notIn, exist, notExist

---

## Architecture

### New Files
```
src/services/core/query-counter.service.ts    # Count API and segmentation logic (~150 lines)
```

### Modified Files
```
src/services/core/base.service.ts             # Add countQuery method
src/services/entities/ticket.service.ts       # Integrate smart search
src/handlers/tools/ticket.tools.ts            # Add segmentation hints in response
```

---

## Implementation Details

### 1. QueryCounterService (new)

```typescript
// src/services/core/query-counter.service.ts

export interface QueryCountResult {
  count: number;
  exceedsThreshold: boolean;
  suggestedSegments?: DateSegment[];
}

export interface DateSegment {
  startDate: string;  // ISO date
  endDate: string;    // ISO date
  label: string;      // e.g., "2024", "2024-12", "2024-Q4"
}

export interface SegmentedQueryResult<T> {
  items: T[];
  totalCount: number;
  segments: SegmentResult[];
  isSegmented: boolean;
  message: string;
}

export interface SegmentResult {
  label: string;
  count: number;
  fetched: boolean;
}
```

**Core methods**:
- `getCount(entity: string, filters: any[]): Promise<number>` - Call `/Entity/query/count`
- `generateTimeSegments(count: number, dateField: string): DateSegment[]` - Generate year/month segments
- `executeSegmentedQuery<T>(entity: string, baseFilters: any[], dateField: string, fetcher: Function): Promise<SegmentedQueryResult<T>>`

### 2. Count API Integration

Per Autotask docs, count endpoint:
```
POST /v1.0/{Entity}/query/count
Body: { "filter": [...] }
Response: { "queryCount": 12345 }
```

Implementation in base service:
```typescript
protected async countQuery(entity: string, filters: any[]): Promise<number> {
  const client = await this.getClient();
  const response = await (client as any).axios.post(`/${entity}/query/count`, {
    filter: filters
  });
  return response.data?.queryCount ?? 0;
}
```

### 3. Segmentation Strategy

**Threshold**: 200 results (configurable)

**Segmentation flow**:
1. Run count with base filters
2. If count <= 200: Execute normal query, return results
3. If count > 200:
   a. Try yearly segments (current year backward)
   b. For each year, if count > 200, subdivide into months
   c. Fetch from most recent segment first
   d. Return with segmentation metadata

**Date field mapping**:
- Tickets:
  - `createDate` - default for general searches, "new tickets", "recently created"
  - `lastActivityDate` - for "recent activity", "latest updates", "modified recently"
- Notes: `createDateTime` (if available) or skip segmentation
- Attachments: `createDateTime` (if available) or skip segmentation

**Segmentation field selection logic**:
- If user explicitly provides `createDateFrom`/`createDateTo` → use `createDate`
- If user explicitly provides `lastActivityDateFrom`/`lastActivityDateTo` → use `lastActivityDate`
- If searching for "latest", "recent", "updated" → prefer `lastActivityDate`
- Default fallback → `createDate`

### 4. Response Format with Hints

```typescript
{
  tickets: [...],
  message: "Found 15,432 total tickets. Showing 187 from December 2024. Use dateRange filter for other periods.",
  segmentation: {
    isSegmented: true,
    totalCount: 15432,
    currentSegment: { label: "2024-12", count: 187 },
    availableSegments: [
      { label: "2024-12", count: 187 },
      { label: "2024-11", count: 245 },
      { label: "2024-10", count: 312 },
      // ... continues backward
    ],
    hint: "Results are segmented by month. To see earlier results, add createDateFrom/createDateTo filters."
  }
}
```

### 5. Tool Schema & Description Updates

**Add to SearchTicketsInputSchema**:
```typescript
lastActivityDateFrom: ISODateTimeSchema.optional().describe(
  'Filter tickets with activity on or after this date/time (ISO 8601 format). Use for "recent updates" queries.'
),
lastActivityDateTo: ISODateTimeSchema.optional().describe(
  'Filter tickets with activity on or before this date/time (ISO 8601 format). Use for "recent updates" queries.'
),
```

**Update `autotask_search_tickets` description**:
```
Search for tickets in Autotask. For large result sets (>200), results are automatically
segmented by time period starting from most recent.

Date filters:
- createDateFrom/createDateTo: Filter by ticket creation date
- lastActivityDateFrom/lastActivityDateTo: Filter by last activity/modification date

Returns segmentation metadata to guide further queries when results exceed threshold.
```

---

## Implementation Phases

### Phase 1: Query Counter Infrastructure
1. Create `src/services/core/query-counter.service.ts`
2. Add `countQuery()` method to base service
3. Add types for segmented results
4. `npm run build` to verify

### Phase 2: Integrate with Ticket Search
1. Update `TicketService.searchTickets()` to use count-first approach
2. Implement time segmentation for tickets
3. Update response format with segmentation metadata
4. `npm run build` to verify

### Phase 3: Update Tool Handler
1. Update `ticket.tools.ts` to pass through segmentation info
2. Update tool description with segmentation behavior
3. `npm run build` to verify

### Phase 4: Extend to Notes (Optional)
1. Notes already require parent ID (low result counts)
2. Add count-based warning if results still large
3. Document behavior

### Phase 5: Testing
1. Test with large ticket dataset
2. Verify segmentation works correctly
3. Test edge cases (no results, exactly 200, etc.)

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `src/services/core/query-counter.service.ts` | NEW: Count API and segmentation logic |
| `src/services/core/base.service.ts` | Add countQuery() method |
| `src/services/entities/ticket.service.ts` | Integrate smart segmented search, add lastActivityDate filters |
| `src/handlers/tools/ticket.tools.ts` | Update response format with hints |
| `src/utils/validation/ticket.schemas.ts` | Add lastActivityDateFrom/lastActivityDateTo filter options |
| `src/types/autotask.ts` | Add segmentation types, lastActivityDate to query options |

---

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Count API call adds latency | Only count when no date filters provided |
| Segmentation increases API calls | Cache counts, fetch only requested segment |
| Complex response format | Clear message and hint fields guide users |
| autotask-node doesn't support count | Use direct axios calls (already pattern in codebase) |

---

## Notes on Existing Constraints

- Notes already require ticketId/projectId/accountId (enforced in schemas)
- Attachments already require parentId (enforced in service)
- Both have low default page sizes (25, 10)
- Focus optimization on ticket search which has highest volume
