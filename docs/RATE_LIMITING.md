```
# API Rate Limiting Implementation

## Overview

Implemented comprehensive API rate limiting and threshold monitoring to comply with Autotask API limits:

- **Thread Limiting**: Maximum 2 concurrent requests per object endpoint
- **Threshold Monitoring**: Track API usage and warn at 50%+ utilization
- **Adaptive Throttling**: Reduce to single-thread mode when usage exceeds 50%

## Architecture

### 1. RateLimiterService (`src/services/rate-limiter.service.ts`)

Core service that manages request concurrency and queue:

**Features:**

- Configurable max concurrent requests (default: 2)
- Request queueing when at capacity
- Automatic threshold checking (every 60 seconds)
- Dynamic thread adjustment based on usage

**Key Methods:**

- `executeWithRateLimit<T>()` - Execute request with rate limiting
- `updateThresholdInfo()` - Update threshold data and adjust threads
- `getStatus()` - Get current rate limiter status
- `shouldCheckThresholds()` - Check if threshold update is needed

**Configuration:**

```typescript
{
  maxConcurrentRequests: 2,        // Per Autotask guidelines
  thresholdCheckInterval: 19,      // Check every 19 API calls
  highUsageThreshold: 50,          // Warn at 50% usage
  minimumCallsRemaining: 100       // Block all requests when <100 calls left
}
```

### 2. AutotaskService Integration

**New Methods:**

- `checkThresholds()` - Calls `/v1.0/Internal/thresholdInformation` endpoint
- `executeWithRateLimit()` - Wrapper for all API calls with rate limiting
- `getRateLimiterStatus()` - Expose status for monitoring

**Rate Limited Operations:**

- `getCompany()` - Companies endpoint
- `searchCompanies()` - Companies search
- `getContact()` - Contacts endpoint
- `getTicket()` - Tickets endpoint
- `searchTickets()` - Tickets search
- `getProject()` - Projects endpoint
- And all other major API operations...

### 3. MCP Tool: `autotask_get_rate_limit_status`

New monitoring tool that returns:

```typescript
{
  activeRequests: number,           // Current executing requests
  maxConcurrentRequests: number,    // Current thread limit (2 or 1)
  queuedRequests: number,           // Requests waiting in queue
  isHighUsage: boolean,             // True if usage > 50%
  isBlocked: boolean,               // True if <100 calls remaining
  apiCallsSinceCheck: number,       // API calls since last threshold check
  callsRemaining: number | null,    // Calls remaining in current window
  threshold: {
    requestCount: number,           // Requests used in current window
    requestLimit: number,           // Limit (typically 10,000/hour)
    percentageUsed: number,         // Usage percentage
    timeRemaining: string           // Time until reset
  }
}
```

## Behavior

### Normal Operation (Usage < 50%, >100 calls remaining)

- **Thread Limit**: 2 concurrent requests
- **Queue**: Requests queue when both threads busy
- **Monitoring**: Checks thresholds every 19 API calls (check itself = 1 call, total 20)

### High Usage Mode (Usage ≥ 50%)

- **Automatic Trigger**: When API usage reaches 50%
- **Thread Limit**: Reduces to 1 concurrent request
- **Warning**: Logs warning message
- **Recovery**: Returns to 2 threads when usage drops below 50%

### Critical Protection Mode (<100 calls remaining)

- **Automatic Trigger**: When remaining calls drops below 100
- **Behavior**: ALL API requests blocked with error
- **Error Message**: "API rate limit protection: Less than 100 calls remaining (X left). Please wait for the limit to reset."
- **Recovery**: Resumes when calls remaining exceeds 100

### Queue Management

- Requests queue when at thread capacity
- FIFO (first-in, first-out) processing
- Automatic processing as threads become available
- No request timeout (relies on API timeout)

## API Threshold Information

Autotask provides real-time usage data via:

```
GET /v1.0/Internal/thresholdInformation
```

**Response Fields:**

- `requestCount` - Requests used in current window
- `requestLimit` - Maximum requests allowed (10,000/hour)
- `timeRemaining` - Time until limit reset

**Rate Limits:**

- **10,000 calls per hour** (rolling window)
- **2-3 threads per object endpoint** (integration-specific)
- Thread latency applied when limit exceeded

## Logging & Warnings

### Info Messages

```
API Usage: 3250/10000 (32.5%) - Remaining: 6750 calls - Time remaining: 42 minutes
✓ API usage back below 50% - restoring normal thread count
✓ API calls recovered above 100 threshold - resuming normal operations
```

### Warning Messages

```
⚠️  API usage above 50% threshold - switching to single-thread mode
Rate limit reached (2/2), queueing request for Tickets
```

### Error Messages (Critical)

```
🚫 CRITICAL: Less than 100 API calls remaining (87 left)! All requests blocked until limit resets. Time remaining: 15 minutes
API rate limit protection: Less than 100 calls remaining (87 left). Please wait for the limit to reset. Time remaining: 15 minutes
```

### Debug Messages

```
Executing request (active: 1/2) for Companies
Request completed (active: 0/2)
Processing queued request (remaining: 5)
```

## Testing

To monitor rate limiting behavior:

1. **Check current status:**

   ```
   Use the autotask_get_rate_limit_status tool
   ```

2. **Trigger high-load scenario:**
   - Run multiple large searches simultaneously
   - Request unlimited results (`pageSize: -1`)
   - Monitor queue depth and thread usage

3. **Verify threshold monitoring:**
   - Check logs for threshold updates (every 60 seconds)
   - Verify single-thread mode activates at 50%
   - Confirm recovery when usage drops

## References

- [Autotask Thread Limiting Documentation](https://autotask.net/help/developerhelp/Content/APIs/General/ThreadLimiting.htm)
- [Autotask REST API Thresholds & Limits](https://autotask.net/help/developerhelp/Content/APIs/REST/General_Topics/REST_Thresholds_Limits.htm)
- [Autotask Advanced Query Features](https://autotask.net/help/developerhelp/Content/APIs/REST/API_Calls/REST_Advanced_Query_Features.htm)

## Files Modified

1. **src/services/rate-limiter.service.ts** - New file, core rate limiting logic
2. **src/services/autotask.service.ts** - Integrated rate limiter, wrapped API calls
3. **src/handlers/tool.handler.ts** - Added `autotask_get_rate_limit_status` tool

## Key Changes from Initial Implementation

### Threshold Check Frequency

- **Before**: Time-based (every 60 seconds)
- **After**: Call-count-based (every 19 API calls)
- **Rationale**: Threshold check counts as 1 API call, so 19 + 1 = 20 calls per check cycle

### Critical Protection

- **New Feature**: Block ALL requests when <100 calls remaining
- **Error Handling**: Throws explicit error instead of queueing
- **User Feedback**: Clear error message with remaining calls and reset time

### Monitoring

- **New Fields**: `apiCallsSinceCheck`, `callsRemaining`, `isBlocked`
- **Enhanced Logging**: Shows remaining calls in addition to percentage used

## Build Info

- **Version**: 3.0.3
- **Build Date**: 12/15/2025, 6:02:07 PM
- **Status**: ✅ Build successful, no vulnerabilities
```