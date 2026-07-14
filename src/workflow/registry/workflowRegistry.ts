/**
 * Workflow Registry
 * Central in-memory registry. Every workflow registers itself here at startup.
 * No UI required. No Firebase writes — pure runtime registry.
 */

import type {
  WorkflowRegistryEntry,
  WorkflowModule,
  IWorkflowRegistry,
} from '../types';

class WorkflowRegistry implements IWorkflowRegistry {
  private readonly store = new Map<string, WorkflowRegistryEntry>();

  register(entry: WorkflowRegistryEntry): void {
    if (this.store.has(entry.id)) {
      console.warn(`[WorkflowRegistry] Overwriting existing registration: ${entry.id}`);
    }
    this.store.set(entry.id, { ...entry, updatedAt: new Date().toISOString() });
  }

  unregister(workflowId: string): void {
    this.store.delete(workflowId);
  }

  get(workflowId: string): WorkflowRegistryEntry | undefined {
    return this.store.get(workflowId);
  }

  getAll(): WorkflowRegistryEntry[] {
    return Array.from(this.store.values());
  }

  getByModule(module: WorkflowModule): WorkflowRegistryEntry[] {
    return this.getAll().filter((e) => e.module === module);
  }

  getByCategory(category: string): WorkflowRegistryEntry[] {
    return this.getAll().filter((e) => e.category === category);
  }

  getPublished(): WorkflowRegistryEntry[] {
    return this.getAll().filter((e) => e.status === 'published');
  }

  has(workflowId: string): boolean {
    return this.store.has(workflowId);
  }

  size(): number {
    return this.store.size;
  }
}

// Global singleton — imported by all modules
export const workflowRegistry = new WorkflowRegistry();

/**
 * Helper for modules to self-register.
 * Usage: registerWorkflow({ id: 'attendance-late-approval', module: 'attendance', ... })
 */
export function registerWorkflow(entry: WorkflowRegistryEntry): void {
  workflowRegistry.register(entry);
}
