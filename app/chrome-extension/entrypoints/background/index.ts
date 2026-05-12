import { initNativeHostListener } from './native-host';
import { initRecordReplayListeners } from './record-replay';
import { initElementMarkerListeners } from './element-marker';

// Record-Replay V3 (feature flag)
import { bootstrapV3 } from './record-replay-v3/bootstrap';

/**
 * Feature flag for RR-V3
 * Set to true to enable the new Record-Replay V3 engine
 */
const ENABLE_RR_V3 = true;

/**
 * Background script entry point
 * Initializes all background services and listeners
 */
export default defineBackground(() => {
  // Open welcome page on first install
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // Open the welcome/onboarding page for new installations
      chrome.tabs.create({
        url: chrome.runtime.getURL('/welcome.html'),
      });
    }
  });

  // Initialize core services
  initNativeHostListener();
  // Record & Replay V1/V2 listeners
  initRecordReplayListeners();

  // Record & Replay V3 (new engine)
  if (ENABLE_RR_V3) {
    bootstrapV3()
      .then((runtime) => {
        console.log(`[RR-V3] Bootstrap complete, ownerId: ${runtime.ownerId}`);
      })
      .catch((error) => {
        console.error('[RR-V3] Bootstrap failed:', error);
      });
  }

  // Element marker: context menu + CRUD listeners
  initElementMarkerListeners();
});
