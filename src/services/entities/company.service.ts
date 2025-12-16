/**
 * Company Service
 *
 * Handles company-related operations in Autotask, including company notes.
 * Uses accounts endpoint in autotask-node.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import {
  AutotaskCompany,
  AutotaskCompanyNote,
  AutotaskQueryOptionsExtended,
} from '../../types/autotask.js';

export class CompanyService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  // ============================================================================
  // COMPANY CRUD OPERATIONS
  // ============================================================================

  /**
   * Get a company by ID
   */
  async getCompany(id: number): Promise<AutotaskCompany | null> {
    const client = await this.getClient();

    return this.context.executeWithRateLimit(async () => {
      try {
        this.logger.debug(`Getting company with ID: ${id}`);
        const result = await client.accounts.get(id);
        return (result.data as AutotaskCompany) || null;
      } catch (error) {
        this.logger.error(`Failed to get company ${id}:`, error);
        throw error;
      }
    }, 'Companies');
  }

  /**
   * Search for companies with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of companies
   *
   * Pagination behavior:
   * - No pageSize specified: Returns 50 companies (safe default)
   * - pageSize: N (1-500): Returns up to N companies
   * - pageSize: -1: Returns ALL companies (use with caution)
   */
  async searchCompanies(options: AutotaskQueryOptionsExtended = {}): Promise<AutotaskCompany[]> {
    const client = await this.getClient();

    return this.context.executeWithRateLimit(async () => {
      try {
        this.logger.debug('Searching companies with options:', options);

        // Resolve pagination with safe defaults
        const { pageSize, unlimited } = this.resolvePaginationOptions(options, 50);

        // Build proper filter array for Autotask API
        const filters: any[] = [];

        if (options.searchTerm) {
          filters.push({
            op: 'contains',
            field: 'companyName',
            value: options.searchTerm,
          });
        }

        if (options.isActive !== undefined) {
          filters.push({
            op: 'eq',
            field: 'isActive',
            value: options.isActive,
          });
        }

        // Default filter if none provided (required by Autotask API)
        if (filters.length === 0) {
          filters.push({
            op: 'gte',
            field: 'id',
            value: 0,
          });
        }

        if (unlimited) {
          // Unlimited mode: fetch ALL companies via pagination
          const allCompanies: AutotaskCompany[] = [];
          const batchSize = 500; // Use max safe page size for efficiency
          let currentPage = 1;
          let hasMorePages = true;

          while (hasMorePages) {
            const queryOptions = {
              filter: filters,
              pageSize: batchSize,
              page: currentPage,
            };

            this.logger.debug(`Fetching companies page ${currentPage}...`);

            const result = await client.accounts.list(queryOptions as any);
            const companies = (result.data as AutotaskCompany[]) || [];

            if (companies.length === 0) {
              hasMorePages = false;
            } else {
              allCompanies.push(...companies);

              // Check if we got a full page - if not, we're done
              if (companies.length < batchSize) {
                hasMorePages = false;
              } else {
                currentPage++;
              }
            }

            // Safety check to prevent infinite loops
            if (currentPage > 50) {
              this.logger.warn('Company pagination safety limit reached at 50 pages (25,000 companies)');
              hasMorePages = false;
            }
          }

          this.logger.info(`Retrieved ${allCompanies.length} companies across ${currentPage} pages (unlimited mode)`);
          return allCompanies;
        } else {
          // Limited mode: fetch single page with specified/default pageSize
          const queryOptions = {
            filter: filters,
            pageSize: pageSize!,
          };

          this.logger.debug('Single page request with limit:', queryOptions);

          const result = await client.accounts.list(queryOptions as any);
          let companies = (result.data as AutotaskCompany[]) || [];

          // Safety cap: Autotask API sometimes ignores pageSize, enforce client-side
          if (companies.length > pageSize!) {
            this.logger.warn(
              `API returned ${companies.length} companies but pageSize was ${pageSize}. Truncating to requested limit.`,
            );
            companies = companies.slice(0, pageSize!);
          }

          this.logger.info(`Retrieved ${companies.length} companies (pageSize: ${pageSize})`);
          return companies;
        }
      } catch (error) {
        this.logger.error('Failed to search companies:', error);
        throw error;
      }
    }, 'Companies');
  }

  /**
   * Create a new company
   */
  async createCompany(company: Partial<AutotaskCompany>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating company:', company);
      const result = await client.accounts.create(company as any);
      const companyId = (result.data as any)?.id;
      this.logger.info(`Company created with ID: ${companyId}`);
      return companyId;
    } catch (error) {
      this.logger.error('Failed to create company:', error);
      throw error;
    }
  }

  /**
   * Update an existing company
   */
  async updateCompany(id: number, updates: Partial<AutotaskCompany>): Promise<void> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Updating company ${id}:`, updates);
      await client.accounts.update(id, updates as any);
      this.logger.info(`Company ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update company ${id}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // COMPANY NOTE OPERATIONS
  // ============================================================================

  /**
   * Get a company note by ID
   */
  async getCompanyNote(companyId: number, noteId: number): Promise<AutotaskCompanyNote | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting company note - CompanyID: ${companyId}, NoteID: ${noteId}`);
      const result = await client.notes.list({
        filter: [
          { field: 'accountId', op: 'eq', value: companyId },
          { field: 'id', op: 'eq', value: noteId },
        ],
      });
      const notes = (result.data as any[]) || [];
      return notes.length > 0 ? (notes[0] as AutotaskCompanyNote) : null;
    } catch (error) {
      this.logger.error(`Failed to get company note ${noteId} for company ${companyId}:`, error);
      throw error;
    }
  }

  /**
   * Search for company notes
   */
  async searchCompanyNotes(
    companyId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskCompanyNote[]> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Searching company notes for company ${companyId}:`, options);

      const optimizedOptions = {
        filter: [{ field: 'accountId', op: 'eq', value: companyId }],
        pageSize: options.pageSize || 25,
      };

      const result = await client.notes.list(optimizedOptions);
      const notes = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${notes.length} company notes`);
      return notes as AutotaskCompanyNote[];
    } catch (error) {
      this.logger.error(`Failed to search company notes for company ${companyId}:`, error);
      throw error;
    }
  }

  /**
   * Create a company note
   */
  async createCompanyNote(companyId: number, note: Partial<AutotaskCompanyNote>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Creating company note for company ${companyId}:`, note);
      const noteData = {
        ...note,
        accountId: companyId,
      };
      const result = await client.notes.create(noteData as any);
      const noteId = (result.data as any)?.id;
      this.logger.info(`Company note created with ID: ${noteId}`);
      return noteId;
    } catch (error) {
      this.logger.error(`Failed to create company note for company ${companyId}:`, error);
      throw error;
    }
  }
}
