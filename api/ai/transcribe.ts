// POST /api/ai/transcribe  multipart: `audio` (WAV, mono 16-bit, 16 or 24 kHz, <= 10 s, <= 1 MB),
// optional `keywords` (JSON array of strings) and `mode` (PUSH_TO_TALK | ENDPOINTING | DIARIZATION).
// Answers { transcript, order, source: 'fast' | 'model' | 'none', ms: { asr, order } } (docs/DESIGN.md section 4): Meta's transcription (PUSH_TO_TALK, biased to the game's words), then the local fast path for the obvious
// commands (src/shared/orders.ts) and otherwise ONE Spark call (api/_lib/voice.ts). When only the Spark step fails the transcript still comes back, with order `none`;
// a failed transcription answers { error, fallback: true } like the other endpoints. With ?stream=1 the answer is two JSON lines (the words first, then the whole thing). The key stays on the server.
import { LIMITS, GuardError, checkWav, filePart, parseMultipart } from '../_lib/guard.ts';
import { createEndpoint, type Deps } from '../_lib/endpoint.ts';
import type { TranscribeMode } from '../_lib/meta.ts';
import { VOICE_KEYWORDS, resolveOrder } from '../_lib/voice.ts';
import type { Hook } from '../_lib/endpoint.ts';
import type { PartnerOrder } from '../../src/shared/orders.ts';

export type TranscribeOutput = { transcript: string; order: PartnerOrder; source: 'fast' | 'model' | 'none'; ms: { asr: number; order: number }; note?: string };

export type TranscribeInput = { wav: Uint8Array; seconds: number; keywords: string[]; mode: TranscribeMode };

const MODES: readonly string[] = ['PUSH_TO_TALK', 'ENDPOINTING', 'DIARIZATION'];

export async function parseTranscribe(request: Request): Promise<TranscribeInput> {
  const form = await parseMultipart(request, LIMITS.audioBytes + LIMITS.multipartSlack);
  const wav = await filePart(form, 'audio');
  if (!wav) throw new GuardError(400, 'bad_field', 'audio file part is required');
  const { seconds } = checkWav(wav);

  let keywords: string[] = [];
  const rawKeywords = form.get('keywords');
  if (typeof rawKeywords === 'string' && rawKeywords.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeywords);
    } catch {
      throw new GuardError(400, 'bad_field', 'keywords must be a JSON array of strings');
    }
    if (!Array.isArray(parsed) || parsed.length > LIMITS.keywords || !parsed.every((k) => typeof k === 'string' && k.length > 0 && k.length <= LIMITS.keywordChars)) {
      throw new GuardError(400, 'bad_field', `keywords must be up to ${LIMITS.keywords} strings of up to ${LIMITS.keywordChars} characters`);
    }
    keywords = parsed as string[];
  }

  const rawMode = form.get('mode');
  const mode = rawMode === null || rawMode === '' ? 'PUSH_TO_TALK' : rawMode;
  if (typeof mode !== 'string' || !MODES.includes(mode)) throw new GuardError(400, 'bad_field', `mode must be one of ${MODES.join(', ')}`);
  return { wav, seconds, keywords, mode: mode as TranscribeMode };
}

export const transcribeHook: Hook<TranscribeInput> = async (input, ctx) => {
  const t0 = Date.now();
  const heard = await ctx.meta.transcribe(input.wav, { keywords: input.keywords.length > 0 ? input.keywords : [...VOICE_KEYWORDS], mode: input.mode });
  const asr = Date.now() - t0;
  const transcript = heard.transcript.trim();
  const finish = async (): Promise<TranscribeOutput> => {
    const resolved = await resolveOrder(ctx.meta, transcript);
    const out: TranscribeOutput = { transcript, order: resolved.order, source: resolved.source, ms: { asr, order: resolved.ms } };
    if (resolved.note) out.note = resolved.note;
    return out;
  };
  // ?stream=1: newline-delimited JSON, the words as soon as they are known (the first line, `{ "transcript": ... }`) and the whole answer when the order is (the second): a slow
  // Spark step then shows the player what was heard while it works. A failed transcription never gets here (it is an error status above), and a failed Spark step still ends in a line.
  if (new URL(ctx.request.url).searchParams.get('stream') === '1') {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode(`${JSON.stringify({ transcript })}\n`));
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(await finish())}\n`));
        } catch {
          controller.enqueue(enc.encode(`${JSON.stringify({ error: 'internal', fallback: true })}\n`));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  }
  return finish();
};

export function createHandler(deps: Deps<TranscribeInput> = {}) {
  return createEndpoint<TranscribeInput>(
    {
      name: 'transcribe',
      methods: ['POST'],
      rate: { capacity: 15, refillPerSec: 0.5 },
      parse: parseTranscribe,
      defaultHook: transcribeHook,
    },
    deps,
  );
}

export default { fetch: createHandler() };
