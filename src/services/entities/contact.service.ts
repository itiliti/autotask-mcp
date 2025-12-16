/**
 * Contact Service
 *
 * Handles contact-related operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import { AutotaskContact, AutotaskQueryOptionsExtended } from '../../types/autotask.js';

export class ContactService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a contact by ID
   */
  async getContact(id: number): Promise<AutotaskContact | null> {
    const client = await this.getClient();

    return this.context.executeWithRateLimit(async () => {
      try {
        this.logger.debug(`Getting contact with ID: ${id}`);
        const result = await client.contacts.get(id);
        return (result.data as AutotaskContact) || null;
      } catch (error) {
        this.logger.error(`Failed to get contact ${id}:`, error);
        throw error;
      }
    }, 'Contacts');
  }

  /**
   * Search for contacts with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of contacts
   *
   * Pagination behavior:
   * - No pageSize specified: Returns 50 contacts (safe default)
   * - pageSize: N (1-500): Returns up to N contacts
   * - pageSize: -1: Returns ALL contacts (use with caution)
   */
  async searchContacts(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskContact[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching contacts with options:', options);

      // Resolve pagination with safe defaults
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 50);

      if (unlimited) {
        // Unlimited mode: fetch ALL contacts via pagination
        const allContacts: AutotaskContact[] = [];
        const batchSize = 500;
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages) {
          const queryOptions = {
            ...options,
            pageSize: batchSize,
            page: currentPage,
          };

          this.logger.debug(`Fetching contacts page ${currentPage}...`);

          const result = await client.contacts.list(queryOptions as any);
          let contacts = (result.data as AutotaskContact[]) || [];

          // Safety cap: Autotask API sometimes ignores pageSize, enforce client-side
          if (contacts.length > pageSize!) {
            this.logger.warn(
              `API returned ${contacts.length} contacts but pageSize was ${pageSize}. Truncating to requested limit.`,
            );
            contacts = contacts.slice(0, pageSize!);
          }

          if (contacts.length === 0) {
            hasMorePages = false;
          } else {
            allContacts.push(...contacts);

            if (contacts.length < batchSize) {
              hasMorePages = false;
            } else {
              currentPage++;
            }
          }

          // Safety check to prevent infinite loops
          if (currentPage > 30) {
            this.logger.warn('Contact pagination safety limit reached at 30 pages (15,000 contacts)');
            hasMorePages = false;
          }
        }

        this.logger.info(`Retrieved ${allContacts.length} contacts across ${currentPage} pages (unlimited mode)`);
        return allContacts;
      } else {
        // Limited mode: fetch single page
        const queryOptions = {
          ...options,
          pageSize: pageSize!,
        };

        const result = await client.contacts.list(queryOptions as any);
        let contacts = (result.data as AutotaskContact[]) || [];

        // Safety cap: Autotask API sometimes ignores pageSize, enforce client-side
        if (contacts.length > pageSize!) {
          this.logger.warn(
            `API returned ${contacts.length} contacts but pageSize was ${pageSize}. Truncating to requested limit.`,
          );
          contacts = contacts.slice(0, pageSize!);
        }

        this.logger.info(`Retrieved ${contacts.length} contacts (pageSize: ${pageSize})`);
        return contacts;
      }
    } catch (error) {
      this.logger.error('Failed to search contacts:', error);
      throw error;
    }
  }

  /**
   * Create a new contact
   */
  async createContact(contact: Partial<AutotaskContact>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating contact:', contact);
      const result = await client.contacts.create(contact as any);
      const contactId = (result.data as any)?.id;
      this.logger.info(`Contact created with ID: ${contactId}`);
      return contactId;
    } catch (error) {
      this.logger.error('Failed to create contact:', error);
      throw error;
    }
  }

  /**
   * Update an existing contact
   */
  async updateContact(id: number, updates: Partial<AutotaskContact>): Promise<void> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Updating contact ${id}:`, updates);
      await client.contacts.update(id, updates as any);
      this.logger.info(`Contact ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update contact ${id}:`, error);
      throw error;
    }
  }
}
