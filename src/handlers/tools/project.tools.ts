/**
 * Project Tools
 *
 * Tools for project and project note operations.
 */

import { ToolDefinition, ToolRegistrar } from './tool.registry.js';
import { successResult, removeUndefined, withErrorHandling } from './base.tool.js';
import { READ_ONLY_ANNOTATIONS, CREATE_ANNOTATIONS } from '../../utils/validation/tool-annotations.js';
import { ProjectSchemas } from '../../utils/validation/project.schemas.js';
import { NoteSchemas } from '../../utils/validation/note.schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Register all project tools
 */
export const registerProjectTools: ToolRegistrar = (_context): ToolDefinition[] => {
  return [
    // Search Projects
    {
      tool: {
        name: 'autotask_search_projects',
        description:
          'Search for projects in Autotask. Returns 25 projects by default (max: 100). Use filters (searchTerm, companyID, status, projectManagerResourceID) to narrow results.',
        inputSchema: zodToJsonSchema(ProjectSchemas.SearchProjects, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Projects',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = ProjectSchemas.SearchProjects.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchProjects(validatedArgs as any);

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} projects (results may be truncated, API max: 100). Add filters (searchTerm, companyID, status, projectManagerResourceID) to narrow results.`
            : `Found ${result.length} projects`;

          return successResult({ projects: result, message });
        }, 'autotask_search_projects');
      },
    },

    // Create Project
    {
      tool: {
        name: 'autotask_create_project',
        description: 'Create a new project in Autotask',
        inputSchema: zodToJsonSchema(ProjectSchemas.CreateProject, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Project',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = ProjectSchemas.CreateProject.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createProject(validatedArgs as any);
          return successResult({
            id: result,
            message: `Successfully created project with ID: ${result}`,
          });
        }, 'autotask_create_project');
      },
    },

    // Get Project Note
    {
      tool: {
        name: 'autotask_get_project_note',
        description: 'Get a specific project note by project ID and note ID',
        inputSchema: zodToJsonSchema(NoteSchemas.GetProjectNote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Get Project Note',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.GetProjectNote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.getProjectNote(
            validatedArgs.projectId as number,
            validatedArgs.noteId as number,
          );
          return successResult({
            note: result,
            message: `Project note retrieved successfully`,
          });
        }, 'autotask_get_project_note');
      },
    },

    // Search Project Notes
    {
      tool: {
        name: 'autotask_search_project_notes',
        description: 'Search for notes on a specific project. Returns 25 notes by default (max: 100).',
        inputSchema: zodToJsonSchema(NoteSchemas.SearchProjectNotes, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Search Project Notes',
          ...READ_ONLY_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.SearchProjectNotes.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const requestedPageSize = validatedArgs.pageSize;
          const defaultPageSize = 25;
          const effectivePageSize = requestedPageSize === -1 ? 100 : requestedPageSize || defaultPageSize;

          const result = await ctx.autotaskService.searchProjectNotes(
            validatedArgs.projectId as number,
            { pageSize: validatedArgs.pageSize } as any,
          );

          const isTruncated = result.length >= effectivePageSize;
          const message = isTruncated
            ? `Returning ${result.length} project notes (results may be truncated, API max: 100). Consider limiting the time range of your query.`
            : `Found ${result.length} project notes`;

          return successResult({ notes: result, message });
        }, 'autotask_search_project_notes');
      },
    },

    // Create Project Note
    {
      tool: {
        name: 'autotask_create_project_note',
        description: 'Create a new note for a project',
        inputSchema: zodToJsonSchema(NoteSchemas.CreateProjectNote, { $refStrategy: 'none', target: 'jsonSchema7' }) as any,
        annotations: {
          title: 'Create Project Note',
          ...CREATE_ANNOTATIONS,
        },
      },
      handler: async (args, ctx) => {
        return withErrorHandling(async () => {
          const validation = NoteSchemas.CreateProjectNote.safeParse(args);
          if (!validation.success) {
            throw validation.error;
          }

          const validatedArgs = removeUndefined(validation.data);
          const result = await ctx.autotaskService.createProjectNote(
            validatedArgs.projectId as number,
            {
              title: validatedArgs.title,
              description: validatedArgs.description,
              noteType: validatedArgs.noteType,
            } as any,
          );
          return successResult({
            id: result,
            message: `Successfully created project note with ID: ${result}`,
          });
        }, 'autotask_create_project_note');
      },
    },
  ];
};
