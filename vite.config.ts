import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * There is deliberately no `define`, no `envPrefix` and no `.env` file in this repository.
 *
 * A build-time constant is an environment baked into an image, and an image with an environment
 * baked into it has to be rebuilt to be promoted — which means the artefact that reaches
 * production is not the artefact that passed CI. Every host this console talks to is resolved at
 * RUNTIME from `window.location.hostname` by `cloudsforgeHosts()`, so one image serves localhost,
 * staging, a preview deployment and production. `test/no-build-time-config.test.ts` fails the
 * build if `import.meta.env.VITE_` ever reappears, and the `rules` job in CI greps for it again
 * so deleting the test does not delete the rule.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // @cloudsforge/ui is a `link:` dependency, so its own node_modules holds a second copy of
    // React. Two copies means two dispatchers, and the shared bar would throw on its first
    // useState.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // The linked package now ships BUILT output — its entry points name a committed `dist` — so
    // the old reason for this line ("shipped as TypeScript source until it is published") is no
    // longer why it is here. The setting is still right, for the reason that outlives it: `link:`
    // resolves to a working tree edited beside this one, and pre-bundling copies it into
    // node_modules/.vite, where it stays until the dep hash changes. A rebuild in micro-ui does
    // not change this repository's lockfile, so `pnpm dev` would keep serving yesterday's `dist`.
    exclude: ['@cloudsforge/ui'],
  },
  build: {
    // Named chunks and a real manifest of hashes: the assets are immutable-cached by nginx, and
    // that is only safe when every rebuild produces a new filename.
    sourcemap: true,
  },
  // 5183, which is a Vite dev port and not a registry entry. The registry's `admin` devPort names
  // where admin-api answers, not where this bundle is served from under `pnpm dev`; see the note
  // about the 3002/4014 disagreement in src/lib/hosts.ts and the README.
  server: { port: 5183 },
  preview: { port: 5183 },
})
