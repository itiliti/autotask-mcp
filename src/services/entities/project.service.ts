/**
 * Project Service
 *
 * Handles project and project note operations in Autotask.
 */

import { BaseEntityService } from '../core/base.service.js';
import { IServiceContext } from '../core/service.context.js';
import {
  AutotaskProject,
  AutotaskProjectNote,
  AutotaskQueryOptions,
  AutotaskQueryOptionsExtended,
} from '../../types/autotask.js';

export class ProjectService extends BaseEntityService {
  constructor(context: IServiceContext) {
    super(context);
  }

  /**
   * Get a project by ID
   */
  async getProject(id: number): Promise<AutotaskProject | null> {
    const client = await this.getClient();

    return this.context.executeWithRateLimit(async () => {
      try {
        this.logger.debug(`Getting project with ID: ${id}`);
        const result = await client.projects.get(id);
        return (result.data as unknown as AutotaskProject) || null;
      } catch (error) {
        this.logger.error(`Failed to get project ${id}:`, error);
        throw error;
      }
    }, 'Projects');
  }

  /**
   * Search for projects with safe pagination defaults
   *
   * @param options - Search options with optional pageSize
   * @returns Array of optimized projects
   *
   * Pagination behavior (v2.0.0+):
   * - No pageSize specified: Returns 25 projects (safe default)
   * - pageSize: N (1-100): Returns up to N projects (capped at 100 for this endpoint)
   * - pageSize: -1: Returns up to 100 projects (API limit)
   *
   * Note: This method uses direct API calls due to autotask-node library limitations.
   */
  async searchProjects(options: AutotaskQueryOptions = {}): Promise<AutotaskProject[]> {
    const client = await this.getClient();

    try {
      this.logger.debug('Searching projects with options:', options);

      // Resolve pagination with safe defaults (capped at 100 for projects API)
      const { pageSize, unlimited } = this.resolvePaginationOptions(options, 25);
      const finalPageSize = Math.min(unlimited ? 100 : pageSize!, 100); // Projects API max is 100

      // WORKAROUND: The autotask-node library's projects.list() method is broken
      // It uses GET with query params instead of POST with body like the working companies endpoint
      // We'll bypass it and make the correct API call directly

      // Essential fields for optimized response size
      const essentialFields = [
        'id',
        'projectName',
        'projectNumber',
        'description',
        'status',
        'projectType',
        'department',
        'companyID',
        'projectManagerResourceID',
        'startDateTime',
        'endDateTime',
        'actualHours',
        'estimatedHours',
        'laborEstimatedRevenue',
        'createDate',
        'completedDate',
        'contractID',
        'originalEstimatedRevenue',
      ];

      // Prepare search body in the same format as working companies endpoint
      const searchBody: any = {};

      // Ensure there's a filter - Autotask API requires a filter
      if (
        !options.filter ||
        (Array.isArray(options.filter) && options.filter.length === 0) ||
        (!Array.isArray(options.filter) && Object.keys(options.filter).length === 0)
      ) {
        searchBody.filter = [
          {
            op: 'gte',
            field: 'id',
            value: 0,
          },
        ];
      } else {
        // If filter is provided as an object, convert to array format expected by API
        if (!Array.isArray(options.filter)) {
          const filterArray = [];
          for (const [field, value] of Object.entries(options.filter)) {
            filterArray.push({
              op: 'eq',
              field: field,
              value: value,
            });
          }
          searchBody.filter = filterArray;
        } else {
          searchBody.filter = options.filter;
        }
      }

      // Add other search parameters
      if (options.sort) searchBody.sort = options.sort;
      if (options.page) searchBody.page = options.page;

      // Apply resolved pageSize
      searchBody.pageSize = finalPageSize;

      // Add field limiting for optimization
      if (essentialFields.length > 0) {
        searchBody.includeFields = essentialFields;
      }

      this.logger.debug('Making direct API call to Projects/query with body:', searchBody);

      // Make the correct API call directly using the axios instance from the client
      const response = await (client as any).axios.post('/Projects/query', searchBody);

      // Extract projects from response (should be in response.data.items format)
      let projects: AutotaskProject[] = [];
      if (response.data && response.data.items) {
        projects = response.data.items;
      } else if (Array.isArray(response.data)) {
        projects = response.data;
      } else {
        this.logger.warn('Unexpected response format from Projects/query:', response.data);
        projects = [];
      }

      // Transform projects to optimize data size
      const optimizedProjects = projects.map((project) => this.optimizeProjectData(project));

      this.logger.info(`Retrieved ${optimizedProjects.length} projects (pageSize: ${finalPageSize})`);
      return optimizedProjects;
    } catch (error: any) {
      // Check if it's the same 405 error pattern
      if (error.response && error.response.status === 405) {
        this.logger.warn(
          'Projects endpoint may not support listing via API (405 Method Not Allowed). This is common with some Autotask configurations.',
        );
        return [];
      }
      this.logger.error('Failed to search projects:', error);
      throw error;
    }
  }

  /**
   * Optimize project data by truncating large text fields
   */
  private optimizeProjectData(project: AutotaskProject): AutotaskProject {
    const maxDescriptionLength = 500;

    const optimizedDescription = project.description
      ? project.description.length > maxDescriptionLength
        ? project.description.substring(0, maxDescriptionLength) + '... [truncated]'
        : project.description
      : '';

    return {
      ...project,
      description: optimizedDescription,
      // Remove potentially large arrays
      userDefinedFields: [],
    };
  }

  /**
   * Create a new project
   */
  async createProject(project: Partial<AutotaskProject>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug('Creating project:', project);
      const result = await client.projects.create(project as any);
      const projectId = (result.data as any)?.id;
      this.logger.info(`Project created with ID: ${projectId}`);
      return projectId;
    } catch (error) {
      this.logger.error('Failed to create project:', error);
      throw error;
    }
  }

  /**
   * Update an existing project
   */
  async updateProject(id: number, updates: Partial<AutotaskProject>): Promise<void> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Updating project ${id}:`, updates);
      await client.projects.update(id, updates as any);
      this.logger.info(`Project ${id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update project ${id}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // PROJECT NOTE OPERATIONS
  // ============================================================================

  /**
   * Get a project note by ID
   */
  async getProjectNote(projectId: number, noteId: number): Promise<AutotaskProjectNote | null> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Getting project note - ProjectID: ${projectId}, NoteID: ${noteId}`);
      const result = await client.notes.list({
        filter: [
          { field: 'projectId', op: 'eq', value: projectId },
          { field: 'id', op: 'eq', value: noteId },
        ],
      });
      const notes = (result.data as any[]) || [];
      return notes.length > 0 ? (notes[0] as AutotaskProjectNote) : null;
    } catch (error) {
      this.logger.error(`Failed to get project note ${noteId} for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Search for project notes
   */
  async searchProjectNotes(
    projectId: number,
    options: AutotaskQueryOptionsExtended = {},
  ): Promise<AutotaskProjectNote[]> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Searching project notes for project ${projectId}:`, options);

      const optimizedOptions = {
        filter: [{ field: 'projectId', op: 'eq', value: projectId }],
        pageSize: options.pageSize || 25,
      };

      const result = await client.notes.list(optimizedOptions);
      const notes = (result.data as any[]) || [];

      this.logger.info(`Retrieved ${notes.length} project notes`);
      return notes as AutotaskProjectNote[];
    } catch (error) {
      this.logger.error(`Failed to search project notes for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Create a project note
   */
  async createProjectNote(projectId: number, note: Partial<AutotaskProjectNote>): Promise<number> {
    const client = await this.getClient();

    try {
      this.logger.debug(`Creating project note for project ${projectId}:`, note);
      const noteData = {
        ...note,
        projectId: projectId,
      };
      const result = await client.notes.create(noteData as any);
      const noteId = (result.data as any)?.id;
      this.logger.info(`Project note created with ID: ${noteId}`);
      return noteId;
    } catch (error) {
      this.logger.error(`Failed to create project note for project ${projectId}:`, error);
      throw error;
    }
  }
}
