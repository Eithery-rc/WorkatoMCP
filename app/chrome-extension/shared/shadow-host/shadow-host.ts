/**
 * Shadow Host
 *
 * Creates an isolated Shadow DOM container for content-script overlays
 * (currently used by the Element Picker; previously also Quick Panel).
 *
 * - Style isolation via Shadow DOM (no CSS bleed in/out)
 * - Event isolation (UI events don't bubble to the host page)
 * - Default theme, switched to the dark variant when the system prefers dark
 *
 * Architecture:
 * - Host element attached to documentElement with highest z-index
 * - Shadow root contains styles + UI container
 */

import { Disposer } from '@/shared/utils/disposables';
import { SHADOW_HOST_STYLES } from './styles';

// ============================================================
// Types
// ============================================================

/**
 * Elements exposed by the shadow host for UI mounting.
 */
export interface ShadowHostElements {
  /** The host element attached to the document */
  host: HTMLElement;
  /** The shadow root */
  shadowRoot: ShadowRoot;
  /** Container for UI elements (pointer-events: none by default) */
  uiRoot: HTMLElement;
  /** Theme root element (class="agent-theme qp-root") */
  root: HTMLElement;
}

/**
 * Manager interface for the shadow host.
 */
export interface ShadowHostManager {
  /** Get the current elements (null if disposed) */
  getElements: () => ShadowHostElements | null;
  /** Check if a node belongs to this shadow host */
  isOverlayElement: (node: unknown) => boolean;
  /** Check if an event originated from within the shadow host */
  isEventFromUi: (event: Event) => boolean;
  /** Clean up and remove the shadow host */
  dispose: () => void;
}

/**
 * Options for mounting the shadow host.
 */
export interface ShadowHostOptions {
  /** Custom host element ID (default: __mcp_quick_panel_host__) */
  hostId?: string;
  /** Custom z-index (default: 2147483647 - highest possible) */
  zIndex?: number;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_HOST_ID = '__mcp_quick_panel_host__';
const UI_CONTAINER_ID = '__mcp_quick_panel_ui__';
const ROOT_ID = '__mcp_quick_panel_root__';

/** Highest possible z-index to ensure Quick Panel is on top */
const DEFAULT_Z_INDEX = 2147483647;

/** Default (light) theme */
const DEFAULT_THEME_ID = 'warm-editorial';

/** Theme used when the system prefers a dark color scheme */
const DARK_THEME_ID = 'dark-console';

/** Events to stop from propagating to the host page */
const BLOCKED_EVENT_TYPES = [
  // Pointer events
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointercancel',
  // Mouse events
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseenter',
  'mouseleave',
  'click',
  'dblclick',
  'contextmenu',
  // Keyboard events
  'keydown',
  'keyup',
  'keypress',
  // Touch events
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  // Scroll events
  'wheel',
  // Form events
  'focus',
  'blur',
  'input',
  'change',
] as const;

// ============================================================
// Utility Functions
// ============================================================

/**
 * Set a CSS property with !important to override page styles.
 */
function setImportantStyle(element: HTMLElement, property: string, value: string): void {
  element.style.setProperty(property, value, 'important');
}

/**
 * Check if system prefers dark mode.
 */
function systemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Apply the theme to the root element: the default one, or the dark variant
 * when the system prefers a dark color scheme.
 */
function applyTheme(root: HTMLElement): void {
  root.dataset.agentTheme = systemPrefersDark() ? DARK_THEME_ID : DEFAULT_THEME_ID;
}

// ============================================================
// Main Export
// ============================================================

/**
 * Mount an isolated Shadow DOM host into the page.
 *
 * @param options - Configuration options
 * @returns Manager interface for the shadow host
 *
 * @example
 * ```typescript
 * const shadowHost = mountShadowHost();
 * const elements = shadowHost.getElements();
 *
 * if (elements) {
 *   // Mount your overlay UI into elements.root
 * }
 *
 * // Cleanup when done
 * shadowHost.dispose();
 * ```
 */
export function mountShadowHost(options: ShadowHostOptions = {}): ShadowHostManager {
  const disposer = new Disposer();
  let elements: ShadowHostElements | null = null;

  const hostId = options.hostId ?? DEFAULT_HOST_ID;
  const zIndex = options.zIndex ?? DEFAULT_Z_INDEX;

  // Clean up any existing host (from previous instance or crash recovery)
  const existing = document.getElementById(hostId);
  if (existing) {
    try {
      existing.remove();
    } catch {
      // Best-effort cleanup
    }
  }

  // Create host element
  const host = document.createElement('div');
  host.id = hostId;
  host.setAttribute('data-mcp-shadow-host', 'true');

  // Apply styles with !important to override page styles
  setImportantStyle(host, 'position', 'fixed');
  setImportantStyle(host, 'inset', '0');
  setImportantStyle(host, 'z-index', String(zIndex));
  setImportantStyle(host, 'pointer-events', 'none');
  setImportantStyle(host, 'contain', 'layout style paint');
  setImportantStyle(host, 'isolation', 'isolate');

  // Create shadow root
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = SHADOW_HOST_STYLES;
  shadowRoot.append(styleEl);

  // Create UI container
  const uiRoot = document.createElement('div');
  uiRoot.id = UI_CONTAINER_ID;
  setImportantStyle(uiRoot, 'position', 'fixed');
  setImportantStyle(uiRoot, 'inset', '0');
  setImportantStyle(uiRoot, 'pointer-events', 'none');
  shadowRoot.append(uiRoot);

  // Create theme root (where UI components mount)
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'agent-theme qp-root';

  // Apply theme synchronously BEFORE mounting to avoid flash
  applyTheme(root);

  uiRoot.append(root);

  // Mount to document
  const mountPoint = document.documentElement ?? document.body;
  mountPoint.append(host);
  disposer.add(() => host.remove());

  elements = { host, shadowRoot, uiRoot, root };

  // Event isolation: stop UI events from bubbling to the page
  const stopPropagation = (event: Event): void => {
    event.stopPropagation();
  };

  for (const eventType of BLOCKED_EVENT_TYPES) {
    disposer.listen(root, eventType, stopPropagation);
  }

  // Re-apply the theme when the system color scheme changes
  try {
    const darkModeMediaQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (darkModeMediaQuery) {
      const handleDarkModeChange = (): void => {
        applyTheme(root);
      };

      // Use addEventListener for modern browsers
      if (typeof darkModeMediaQuery.addEventListener === 'function') {
        darkModeMediaQuery.addEventListener('change', handleDarkModeChange);
        disposer.add(() => darkModeMediaQuery.removeEventListener('change', handleDarkModeChange));
      }
    }
  } catch {
    // Best-effort: dark mode detection is optional
  }

  // Helper to check if a node belongs to this shadow host
  const isOverlayElement = (node: unknown): boolean => {
    if (!(node instanceof Node)) return false;
    if (node === host) return true;

    const rootNode = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
    return rootNode instanceof ShadowRoot && rootNode.host === host;
  };

  // Helper to check if an event originated from within the shadow host
  const isEventFromUi = (event: Event): boolean => {
    try {
      if (typeof event.composedPath === 'function') {
        return event.composedPath().some((el) => isOverlayElement(el));
      }
    } catch {
      // Fallback to checking target
    }
    return isOverlayElement(event.target);
  };

  return {
    getElements: () => elements,
    isOverlayElement,
    isEventFromUi,
    dispose: () => {
      elements = null;
      disposer.dispose();
    },
  };
}
