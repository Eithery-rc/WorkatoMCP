/**
 * The popup's Modules section, background side: read and write the bridge's
 * module switch over the WebSocket, and answer with what the popup shows.
 */

import { NativeMessageType } from 'workatomcp-shared';
import { DEFAULT_ENABLED, type ModuleStates } from '@/common/module-state';
import type { BridgeRequests, BridgeSocket } from './bridge-requests';

/** Whether the switch can be changed right now. */
export type ModulesBridge = 'connected' | 'disconnected' | 'unsupported';

export interface PopupModuleInfo {
  id: string;
  title: string;
  description: string;
}

export interface ModulePopupDeps {
  /** The open bridge socket, or null. */
  socket: () => BridgeSocket | null;
  requests: BridgeRequests;
  /** Keep a modules_state from the bridge (memory, storage, open popup). */
  applyState: (payload: unknown) => Promise<unknown>;
  /** The id -> on map last stored. */
  storedStates: () => Promise<ModuleStates>;
  /** Every module compiled into the extension. */
  modules: readonly PopupModuleInfo[];
}

export interface ModulesReply {
  success: boolean;
  bridge: ModulesBridge;
  error?: string;
  modules: Array<PopupModuleInfo & { enabled: boolean }>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createModulePopupHandlers(deps: ModulePopupDeps) {
  const reply = async (
    bridge: ModulesBridge,
    extra: { success?: boolean; error?: string } = {},
  ): Promise<ModulesReply> => {
    const states = await deps.storedStates();
    return {
      success: extra.success ?? true,
      bridge,
      ...(extra.error ? { error: extra.error } : {}),
      modules: deps.modules.map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description,
        enabled: states[module.id] ?? DEFAULT_ENABLED,
      })),
    };
  };

  return {
    /** The switch as the bridge has it; the last stored state when it cannot say. */
    async getModules(): Promise<ModulesReply> {
      const socket = deps.socket();
      if (!socket) return reply('disconnected');
      try {
        await deps.applyState(await deps.requests.request(socket, NativeMessageType.MODULES_GET));
        return reply('connected');
      } catch (error) {
        return reply('unsupported', { error: message(error) });
      }
    },

    /** Change one switch in the bridge; every profile hears of it from there. */
    async setModule(id: unknown, enabled: unknown): Promise<ModulesReply> {
      const socket = deps.socket();
      if (!socket) return reply('disconnected', { success: false });
      try {
        await deps.applyState(
          await deps.requests.request(socket, NativeMessageType.MODULES_SET, { id, enabled }),
        );
        return reply('connected');
      } catch (error) {
        return reply('connected', { success: false, error: message(error) });
      }
    },
  };
}
