/**
 * @fileoverview Trigger handler interface definitions.
 */

import type { TriggerSpec, TriggerKind } from '../../domain/triggers';

/**
 * Trigger handler interface — each trigger kind must implement this.
 */
export interface TriggerHandler<K extends TriggerKind = TriggerKind> {
  /** Trigger kind. */
  readonly kind: K;

  /**
   * Install the trigger (register chrome API listeners, etc.).
   * @param trigger Trigger specification.
   */
  install(trigger: Extract<TriggerSpec, { kind: K }>): Promise<void>;

  /**
   * Uninstall the trigger (remove chrome API listeners, etc.).
   * @param triggerId Trigger ID.
   */
  uninstall(triggerId: string): Promise<void>;

  /**
   * Uninstall all triggers of this kind.
   */
  uninstallAll(): Promise<void>;

  /**
   * Return the list of currently installed trigger IDs.
   */
  getInstalledIds(): string[];
}

/**
 * Trigger fire callback — injected into each handler by the TriggerManager.
 */
export interface TriggerFireCallback {
  /**
   * Called when a trigger fires.
   * @param triggerId Trigger ID.
   * @param context Fire context.
   */
  onFire(
    triggerId: string,
    context: {
      sourceTabId?: number;
      sourceUrl?: string;
    },
  ): Promise<void>;
}

/**
 * Factory that creates a TriggerHandler for a specific kind.
 */
export type TriggerHandlerFactory<K extends TriggerKind> = (
  fireCallback: TriggerFireCallback,
) => TriggerHandler<K>;
