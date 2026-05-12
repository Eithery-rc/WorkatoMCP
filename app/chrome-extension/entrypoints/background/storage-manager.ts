import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

/**
 * Get storage statistics
 *
 * NOTE: The vector indexer was removed in the v1.3 cleanup. This handler now
 * returns zeroed stats so legacy popup callers continue to function without errors.
 */
export async function handleGetStorageStats(): Promise<{
  success: boolean;
  stats?: any;
  error?: string;
}> {
  return {
    success: true,
    stats: {
      indexedPages: 0,
      totalDocuments: 0,
      totalTabs: 0,
      indexSize: 0,
      isInitialized: false,
      semanticEngineReady: false,
      semanticEngineInitializing: false,
    },
  };
}

/**
 * Clear all data
 *
 * NOTE: The vector indexer and vector database were removed in the v1.3 cleanup.
 * Only the legacy storage keys that referenced the indexer are cleared now.
 */
export async function handleClearAllData(): Promise<{ success: boolean; error?: string }> {
  try {
    const keysToRemove = ['vectorDatabaseStats', 'lastCleanupTime', 'contentIndexerStats'];
    await chrome.storage.local.remove(keysToRemove);
    return { success: true };
  } catch (error: any) {
    console.error('Background: Failed to clear storage data:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize storage manager module message listeners
 */
export const initStorageManagerListener = () => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.GET_STORAGE_STATS) {
      handleGetStorageStats()
        .then((result: { success: boolean; stats?: any; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (message.type === BACKGROUND_MESSAGE_TYPES.CLEAR_ALL_DATA) {
      handleClearAllData()
        .then((result: { success: boolean; error?: string }) => sendResponse(result))
        .catch((error: any) => sendResponse({ success: false, error: error.message }));
      return true;
    }
  });
};
