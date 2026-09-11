import { describe, expect, it } from "vitest"
import { pruneIceServers } from "./iceServers"

describe("pruneIceServers", () => {
  // What Cloudflare actually answers, and the shape that broke every broadcast:
  // the browser gets no candidate at all while port 53 is in the list.
  it("drops the port 53 URL Cloudflare offers alongside 3478", () => {
    const answer = {
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      ],
    }

    expect(pruneIceServers(answer)).toEqual({
      iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }],
    })
  })

  it("keeps a TURN server whole, credentials and all", () => {
    const answer = {
      iceServers: [
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
          username: "quem",
          credential: "segredo",
        },
      ],
    }

    expect(pruneIceServers(answer)).toEqual(answer)
  })

  it("accepts a single url as a plain string", () => {
    expect(pruneIceServers({ iceServers: [{ urls: "stun:example.com:3478" }] })).toEqual({
      iceServers: [{ urls: "stun:example.com:3478" }],
    })
  })

  it("drops a server whose only url is unusable", () => {
    expect(pruneIceServers({ iceServers: [{ urls: "stun:example.com:53" }] })).toEqual({
      iceServers: [],
    })
  })

  it("keeps a url with no port", () => {
    expect(pruneIceServers({ iceServers: [{ urls: "stun:example.com" }] })).toEqual({
      iceServers: [{ urls: "stun:example.com" }],
    })
  })

  it("keeps the query string of a turn url intact", () => {
    const urls = ["turn:turn.example.com:3478?transport=tcp"]
    expect(pruneIceServers({ iceServers: [{ urls }] })).toEqual({ iceServers: [{ urls }] })
  })

  // A shape we do not recognise has to pass through: this sits in front of a
  // response the browser is about to act on, and turning it into an empty list
  // would break connections that were working.
  it("passes through anything it does not understand", () => {
    expect(pruneIceServers({ outroFormato: true })).toEqual({ outroFormato: true })
    expect(pruneIceServers({ iceServers: "nem lista" })).toEqual({ iceServers: "nem lista" })
    expect(pruneIceServers(null)).toBeNull()
    expect(pruneIceServers("texto solto")).toBe("texto solto")
  })

  it("drops entries that are not objects", () => {
    expect(pruneIceServers({ iceServers: [null, 42, { urls: "stun:ok.com:3478" }] })).toEqual({
      iceServers: [{ urls: "stun:ok.com:3478" }],
    })
  })
})
