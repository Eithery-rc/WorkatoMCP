#!/usr/bin/env node
import serverInstance from './server';
import nativeMessagingHostInstance from './native-messaging-host';
import * as path from 'path';
import { startUpdateChecker, updateStateDir } from './update-checker';
import { profileRegistry } from './server/profile-registry';

try {
  // The default profile outlives a bridge restart (an extension reload of the
  // profile that owns the port restarts this process).
  profileRegistry.enablePreferencePersistence(path.join(updateStateDir(), 'default-profile.json'));
  serverInstance.setNativeHost(nativeMessagingHostInstance); // Server needs setNativeHost method
  nativeMessagingHostInstance.setServer(serverInstance); // NativeHost needs setServer method
  nativeMessagingHostInstance.start();
  // Self-update: exiting cleanly makes the extension respawn the host via the
  // wrapper, which installs the pending version before the next launch.
  startUpdateChecker(() => {
    serverInstance
      .stop()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
} catch (error) {
  process.exit(1);
}

process.on('error', (error) => {
  process.exit(1);
});

// Handle process signals and uncaught exceptions
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

process.on('exit', (code) => {});

process.on('uncaughtException', (error) => {
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  // Don't exit immediately, let the program continue running
});
