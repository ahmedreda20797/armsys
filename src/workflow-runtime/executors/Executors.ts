/**
 * ARM ERP — Workflow Runtime V1 Concrete Executors
 *
 * One module per executor family. Each executor:
 *   - extends {@link BaseExecutor}
 *   - declares a static `nodeType`
 *   - implements the {@link execute} method
 *   - is registered with the {@link ExecutorRegistry} via {@link registerStandardExecutors}
 *
 * Adding a new business executor later (e.g. NotifyExecutor with a real
 * transport) does NOT require touching the runtime — register it and the
 * runtime will discover it.
 *
 * @module workflow-runtime/executors/Executors
 */

import type {
  RuntimeNode,
  RuntimeBranch,
  ExecutorResult,
  VariableValue,
} from '../types/runtime.types';
import type { RuntimeContext } from '../engine/RuntimeContext';
import {
  BaseExecutor,
  type ExecutorContext,
} from './BaseExecutor';
import { applyCondition } from './ConditionOps';

/* ════════════════════════════════════════════════════════════════════════
   START EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/** Entry node — passes control to its first downstream node. */
export class StartExecutor extends BaseExecutor {
  public static readonly nodeType = 'start';
  public readonly type = 'start';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    _exec: ExecutorContext,
  ): ExecutorResult {
    const nextNodeId = this.resolveNext(node, context);
    return { outcome: 'continue', nextNodeId };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   END EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/** Terminal node — completes the execution. */
export class EndExecutor extends BaseExecutor {
  public static readonly nodeType = 'end';
  public readonly type = 'end';

  public execute(
    _node: RuntimeNode,
    _context: RuntimeContext,
    _exec: ExecutorContext,
  ): ExecutorResult {
    return { outcome: 'complete', nextNodeId: null };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   IF EXECUTOR (condition)
   ════════════════════════════════════════════════════════════════════════ */

/** Conditional branching — evaluates branches and takes the first match. */
export class IfExecutor extends BaseExecutor {
  public static readonly nodeType = 'if';
  public readonly type = 'if';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    _exec: ExecutorContext,
  ): ExecutorResult {
    const branches = node.branches ?? [];
    for (const branch of branches) {
      const actual = context.variables.get(branch.field);
      if (applyCondition(branch.operator, actual, branch.expected)) {
        return {
          outcome: 'continue',
          nextNodeId: branch.targetNodeId,
          branchLabel: branch.label,
        };
      }
    }
    // No branch matched — fall through to first next or null.
    return { outcome: 'continue', nextNodeId: this.resolveNext(node, context) };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   SWITCH EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/** Multi-branch switch — same semantics as If but typically more branches. */
export class SwitchExecutor extends BaseExecutor {
  public static readonly nodeType = 'switch';
  public readonly type = 'switch';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    _exec: ExecutorContext,
  ): ExecutorResult {
    const branches: RuntimeBranch[] = node.branches ?? [];
    for (const branch of branches) {
      const actual = context.variables.get(branch.field);
      if (applyCondition(branch.operator, actual, branch.expected)) {
        return {
          outcome: 'continue',
          nextNodeId: branch.targetNodeId,
          branchLabel: branch.label,
        };
      }
    }
    // Default case: explicit "default" branch in config, else next, else null.
    const defaultTarget = node.config?.defaultTarget;
    if (typeof defaultTarget === 'string') {
      return { outcome: 'continue', nextNodeId: defaultTarget };
    }
    return { outcome: 'continue', nextNodeId: this.resolveNext(node, context) };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   DELAY EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/** Delays execution by a configurable number of milliseconds. */
export class DelayExecutor extends BaseExecutor {
  public static readonly nodeType = 'delay';
  public readonly type = 'delay';

  public async execute(
    node: RuntimeNode,
    context: RuntimeContext,
    exec: ExecutorContext,
  ): Promise<ExecutorResult> {
    const delayMs = readNumberConfig(node, 'delayMs', 0);
    if (delayMs > 0) {
      exec.logger.debug(
        { workflowId: context.workflowId, executionId: context.executionId, nodeId: node.id },
        `Delaying for ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
    return { outcome: 'continue', nextNodeId: this.resolveNext(node, context) };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   NOTIFY EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Notification executor — architecture-only. The actual transport (email,
 * push, in-app, SMS) is plugged by the host module via metadata. This
 * executor records the notification intent into nodeOutput so a downstream
 * sink (or future Notification module) can deliver it.
 */
export class NotifyExecutor extends BaseExecutor {
  public static readonly nodeType = 'notify';
  public readonly type = 'notify';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    exec: ExecutorContext,
  ): ExecutorResult {
    const channel = readStringConfig(node, 'channel', 'in-app');
    const to = node.config?.to;
    const subject = readStringConfig(node, 'subject', '');
    const body = readStringConfig(node, 'body', '');

    exec.logger.info(
      { workflowId: context.workflowId, executionId: context.executionId, nodeId: node.id },
      `Notify via ${channel}`,
      { channel, to },
    );

    return {
      outcome: 'continue',
      nextNodeId: this.resolveNext(node, context),
      output: {
        notification: {
          channel,
          to,
          subject,
          body,
          sentAt: Date.now(),
        } as unknown as VariableValue,
      },
    };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   SET VARIABLE EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/** Sets a variable in the execution scope from node config. */
export class SetVariableExecutor extends BaseExecutor {
  public static readonly nodeType = 'setVariable';
  public readonly type = 'setVariable';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    _exec: ExecutorContext,
  ): ExecutorResult {
    const name = readStringConfig(node, 'name', '');
    const rawValue = node.config?.value;
    const scope = readStringConfig(node, 'scope', 'execution') as
      | 'global'
      | 'workflow'
      | 'execution'
      | 'temp'
      | 'nodeOutput';

    if (!name) {
      return { outcome: 'continue', nextNodeId: this.resolveNext(node, context) };
    }

    // Allow value to be a variable reference (string starting with ${...}).
    let value: VariableValue = rawValue;
    if (typeof rawValue === 'string' && rawValue.startsWith('${') && rawValue.endsWith('}')) {
      value = context.variables.get(rawValue.slice(2, -1));
    }

    context.variables.set(name, value, scope);
    return {
      outcome: 'continue',
      nextNodeId: this.resolveNext(node, context),
      output: { [name]: value },
    };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   CREATE CAPA EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Creates a CAPA (Corrective and Preventive Action) record. This is the
 * canonical example of a business-specific executor — the runtime does not
 * know about CAPA, Firebase, or the database. It only records the intent
 * into nodeOutput; the host module subscribes to `node.completed` events
 * and persists the CAPA via the existing module.
 */
export class CreateCAPAExecutor extends BaseExecutor {
  public static readonly nodeType = 'createCAPA';
  public readonly type = 'createCAPA';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    exec: ExecutorContext,
  ): ExecutorResult {
    const title = readStringConfig(node, 'title', 'Untitled CAPA');
    const severity = readStringConfig(node, 'severity', 'medium');
    const source = node.config?.source ?? context.workflowId;
    const description = readStringConfig(node, 'description', '');

    const capaId = `capa_${context.executionId}_${node.id}`;

    exec.logger.info(
      { workflowId: context.workflowId, executionId: context.executionId, nodeId: node.id },
      `Creating CAPA "${title}"`,
      { capaId, severity },
    );

    return {
      outcome: 'continue',
      nextNodeId: this.resolveNext(node, context),
      output: {
        capaId,
        capa: {
          id: capaId,
          title,
          severity,
          source,
          description,
          status: 'open',
          createdAt: Date.now(),
        } as unknown as VariableValue,
      },
    };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   ASSIGN EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/** Assigns a workload item to a user/role. Records the assignment intent. */
export class AssignExecutor extends BaseExecutor {
  public static readonly nodeType = 'assign';
  public readonly type = 'assign';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    exec: ExecutorContext,
  ): ExecutorResult {
    const assignee = readStringConfig(node, 'assignee', '');
    const role = readStringConfig(node, 'role', '');
    const itemType = readStringConfig(node, 'itemType', 'task');

    const assignmentId = `assign_${context.executionId}_${node.id}`;

    exec.logger.info(
      { workflowId: context.workflowId, executionId: context.executionId, nodeId: node.id },
      `Assigning ${itemType} to ${assignee || `role:${role}`}`,
    );

    return {
      outcome: 'continue',
      nextNodeId: this.resolveNext(node, context),
      output: {
        assignmentId,
        assignment: {
          id: assignmentId,
          assignee,
          role,
          itemType,
          status: 'assigned',
          assignedAt: Date.now(),
        } as unknown as VariableValue,
      },
    };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   PLACEHOLDER EXECUTOR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Pass-through executor for not-yet-implemented business nodes. Also used as
 * the registry fallback so unknown node types never crash the runtime — they
 * are logged as a warning and the flow continues.
 */
export class PlaceholderExecutor extends BaseExecutor {
  public static readonly nodeType = 'placeholder';
  public readonly type = 'placeholder';

  public execute(
    node: RuntimeNode,
    context: RuntimeContext,
    exec: ExecutorContext,
  ): ExecutorResult {
    exec.logger.warn(
      { workflowId: context.workflowId, executionId: context.executionId, nodeId: node.id },
      `Placeholder executor used for node type "${node.type ?? node.kind}"`,
    );
    return {
      outcome: 'continue',
      nextNodeId: this.resolveNext(node, context),
      message: 'placeholder',
    };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   REGISTRATION HELPER
   ════════════════════════════════════════════════════════════════════════ */

import type { ExecutorRegistry } from './ExecutorRegistry';

/**
 * Instantiate and register every standard executor. This is the single
 * place the runtime needs to be aware of executor classes — adding a new
 * executor means adding it to this list (or registering it externally).
 */
export function registerStandardExecutors(registry: ExecutorRegistry): ExecutorRegistry {
  registry.registerAll([
    new StartExecutor(),
    new EndExecutor(),
    new IfExecutor(),
    new SwitchExecutor(),
    new DelayExecutor(),
    new NotifyExecutor(),
    new SetVariableExecutor(),
    new CreateCAPAExecutor(),
    new AssignExecutor(),
    new PlaceholderExecutor(),
  ]);
  // The placeholder is the safe fallback for any unrecognised node type.
  registry.setFallback(new PlaceholderExecutor());
  return registry;
}

/* ════════════════════════════════════════════════════════════════════════
   INTERNAL HELPERS
   ════════════════════════════════════════════════════════════════════════ */

function readStringConfig(node: RuntimeNode, key: string, fallback: string): string {
  const v = node.config?.[key];
  return typeof v === 'string' ? v : fallback;
}

function readNumberConfig(node: RuntimeNode, key: string, fallback: number): number {
  const v = node.config?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
