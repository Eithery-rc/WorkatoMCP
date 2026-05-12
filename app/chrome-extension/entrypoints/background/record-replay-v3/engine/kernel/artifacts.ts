/**
 * @fileoverview Artifact (screenshot) interfaces and implementations for Record-Replay V3.
 */

import type { NodeId, RunId } from '../../domain/ids';
import type { RRError } from '../../domain/errors';
import { RR_ERROR_CODES, createRRError } from '../../domain/errors';

/**
 * Screenshot capture result.
 */
export type ScreenshotResult = { ok: true; base64: string } | { ok: false; error: RRError };

/**
 * Artifact service interface — provides screenshot capture and storage.
 */
export interface ArtifactService {
  /**
   * Capture a screenshot of the visible tab.
   * @param tabId Tab ID
   * @param options Capture options
   */
  screenshot(
    tabId: number,
    options?: {
      format?: 'png' | 'jpeg';
      quality?: number;
    },
  ): Promise<ScreenshotResult>;

  /**
   * Persist a screenshot.
   * @param runId Run ID
   * @param nodeId Node ID
   * @param base64 Screenshot data
   * @param filename Optional filename
   */
  saveScreenshot(
    runId: RunId,
    nodeId: NodeId,
    base64: string,
    filename?: string,
  ): Promise<{ savedAs: string } | { error: RRError }>;
}

/**
 * Create a stub ArtifactService that returns not-implemented errors.
 * Placeholder for Phase 0–1.
 */
export function createNotImplementedArtifactService(): ArtifactService {
  return {
    screenshot: async () => ({
      ok: false,
      error: createRRError(RR_ERROR_CODES.INTERNAL, 'ArtifactService.screenshot not implemented'),
    }),
    saveScreenshot: async () => ({
      error: createRRError(
        RR_ERROR_CODES.INTERNAL,
        'ArtifactService.saveScreenshot not implemented',
      ),
    }),
  };
}

/**
 * Create an ArtifactService backed by chrome.tabs.captureVisibleTab.
 */
export function createChromeArtifactService(): ArtifactService {
  // In-memory storage for screenshots (could be replaced with IndexedDB)
  const screenshotStore = new Map<string, string>();

  return {
    screenshot: async (tabId, options) => {
      try {
        // Get the window ID for the tab
        const tab = await chrome.tabs.get(tabId);
        if (!tab.windowId) {
          return {
            ok: false,
            error: createRRError(RR_ERROR_CODES.INTERNAL, `Tab ${tabId} has no window`),
          };
        }

        // Capture the visible tab
        const format = options?.format ?? 'png';
        const quality = options?.quality ?? 100;

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format,
          quality: format === 'jpeg' ? quality : undefined,
        });

        // Extract base64 from data URL
        const base64Match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        if (!base64Match) {
          return {
            ok: false,
            error: createRRError(RR_ERROR_CODES.INTERNAL, 'Invalid screenshot data URL'),
          };
        }

        return { ok: true, base64: base64Match[1] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: createRRError(RR_ERROR_CODES.INTERNAL, `Screenshot failed: ${message}`),
        };
      }
    },

    saveScreenshot: async (runId, nodeId, base64, filename) => {
      try {
        // Generate filename if not provided
        const savedAs = filename ?? `${runId}_${nodeId}_${Date.now()}.png`;
        const key = `${runId}/${savedAs}`;

        // Store in memory (in production, this would go to IndexedDB or cloud storage)
        screenshotStore.set(key, base64);

        return { savedAs };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          error: createRRError(RR_ERROR_CODES.INTERNAL, `Save screenshot failed: ${message}`),
        };
      }
    },
  };
}

/**
 * Artifact policy executor — decides whether to capture artifacts based on policy configuration.
 */
export interface ArtifactPolicyExecutor {
  /**
   * Execute the screenshot policy.
   * @param policy Screenshot policy
   * @param context Execution context
   */
  executeScreenshotPolicy(
    policy: 'never' | 'onFailure' | 'always',
    context: {
      tabId: number;
      runId: RunId;
      nodeId: NodeId;
      failed: boolean;
      saveAs?: string;
    },
  ): Promise<{ captured: boolean; savedAs?: string; error?: RRError }>;
}

/**
 * Create the default ArtifactPolicyExecutor.
 */
export function createArtifactPolicyExecutor(service: ArtifactService): ArtifactPolicyExecutor {
  return {
    executeScreenshotPolicy: async (policy, context) => {
      // Decide whether to capture based on the policy
      const shouldCapture = policy === 'always' || (policy === 'onFailure' && context.failed);

      if (!shouldCapture) {
        return { captured: false };
      }

      // Capture screenshot
      const result = await service.screenshot(context.tabId);
      if (!result.ok) {
        return { captured: false, error: result.error };
      }

      // Save if a filename was specified
      if (context.saveAs) {
        const saveResult = await service.saveScreenshot(
          context.runId,
          context.nodeId,
          result.base64,
          context.saveAs,
        );
        if ('error' in saveResult) {
          return { captured: true, error: saveResult.error };
        }
        return { captured: true, savedAs: saveResult.savedAs };
      }

      return { captured: true };
    },
  };
}
