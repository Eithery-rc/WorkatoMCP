<template>
  <div class="popup-container agent-theme" :data-agent-theme="agentTheme">
    <!-- Home view -->
    <div v-show="currentView === 'home'" class="home-view">
      <div class="header">
        <div class="header-content">
          <h1 class="header-title">WorkatoMCP</h1>
        </div>
      </div>
      <div class="content">
        <!-- Server configuration card -->
        <div class="section">
          <h2 class="section-title">{{ getMessage('nativeServerConfigLabel') }}</h2>
          <div class="config-card">
            <div class="status-section">
              <div class="status-header">
                <p class="status-label">{{ getMessage('runningStatusLabel') }}</p>
                <button
                  class="refresh-status-button"
                  @click="refreshServerStatus"
                  :title="getMessage('refreshStatusButton')"
                >
                  <RefreshIcon className="icon-small" />
                </button>
              </div>
              <div class="status-info">
                <span :class="['status-dot', getStatusClass()]"></span>
                <span class="status-text">{{ getStatusText() }}</span>
              </div>
              <div v-if="serverStatus.lastUpdated" class="status-timestamp">
                {{ getMessage('lastUpdatedLabel') }}
                {{ new Date(serverStatus.lastUpdated).toLocaleTimeString() }}
              </div>
            </div>

            <div v-if="showMcpConfig" class="mcp-config-section">
              <div
                class="mcp-config-header"
                @click="showConfigDetails = !showConfigDetails"
                style="cursor: pointer"
              >
                <p class="mcp-config-label">
                  {{ getMessage('mcpServerConfigLabel') }}
                  <span class="chevron-icon" :class="{ expanded: showConfigDetails }">▾</span>
                </p>
                <button class="copy-config-button" @click.stop="copyMcpConfig">
                  {{ copyButtonText }}
                </button>
              </div>
              <Transition name="slide-fade">
                <div v-show="showConfigDetails" class="mcp-config-content">
                  <pre class="mcp-config-json">{{ mcpConfigJson }}</pre>
                </div>
              </Transition>
            </div>
            <div class="port-grid">
              <div class="port-section">
                <label for="port" class="port-label">{{ getMessage('connectionPortLabel') }}</label>
                <input
                  type="text"
                  id="port"
                  :value="nativeServerPort"
                  @input="updatePort"
                  class="port-input"
                />
              </div>
              <div class="port-section">
                <label for="profile" class="port-label">Profile Name</label>
                <input
                  type="text"
                  id="profile"
                  :value="profileName"
                  @input="updateProfileName"
                  class="port-input"
                  placeholder="e.g. prod, staging, dev"
                />
              </div>
            </div>

            <button class="connect-button" :disabled="isConnecting" @click="testNativeConnection">
              <BoltIcon />
              <span>{{
                isConnecting
                  ? getMessage('connectingStatus')
                  : nativeConnectionStatus === 'connected'
                    ? getMessage('disconnectButton')
                    : getMessage('connectButton')
              }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="footer">
        <div class="footer-links">
          <button class="footer-link" @click="openWelcomePage" title="View installation guide">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Guide
          </button>
          <button class="footer-link" @click="openTroubleshooting" title="Troubleshooting">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            Docs
          </button>
        </div>
        <p class="footer-text">chrome mcp server for ai</p>
      </div>
    </div>

    <!-- Workflow management lives in the side panel; editor opens in a separate window -->

    <!-- Coming Soon Toast -->
    <Transition name="toast">
      <div v-if="comingSoonToast.show" class="coming-soon-toast">
        <svg
          class="toast-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ comingSoonToast.feature }} — coming soon</span>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
/**
 * Extension popup UI main component.
 * Allows configuring settings and viewing connection states, including Chrome profile name setup.
 *
 * Author: Roman Chikalenko
 * Version: 1.5.7
 */
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { LINKS } from '@/common/constants';
import { getMessage } from '@/utils/i18n';
import { useAgentTheme } from '@/shared/agent-theme/useAgentTheme';

import { BoltIcon, RecordIcon, StopIcon, RefreshIcon, MarkerIcon } from './components/icons';

// AgentChat theme — loaded from preload to stay consistent with the side panel.
const { theme: agentTheme, initTheme } = useAgentTheme();

// Current view state: home only.
const currentView = ref<'home'>('home');

// Coming Soon Toast
const comingSoonToast = ref<{ show: boolean; feature: string }>({ show: false, feature: '' });

function showComingSoonToast(feature: string) {
  comingSoonToast.value = { show: true, feature };
  setTimeout(() => {
    comingSoonToast.value = { show: false, feature: '' };
  }, 2000);
}

// Record & Replay state
const rrRecording = ref(false);
const rrFlows = ref<
  Array<{ id: string; name: string; description?: string; meta?: any; variables?: any[] }>
>([]);
const rrOnlyBound = ref(false);
const rrSearch = ref('');
const currentTabUrl = ref<string>('');
const filteredRrFlows = computed(() => {
  const base = rrOnlyBound.value ? rrFlows.value.filter(isFlowBoundToCurrent) : rrFlows.value;
  const q = rrSearch.value.trim().toLowerCase();
  if (!q) return base;
  return base.filter((f: any) => {
    const name = String(f.name || '').toLowerCase();
    const domain = String(f?.meta?.domain || '').toLowerCase();
    const tags = ((f?.meta?.tags || []) as any[]).join(',').toLowerCase();
    return name.includes(q) || domain.includes(q) || tags.includes(q);
  });
});

// Flow editor opens in a separate window; popup no longer shows the full list.

const loadFlows = async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_LIST_FLOWS });
    if (res && res.success) rrFlows.value = res.flows || [];
  } catch (e) {
    /* ignore */
  }
};

function isFlowBoundToCurrent(flow: any) {
  try {
    const bindings = flow?.meta?.bindings || [];
    if (!bindings.length) return false;
    if (!currentTabUrl.value) return true;
    const url = new URL(currentTabUrl.value);
    return bindings.some((b: any) => {
      if (b.type === 'domain') return url.hostname.includes(b.value);
      if (b.type === 'path') return url.pathname.startsWith(b.value);
      if (b.type === 'url') return (url.href || '').startsWith(b.value);
      return false;
    });
  } catch {
    return false;
  }
}

// Run history and overrides are viewed in the side panel.
const startRecording = async () => {
  // TODO: Record-replay feature is under development — stub for now.
  showComingSoonToast('Record-Replay');
  return;
};

const stopRecording = async () => {
  // TODO: Record-replay feature is under development — stub for now.
  showComingSoonToast('Record-Replay');
  return;
};

const runFlow = async (flowId: string) => {
  try {
    // load flow to get runOptions
    let flow: any = null;
    try {
      const getRes = await chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.RR_GET_FLOW,
        flowId,
      });
      if (getRes && getRes.success) flow = getRes.flow;
    } catch {}
    const runOptions = (flow && flow.meta && flow.meta.runOptions) || {};
    // No per-run overrides in popup; sidepanel/editor manage advanced options
    const ov: any = {};
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_RUN_FLOW,
      flowId,
      options: { ...runOptions, ...ov, returnLogs: true },
    });
    if (!(res && res.success)) {
      console.warn('Playback failed');
      return;
    }
    // Builder window removed: failed/fallback steps are now surfaced via logs only.
  } catch (e) {
    console.error('Playback failed:', e);
  }
};

// Clone/publish/schedule/override operations are handled in the side panel or editor.

const nativeConnectionStatus = ref<'unknown' | 'connected' | 'disconnected'>('unknown');
const isConnecting = ref(false);
const nativeServerPort = ref<number>(12306);
const profileName = ref<string>('default');
const showConfigDetails = ref(false);

const serverStatus = ref<{
  isRunning: boolean;
  port?: number;
  lastUpdated: number;
}>({
  isRunning: false,
  lastUpdated: Date.now(),
});

const showMcpConfig = computed(() => {
  return nativeConnectionStatus.value === 'connected' && serverStatus.value.isRunning;
});

const copyButtonText = ref(getMessage('copyConfigButton'));

const mcpConfigJson = computed(() => {
  const port = serverStatus.value.port || nativeServerPort.value;
  const config = {
    mcpServers: {
      'streamable-mcp-server': {
        type: 'streamable-http',
        url: `http://127.0.0.1:${port}/mcp`,
      },
    },
  };
  return JSON.stringify(config, null, 2);
});

const getStatusClass = () => {
  if (nativeConnectionStatus.value === 'connected') {
    if (serverStatus.value.isRunning) {
      return 'bg-emerald-500';
    } else {
      return 'bg-yellow-500';
    }
  } else if (nativeConnectionStatus.value === 'disconnected') {
    return 'bg-red-500';
  } else {
    return 'bg-gray-500';
  }
};

async function toggleElementMarker() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.warn('Cannot get active tab');
      return;
    }

    await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_START,
      tabId: tab.id,
    });
  } catch (error) {
    console.warn('Failed to open element marker:', error);
  }
}

async function openWelcomePage() {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  } catch {
    // ignore
  }
}

async function openTroubleshooting() {
  try {
    await chrome.tabs.create({ url: LINKS.TROUBLESHOOTING });
  } catch {
    // ignore
  }
}

const getStatusText = () => {
  if (nativeConnectionStatus.value === 'connected') {
    if (serverStatus.value.isRunning) {
      return getMessage('serviceRunningStatus', [
        (serverStatus.value.port || 'Unknown').toString(),
      ]);
    } else {
      return getMessage('connectedServiceNotStartedStatus');
    }
  } else if (nativeConnectionStatus.value === 'disconnected') {
    return getMessage('serviceNotConnectedStatus');
  } else {
    return getMessage('detectingStatus');
  }
};

const updatePort = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const newPort = Number(target.value);
  nativeServerPort.value = newPort;

  await savePortPreference(newPort);
};

const updateProfileName = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const newName = target.value.trim() || 'default';
  profileName.value = newName;

  await saveProfileNamePreference(newName);
};

const checkNativeConnection = async () => {
  try {
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({ type: 'ping_native' });
    nativeConnectionStatus.value = response?.connected ? 'connected' : 'disconnected';
  } catch (error) {
    console.error('Failed to check native connection status:', error);
    nativeConnectionStatus.value = 'disconnected';
  }
};

const checkServerStatus = async () => {
  try {
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    if (response?.success && response.serverStatus) {
      serverStatus.value = response.serverStatus;
    }

    if (response?.connected !== undefined) {
      nativeConnectionStatus.value = response.connected ? 'connected' : 'disconnected';
    }
  } catch (error) {
    console.error('Failed to check server status:', error);
  }
};

const refreshServerStatus = async () => {
  try {
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS,
    });
    if (response?.success && response.serverStatus) {
      serverStatus.value = response.serverStatus;
    }

    if (response?.connected !== undefined) {
      nativeConnectionStatus.value = response.connected ? 'connected' : 'disconnected';
    }
  } catch (error) {
    console.error('Failed to refresh server status:', error);
  }
};

const copyMcpConfig = async () => {
  try {
    await navigator.clipboard.writeText(mcpConfigJson.value);
    copyButtonText.value = '✅' + getMessage('configCopiedNotification');

    setTimeout(() => {
      copyButtonText.value = getMessage('copyConfigButton');
    }, 2000);
  } catch (error) {
    console.error('Failed to copy config:', error);
    copyButtonText.value = '❌' + getMessage('networkErrorMessage');

    setTimeout(() => {
      copyButtonText.value = getMessage('copyConfigButton');
    }, 2000);
  }
};

const testNativeConnection = async () => {
  if (isConnecting.value) return;
  isConnecting.value = true;
  try {
    if (nativeConnectionStatus.value === 'connected') {
      // eslint-disable-next-line no-undef
      await chrome.runtime.sendMessage({ type: 'disconnect_native' });
      nativeConnectionStatus.value = 'disconnected';
    } else {
      console.log(`Attempting connection to port: ${nativeServerPort.value}`);
      // eslint-disable-next-line no-undef
      const response = await chrome.runtime.sendMessage({
        type: 'connectNative',
        port: nativeServerPort.value,
      });
      if (response && response.success) {
        nativeConnectionStatus.value = 'connected';
        console.log('Connection successful:', response);
        await savePortPreference(nativeServerPort.value);
      } else {
        nativeConnectionStatus.value = 'disconnected';
        console.error('Connection failed:', response);
      }
    }
  } catch (error) {
    console.error('Connection test failed:', error);
    nativeConnectionStatus.value = 'disconnected';
  } finally {
    isConnecting.value = false;
  }
};

const savePortPreference = async (port: number) => {
  try {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({ nativeServerPort: port });
    console.log(`Port preference saved: ${port}`);
  } catch (error) {
    console.error('Failed to save port preference:', error);
  }
};

const loadPortPreference = async () => {
  try {
    // eslint-disable-next-line no-undef
    const result = await chrome.storage.local.get(['nativeServerPort']);
    if (result.nativeServerPort) {
      nativeServerPort.value = result.nativeServerPort;
      console.log(`Port preference loaded: ${result.nativeServerPort}`);
    }
  } catch (error) {
    console.error('Failed to load port preference:', error);
  }
};

const saveProfileNamePreference = async (name: string) => {
  try {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({ profileName: name });
    console.log(`Profile name preference saved: ${name}`);
  } catch (error) {
    console.error('Failed to save profile name preference:', error);
  }
};

const loadProfileNamePreference = async () => {
  try {
    // eslint-disable-next-line no-undef
    const result = await chrome.storage.local.get(['profileName']);
    if (result.profileName) {
      profileName.value = result.profileName;
      console.log(`Profile name preference loaded: ${result.profileName}`);
    }
  } catch (error) {
    console.error('Failed to load profile name preference:', error);
  }
};

const setupServerStatusListener = () => {
  // eslint-disable-next-line no-undef
  const onMessage = (message: { type?: string; payload?: unknown }) => {
    // Server status changes
    if (message.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED && message.payload) {
      serverStatus.value = message.payload as any;
      console.log('Server status updated:', message.payload);
    }
    // Flows changed - refresh list (IndexedDB-based notification)
    if (message.type === BACKGROUND_MESSAGE_TYPES.RR_FLOWS_CHANGED) {
      loadFlows();
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // Store reference for cleanup
  (window as any).__rr_popup_onMessage = onMessage;
};

onMounted(async () => {
  await initTheme();
  await loadPortPreference();
  await loadProfileNamePreference();
  await checkNativeConnection();
  await checkServerStatus();
  await loadFlows();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabUrl.value = tab?.url || '';
  } catch {}

  setupServerStatusListener();
  // Auto-refresh workflows list when storage rr_flows changes
  try {
    const onChanged = (changes: any, area: string) => {
      try {
        if (area !== 'local') return;
        if (Object.prototype.hasOwnProperty.call(changes || {}, 'rr_flows')) loadFlows();
      } catch {}
    };
    chrome.storage.onChanged.addListener(onChanged);
    (window as any).__rr_popup_onChanged = onChanged;
  } catch {}
});

onUnmounted(() => {
  // Clean up runtime message listener
  try {
    const msgFn = (window as any).__rr_popup_onMessage;
    if (msgFn && chrome?.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(msgFn);
    }
  } catch {}
  // Clean up storage change listener (legacy fallback)
  try {
    const fn = (window as any).__rr_popup_onChanged;
    if (fn && chrome?.storage?.onChanged?.removeListener) {
      chrome.storage.onChanged.removeListener(fn);
    }
  } catch {}
});
</script>

<style scoped>
/* Spring Slide-up Staggered Cascades */
@keyframes spring-slide-up {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.popup-container {
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 16px;
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family:
    var(--ac-font-body),
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  height: 100%;
  transition: all var(--transition-slow);
}

/* 1. Warm Editorial Glass Card */
.popup-container[data-agent-theme='warm-editorial'] {
  background: rgba(253, 252, 248, 0.35);
  border: 1px solid rgba(217, 119, 87, 0.22);
  box-shadow:
    0 10px 30px rgba(217, 119, 87, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  font-family: var(--ac-font-sans);
}
.popup-container[data-agent-theme='warm-editorial'] .header-title {
  background: linear-gradient(135deg, #d97757 0%, #c4664a 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.popup-container[data-agent-theme='warm-editorial'] .config-card {
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(217, 119, 87, 0.12);
}
.popup-container[data-agent-theme='warm-editorial'] .connect-button {
  background: linear-gradient(135deg, #d97757 0%, #c4664a 100%);
  box-shadow: 0 4px 14px rgba(217, 119, 87, 0.2);
}
.popup-container[data-agent-theme='warm-editorial'] .connect-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #c4664a 0%, #b4583c 100%);
  box-shadow: 0 6px 20px rgba(217, 119, 87, 0.35);
}

/* 2. Blueprint Architect Glass Card */
.popup-container[data-agent-theme='blueprint-architect'] {
  background: rgba(247, 251, 255, 0.35);
  border: 1px solid rgba(37, 99, 235, 0.28);
  box-shadow:
    0 10px 30px rgba(37, 99, 235, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  font-family: var(--ac-font-grotesk);
}
.popup-container[data-agent-theme='blueprint-architect'] .header-title {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-family: var(--ac-font-grotesk);
}
.popup-container[data-agent-theme='blueprint-architect'] .config-card {
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(37, 99, 235, 0.15);
}
.popup-container[data-agent-theme='blueprint-architect'] .connect-button {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.2);
}
.popup-container[data-agent-theme='blueprint-architect'] .connect-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);
}

/* 3. Zen Journal Glass Card */
.popup-container[data-agent-theme='zen-journal'] {
  background: rgba(244, 244, 245, 0.35);
  border: 1px solid rgba(113, 113, 122, 0.25);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  font-family: var(--ac-font-sans);
}
.popup-container[data-agent-theme='zen-journal'] .header-title {
  background: linear-gradient(135deg, #27272a 0%, #52525b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.popup-container[data-agent-theme='zen-journal'] .config-card {
  background: rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(113, 113, 122, 0.15);
}
.popup-container[data-agent-theme='zen-journal'] .connect-button {
  background: linear-gradient(135deg, #27272a 0%, #18181b 100%);
  box-shadow: 0 4px 14px rgba(39, 39, 42, 0.15);
}
.popup-container[data-agent-theme='zen-journal'] .connect-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #18181b 0%, #09090b 100%);
  box-shadow: 0 6px 20px rgba(39, 39, 42, 0.25);
}

/* 4. Neo-Pop Glass Card */
.popup-container[data-agent-theme='neo-pop'] {
  background: rgba(255, 255, 255, 0.7);
  border: 2px solid #000000;
  box-shadow: 4px 4px 0px #000000;
  font-family: var(--ac-font-grotesk);
}
.popup-container[data-agent-theme='neo-pop'] .header-title {
  background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-family: var(--ac-font-grotesk);
  font-weight: 900;
}
.popup-container[data-agent-theme='neo-pop'] .config-card {
  background: rgba(255, 255, 255, 0.85);
  border: 2px solid #000000;
  box-shadow: 3px 3px 0px #000000;
}
.popup-container[data-agent-theme='neo-pop'] .connect-button {
  background: #ec4899;
  border: 2px solid #000000;
  color: #000000;
  font-weight: 800;
  box-shadow: 3px 3px 0px #000000;
}
.popup-container[data-agent-theme='neo-pop'] .connect-button:hover:not(:disabled) {
  background: #f43f5e;
  transform: translate(-1px, -1px) scale(1.01);
  box-shadow: 4px 4px 0px #000000;
}
.popup-container[data-agent-theme='neo-pop'] .connect-button:active:not(:disabled) {
  transform: translate(2px, 2px) scale(0.98);
  box-shadow: 1px 1px 0px #000000;
}
.popup-container[data-agent-theme='neo-pop'] .port-input {
  border: 2px solid #000000;
  background: #ffffff;
}
.popup-container[data-agent-theme='neo-pop'] .port-input:focus {
  transform: scale(1);
  box-shadow: 2px 2px 0px #000000;
}

/* 5. Dark Console Glass Card */
.popup-container[data-agent-theme='dark-console'] {
  background: rgba(9, 9, 11, 0.55);
  border: 1px solid rgba(34, 197, 94, 0.32);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  font-family: var(--ac-font-mono);
}
.popup-container[data-agent-theme='dark-console'] .header-title {
  background: linear-gradient(135deg, #22c55e 0%, #10b981 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-family: var(--ac-font-mono);
  letter-spacing: -0.05em;
}
.popup-container[data-agent-theme='dark-console'] .config-card {
  background: rgba(18, 18, 24, 0.45);
  border: 1px solid rgba(34, 197, 94, 0.18);
}
.popup-container[data-agent-theme='dark-console'] .connect-button {
  background: linear-gradient(135deg, #22c55e 0%, #10b981 100%);
  color: #052e16;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(34, 197, 94, 0.15);
}
.popup-container[data-agent-theme='dark-console'] .connect-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
  box-shadow: 0 6px 20px rgba(34, 197, 94, 0.25);
}
.popup-container[data-agent-theme='dark-console'] .port-input {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #22c55e;
  font-family: var(--ac-font-mono);
}
.popup-container[data-agent-theme='dark-console'] .port-input:focus {
  border-color: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
}
.popup-container[data-agent-theme='dark-console'] .mcp-config-json {
  color: #22c55e;
}
.popup-container[data-agent-theme='dark-console'] .status-text,
.popup-container[data-agent-theme='dark-console'] .section-title,
.popup-container[data-agent-theme='dark-console'] .port-label,
.popup-container[data-agent-theme='dark-console'] .status-label,
.popup-container[data-agent-theme='dark-console'] .mcp-config-label {
  color: rgba(34, 197, 94, 0.85);
}
.popup-container[data-agent-theme='dark-console'] .footer-link {
  color: rgba(34, 197, 94, 0.7);
}
.popup-container[data-agent-theme='dark-console'] .footer-link:hover {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.05);
}
.popup-container[data-agent-theme='dark-console'] .copy-config-button {
  color: rgba(34, 197, 94, 0.8);
  border: 1px solid rgba(34, 197, 94, 0.25);
}
.popup-container[data-agent-theme='dark-console'] .copy-config-button:hover {
  background: rgba(34, 197, 94, 0.08);
  color: #22c55e;
}
.popup-container[data-agent-theme='dark-console'] .chevron-icon {
  color: #22c55e;
}

/* 6. Swiss Grid Glass Card */
.popup-container[data-agent-theme='swiss-grid'] {
  background: rgba(255, 255, 255, 0.75);
  border: 2px solid #000000;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.03);
  font-family: var(--ac-font-grotesk);
}
.popup-container[data-agent-theme='swiss-grid'] .header-title {
  background: #ef4444;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-family: var(--ac-font-grotesk);
  font-weight: 900;
}
.popup-container[data-agent-theme='swiss-grid'] .config-card {
  background: #ffffff;
  border: 2px solid #000000;
}
.popup-container[data-agent-theme='swiss-grid'] .connect-button {
  background: #ef4444;
  color: #ffffff;
  border: 2px solid #000000;
  font-weight: 700;
}
.popup-container[data-agent-theme='swiss-grid'] .connect-button:hover:not(:disabled) {
  background: #dc2626;
}
.popup-container[data-agent-theme='swiss-grid'] .port-input {
  border: 2px solid #000000;
}

.home-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  flex-shrink: 0;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  animation: spring-slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.content {
  flex-grow: 1;
  padding: 12px 14px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.content::-webkit-scrollbar {
  display: none;
}

.section {
  margin-bottom: 0px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-left: 2px;
}

.config-card {
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.02),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  animation: spring-slide-up 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.05s both;
}

.status-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 2px;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.refresh-status-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: #64748b;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.refresh-status-button:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #0f172a;
  transform: scale(1.15) rotate(35deg);
}

.refresh-status-button:active {
  transform: scale(0.9) rotate(0deg);
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  height: 6px;
  width: 6px;
  border-radius: 50%;
  animation: pulse-glow 2s infinite ease-in-out;
}

@keyframes pulse-glow {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
    filter: brightness(1.2);
  }
}

.status-dot.bg-emerald-500 {
  background-color: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
}

.status-dot.bg-red-500 {
  background-color: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
}

.status-dot.bg-yellow-500 {
  background-color: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
}

.status-dot.bg-gray-500 {
  background-color: #9ca3af;
  box-shadow: 0 0 6px rgba(156, 163, 175, 0.4);
}

.status-text {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}

.status-timestamp {
  font-size: 10px;
  color: #64748b;
  margin-top: 2px;
}

.mcp-config-section {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  padding-top: 12px;
}

.mcp-config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.mcp-config-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
}

.chevron-icon {
  display: inline-block;
  font-size: 10px;
  margin-left: 4px;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  color: #64748b;
}

.chevron-icon.expanded {
  transform: rotate(180deg);
}

.copy-config-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  color: #475569;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.copy-config-button:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #0f172a;
  border-color: rgba(0, 0, 0, 0.15);
  transform: translateY(-1px) scale(1.03);
}

.copy-config-button:active {
  transform: translateY(0) scale(0.96);
}

/* Vue Dropdown slide-fade spring transition */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  max-height: 120px;
  overflow: hidden;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-8px);
  opacity: 0;
  max-height: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  margin-top: 0 !important;
  border-color: transparent !important;
}

.mcp-config-content {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  padding: 8px;
  max-height: 120px;
  overflow: hidden;
}

.mcp-config-json {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 10px;
  line-height: 1.4;
  color: #1e293b;
  margin: 0;
  white-space: pre;
}

.port-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.port-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.port-label {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
}

.port-input {
  display: block;
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.6);
  color: #0f172a;
  padding: 8px 10px;
  font-size: 13px;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-sizing: border-box;
}

.port-input:focus {
  outline: none;
  border-color: rgba(79, 70, 229, 0.5);
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
  transform: scale(1.02);
}

.connect-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-weight: 600;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  font-size: 13px;
  box-shadow: 0 4px 14px rgba(79, 70, 229, 0.2);
  margin-top: 4px;
}

.connect-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #4338ca 0%, #2563eb 100%);
  box-shadow: 0 6px 20px rgba(79, 70, 229, 0.35);
  transform: translateY(-1.5px) scale(1.02);
}

.connect-button:active:not(:disabled) {
  transform: translateY(0) scale(0.96);
}

.connect-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

:deep(.icon-small) {
  width: 14px;
  height: 14px;
}

:deep(svg) {
  width: 14px;
  height: 14px;
}

.footer {
  padding: 12px;
  margin-top: auto;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  animation: spring-slide-up 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.footer-links {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.footer-link {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: #475569;
  font-size: 11px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.footer-link:hover {
  color: #4f46e5;
  background: rgba(0, 0, 0, 0.03);
  transform: translateY(-0.5px);
}

.footer-link:active {
  transform: translateY(0);
}

.footer-link svg {
  width: 12px;
  height: 12px;
}

.footer-text {
  text-align: center;
  font-size: 10px;
  color: #64748b;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Coming Soon Toast */
.coming-soon-toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.1);
  color: #0f172a;
  font-size: 11px;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  z-index: 1000;
  white-space: nowrap;
}

.toast-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #4f46e5;
}

/* Toast transition */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
