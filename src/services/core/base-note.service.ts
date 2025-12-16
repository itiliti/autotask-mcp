/**
 * Base Note Service Mixin
 *
 * Provides common note-related validation and utility methods
 * that are shared across entity services that handle notes
 * (TicketService, ProjectService, CompanyService).
 *
 * Note: This is not meant to be instantiated directly.
 * Entity services should use these helpers via composition.
 */

/**
 * Common note validation utilities
 */
export const NoteValidation = {
  /**
   * Maximum description length for notes (Autotask limit)
   */
  MAX_DESCRIPTION_LENGTH: 32000,

  /**
   * Maximum title length for notes (Autotask limit)
   */
  MAX_TITLE_LENGTH: 250,

  /**
   * Valid publish levels for notes
   * 1 = Internal Only (default)
   * 2 = All Autotask Users
   * 3 = Everyone (portal visible)
   */
  PUBLISH_LEVELS: {
    INTERNAL: 1,
    ALL_AUTOTASK_USERS: 2,
    EVERYONE: 3,
  } as const,

  /**
   * Valid note types
   * 1 = General (default)
   * 2 = Appointment
   * 3 = Task
   * 4 = Ticket
   * 5 = Project
   * 6 = Opportunity
   */
  NOTE_TYPES: {
    GENERAL: 1,
    APPOINTMENT: 2,
    TASK: 3,
    TICKET: 4,
    PROJECT: 5,
    OPPORTUNITY: 6,
  } as const,

  /**
   * Validate description field
   * @throws Error if description is invalid
   */
  validateDescription(description: string | undefined): void {
    if (!description || description.trim().length === 0) {
      throw new Error('description is required and cannot be empty');
    }
    if (description.length > NoteValidation.MAX_DESCRIPTION_LENGTH) {
      throw new Error(
        `Note description exceeds maximum length of ${NoteValidation.MAX_DESCRIPTION_LENGTH} characters. ` +
          `Current length: ${description.length}`,
      );
    }
  },

  /**
   * Validate publish level
   * @throws Error if publish level is invalid
   */
  validatePublishLevel(publish: number): void {
    const validLevels = [1, 2, 3];
    if (!validLevels.includes(publish)) {
      throw new Error(
        `Invalid publish level: ${publish}. Must be 1 (Internal Only), 2 (All Autotask Users), or 3 (Everyone)`,
      );
    }
  },

  /**
   * Validate note type
   * @throws Error if note type is invalid
   */
  validateNoteType(noteType: number): void {
    const validTypes = [1, 2, 3, 4, 5, 6];
    if (!validTypes.includes(noteType)) {
      throw new Error(
        `Invalid note type: ${noteType}. Must be 1-6 (General, Appointment, Task, Ticket, Project, Opportunity)`,
      );
    }
  },

  /**
   * Get default publish level
   */
  getDefaultPublishLevel(): number {
    return NoteValidation.PUBLISH_LEVELS.INTERNAL;
  },

  /**
   * Get default note type
   */
  getDefaultNoteType(): number {
    return NoteValidation.NOTE_TYPES.GENERAL;
  },
};

/**
 * Note payload builder for Autotask REST API
 *
 * Helps build consistent PascalCase payloads for note creation
 */
export interface NotePayloadParams {
  description: string;
  title?: string;
  publish?: number;
  noteType?: number;
  creatorResourceID?: number;
}

export function buildNotePayload(params: NotePayloadParams): Record<string, any> {
  // Validate required fields
  NoteValidation.validateDescription(params.description);

  const publish = params.publish ?? NoteValidation.getDefaultPublishLevel();
  NoteValidation.validatePublishLevel(publish);

  const noteType = params.noteType ?? NoteValidation.getDefaultNoteType();

  // Build PascalCase payload for Autotask REST API
  const payload: Record<string, any> = {
    Description: params.description.trim(),
    Publish: publish,
    NoteType: noteType,
  };

  // Title is conditionally required based on entity settings
  if (params.title && params.title.trim().length > 0) {
    payload.Title = params.title.trim();
  }

  // CreatorResourceID is optional
  if (params.creatorResourceID !== undefined) {
    payload.CreatorResourceID = params.creatorResourceID;
  }

  return payload;
}
