/**
 * Core Service Infrastructure
 *
 * Exports shared infrastructure used by all entity services:
 * - ServiceContext: Shared dependencies and helpers
 * - BaseEntityService: Abstract base class for entity services
 * - Note utilities: Common note validation and payload building
 * - QueryCounterService: Count-based query segmentation
 */

export { ServiceContext, type IServiceContext, type PaginationConfig } from './service.context.js';
export { BaseEntityService } from './base.service.js';
export { NoteValidation, buildNotePayload, type NotePayloadParams } from './base-note.service.js';
export {
  QueryCounterService,
  type QueryCountResult,
  type DateSegment,
  type SegmentedQueryResult,
  type SegmentResult,
  type SegmentationConfig,
} from './query-counter.service.js';
