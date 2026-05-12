/**
 * @fileoverview Plugin registry — manages registration and lookup of node and trigger plugins.
 */

import type { NodeKind } from '../../domain/flow';
import type { TriggerKind } from '../../domain/triggers';
import { RR_ERROR_CODES, createRRError } from '../../domain/errors';
import type {
  NodeDefinition,
  TriggerDefinition,
  PluginRegistrationContext,
  RRPlugin,
} from './types';

/**
 * Plugin registry — manages all registered nodes and triggers.
 */
export class PluginRegistry implements PluginRegistrationContext {
  private nodes = new Map<NodeKind, NodeDefinition>();
  private triggers = new Map<TriggerKind, TriggerDefinition>();

  /**
   * Register a node definition (overwrites any existing definition for the same kind).
   */
  registerNode(def: NodeDefinition): void {
    this.nodes.set(def.kind, def);
  }

  /**
   * Register a trigger definition (overwrites any existing definition for the same kind).
   */
  registerTrigger(def: TriggerDefinition): void {
    this.triggers.set(def.kind, def);
  }

  /**
   * Get a node definition, or undefined if not registered.
   */
  getNode(kind: NodeKind): NodeDefinition | undefined {
    return this.nodes.get(kind);
  }

  /**
   * Get a node definition, throwing an RRError if not registered.
   */
  getNodeOrThrow(kind: NodeKind): NodeDefinition {
    const def = this.nodes.get(kind);
    if (!def) {
      throw createRRError(RR_ERROR_CODES.UNSUPPORTED_NODE, `Node kind "${kind}" is not registered`);
    }
    return def;
  }

  /**
   * Get a trigger definition, or undefined if not registered.
   */
  getTrigger(kind: TriggerKind): TriggerDefinition | undefined {
    return this.triggers.get(kind);
  }

  /**
   * Get a trigger definition, throwing an RRError if not registered.
   */
  getTriggerOrThrow(kind: TriggerKind): TriggerDefinition {
    const def = this.triggers.get(kind);
    if (!def) {
      throw createRRError(
        RR_ERROR_CODES.UNSUPPORTED_NODE,
        `Trigger kind "${kind}" is not registered`,
      );
    }
    return def;
  }

  /**
   * Whether a node kind is registered.
   */
  hasNode(kind: NodeKind): boolean {
    return this.nodes.has(kind);
  }

  /**
   * Whether a trigger kind is registered.
   */
  hasTrigger(kind: TriggerKind): boolean {
    return this.triggers.has(kind);
  }

  /**
   * List all registered node kinds.
   */
  listNodeKinds(): NodeKind[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * List all registered trigger kinds.
   */
  listTriggerKinds(): TriggerKind[] {
    return Array.from(this.triggers.keys());
  }

  /**
   * Register a plugin by calling its register method.
   */
  registerPlugin(plugin: RRPlugin): void {
    plugin.register(this);
  }

  /**
   * Register multiple plugins.
   */
  registerPlugins(plugins: RRPlugin[]): void {
    for (const plugin of plugins) {
      this.registerPlugin(plugin);
    }
  }

  /**
   * Remove all registered nodes and triggers.
   * Primarily used in tests.
   */
  clear(): void {
    this.nodes.clear();
    this.triggers.clear();
  }
}

/** Module-level singleton plugin registry. */
let globalRegistry: PluginRegistry | null = null;

/**
 * Get the global plugin registry (creating it on first access).
 */
export function getPluginRegistry(): PluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new PluginRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global plugin registry.
 * Primarily used in tests.
 */
export function resetPluginRegistry(): void {
  globalRegistry = null;
}
