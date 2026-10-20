import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { attachRelay, netInfoMiddleware } from './server/relay.mjs';

/** кооп-реле на тому ж порту, що й гра (ws://<host>:5173/net) */
function coopRelay(): Plugin {
  return {
    name: 'storm-coop-relay',
    configureServer(server) {
      server.middlewares.use(netInfoMiddleware);
      if (server.httpServer) attachRelay(server.httpServer);
    },
    configurePreviewServer(server) {
      server.middlewares.use(netInfoMiddleware);
      if (server.httpServer) attachRelay(server.httpServer);
    },
  };
}

/** збірка: короткий хеш коміту (* — є незакомічені зміни) і дата коміту */
function gitBuild(): { hash: string; date: string } {
  try {
    const git = (c: string) => execSync(`git ${c}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { hash: git('rev-parse --short HEAD') + (git('status --porcelain --untracked-files=no') ? '*' : ''), date: git('log -1 --format=%cs') };
  } catch {
    return { hash: 'dev', date: '' };
  }
}
const BUILD = gitBuild();

/** version.json поруч із грою — за ним відкрита вкладка помічає новішу збірку */
function buildInfo(): Plugin {
  return {
    name: 'storm-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [coopRelay(), buildInfo()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  server: {
    port: 5173,
    host: true,
    // гра з друзями через інтернет: тунель на цей порт (cloudflared / ngrok / localtunnel)
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.loca.lt'],
  },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
});
