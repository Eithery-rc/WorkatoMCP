/**
 * Profile Registry - Manage active Chrome profile connections over WebSockets.
 *
 * Author: Roman Chikalenko
 * Version: 1.4.0
 */
import { v4 as uuidv4 } from 'uuid';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: NodeJS.Timeout;
}

function logProfileRegistry(message: string): void {
  console.error(message);
}

export class ProfileRegistry {
  private connections: Map<string, any> = new Map(); // profileName -> WebSocket socket
  private activeProfile: string | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private defaultTimeoutMs = 120000;

  /**
   * Register a new profile connection
   */
  public register(profileName: string, socket: any): void {
    // If there's an existing socket for this profile, close it first
    const existing = this.connections.get(profileName);
    if (existing) {
      try {
        existing.close();
      } catch (e) {
        // Ignore
      }
    }

    this.connections.set(profileName, socket);
    logProfileRegistry(`[ProfileRegistry] Profile "${profileName}" connected.`);

    // If no active profile, or the active profile is no longer connected, set this as active
    if (!this.activeProfile || !this.connections.has(this.activeProfile)) {
      this.activeProfile = profileName;
      logProfileRegistry(`[ProfileRegistry] Active profile automatically set to "${profileName}".`);
    }

    // Set up message handling for this socket
    socket.on('message', (rawData: any) => {
      try {
        const message = JSON.parse(rawData.toString());
        this.handleIncomingMessage(profileName, message);
      } catch (error: any) {
        console.error(
          `[ProfileRegistry] Failed to parse message from profile "${profileName}":`,
          error.message,
        );
      }
    });

    socket.on('close', () => {
      this.deregister(profileName);
    });

    socket.on('error', (err: any) => {
      console.error(`[ProfileRegistry] Socket error for profile "${profileName}":`, err);
      this.deregister(profileName);
    });
  }

  /**
   * Deregister a profile connection
   */
  public deregister(profileName: string): void {
    if (this.connections.has(profileName)) {
      this.connections.delete(profileName);
      logProfileRegistry(`[ProfileRegistry] Profile "${profileName}" disconnected.`);

      if (this.activeProfile === profileName) {
        // Elect a new active profile from remaining connections
        const remaining = Array.from(this.connections.keys());
        if (remaining.length > 0) {
          this.activeProfile = remaining[0];
          logProfileRegistry(
            `[ProfileRegistry] Active profile automatically switched to "${this.activeProfile}".`,
          );
        } else {
          this.activeProfile = null;
          logProfileRegistry(`[ProfileRegistry] No profiles connected. Active profile is null.`);
        }
      }
    }
  }

  /**
   * Switch the active profile
   */
  public switchProfile(profileName: string): boolean {
    if (this.connections.has(profileName)) {
      this.activeProfile = profileName;
      logProfileRegistry(`[ProfileRegistry] Active profile switched to "${profileName}".`);
      return true;
    }
    console.warn(
      `[ProfileRegistry] Cannot switch to "${profileName}" because it is not connected.`,
    );
    return false;
  }

  /**
   * Get the active profile name
   */
  public getActiveProfile(): string | null {
    // Double check that activeProfile is still connected
    if (this.activeProfile && !this.connections.has(this.activeProfile)) {
      const remaining = Array.from(this.connections.keys());
      this.activeProfile = remaining.length > 0 ? remaining[0] : null;
    }
    return this.activeProfile;
  }

  /**
   * Get all connected profile names
   */
  public getConnectedProfiles(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Send a request to a specific profile and wait for response
   */
  public sendRequest(
    profileName: string,
    messagePayload: any,
    messageType: string = 'request_data',
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = this.connections.get(profileName);
      if (!socket) {
        return reject(new Error(`Profile "${profileName}" is not connected`));
      }

      const requestId = uuidv4();
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request to profile "${profileName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });

      const envelope = {
        type: messageType,
        payload: messagePayload,
        requestId: requestId,
      };

      try {
        socket.send(JSON.stringify(envelope));
      } catch (err: any) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(new Error(`Failed to send message to profile "${profileName}": ${err.message}`));
      }
    });
  }

  /**
   * Handle incoming message from WebSocket client
   */
  private handleIncomingMessage(profileName: string, message: any): void {
    if (!message || typeof message !== 'object') return;

    if (message.responseToRequestId) {
      const requestId = message.responseToRequestId;
      const pending = this.pendingRequests.get(requestId);

      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(requestId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          // Return the full payload (containing status, data, error)
          pending.resolve(message.payload);
        }
      }
    }
  }
}

export const profileRegistry = new ProfileRegistry();
