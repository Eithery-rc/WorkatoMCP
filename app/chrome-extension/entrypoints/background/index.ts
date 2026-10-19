import { initNativeHostListener } from './native-host';
import { removeLegacyData } from './legacy-cleanup';

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
    if (details.reason === 'update') {
      // Drop data only the removed upstream features wrote (best effort)
      void removeLegacyData();
    }
  });

  // Initialize core services
  initNativeHostListener();
});
