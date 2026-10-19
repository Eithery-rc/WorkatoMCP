<template>
  <div class="popup-container agent-theme">
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

import { BoltIcon, RefreshIcon } from './components/icons';

// Current view state: home only.
const currentView = ref<'home'>('home');

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
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // Store reference for cleanup
  (window as any).__popup_onMessage = onMessage;
};

onMounted(async () => {
  await loadPortPreference();
  await loadProfileNamePreference();
  await checkNativeConnection();
  await checkServerStatus();

  setupServerStatusListener();
});

onUnmounted(() => {
  // Clean up runtime message listener
  try {
    const msgFn = (window as any).__popup_onMessage;
    if (msgFn && chrome?.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(msgFn);
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
  background: rgba(253, 252, 248, 0.35);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid rgba(217, 119, 87, 0.22);
  border-radius: 16px;
  box-shadow:
    0 10px 30px rgba(217, 119, 87, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--ac-font-sans);
  height: 100%;
  transition: all var(--transition-slow);
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
  background: linear-gradient(135deg, #d97757 0%, #c4664a 100%);
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
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(217, 119, 87, 0.12);
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
  background: linear-gradient(135deg, #d97757 0%, #c4664a 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-weight: 600;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  font-size: 13px;
  box-shadow: 0 4px 14px rgba(217, 119, 87, 0.2);
  margin-top: 4px;
}

.connect-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #c4664a 0%, #b4583c 100%);
  box-shadow: 0 6px 20px rgba(217, 119, 87, 0.35);
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
</style>
