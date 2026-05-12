/**
 * @fileoverview Trigger type definitions for Record-Replay V3.
 */

import type { JsonObject, UnixMillis } from './json';
import type { FlowId, TriggerId } from './ids';

/** Trigger kind. */
export type TriggerKind =
  | 'manual'
  | 'url'
  | 'cron'
  | 'interval'
  | 'once'
  | 'command'
  | 'contextMenu'
  | 'dom';

/**
 * Base interface shared by all trigger specs.
 */
export interface TriggerSpecBase {
  /** Trigger ID. */
  id: TriggerId;
  /** Trigger kind. */
  kind: TriggerKind;
  /** Whether the trigger is enabled. */
  enabled: boolean;
  /** Associated Flow ID. */
  flowId: FlowId;
  /** Arguments passed to the flow. */
  args?: JsonObject;
}

/**
 * URL match rule.
 */
export interface UrlMatchRule {
  kind: 'url' | 'domain' | 'path';
  value: string;
}

/**
 * Union of all trigger spec variants.
 */
export type TriggerSpec =
  // Manual trigger
  | (TriggerSpecBase & { kind: 'manual' })

  // URL trigger
  | (TriggerSpecBase & {
      kind: 'url';
      match: UrlMatchRule[];
    })

  // Cron trigger
  | (TriggerSpecBase & {
      kind: 'cron';
      cron: string;
      timezone?: string;
    })

  // Interval trigger (repeating at a fixed interval)
  | (TriggerSpecBase & {
      kind: 'interval';
      /** Interval in minutes (minimum 1). */
      periodMinutes: number;
    })

  // Once trigger (fires at a specific time, then auto-disables)
  | (TriggerSpecBase & {
      kind: 'once';
      /** Fire timestamp (Unix milliseconds). */
      whenMs: UnixMillis;
    })

  // Keyboard shortcut trigger
  | (TriggerSpecBase & {
      kind: 'command';
      commandKey: string;
    })

  // Context-menu trigger
  | (TriggerSpecBase & {
      kind: 'contextMenu';
      title: string;
      contexts?: ReadonlyArray<string>;
    })

  // DOM element appearance trigger
  | (TriggerSpecBase & {
      kind: 'dom';
      selector: string;
      appear?: boolean;
      once?: boolean;
      debounceMs?: UnixMillis;
    });

/**
 * Context describing when and how a trigger fired.
 */
export interface TriggerFireContext {
  /** Trigger ID. */
  triggerId: TriggerId;
  /** Trigger kind. */
  kind: TriggerKind;
  /** Time the trigger fired. */
  firedAt: UnixMillis;
  /** Source tab ID. */
  sourceTabId?: number;
  /** Source URL. */
  sourceUrl?: string;
}

/**
 * Extract a typed trigger spec by kind.
 */
export type TriggerSpecByKind<K extends TriggerKind> = Extract<TriggerSpec, { kind: K }>;

/**
 * Whether a trigger is enabled.
 */
export function isTriggerEnabled(trigger: TriggerSpec): boolean {
  return trigger.enabled;
}

/**
 * Create a TriggerFireContext for a given trigger.
 */
export function createTriggerFireContext(
  trigger: TriggerSpec,
  options?: { sourceTabId?: number; sourceUrl?: string },
): TriggerFireContext {
  return {
    triggerId: trigger.id,
    kind: trigger.kind,
    firedAt: Date.now(),
    sourceTabId: options?.sourceTabId,
    sourceUrl: options?.sourceUrl,
  };
}
