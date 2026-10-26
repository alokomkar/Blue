import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { existsSync, cpSync, createReadStream } from 'node:fs';

// Standalone web build of the game page: no Reddit wrapper, no server of its own. The model
// calls (added during the hackathon) go through serverless functions under /api.
//
// `--mode original` is the live-demo build with the project's original character animations. They
// are not CC0, so they are not in this repository: the git-ignored `private-overlay/` holds the
// matching source files and `public/models/private/` the models and clips. Without that folder
// there is no such mode, and the plain build uses the CC0 clips.
const root = import.meta.dirname;
const privateModels = resolve(root, 'public/models/private');

function originalOverlay(): Plugin {
  const src = resolve(root, 'src');
  const overlay = resolve(root, 'private-overlay/src');
  // The files the original build serves from the private folder, at the URLs the original code asks for.
  const served = /^\/models\/(soldier|agent_male|agent_female)\.glb$|^\/models\/anims\/(crouchIdle|crouchWalk|crouchLeft|crouchRight|hide|wall)\.glb$/;
  return {
    name: 'original-overlay',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      const inOverlay = importer.startsWith(overlay);
      const from = inOverlay ? importer.replace(overlay, src) : importer;
      const target = resolve(dirname(from), source);
      const file = target.endsWith('.ts') ? target : `${target}.ts`;
      if (!file.startsWith(src)) return null;
      const replaced = file.replace(src, overlay);
      if (existsSync(replaced)) return replaced;
      return inOverlay && existsSync(file) ? file : null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (!served.test(path)) return next();
        const file = resolve(privateModels, path.replace(/^\/models\//, ''));
        if (!existsSync(file)) return next();
        res.setHeader('content-type', 'model/gltf-binary');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(privateModels, resolve(root, 'dist-original/models'), { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const original = mode === 'original';
  if (original && !existsSync(resolve(root, 'private-overlay/src'))) throw new Error('private-overlay/ is missing: the original-animation build needs it');
  return {
    root: 'src/client',
    publicDir: resolve(root, 'public'),
    plugins: original ? [originalOverlay()] : [],
    // `npm run dev:api` serves /api/ai/* locally; only that prefix is forwarded, so the game's other /api calls still 404.
    server: { proxy: { '/api/ai': `http://127.0.0.1:${process.env.API_PORT ?? 8787}` } },
    build: {
      outDir: resolve(root, original ? 'dist-original' : 'dist'),
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { input: { game: resolve(root, 'src/client/game.html'), director: resolve(root, 'src/client/director.html') } },
    },
  };
});
