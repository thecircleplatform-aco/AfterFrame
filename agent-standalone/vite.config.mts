import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { standaloneAgentPlugins } from './server/plugins.ts';

/**
 * Standalone host for the AfterFrame agent runtime.
 *
 * This is the same hosting shape the main app uses (config/vite.config.ts and
 * desktop/embedded-server.ts both mount serverPlugins() into a Vite dev-style
 * server), trimmed down to the plugins the agent actually needs:
 *
 *   /api/agent-runs/**  → the agent loop (create / start / events / tool-claim /
 *                         tool-result / cancel / settle / draft)
 *   /api/llm/**         → the LLM proxy the server-side model client calls
 *   project store, local media, skills, settings
 *
 * The client below speaks the exact same protocol as the editor's chat panel.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), ...standaloneAgentPlugins()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('../src', import.meta.url)),
      '@server': fileURLToPath(new URL('../server', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: false,
    fs: {
      // The runtime lives one level up; allow it to be served/imported.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
