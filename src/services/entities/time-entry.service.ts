/**
 * Time Entry Service
 *
 * Handles time entry operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskTimeEntry, AutotaskQueryOptions } from '../../types/autotask.js';

export class TimeEntryService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Create a new time entry
   */
  async createTimeEntry(timeEntry: Partial<AutotaskTimeEntry>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating time entry:', timeEntry);
      const result = await client.timeEntries.create(timeEntry as any);
      const timeEntryId = (result.data as any)?.id;
      this.logger.info(`Time entry created with ID: ${timeEntryId}`);
      return timeEntryId;
    } catch (error) {
      this.logger.error('Failed to create time entry:', error);
      throw error;
    }
  }

  /**
   * Get time entries with optional filtering
   */
  async getTimeEntries(options: AutotaskQueryOptions = {}): Promise<AutotaskTimeEntry[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Getting time entries with options:', options);
      const result = await client.timeEntries.list(options as any);
      return (result.data as AutotaskTimeEntry[]) || [];
    } catch (error) {
      this.logger.error('Failed to get time entries:', error);
      throw error;
    }
  }
}
