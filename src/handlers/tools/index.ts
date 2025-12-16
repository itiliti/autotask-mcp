/**
 * Tool Modules Index
 *
 * Exports all tool registrars for easy registration with the ToolRegistry.
 */

export { ToolRegistry, ToolContext, ToolHandler, ToolDefinition, ToolRegistrar } from './tool.registry.js';
export { successResult, errorResult, validateArgs, removeUndefined, withErrorHandling, PAGE_SIZE_MEDIUM, PAGE_SIZE_LIMITED } from './base.tool.js';

// Tool registrars - import for local use
import { registerSystemTools } from './system.tools.js';
import { registerCompanyTools } from './company.tools.js';
import { registerContactTools } from './contact.tools.js';
import { registerTicketTools } from './ticket.tools.js';
import { registerProjectTools } from './project.tools.js';
import { registerResourceTools } from './resource.tools.js';
import { registerTaskTools } from './task.tools.js';
import { registerTimeTools } from './time.tools.js';
import { registerAttachmentTools } from './attachment.tools.js';
import { registerExpenseTools } from './expense.tools.js';
import { registerQuoteTools } from './quote.tools.js';
import { registerContractTools } from './contract.tools.js';
import { registerInvoiceTools } from './invoice.tools.js';
import { registerConfigItemTools } from './config-item.tools.js';

// Re-export for external use
export {
  registerSystemTools,
  registerCompanyTools,
  registerContactTools,
  registerTicketTools,
  registerProjectTools,
  registerResourceTools,
  registerTaskTools,
  registerTimeTools,
  registerAttachmentTools,
  registerExpenseTools,
  registerQuoteTools,
  registerContractTools,
  registerInvoiceTools,
  registerConfigItemTools,
};

/**
 * All tool registrars in registration order
 */
export const allToolRegistrars = [
  registerSystemTools,
  registerCompanyTools,
  registerContactTools,
  registerTicketTools,
  registerProjectTools,
  registerResourceTools,
  registerTaskTools,
  registerTimeTools,
  registerAttachmentTools,
  registerExpenseTools,
  registerQuoteTools,
  registerContractTools,
  registerInvoiceTools,
  registerConfigItemTools,
];
