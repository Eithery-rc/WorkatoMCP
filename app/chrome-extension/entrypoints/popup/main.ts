import { createApp } from 'vue';
import { NativeMessageType } from 'workatomcp-shared';
import './style.css';
import '@/shared/agent-theme/agent-chat.css';
import { preloadAgentTheme } from '@/shared/agent-theme/useAgentTheme';
import App from './App.vue';

// Preload theme before Vue mounts to prevent flash of unstyled content.
preloadAgentTheme().then(() => {
  // Trigger ensure native connection (fire-and-forget, don't block UI mounting)
  void chrome.runtime.sendMessage({ type: NativeMessageType.ENSURE_NATIVE }).catch(() => {
    // Silent failure - background will handle reconnection
  });
  createApp(App).mount('#app');
});
