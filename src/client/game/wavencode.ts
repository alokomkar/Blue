// A recorded clip as the transcribe endpoint wants it (api/_lib/guard.ts's checkWav): mono, 16-bit PCM, in a WAV, at 24 kHz and at most a few seconds.
// The microphone hands over float samples at the sound card's rate (44.1 or 48 kHz as a rule), so they are mixed down to one channel, resampled and quantised here.
// Pure (no Web Audio), so it is unit-tested under Node.

/** The rate the clip is sent at (the endpoint takes 16 or 24 kHz). */
export const CLIP_RATE = 24000;
/** The longest clip: holding the key past this stops the recording. */
export const CLIP_MAX_S = 6;
/** Shorter than this is a tap, not a command. */
export const CLIP_MIN_S = 0.3;

/** One mono track from several channels' samples (their mean). */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += (ch[i] ?? 0) / channels.length;
  return out;
}

/** All the chunks as one array. */
export function concat(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The samples at another rate: each output sample is the mean of the input it spans when going down (a box filter, so 48 kHz to 24 kHz does not alias), a straight line between neighbours when going up. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const a = i * ratio;
      const b = Math.min(input.length, (i + 1) * ratio);
      let sum = 0;
      let weight = 0;
      for (let k = Math.floor(a); k < Math.ceil(b); k++) {
        const w = Math.min(k + 1, b) - Math.max(k, a);
        sum += (input[k] ?? 0) * w;
        weight += w;
      }
      out[i] = weight > 0 ? sum / weight : 0;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const at = i * ratio;
      const k = Math.floor(at);
      const f = at - k;
      out[i] = (input[k] ?? 0) * (1 - f) + (input[Math.min(input.length - 1, k + 1)] ?? 0) * f;
    }
  }
  return out;
}

/** Float samples (-1..1) as 16-bit, clipped at the ends. */
export function toPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** A WAV file: the 44-byte header and the samples, mono 16-bit little-endian. */
export function encodeWav(pcm: Int16Array, rate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i]!, true);
  return out;
}

export type Clip = { wav: Uint8Array<ArrayBuffer>; seconds: number };

/** The recorded chunks (one array per channel per callback, or one mono array) as a clip: mixed down, cut to `maxSeconds`, resampled to 24 kHz, as a WAV. */
export function encodeClip(chunks: readonly Float32Array[], sampleRate: number, maxSeconds: number = CLIP_MAX_S): Clip {
  const all = concat(chunks);
  const cut = all.subarray(0, Math.floor(maxSeconds * sampleRate));
  const pcm = toPcm16(resample(cut, sampleRate, CLIP_RATE));
  return { wav: encodeWav(pcm, CLIP_RATE), seconds: pcm.length / CLIP_RATE };
}

/** How loud the last stretch was, 0..1 (the peak), for the "listening" light. */
export function peak(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i] ?? 0));
  return Math.min(1, p);
}
