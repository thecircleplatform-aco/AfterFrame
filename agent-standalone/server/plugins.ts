import type { Plugin } from 'vite';
import { crossOriginIsolationPlugin } from '../../server/plugins/cross-origin-isolation.ts';
import { storageLifecyclePlugin } from '../../server/plugins/storage-lifecycle.ts';
import { projectStorePlugin } from '../../server/plugins/project-store-plugin.ts';
import { settingsPlugin } from '../../server/plugins/settings.ts';
import { skillFilesPlugin } from '../../server/plugins/skill-files.ts';
import { skillInstallPlugin } from '../../server/plugins/skill-install.ts';
import { skillExecPlugin } from '../../server/plugins/skill-exec.ts';
import { localMediaPlugin } from '../../server/plugins/local-media.ts';
import { llmProxyPlugin } from '../../server/plugins/llm-proxy.ts';
import { requestShapeGatePlugin } from '../../server/plugins/request-shape-gate.ts';
import { agentRunsPlugin } from '../../server/agent-runs/routes.ts';
import { migrateLegacyHome } from '../../server/legacy-home.ts';
import { installSystemProxy } from '../../server/net.ts';

/**
 * The agent's server-side dependency set — everything the run protocol needs and
 * nothing else. Every plugin here is the production module the editor mounts:
 * same routes, same gates, same persistence, same limits.
 *
 * Deliberately NOT mounted (they belong to the editor shell, not the agent):
 *   upload/export/transcode plugins, external-agent MCP bridge, codex / copilot /
 *   claude-code turn plugins (the `backend` field stays `api`), remote control.
 */
export function standaloneAgentPlugins(): Plugin[] {
  // Move legacy profile dir before anything reads a profile path.
  migrateLegacyHome();
  installSystemProxy();
  return [
    // Host/Origin gate: loopback + same-origin, exactly like the editor host.
    requestShapeGatePlugin(),
    crossOriginIsolationPlugin(),
    storageLifecyclePlugin(),
    // Model transport (server-side model client + key validation).
    llmProxyPlugin(),
    // THE agent loop.
    agentRunsPlugin(),
    // Durable agent runtime (runs, events, artifacts, approvals) + project doc.
    projectStorePlugin({ http: true }),
    // Model/provider settings, skills, local media.
    settingsPlugin(),
    skillFilesPlugin(),
    skillInstallPlugin(),
    skillExecPlugin(),
    localMediaPlugin(),
  ];
}
