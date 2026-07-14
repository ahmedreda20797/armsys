/**
 * Workflow Version Manager
 * Handles draft → publish → archive lifecycle, rollback, and migration.
 */

import type { WorkflowVersion, WorkflowDefinition } from '../types';
import { generateVersionId } from '../utils/ids';

export function createDraftVersion(
  workflowId: string,
  createdBy: string,
  fromVersion?: WorkflowVersion
): WorkflowVersion {
  const nextVersion = fromVersion ? fromVersion.version + 1 : 1;
  return {
    id: generateVersionId(workflowId, nextVersion),
    workflowId,
    version: nextVersion,
    label: `v${nextVersion}.0`,
    status: 'draft',
    steps: fromVersion ? [...fromVersion.steps] : [],
    transitions: fromVersion ? [...fromVersion.transitions] : [],
    variables: fromVersion ? [...fromVersion.variables] : [],
    triggers: fromVersion ? [...fromVersion.triggers] : [],
    publishedAt: null,
    publishedBy: null,
    createdAt: new Date().toISOString(),
    createdBy,
    changelog: '',
  };
}

export function publishVersion(
  version: WorkflowVersion,
  publishedBy: string
): WorkflowVersion {
  if (version.status !== 'draft') {
    throw new Error(`[VersionManager] Only draft versions can be published. Current: ${version.status}`);
  }
  return {
    ...version,
    status: 'published',
    publishedAt: new Date().toISOString(),
    publishedBy,
  };
}

export function archiveVersion(version: WorkflowVersion): WorkflowVersion {
  return { ...version, status: 'archived' };
}

/** Apply a rollback: archive current published, re-publish a previous version */
export function rollbackToVersion(
  current: WorkflowVersion,
  target: WorkflowVersion,
  performedBy: string
): { archived: WorkflowVersion; restored: WorkflowVersion } {
  return {
    archived: archiveVersion(current),
    restored: publishVersion({ ...target, status: 'draft' }, performedBy),
  };
}

/** Check backward compatibility — returns warnings if breaking changes detected */
export function checkCompatibility(
  oldVersion: WorkflowVersion,
  newVersion: WorkflowVersion
): string[] {
  const warnings: string[] = [];

  const oldStepIds = new Set(oldVersion.steps.map((s) => s.id));
  for (const step of newVersion.steps) {
    if (!oldStepIds.has(step.id)) {
      warnings.push(`New step added: ${step.id} — existing instances may be affected`);
    }
  }

  const removedSteps = oldVersion.steps.filter(
    (s) => !newVersion.steps.find((ns) => ns.id === s.id)
  );
  for (const step of removedSteps) {
    warnings.push(`Step removed: ${step.id} — running instances on this step will fail`);
  }

  return warnings;
}
