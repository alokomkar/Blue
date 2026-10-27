import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWav } from '../../../api/_lib/guard.ts';
import { CLIP_MAX_S, CLIP_RATE, concat, encodeClip, encodeWav, mixDown, peak, resample, toPcm16 } from './wavencode.ts';

const sine = (rate: number, seconds: number, hz = 440, amp = 0.5): Float32Array => {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

test('toPcm16: full scale and silence map to the ends, and anything louder is clipped', () => {
  assert.deepEqual([...toPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -3]))], [0, 32767, -32768, 16384, -16384, 32767, -32768]);
});

test('encodeWav: a 44-byte header the endpoint\'s own checker accepts, and the samples after it', () => {
  const wav = encodeWav(new Int16Array([1, -2, 300]), 24000);
  assert.equal(wav.length, 44 + 6);
  assert.deepEqual(checkWav(new Uint8Array(wav.buffer, 0, wav.length)), { sampleRate: 24000, seconds: 3 / 24000 });
  const v = new DataView(wav.buffer);
  assert.equal(v.getInt16(44, true), 1);
  assert.equal(v.getInt16(46, true), -2);
  assert.equal(v.getInt16(48, true), 300);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint32(4, true), wav.length - 8);
  assert.equal(v.getUint32(40, true), 6);
});

test('resample: 48 kHz to 24 kHz halves the length and keeps a tone at the same pitch and level; the same rate is untouched', () => {
  const a = sine(48000, 1, 440);
  const b = resample(a, 48000, 24000);
  assert.equal(b.length, 24000);
  const ref = sine(24000, 1, 440);
  let err = 0;
  for (let i = 100; i < 23900; i++) err = Math.max(err, Math.abs(b[i]! - ref[i]!));
  assert.ok(err < 0.05, `a 440 Hz tone is the same tone at the lower rate (max error ${err})`);
  assert.equal(resample(a, 48000, 48000), a);
});

test('resample: 44.1 kHz to 24 kHz gives the right length (not a whole ratio)', () => {
  const b = resample(sine(44100, 2), 44100, 24000);
  assert.ok(Math.abs(b.length - 48000) <= 1, String(b.length));
});

test('resample: going up interpolates (16 kHz to 24 kHz)', () => {
  const b = resample(new Float32Array([0, 1, 0, -1]), 16000, 24000);
  assert.equal(b.length, 6);
  assert.ok(Math.abs(b[1]! - 0.667) < 0.01, 'a third of the way between the 0 and the 1... two thirds along: ' + b[1]);
});

test('resample: a tone above the new Nyquist is attenuated by the box filter, not folded back at full strength', () => {
  const b = resample(sine(48000, 1, 23000, 0.8), 48000, 24000);
  assert.ok(peak(b.subarray(100, 20000)) < 0.4, 'aliasing is reduced');
});

test('mixDown: one channel is returned as is; two are averaged', () => {
  const l = new Float32Array([1, 0, 0.5]);
  assert.equal(mixDown([l]), l);
  assert.deepEqual([...mixDown([l, new Float32Array([0, 1, 0.5])])], [0.5, 0.5, 0.5]);
  assert.equal(mixDown([]).length, 0);
});

test('concat joins the chunks in order', () => {
  assert.deepEqual([...concat([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])])], [1, 2, 3]);
});

test('encodeClip: any sound-card rate comes out mono 16-bit at 24 kHz and passes the endpoint\'s checker', () => {
  for (const rate of [44100, 48000, 16000, 24000, 32000]) {
    const chunks = [];
    const all = sine(rate, 2);
    for (let i = 0; i < all.length; i += 4096) chunks.push(all.subarray(i, i + 4096));
    const clip = encodeClip(chunks, rate);
    const info = checkWav(new Uint8Array(clip.wav.buffer));
    assert.equal(info.sampleRate, CLIP_RATE, String(rate));
    assert.ok(Math.abs(info.seconds - 2) < 0.01, `${rate}: ${info.seconds}`);
    assert.ok(Math.abs(clip.seconds - 2) < 0.01);
    assert.ok(clip.wav.length < 1_000_000);
  }
});

test('encodeClip: cut to the longest clip, however long the key was held', () => {
  const clip = encodeClip([sine(48000, 10)], 48000);
  assert.ok(Math.abs(clip.seconds - CLIP_MAX_S) < 0.01);
  assert.ok(clip.wav.length <= 44 + CLIP_MAX_S * CLIP_RATE * 2 + 2);
  assert.equal(checkWav(new Uint8Array(clip.wav.buffer)).seconds <= 10, true);
  assert.ok(Math.abs(encodeClip([sine(48000, 10)], 48000, 3).seconds - 3) < 0.01);
});

test('encodeClip: an empty recording is an empty clip, not a crash', () => {
  const clip = encodeClip([], 48000);
  assert.equal(clip.seconds, 0);
  assert.equal(clip.wav.length, 44);
});

test('peak: the loudest sample, at most 1', () => {
  assert.ok(Math.abs(peak(new Float32Array([0.1, -0.7, 0.3])) - 0.7) < 1e-6);
  assert.equal(peak(new Float32Array([3])), 1);
  assert.equal(peak(new Float32Array(0)), 0);
});
