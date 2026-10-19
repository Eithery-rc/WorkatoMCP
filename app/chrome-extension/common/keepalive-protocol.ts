/**
 * @fileoverview Keepalive Protocol Constants
 * @description Shared protocol constants for Background-Offscreen keepalive communication
 */

/** Keepalive port name */
export const KEEPALIVE_PORT_NAME = 'keepalive' as const;

/** Runtime message the background sends to start or stop the offscreen ping loop */
export const KEEPALIVE_CONTROL_MESSAGE_TYPE = 'keepalive.control' as const;

export type KeepaliveControlCommand = 'start' | 'stop';

export interface KeepaliveControlMessage {
  type: typeof KEEPALIVE_CONTROL_MESSAGE_TYPE;
  command: KeepaliveControlCommand;
}

/** Keepalive message types */
export type KeepaliveMessageType =
  | 'keepalive.ping'
  | 'keepalive.pong'
  | 'keepalive.start'
  | 'keepalive.stop';

/** Keepalive message */
export interface KeepaliveMessage {
  type: KeepaliveMessageType;
  timestamp: number;
}

/** Default heartbeat interval (ms) — Offscreen sends ping at this interval */
export const DEFAULT_KEEPALIVE_PING_INTERVAL_MS = 20_000;

/** Max heartbeat interval (ms) — Chrome MV3 SW terminates after ~30 s idle */
export const MAX_KEEPALIVE_PING_INTERVAL_MS = 25_000;
