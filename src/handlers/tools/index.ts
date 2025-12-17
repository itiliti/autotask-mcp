/**
 * Tool Modules Index
 *
 * Exports all tool registrars for easy registration with the ToolRegistry.
 *
 * Tool modules can be enabled/disabled via environment variables:
 *   AUTOTASK_ENABLED_TOOLS - Comma-separated list of enabled tool modules
 *   AUTOTASK_DISABLED_TOOLS - Comma-separated list of disabled tool modules
 *
 * Available modules: system, company, contact, ticket, project, resource,
 *                    task, time, attachment, expense, quote, contract, invoice, config-item
 *
 * Examples:
 *   AUTOTASK_ENABLED_TOOLS=system,company,contact,ticket,resource
 *   AUTOTASK_DISABLED_TOOLS=quote,invoice,project,task
 *
 * If AUTOTASK_ENABLED_TOOLS is set, only those modules are loaded.
 * If AUTOTASK_DISABLED_TOOLS is set (and ENABLED is not), those modules are excluded.
 * If neither is set, all modules are loaded (default behavior).
 */

import { ToolRegistrar } from './tool.registry.js';

export { ToolRegistry, ToolContext, ToolHandler, ToolDefinition, ToolRegistrar } from './tool.registry.js';
export { successResult, errorResult, validateArgs, removeUndefined, withErrorHandling, PAGE_SIZE_MEDIUM, PAGE_SIZE_LIMITED } from './base.tool.js';

// Tool registrars - import for local use
import { registerSystemTools } from './system.tools.js';
import { registerQueryTools } from './query.tools.js';
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
  registerQueryTools,
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
 * Tool module registry mapping module names to registrars
 */
const toolModuleRegistry: Record<string, ToolRegistrar> = {
  system: registerSystemTools,
  query: registerQueryTools,
  company: registerCompanyTools,
  contact: registerContactTools,
  ticket: registerTicketTools,
  project: registerProjectTools,
  resource: registerResourceTools,
  task: registerTaskTools,
  time: registerTimeTools,
  attachment: registerAttachmentTools,
  expense: registerExpenseTools,
  quote: registerQuoteTools,
  contract: registerContractTools,
  invoice: registerInvoiceTools,
  'config-item': registerConfigItemTools,
};

/**
 * Default enabled modules (all modules)
 */
export const defaultEnabledModules = Object.keys(toolModuleRegistry);

/**
 * Parse comma-separated environment variable into array of module names
 */
function parseModuleList(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0);
}

/**
 * Get the list of enabled tool modules based on environment configuration
 */
export function getEnabledModules(): string[] {
  const enabledEnv = process.env.AUTOTASK_ENABLED_TOOLS;
  const disabledEnv = process.env.AUTOTASK_DISABLED_TOOLS;

  // If explicit enabled list is provided, use only those
  if (enabledEnv) {
    const enabled = parseModuleList(enabledEnv);
    // Filter to only valid module names
    return enabled.filter((m) => toolModuleRegistry[m] !== undefined);
  }

  // If disabled list is provided, exclude those from all modules
  if (disabledEnv) {
    const disabled = new Set(parseModuleList(disabledEnv));
    return defaultEnabledModules.filter((m) => !disabled.has(m));
  }

  // Default: all modules enabled
  return defaultEnabledModules;
}

/**
 * Get tool registrars for enabled modules only
 *
 * Respects AUTOTASK_ENABLED_TOOLS and AUTOTASK_DISABLED_TOOLS environment variables.
 */
export function getEnabledToolRegistrars(): ToolRegistrar[] {
  const enabledModules = getEnabledModules();
  return enabledModules
    .map((name) => toolModuleRegistry[name])
    .filter((registrar): registrar is ToolRegistrar => registrar !== undefined);
}

/**
 * All tool registrars (for backward compatibility)
 * Note: Use getEnabledToolRegistrars() for environment-aware loading
 */
export const allToolRegistrars = Object.values(toolModuleRegistry);
