/**
 * The bridge's one WatchManager, wired to the connected Chrome profiles.
 * Shared by the MCP tools (chrome_watch_*) and the /watch/wait HTTP route.
 */
import * as path from 'path';
import { NativeMessageType } from 'workatomcp-shared';
import { profileRegistry } from '../server/profile-registry';
import { updateStateDir } from '../update-checker';
import { WatchManager } from './browser-watch';

const PROBE_REQUEST_TIMEOUT_MS = 30_000;

export const watchManager = new WatchManager({
  probe: async (profile, payload) => {
    const reply = await profileRegistry.sendRequest(
      profile,
      payload,
      NativeMessageType.WATCH_PROBE,
      PROBE_REQUEST_TIMEOUT_MS,
    );
    if (reply?.status !== 'success') {
      throw new Error(reply?.error || 'the extension did not answer the watch probe');
    }
    return reply.data;
  },
  isConnected: (profile) => profileRegistry.getConnectedProfiles().includes(profile),
  now: () => Date.now(),
  stateFile: path.join(updateStateDir(), 'watches.json'),
});
