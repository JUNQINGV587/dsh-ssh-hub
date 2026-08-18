/**
 * Bounded output ring for one Terminal Session (ADR-0004).
 *
 * Every byte the shell writes is pushed here so a reattaching client can be
 * replayed the recent output before live frames resume. The ring is a list of
 * whole chunks trimmed from the front once the total passes the cap — a trim
 * may split an ANSI/UTF-8 sequence, which at worst garbles one glyph at the
 * top of the replay; xterm tolerates the rest.
 */
export const DEFAULT_SCROLLBACK_BYTES = 512 * 1024;

export class Scrollback {
  readonly maxBytes: number;
  private chunks: Buffer[] = [];
  private bytes = 0;

  constructor(maxBytes: number = DEFAULT_SCROLLBACK_BYTES) {
    this.maxBytes = maxBytes;
  }

  push(data: Buffer) {
    if (data.length === 0) return;
    this.chunks.push(data);
    this.bytes += data.length;
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const first = this.chunks.shift()!;
      this.bytes -= first.length;
    }
    // A single chunk can exceed the cap on its own: keep only its tail.
    if (this.chunks.length === 1 && this.bytes > this.maxBytes) {
      const tail = this.chunks[0].subarray(this.chunks[0].length - this.maxBytes);
      this.chunks = [tail];
      this.bytes = tail.length;
    }
  }

  /** A copy of everything currently held, for replay on attach. */
  snapshot(): Buffer {
    return Buffer.concat(this.chunks);
  }

  clear() {
    this.chunks = [];
    this.bytes = 0;
  }

  get size() {
    return this.bytes;
  }
}
