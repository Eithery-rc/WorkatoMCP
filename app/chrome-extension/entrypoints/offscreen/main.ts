import { MessageTarget } from '@/common/message-types';
import { handleGifMessage } from './gif-encoder';
import { initKeepalive } from './rr-keepalive';

// Initialize RR V3 Keepalive
initKeepalive();

interface OffscreenMessage {
  target: MessageTarget | string;
  type: string;
}

type MessageResponse = {
  result?: string;
  error?: string;
  success?: boolean;
};

// Listen for messages from the extension
chrome.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    if (message.target !== MessageTarget.Offscreen) {
      return;
    }

    // Handle GIF encoding messages
    if (handleGifMessage(message, sendResponse)) {
      return true;
    }

    // Unknown offscreen message type — the semantic similarity engine that
    // previously handled additional message kinds was removed in v1.3.
    sendResponse({ error: `Unknown message type: ${message.type}` });
    return true;
  },
);

console.log('Offscreen: handler loaded (GIF encoder + RR-V3 keepalive)');
