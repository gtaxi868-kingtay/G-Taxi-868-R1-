// supabase-js realtime requires a global WebSocket constructor at client-init time.
// The Node test env (vitest, Node 20) has none, so importing anything that calls
// initializeSupabaseClient throws "Node.js 20 detected without native WebSocket
// support". Tests never open a real socket, so a stub constructor is sufficient.
class WebSocketStub {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((...a: unknown[]) => void) | null = null;
  onclose: ((...a: unknown[]) => void) | null = null;
  onerror: ((...a: unknown[]) => void) | null = null;
  onmessage: ((...a: unknown[]) => void) | null = null;
  constructor(_url?: string) {}
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

// @ts-expect-error – assign stub only if a native WebSocket is unavailable
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocketStub;
