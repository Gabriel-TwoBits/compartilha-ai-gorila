/**
 * Parsing the `Range` header, for the update feed.
 *
 * The desktop updater fetches a new version differentially: it reads the
 * `.blockmap`, works out which blocks actually changed, and asks for just
 * those — one request carrying many ranges. Answering that with the whole file
 * turns a 165 KB update into 122 MB, per person, every release.
 *
 * `@hono/node-server`'s static handler serves a single range correctly and
 * answers a multi-range request with `200`-shaped content under a `206` status,
 * which the updater rejects — so multi-range is handled before it.
 */

/** Inclusive, as the header itself is: `bytes=0-99` is a hundred bytes. */
export type ByteRange = {
  start: number
  end: number
}

const UNIT_PREFIX = "bytes="

/**
 * Turns a `Range` header into ranges inside a file of `size` bytes.
 *
 * Returns `null` for anything that is not a satisfiable `bytes` range, which
 * the caller relays as "no range asked for" rather than as an error: a header
 * we failed to understand must not cost somebody their download.
 *
 * Follows RFC 7233 on the two forms with an implicit end — `500-` is from there
 * to the end, `-500` is the last five hundred bytes.
 */
export function parseRangeHeader(header: string | undefined, size: number): ByteRange[] | null {
  if (header === undefined) return null
  if (!header.startsWith(UNIT_PREFIX)) return null
  if (size <= 0) return null

  const ranges: ByteRange[] = []

  for (const piece of header.slice(UNIT_PREFIX.length).split(",")) {
    const [rawStart, rawEnd] = piece.trim().split("-")
    if (rawStart === undefined || rawEnd === undefined) return null

    // `-500`: the last 500 bytes, and never more of them than the file has.
    if (rawStart === "") {
      const length = Number(rawEnd)
      if (!Number.isInteger(length) || length <= 0) return null
      ranges.push({ start: Math.max(size - length, 0), end: size - 1 })
      continue
    }

    const start = Number(rawStart)
    if (!Number.isInteger(start) || start < 0) return null
    // A start past the end is unsatisfiable, and the whole header goes with it.
    if (start >= size) return null

    // `500-`: from there to the end.
    if (rawEnd === "") {
      ranges.push({ start, end: size - 1 })
      continue
    }

    const end = Number(rawEnd)
    if (!Number.isInteger(end) || end < start) return null
    // An end past the file is clamped rather than refused, which is what the
    // specification asks for.
    ranges.push({ start, end: Math.min(end, size - 1) })
  }

  return ranges.length > 0 ? ranges : null
}

/** Bytes a set of ranges covers, for the `Content-Length` of a single one. */
export function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1
}

/**
 * The body of a `multipart/byteranges` response, given each range's bytes.
 *
 * Assembled here rather than streamed because the ranges a differential update
 * asks for are small — hundreds of kilobytes against a file of hundreds of
 * megabytes, which is the entire point of asking for them.
 */
export function multipartBody(
  parts: { range: ByteRange; bytes: Uint8Array }[],
  size: number,
  contentType: string,
  boundary: string,
  // Backed by a plain ArrayBuffer, not the `ArrayBufferLike` the bare type
  // allows: a response body cannot be built over a SharedArrayBuffer.
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []

  for (const { range, bytes } of parts) {
    chunks.push(
      encoder.encode(
        `\r\n--${boundary}\r\n` +
          `Content-Type: ${contentType}\r\n` +
          `Content-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`,
      ),
    )
    chunks.push(bytes)
  }

  chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`))

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
