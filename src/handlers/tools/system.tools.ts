/**
 * System Tools
 *
 * Tools for server information, connection testing, and rate limiting.
 */

import { ToolDefinition, ToolContext, ToolRegistrar } from './tool.registry.js';
import { successResult } from './base.tool.js';
import { TEST_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';

/**
 * Register all system tools
 */
export const registerSystemTools: ToolRegistrar = (_context: ToolContext): ToolDefinition[] => {
  return [
    // Build Info Tool
    {
      tool: {
        name: 'autotask_get_build_info',
        description: 'Get server build information including version and build date/time',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          title: 'Get Build Info',
          ...TEST_ANNOTATIONS,
        },
      },
      handler: async () => {
        const { getBuildInfo } = await import('../../utils/build-info.js');
        const buildInfo = getBuildInfo();
        return successResult({
          ...buildInfo,
          message: `Server version ${buildInfo.version}, built on ${buildInfo.buildDate}`,
        });
      },
    },

    // Rate Limit Status Tool
    {
      tool: {
        name: 'autotask_get_rate_limit_status',
        description:
          'Get current API rate limit status including usage thresholds, active requests, and queue depth. Shows API usage percentage and thread management status.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          title: 'Get Rate Limit Status',
          ...TEST_ANNOTATIONS,
        },
      },
      handler: async (_args, ctx) => {
        const status = ctx.autotaskService.getRateLimiterStatus();

        const warnings: string[] = [];
        if (status.isBlocked) {
          warnings.push(`🚫 BLOCKED: Less than 100 API calls remaining`);
        }
        if (status.isHighUsage) {
          warnings.push(`⚠️  API usage above 50% - operating in single-thread mode`);
        }
        if (status.queuedRequests > 0) {
          warnings.push(`${status.queuedRequests} requests queued`);
        }

        const thresholdText = status.threshold
          ? `${status.threshold.requestCount}/${status.threshold.requestLimit} (${status.threshold.percentageUsed.toFixed(1)}%)`
          : 'Not yet checked';

        const message = [
          `Rate Limiter Status:`,
          `- Active requests: ${status.activeRequests}/${status.maxConcurrentRequests}`,
          `- Queued requests: ${status.queuedRequests}`,
          `- API calls since last check: ${status.apiCallsSinceCheck}/19`,
          `- API usage: ${thresholdText}`,
          status.callsRemaining !== null ? `- Calls remaining: ${status.callsRemaining}` : '',
          warnings.length > 0 ? `- Warnings: ${warnings.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        return successResult({
          ...status,
          message,
        });
      },
    },

    // Default Resource Tool
    {
      tool: {
        name: 'autotask_get_default_resource',
        description:
          'Get the default resource ID (API user). This resource is used as default when a resource is required but not specified. Shows cached information about the API user.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          title: 'Get Default Resource',
          ...TEST_ANNOTATIONS,
        },
      },
      handler: async (_args, ctx) => {
        const resourceId = ctx.autotaskService.getDefaultResourceId();
        const cacheInfo = ctx.autotaskService.getApiUserCache();

        if (resourceId && cacheInfo) {
          return successResult({
            resourceId: resourceId,
            email: cacheInfo.email,
            name: cacheInfo.resourceName,
            lastUpdated: cacheInfo.lastUpdated,
            message: `Default Resource (API User): ${cacheInfo.resourceName} (ID: ${resourceId}, ${cacheInfo.email})`,
          });
        } else {
          return successResult({
            resourceId: null,
            message: 'No default resource ID configured. API user resource not found or not initialized.',
          });
        }
      },
    },

    // Test Connection Tool
    {
      tool: {
        name: 'autotask_test_connection',
        description: 'Test the connection to Autotask API',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          title: 'Test Connection',
          ...TEST_ANNOTATIONS,
        },
      },
      handler: async (_args, ctx) => {
        const connectionResult = await ctx.autotaskService.testConnection();
        return successResult({
          success: connectionResult,
          message: connectionResult
            ? 'Successfully connected to Autotask API'
            : 'Connection failed: Unable to connect to Autotask API',
        });
      },
    },
  ];
};
