/**
 * Attachment Service
 *
 * Handles ticket attachment operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskTicketAttachment, AutotaskQueryOptionsExtended } from '../../types/autotask.js';

export class AttachmentService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a ticket attachment by ID
   */
  async getTicketAttachment(
    ticketId: number,
    attachmentId: number,
    includeData: boolean = false,
  ): Promise<AutotaskTicketAttachment | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(
        `Getting ticket attachment - TicketID: ${ticketId}, AttachmentID: ${attachmentId}, includeData: ${includeData}`,
      );

      // Search for attachment by parent ID and attachment ID
      const result = await client.attachments.list({
        filter: [
          { field: 'parentId', op: 'eq', value: ticketId },
          { field: 'id', op: 'eq', value: attachmentId },
        ],
      });

      const attachments = (result.data as any[]) || [];
      return attachments.length > 0 ? (attachments[0] as AutotaskTicketAttachment) : null;
    } catch (error) {
      this.logger.error(`Failed to get ticket attachment ${attachmentId} for ticket ${ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Search for ticket attachments
   */
  async searchTicketAttachments(
    ticketId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskTicketAttachment[]> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Searching ticket attachments for ticket ${ticketId}:`, options);

      const optimizedOptions = {
        filter: [{ field: 'parentId', op: 'eq', value: ticketId }],
        pageSize: options.pageSize || 10,
      };

      const result = await client.attachments.list(optimizedOptions);
      const attachments = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${attachments.length} ticket attachments`);
      return attachments as AutotaskTicketAttachment[];
    } catch (error) {
      this.logger.error(`Failed to search ticket attachments for ticket ${ticketId}:`, error);
      throw error;
    }
  }
}
