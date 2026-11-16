// A project-less AgentContext for the Agent portal (the dashboard agent view).
//
// Every editor-backed tool reads `ctx.getState()` / `ctx.getDoc()` / `ctx.commands`.
// On the dashboard there is no open project, so this module hands the agent a
// disposable blank document. Consequences, by design:
//
//   • Portfolio tools (list_projects, create_project, target_project, edit_project,
//     duplicate_project, delete_project, restore_project, get_editor_url) work
//     immediately — they are backed by `projectStore`, not by the editor.
//   • Timeline tools that WOULD edit a project run against the scratch draft and
//     are discarded, so the agent never silently mutates a saved project it has
//     not been told to open.
//   • `openProject(id)` navigates to the editor for that project. That is the
//     hand-over: from there the normal editor context takes over.
//
// Nothing here touches the editor's own store, so the existing in-project agent
// is completely unaffected.
import { useMemo } from 'react';
import type { AgentContext } from './context';
import type { EditorCommands } from '../editor/store';
import { activeTimeline } from '../editor/types';
import type { TimelineState } from '../editor/types';
import { emptyProjectDoc } from './tools/project-tools';
import { navigateTo } from '../app/appShell';
import type { AudioAsset } from '../audio/library';
import type { Tpl } from '../types';

/** Project id the portal chats are filed under (chat history, drafts, presets). */
export const AGENT_PORTAL_PROJECT_ID = 'agent-portal';

/**
 * Commands are only ever invoked by timeline-editing tools, which have nothing
 * meaningful to act on here: the draft is thrown away. Rejecting loudly is
 * better than silently pretending an edit landed.
 */
function inertCommands(): EditorCommands {
  const notSupported = (): never => {
    throw new Error(
      'The Agent portal cannot edit a timeline. Ask it to create or open a project first, then edit from inside the editor.',
    );
  };
  // A Proxy keeps this correct as EditorCommands gains methods, without listing
  // them here (the interface has well over a hundred entries).
  return new Proxy({}, { get: () => notSupported }) as unknown as EditorCommands;
}

/**
 * The scratch document. `create_project` builds its own doc from the requested
 * composition size, so this blank 1920×1080/30fps timeline is only ever the
 * "no project open" reading for tools that introspect the current state.
 */
function scratchDoc(): { doc: ReturnType<typeof emptyProjectDoc>; state: TimelineState } {
  const doc = emptyProjectDoc({ width: 1920, height: 1080, fps: 30 });
  return { doc, state: activeTimeline(doc) };
}

/**
 * Build a stable, memoised context for the portal. `onProjectCreated` fires after
 * the agent creates a project so the shell can refresh the dashboard list.
 */
export function useAgentPortalContext(options: {
  onProjectsChanged?: () => void | Promise<void>;
} = {}): AgentContext {
  const { onProjectsChanged } = options;
  return useMemo<AgentContext>(() => {
    const { doc, state } = scratchDoc();
    return {
      commands: inertCommands(),
      getState: () => state,
      getDoc: () => doc,
      getCreativeMode: () => null,
      templates: [] as Tpl[],
      audio: [] as AudioAsset[],
      // The portal has no OPEN project. Returning a sentinel (labelled as such in
      // the prompt) means every tool that needs one must pass an explicit
      // projectId or create one first — which is what makes `list_projects` the
      // agent's natural first move. Nothing resolves to this id, because
      // `resolveMeta` looks it up in the store and finds nothing.
      getProjectId: () => 'agent-portal:none',
      // The hand-over to the editor. `refresh()` afterwards keeps the dashboard
      // list current if the agent created something on its way here.
      openProject: async (projectId: string) => {
        try {
          navigateTo(`#/editor/${projectId}`);
          void Promise.resolve(onProjectsChanged?.()).catch(() => {});
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'navigation failed' };
        }
      },
      onProjectRenamed: () => { void Promise.resolve(onProjectsChanged?.()).catch(() => {}); },
    };
  }, [onProjectsChanged]);
}
