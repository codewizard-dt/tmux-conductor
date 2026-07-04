/*
 * Focused terminal receipt-to-repaint probe.
 *
 * Use from the dashboard browser console before opening a focused agent detail:
 *
 *   const s = document.createElement('script')
 *   s.src = '/raw/research/focused-terminal-latency-baseline/browser-repaint-probe.js'
 *   document.head.appendChild(s)
 *
 * If the dev server does not serve raw/, paste this file into the console directly.
 * Then open the focused terminal and later run:
 *
 *   __focusedTerminalLatencyBaseline.summary()
 *   __focusedTerminalLatencyBaseline.exportJson()
 *   __focusedTerminalLatencyBaseline.exportCsv()
 */
(() => {
  const KEY = '__focusedTerminalLatencyBaseline';
  if (window[KEY]?.installed) return;

  const samples = [];
  const OriginalWebSocket = window.WebSocket;
  const OriginalEventSource = window.EventSource;

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  function percentile(values, pct) {
    const clean = [...values].sort((a, b) => a - b);
    if (clean.length === 0) return null;
    const index = Math.min(clean.length - 1, Math.ceil((pct / 100) * clean.length) - 1);
    return clean[index];
  }

  function record(transport, payload, receivedAt) {
    const text = typeof payload?.text === 'string' ? payload.text : '';
    const agentId = typeof payload?.agentId === 'number' ? payload.agentId : null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        samples.push({
          transport,
          agentId,
          receivedAt,
          paintedAt: performance.now(),
          receiptToPaintMs: round(performance.now() - receivedAt),
          bytes: text.length,
          lines: typeof payload?.lines === 'number' ? payload.lines : null,
          windowPresent: payload?.windowPresent ?? null,
        });
      });
    });
  }

  function parseJson(data) {
    try {
      return JSON.parse(String(data));
    } catch {
      return null;
    }
  }

  window.WebSocket = class InstrumentedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (String(url).includes('/terminal/ws')) {
        let assignedOnMessage = null;
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get() {
            return assignedOnMessage;
          },
          set(handler) {
            assignedOnMessage = typeof handler === 'function'
              ? function instrumentedOnMessage(event) {
                const receivedAt = performance.now();
                const payload = parseJson(event.data);
                const result = handler.call(this, event);
                if (payload?.type === 'output') record('websocket', payload, receivedAt);
                return result;
              }
              : handler;
          },
        });
        this.addEventListener('message', (event) => {
          const receivedAt = performance.now();
          const payload = parseJson(event.data);
          if (payload?.type === 'output') record('websocket', payload, receivedAt);
        });
      }
    }
  };
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  window.EventSource = class InstrumentedEventSource extends OriginalEventSource {
    constructor(url, config) {
      super(url, config);
      const nativeAddEventListener = this.addEventListener.bind(this);
      this.addEventListener = (eventName, handler, options) => {
        if (eventName !== 'terminal-output-focus' || typeof handler !== 'function') {
          return nativeAddEventListener(eventName, handler, options);
        }
        return nativeAddEventListener(eventName, function instrumentedSseHandler(event) {
          const receivedAt = performance.now();
          const payload = parseJson(event.data);
          const result = handler.call(this, event);
          if (payload) record('sse', payload, receivedAt);
          return result;
        }, options);
      };
      this.addEventListener('terminal-output-focus', (event) => {
        const receivedAt = performance.now();
        const payload = parseJson(event.data);
        if (payload) record('sse', payload, receivedAt);
      });
    }
  };
  window.EventSource.prototype = OriginalEventSource.prototype;

  window[KEY] = {
    installed: true,
    samples,
    restore() {
      window.WebSocket = OriginalWebSocket;
      window.EventSource = OriginalEventSource;
    },
    clear() {
      samples.length = 0;
    },
    summary() {
      const values = samples.map((sample) => sample.receiptToPaintMs);
      const byTransport = {};
      for (const sample of samples) {
        byTransport[sample.transport] ??= 0;
        byTransport[sample.transport] += 1;
      }
      return {
        count: samples.length,
        byTransport,
        medianMs: round(percentile(values, 50)),
        p95Ms: round(percentile(values, 95)),
        maxMs: values.length ? round(Math.max(...values)) : null,
      };
    },
    exportJson() {
      return JSON.stringify({ summary: this.summary(), samples }, null, 2);
    },
    exportCsv() {
      const header = 'transport,agentId,receivedAt,paintedAt,receiptToPaintMs,bytes,lines,windowPresent';
      const rows = samples.map((sample) => [
        sample.transport,
        sample.agentId ?? '',
        sample.receivedAt,
        sample.paintedAt,
        sample.receiptToPaintMs,
        sample.bytes,
        sample.lines ?? '',
        sample.windowPresent ?? '',
      ].join(','));
      return [header, ...rows].join('\n');
    },
  };

  console.info('Focused terminal latency probe installed:', window[KEY]);
})();
