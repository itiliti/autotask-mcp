/**
 * Expense Tools
 *
 * Tools for expense report operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, withErrorHandling, PAGE_SIZE_MEDIUM } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';

/**
 * Register all expense tools
 */
export const registerExpenseTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Get Expense Report
    {
      tool: {
        name: 'autotask_get_expense_report',
        description: 'Get an expense report by ID',
        inputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'number', description: 'The expense report ID' },
          },
          required: ['reportId'],
        },
        annotations: {
          title: 'Get Expense Report',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const result = await ctx.autotaskService.getExpenseReport(args.reportId);
          return successResult({
            expenseReport: result,
            message: `Expense report retrieved successfully`,
          });
        }, 'autotask_get_expense_report');
      },
    },

    // Search Expense Reports
    {
      tool: {
        name: 'autotask_search_expense_reports',
        description: 'Search for expense reports. Returns 25 reports by default (max: 100). Use filters (submitterId, status) to narrow results.',
        inputSchema: {
          type: 'object',
          properties: {
            submitterId: { type: 'number', description: 'Filter by submitter resource ID' },
            status: { type: 'number', description: 'Filter by status' },
            pageSize: PAGE_SIZE_MEDIUM,
          },
          required: [],
        },
        annotations: {
          title: 'Search Expense Reports',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const requestedPageSize = args.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchExpenseReports({
            submitterId: args.submitterId,
            status: args.status,
            pageSize: args.pageSize,
          });

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} expense reports (results may be truncated, API max: 100). Add filters (submitterId, status) to narrow results.`
            : `Found ${result.length} expense reports`;

          return successResult({ expenseReports: result, message });
        }, 'autotask_search_expense_reports');
      },
    },

    // Create Expense Report
    {
      tool: {
        name: 'autotask_create_expense_report',
        description: 'Create a new expense report',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the expense report' },
            description: { type: 'string', description: 'Description of the expense report' },
            submitterId: { type: 'number', description: 'Resource ID of the submitter' },
            weekEndingDate: { type: 'string', description: 'Week ending date in ISO format' },
          },
          required: ['name', 'submitterId', 'weekEndingDate'],
        },
        annotations: {
          title: 'Create Expense Report',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const result = await ctx.autotaskService.createExpenseReport({
            name: args.name,
            description: args.description,
            submitterID: args.submitterId,
            weekEndingDate: args.weekEndingDate,
          });
          return successResult({
            id: result,
            message: `Successfully created expense report with ID: ${result}`,
          });
        }, 'autotask_create_expense_report');
      },
    },
  ];
};
