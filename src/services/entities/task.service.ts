/**
 * Task Service
 *
 * Handles task operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskTask, AutotaskQueryOptions } from '../../types/autotask.js';

export class TaskService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a task by ID
   */
  async getTask(id: number): Promise<AutotaskTask | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting task with ID: ${id}`);
      const result = await client.tasks.get(id);
      return (result.data as unknown as AutotaskTask) || null;
    } catch (error) {
      this.logger.error(`Failed to get task ${id}:`, error);
      throw error;
    }
  }

  /**
   * Search for tasks with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of optimized tasks
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 tasks (safe default)
   * - pageSize: N (1-100): Returns up to N tasks (capped at 100)
   * - pageSize: -1: Returns up to 100 tasks (API limit)
   *
   * Note: Tasks are optimized with field limiting for reduced response size.
   */
  async searchTasks(options: AutotaskQueryOptions = {}): Promise<AutotaskTask[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching tasks with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);
      const finalPageSize = Math.min(unlimited ? 100 : pageSize!, 100); // Tasks API max is 100

      // Define essential task fields to minimize response size
      const essentialFields = [
        'id',
        'title',
        'description',
        'status',
        'projectID',
        'assignedResourceID',
        'creatorResourceID',
        'createDateTime',
        'startDateTime',
        'endDateTime',
        'estimatedHours',
        'hoursToBeScheduled',
        'remainingHours',
        'percentComplete',
        'priorityLabel',
        'taskType',
        'lastActivityDateTime',
        'completedDateTime',
      ];

      // Set default pagination and field limits
      const optimizedOptions = {
        ...options,
        includeFields: essentialFields,
        pageSize: finalPageSize,
      };

      const result = await client.tasks.list(optimizedOptions as any);
      const tasks = (result.data as unknown as AutotaskTask[]) || [];

      // Transform tasks to optimize data size
      const optimizedTasks = tasks.map((task) => this.optimizeTaskData(task));

      this.logger.info(`Retrieved ${optimizedTasks.length} tasks (pageSize: ${finalPageSize})`);
      return optimizedTasks;
    } catch (error) {
      this.logger.error('Failed to search tasks:', error);
      throw error;
    }
  }

  /**
   * Optimize task data by truncating large text fields
   */
  private optimizeTaskData(task: AutotaskTask): AutotaskTask {
    const maxDescriptionLength = 400;

    const optimizedDescription = task.description
      ? task.description.length > maxDescriptionLength
        ? task.description.substring(0, maxDescriptionLength) + '... [truncated]'
        : task.description
      : '';

    return {
      ...task,
      description: optimizedDescription,
      // Remove potentially large arrays
      userDefinedFields: [],
    };
  }

  /**
   * Create a new task
   */
  async createTask(task: Partial<AutotaskTask>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating task:', task);
      const result = await client.tasks.create(task as any);
      const taskId = (result.data as any)?.id;
      this.logger.info(`Task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.logger.error('Failed to create task:', error);
      throw error;
    }
  }

  /**
   * Update an existing task
   */
  async updateTask(id: number, updates: Partial<AutotaskTask>): Promise<void> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Updating task ${id}:`, updates);
      await client.tasks.update(id, updates as any);
      this.logger.info(`Task ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update task ${id}:`, error);
      throw error;
    }
  }
}
