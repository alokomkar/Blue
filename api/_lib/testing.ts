// Test helpers (not imported by any endpoint).

/** A mono 16-bit PCM WAV of silence. */
export function wav(seconds: number, rate = 16000, opts: { channels?: number; bits?: number } = {}): Uint8Array {
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const dataBytes = Math.round(seconds * rate * 2);
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  v.setUint32(4, 36 + dataBytes, true);
  out.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, bits, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36);
  v.setUint32(40, dataBytes, true);
  return out;
}
