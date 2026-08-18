import { useCallback, useEffect, useRef, useState } from "react"
import { type ClientMessage, type Participant, parseServerMessage } from "@shared/protocol"

const INITIAL_RECONNECT_DELAY_MS = 500
const MAX_RECONNECT_DELAY_MS = 10_000
const RECONNECT_BACKOFF_FACTOR = 2

export type RoomState = {
  /** Our own participant id, so the UI can tell us apart from everyone else. */
  you: string
  participants: Participant[]
}

export type Signaling = {
  room: RoomState | null
  connected: boolean
  send: (message: ClientMessage) => void
}

function socketUrl(): string {
  const url = new URL("/ws", window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

/**
 * Keeps a socket to the room open, reconnecting with backoff when it drops.
 *
 * The room is cleared while disconnected: showing a stale participant list would
 * be worse than showing none, since anyone in it may already be gone.
 */
export function useSignaling(): Signaling {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let disposed = false
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS
    let reconnectTimer: number | undefined

    function open(): void {
      const socket = new WebSocket(socketUrl())
      socketRef.current = socket

      socket.addEventListener("open", () => {
        reconnectDelay = INITIAL_RECONNECT_DELAY_MS
        setConnected(true)
      })

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return
        const message = parseServerMessage(event.data)
        if (message === null) return
        setRoom({ you: message.you, participants: message.participants })
      })

      socket.addEventListener("close", () => {
        // The development double-mount closes the first socket while it is
        // still connecting, and that close can land after its replacement is
        // already open. Reporting it would leave the UI stuck on "reconnecting"
        // over a live connection.
        if (socketRef.current !== socket) return

        setConnected(false)
        setRoom(null)
        if (disposed) return
        reconnectTimer = window.setTimeout(open, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * RECONNECT_BACKOFF_FACTOR, MAX_RECONNECT_DELAY_MS)
      })
    }

    open()

    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [])

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current
    // Dropping a message while reconnecting is safe: the next full snapshot the
    // server sends re-establishes the truth for everyone.
    if (socket === null || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }, [])

  return { room, connected, send }
}
