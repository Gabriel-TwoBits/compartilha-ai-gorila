import { randomUUID } from "node:crypto"
import { type WebSocketLike, type WebSocketServerLike, upgradeWebSocket } from "@hono/node-server"
import type { WSContext } from "hono/ws"
import type { WebSocket } from "ws"
import { WebSocketServer } from "ws"
import { type ClientMessage, type ServerMessage, parseClientMessage } from "@shared/protocol"
import * as room from "./room"

/**
 * The signaling WebSocket: presence, plus the track addresses viewers need in
 * order to pull a broadcast from the SFU.
 */

/**
 * How often each connection is probed for liveness. A laptop lid closing or a
 * network dropping never sends a TCP FIN, so without this a participant would
 * linger in the room list forever. Two missed probes close the socket, which
 * lands in the same 30 second window Cloudflare uses to garbage collect tracks.
 */
const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Handed to `serve()` so Hono can perform the upgrade on this same port.
 *
 * The cast reconciles a declaration mismatch, not a behavioural one: `ws` types
 * `options.noServer` as `boolean | undefined` while the adapter declares it
 * optional, which `exactOptionalPropertyTypes` treats as incompatible. The
 * adapter is written against `ws`.
 */
export const webSocketServer = new WebSocketServer({ noServer: true }) as WebSocketServerLike

type Client = {
  id: string
  nickname: string
  ws: WSContext<WebSocketLike>
  /** Set on every pong, cleared on every probe. */
  alive: boolean
}

const clients = new Map<string, Client>()

/**
 * Sends the current room to everyone. Serialized per client because each one
 * needs its own nickname echoed back in `you`.
 */
function publishRoomState(): void {
  const participants = room.snapshot()
  for (const client of clients.values()) {
    const message: ServerMessage = { type: "state", you: client.nickname, participants }
    client.ws.send(JSON.stringify(message))
  }
}

function applyMessage(id: string, nickname: string, message: ClientMessage): void {
  switch (message.type) {
    case "broadcast-start":
      room.startBroadcast(id, nickname, {
        screen: message.screen,
        camera: message.camera,
        audio: message.audio,
      })
      return
    case "broadcast-stop":
      room.stopBroadcast(id, nickname)
      return
    case "watching":
      room.setWatching(nickname, message.nicknames)
      return
    default:
      // Unreachable: parseClientMessage yields no other shape. Ignoring beats
      // throwing here, which would tear down an otherwise healthy socket.
      return
  }
}

/**
 * The `ws` socket underneath the adapter. The adapter narrows it to a type
 * without ping/pong, which the liveness probe needs.
 */
function rawSocket(ws: WSContext<WebSocketLike>): WebSocket | null {
  return (ws.raw as WebSocket | undefined) ?? null
}

export const signalingRoute = upgradeWebSocket(
  (c) => {
    const nickname = c.get("nickname")
    const id = randomUUID()

    return {
      onOpen(_event, ws) {
        clients.set(id, { id, nickname, ws, alive: true })
        room.join(id, nickname)

        rawSocket(ws)?.on("pong", () => {
          const client = clients.get(id)
          if (client !== undefined) client.alive = true
        })

        publishRoomState()
      },

      onMessage(event) {
        // Binary frames are not part of the protocol.
        if (typeof event.data !== "string") return

        const message = parseClientMessage(event.data)
        if (message === null) return

        applyMessage(id, nickname, message)
        publishRoomState()
      },

      onClose() {
        clients.delete(id)
        room.leave(id, nickname)
        publishRoomState()
      },
    }
  },
  {
    onError(error) {
      console.error("signaling socket error:", error)
    },
  },
)

/** Starts the liveness probe. Called once, after the server is listening. */
export function startHeartbeat(): void {
  setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) {
        // onClose does the room cleanup.
        client.ws.close()
        continue
      }
      client.alive = false
      rawSocket(client.ws)?.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)
}
