/**
 * Module Registration Helper
 * Each ARM module calls registerModuleWorkflows() at startup to register its workflows.
 * No module-specific logic lives here — only the registration contract.
 */

import type {
  WorkflowRegistryEntry,
  WorkflowModule,
  WorkflowPermissions,
} from '../types';
import { registerWorkflow } from '../registry/workflowRegistry';
import { registerVersion } from '../services/workflowService';
import type { WorkflowVersion } from '../types';

export interface ModuleWorkflowConfig {
  id: string;
  name: string;
  description: string;
  module: WorkflowModule;
  category: string;
  ownerId: string;
  permissions: WorkflowPermissions;
  version: WorkflowVersion;
  supportedEvents?: string[];
  tags?: string[];
}

export function registerModuleWorkflow(config: ModuleWorkflowConfig): void {
  const entry: WorkflowRegistryEntry = {
    id: config.id,
    name: config.name,
    version: config.version.version,
    latestVersionId: config.version.id,
    ownerId: config.ownerId,
    module: config.module,
    category: config.category,
    description: config.description,
    status: config.version.status === 'published' ? 'published' : 'draft',
    permissions: config.permissions,
    entryPoint: config.version.steps[0]?.id ?? '',
    supportedEvents: config.supportedEvents ?? [],
    registeredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  registerWorkflow(entry);
  registerVersion(config.version);
}

/** Default open permissions — override per workflow */
export const OPEN_PERMISSIONS: WorkflowPermissions = {
  canView:    ['admin', 'hr', 'manager', 'quality'],
  canExecute: ['admin', 'hr', 'manager', 'quality'],
  canEdit:    ['admin'],
  canPublish: ['admin'],
};

export const ADMIN_ONLY_PERMISSIONS: WorkflowPermissions = {
  canView:    ['admin'],
  canExecute: ['admin'],
  canEdit:    ['admin'],
  canPublish: ['admin'],
};
