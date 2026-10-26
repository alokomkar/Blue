// POST /api/ai/transcribe  multipart: `audio` (WAV, mono 16-bit, 16 or 24 kHz, <= 10 s, <= 1 MB),
// optional `keywords` (JSON array of strings) and `mode` (PUSH_TO_TALK | ENDPOINTING | DIARIZATION).
// Stub: validates and answers 501 until the transcribe + order step (docs/DESIGN.md section 4) is plugged in.
import { LIMITS, GuardError, checkWav, filePart, parseMultipart } from '../_lib/guard.ts';
import { createEndpoint, type Deps } from '../_lib/endpoint.ts';
import type { TranscribeMode } from '../_lib/meta.ts';

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

export function createHandler(deps: Deps<TranscribeInput> = {}) {
  return createEndpoint<TranscribeInput>(
    {
      name: 'transcribe',
      methods: ['POST'],
      rate: { capacity: 15, refillPerSec: 0.5 },
      parse: parseTranscribe,
      // HOOK: meta.transcribe(wav, {keywords, mode}) then the planner turns the text into a PartnerOrder.
    },
    deps,
  );
}

export default { fetch: createHandler() };
