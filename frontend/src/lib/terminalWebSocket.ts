import { API_BASE, type KeysPayload } from './api'

export interface TerminalWebSocketMessage {
  type: 'output' | 'ack' | 'echo' | 'error'
  agentId?: number
  agent?: string
  inputId?: number
  sentAt?: number
  acknowledgedAt?: number
  lines?: number
  windowPresent?: boolean
  text?: string
  error?: string
  latencyMs?: number
  sent?: {
    keys: number
    textChars: number
    enter: boolean
  }
}

export interface TerminalWebSocketClient {
  close: () => void
  sendInput: (payload: KeysPayload) => boolean
}

function websocketBase(): string {
  if (API_BASE.startsWith('https://')) return API_BASE.replace(/^https:/, 'wss:')
  if (API_BASE.startsWith('http://')) return API_BASE.replace(/^http:/, 'ws:')
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${API_BASE}`
}

export function connectTerminalWebSocket(
  agentId: number,
  onMessage: (message: TerminalWebSocketMessage) => void,
  onClose: () => void,
  onOpen?: () => void,
): TerminalWebSocketClient {
  const ws = new WebSocket(`${websocketBase()}/agents/${agentId.toString()}/terminal/ws`)
  let nextInputId = 1

  ws.onopen = () => { onOpen?.() }
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(String(event.data)) as TerminalWebSocketMessage)
    } catch {
      /* ignore malformed websocket frames */
    }
  }
  ws.onclose = onClose
  ws.onerror = () => { onClose() }

  return {
    close: () => { ws.close() },
    sendInput: (payload) => {
      if (ws.readyState !== WebSocket.OPEN) return false
      const inputId = nextInputId
      nextInputId += 1
      ws.send(JSON.stringify({ type: 'input', inputId, sentAt: performance.now(), payload }))
      return true
    },
  }
}
