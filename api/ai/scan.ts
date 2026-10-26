// POST /api/ai/scan  an image (PNG or JPEG, <= 4 MB): either the raw body with an image/* content type, or
// multipart with an `image` file part.
// Stub: validates and answers 501 until the Spark vision + SAM pipeline (docs/DESIGN.md section 6) is plugged in.
import { LIMITS, GuardError, checkImage, filePart, parseMultipart, readBody } from '../_lib/guard.ts';
import { createEndpoint, type Deps } from '../_lib/endpoint.ts';

export type ScanInput = { image: Uint8Array; mime: 'image/png' | 'image/jpeg' };

export async function parseScan(request: Request): Promise<ScanInput> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  let image: Uint8Array | null;
  if (type.startsWith('multipart/form-data')) {
    image = await filePart(await parseMultipart(request, LIMITS.imageBytes + LIMITS.multipartSlack), 'image');
  } else if (type.startsWith('image/')) {
    image = await readBody(request, LIMITS.imageBytes);
  } else {
    throw new GuardError(415, 'unsupported_media_type', 'Expected an image or multipart/form-data');
  }
  if (!image) throw new GuardError(400, 'bad_field', 'image file part is required');
  return { image, mime: checkImage(image).mime };
}

export function createHandler(deps: Deps<ScanInput> = {}) {
  return createEndpoint<ScanInput>(
    {
      name: 'scan',
      methods: ['POST'],
      rate: { capacity: 5, refillPerSec: 0.1 },
      parse: parseScan,
      // HOOK: Spark vision for bounds/entrance/goal, SAM per concept, rasterise to a grid, run the verifier.
    },
    deps,
  );
}

export default { fetch: createHandler() };
