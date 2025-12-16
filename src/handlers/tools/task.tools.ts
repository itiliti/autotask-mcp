/**
 * Task Tools
 *
 * Tools for project task operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { TaskSchemas } from '../../utils/validation/task.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all task tools
 */
export const registerTaskTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Tasks
    {
      tool: {
        name: 'autotask_search_tasks',
        description:
          'Search for project tasks in Autotask. Returns 25 tasks by default (max: 100). Use filters (searchTerm, projectID, status, assignedResourceID) to narrow results.',
        inputSchema: zodToJsonSchema(TaskSchemas.SearchTasks, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Tasks',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = TaskSchemas.SearchTasks.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchTasks(validatedArgs as any);

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} tasks (results may be truncated, API max: 100). Add filters (searchTerm, projectID, status, assignedResourceID) to narrow results.`
            : `Found ${result.length} tasks`;

          return successResult({ tasks: result, message });
        }, 'autotask_search_tasks');
      },
    },

    // Create Task
    {
      tool: {
        name: 'autotask_create_task',
        description: 'Create a new project task in Autotask',
        inputSchema: zodToJsonSchema(TaskSchemas.CreateTask, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Task',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = TaskSchemas.CreateTask.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createTask(validatedArgs as any);
          return successResult({
            id: result,
            message: `Successfully created task with ID: ${result}`,
          });
        }, 'autotask_create_task');
      },
    },
  ];
};
