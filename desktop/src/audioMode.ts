/**
 * Where the broadcast's audio comes from, shared by both platform backends.
 *
 * "everything" is an inclusion of every application on the list, never a native
 * exclusion. Windows offers one, but it takes a SINGLE process tree and more
 * than one thing has to stay out — Discord, ourselves, and the audio mixers.
 * Selecting by what the list contains keeps that rule in one place, and the
 * list is built so that what must stay out never enters it.
 */
export type AudioMode =
  | { kind: "none" }
  | { kind: "system" }
  /** Only the ticked pids. */
  | { kind: "include"; pids: number[] }
  /** Everything on the list, and so everything opened later too. */
  | { kind: "everything" }
