import { describe, expect, it } from "vitest"
import { multipartBody, parseRangeHeader, rangeLength } from "./ranges"

const SIZE = 1000

describe("parseRangeHeader", () => {
  it("reads one range", () => {
    expect(parseRangeHeader("bytes=0-99", SIZE)).toEqual([{ start: 0, end: 99 }])
  })

  // What the updater actually sends: the blocks that changed, in one request.
  it("reads the many ranges a differential update asks for", () => {
    expect(parseRangeHeader("bytes=0-99,200-299,500-", SIZE)).toEqual([
      { start: 0, end: 99 },
      { start: 200, end: 299 },
      { start: 500, end: 999 },
    ])
  })

  it("reads a range with no end as running to the end of the file", () => {
    expect(parseRangeHeader("bytes=500-", SIZE)).toEqual([{ start: 500, end: 999 }])
  })

  it("reads a suffix range as the last bytes", () => {
    expect(parseRangeHeader("bytes=-500", SIZE)).toEqual([{ start: 500, end: 999 }])
  })

  it("clamps a suffix longer than the file", () => {
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual([{ start: 0, end: 999 }])
  })

  // The specification asks for this rather than a refusal.
  it("clamps an end past the last byte", () => {
    expect(parseRangeHeader("bytes=900-5000", SIZE)).toEqual([{ start: 900, end: 999 }])
  })

  it("tolerates the spaces a client may put after the commas", () => {
    expect(parseRangeHeader("bytes=0-9, 20-29", SIZE)).toEqual([
      { start: 0, end: 9 },
      { start: 20, end: 29 },
    ])
  })

  /**
   * Every one of these relays as "no range asked for" rather than as an error:
   * a header we failed to understand must not cost somebody their download.
   */
  describe("gives up rather than guessing", () => {
    it("on no header at all", () => {
      expect(parseRangeHeader(undefined, SIZE)).toBeNull()
    })

    it("on a unit that is not bytes", () => {
      expect(parseRangeHeader("items=0-99", SIZE)).toBeNull()
    })

    it("on a start past the end of the file", () => {
      expect(parseRangeHeader("bytes=2000-3000", SIZE)).toBeNull()
    })

    it("on an end before the start", () => {
      expect(parseRangeHeader("bytes=500-100", SIZE)).toBeNull()
    })

    it("on anything that is not a number", () => {
      expect(parseRangeHeader("bytes=abc-def", SIZE)).toBeNull()
      expect(parseRangeHeader("bytes=", SIZE)).toBeNull()
      expect(parseRangeHeader("bytes=1.5-2.5", SIZE)).toBeNull()
    })

    it("on a negative start", () => {
      expect(parseRangeHeader("bytes=-0", SIZE)).toBeNull()
    })

    it("on an empty file", () => {
      expect(parseRangeHeader("bytes=0-99", 0)).toBeNull()
    })

    // One bad range drops the whole header: serving part of what was asked for
    // would be worse than serving the file.
    it("on one bad range among good ones", () => {
      expect(parseRangeHeader("bytes=0-99,5000-6000", SIZE)).toBeNull()
    })
  })
})

describe("rangeLength", () => {
  // The header is inclusive on both ends: 0-99 is a hundred bytes, not
  // ninety-nine. Off by one here is off by one in every Content-Length.
  it("counts both ends", () => {
    expect(rangeLength({ start: 0, end: 99 })).toBe(100)
    expect(rangeLength({ start: 5, end: 5 })).toBe(1)
  })
})

describe("multipartBody", () => {
  const boundary = "LIMITE"
  const decoder = new TextDecoder()

  it("wraps each range in its own part, with its own Content-Range", () => {
    const body = decoder.decode(
      multipartBody(
        [
          { range: { start: 0, end: 2 }, bytes: new Uint8Array([65, 66, 67]) },
          { range: { start: 10, end: 11 }, bytes: new Uint8Array([88, 89]) },
        ],
        SIZE,
        "application/octet-stream",
        boundary,
      ),
    )

    expect(body).toContain("--LIMITE\r\n")
    expect(body).toContain("Content-Range: bytes 0-2/1000")
    expect(body).toContain("Content-Range: bytes 10-11/1000")
    expect(body).toContain("ABC")
    expect(body).toContain("XY")
    // The closing boundary carries the trailing dashes, and its absence is what
    // makes a client wait forever for more parts.
    expect(body.endsWith("\r\n--LIMITE--\r\n")).toBe(true)
  })

  it("keeps the bytes intact, whatever they are", () => {
    const bytes = new Uint8Array([0, 13, 10, 255, 45, 45])
    const body = multipartBody(
      [{ range: { start: 0, end: 5 }, bytes }],
      SIZE,
      "application/octet-stream",
      boundary,
    )

    // The payload sits between the blank line after the headers and the closing
    // boundary; finding it verbatim is what proves nothing re-encoded it.
    const marker = new TextEncoder().encode("\r\n\r\n")
    const start = body.findIndex((_value, index) =>
      marker.every((byte, offset) => body[index + offset] === byte),
    )
    expect(Array.from(body.slice(start + marker.length, start + marker.length + bytes.length))).toEqual(
      Array.from(bytes),
    )
  })
})
