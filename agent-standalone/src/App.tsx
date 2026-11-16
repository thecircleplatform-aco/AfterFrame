import { useCallback, useRef, useState } from 'react';
import type { DisplayMessage } from '@app/agent/agent-session';
import { ChatMessage } from '@app/components/chat/ChatMessage';
import { runAgent, toModelHistory } from './agentClient';
import {
  DEFAULT_SETTINGS,
  STANDALONE_PROJECT_ID,
  type StandaloneSettings,
} from './config';
import { TOOL_EXECUTOR_URL, remoteToolExecutor } from './toolExecutor';

/**
 * Standalone agent console.
 *
 * Rendering is the shipped `ChatMessage` component — the same one the editor's
 * chat panel uses — so markdown, thinking blocks, tool badges, widget cards and
 * streaming behaviour are the production implementation. Only the host shell
 * (header / composer) is re-declared here, because the editor's ChatPanel is
 * wired to the timeline, media pool and inspector stores.
 */
export function App(): React.JSX.Element {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [settings, setSettings] = useState<StandaloneSettings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const patchLastAssistant = useCallback((patch: (message: DisplayMessage) => DisplayMessage) => {
    setMessages((previous) => {
      const next = [...previous];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const message = next[index]!;
        if (message.role !== 'assistant') continue;
        next[index] = patch(message);
        break;
      }
      return next;
    });
  }, []);

  const pushNote = useCallback((text: string) => {
    setMessages((previous) => [...previous, { role: 'note', text }]);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setError('');
    setStatus('running');
    setRunning(true);
    setMessages((previous) => [
      ...previous,
      { role: 'user', text },
      { role: 'assistant', text: '' },
    ]);

    const history = toModelHistory([...messages, { role: 'user', text }]);
    const abort = new AbortController();
    abortRef.current = abort;
    // The server owns the terminal status ('completed' | 'failed' | 'cancelled');
    // only fall back to local inference when no status event arrived.
    let terminalStatus = 'completed';

    try {
      await runAgent({
        config: {
          projectId: STANDALONE_PROJECT_ID,
          provider: settings.provider || undefined,
          model: settings.model || undefined,
          reasoningEffort: settings.reasoningEffort || undefined,
          cacheMode: settings.cacheMode,
          maxOutputTokens: settings.maxOutputTokens,
          autonomousAcceptance: settings.autonomousAcceptance,
          maxAcceptanceIterations: settings.maxAcceptanceIterations,
          askOnly: settings.askOnly,
          // No editor here: tools are refused unless a worker is configured.
          ...(TOOL_EXECUTOR_URL ? { executeTool: remoteToolExecutor(TOOL_EXECUTOR_URL) } : {}),
        },
        history,
        text,
        signal: abort.signal,
        callbacks: {
          onStatus: (next) => {
            terminalStatus = next;
            setStatus(next);
          },
          onText: (delta) => {
            if (delta) patchLastAssistant((message) => ({ ...message, text: message.text + delta }));
          },
          onThinking: (delta) => {
            if (!delta) return;
            patchLastAssistant((message) => ({
              ...message,
              thinking: (message.thinking ?? '') + delta,
            }));
          },
          onToolRequest: (request) => {
            pushNote(`→ ${request.name} ${JSON.stringify(request.args).slice(0, 160)}`);
          },
          onToolResult: (result) => {
            pushNote(`← ${result.toolName ?? 'tool'}: ${result.error ?? 'ok'}`);
          },
          onError: (message) => setError(message),
        },
      });
    } catch (runError) {
      if (abort.signal.aborted) {
        terminalStatus = 'cancelled';
      } else {
        const message = runError instanceof Error ? runError.message : String(runError);
        setError(message);
        terminalStatus = 'failed';
      }
    } finally {
      abortRef.current = null;
      setStatus(abort.signal.aborted ? 'cancelled' : terminalStatus);
      setRunning(false);
    }
  }, [input, messages, patchLastAssistant, pushNote, running, settings]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('cancelled');
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="af-shell">
      <header className="af-header">
        <strong>AfterFrame Agent</strong>
        <span className="af-badge" data-state={status}>
          {status}
        </span>
        <span className="af-spacer" />
        <label className="af-field">
          provider
          <input
            type="text"
            value={settings.provider}
            disabled={running}
            onChange={(event) => setSettings({ ...settings, provider: event.target.value })}
          />
        </label>
        <label className="af-field">
          model
          <input
            type="text"
            value={settings.model}
            disabled={running}
            onChange={(event) => setSettings({ ...settings, model: event.target.value })}
          />
        </label>
        <label className="af-field">
          <input
            type="checkbox"
            checked={settings.askOnly}
            disabled={running}
            onChange={(event) => setSettings({ ...settings, askOnly: event.target.checked })}
          />
          ask-only
        </label>
      </header>

      <main className="af-messages">
        {messages.length === 0 && (
          <div className="af-empty">
            <p>The agent runtime is hosted on its own server.</p>
            <p>
              Same payload, same run protocol, same stream as the editor: runs are admitted by{' '}
              <code>POST /api/agent-runs/</code>, streamed by{' '}
              <code>/api/agent-runs/:id/events</code>, and every tool call travels back as a{' '}
              <code>tool-claim</code> / <code>tool-result</code> request.
            </p>
            <p>
              Tool calls that need the timeline are refused by this host — no editor is attached.
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <ChatMessage
            key={index}
            msg={message}
            streaming={running && index === messages.length - 1 && message.role === 'assistant'}
            running={running}
          />
        ))}
        {error && <div className="af-error">{error}</div>}
      </main>

      <footer className="af-composer">
        <textarea
          value={input}
          placeholder="Message the agent…  (Enter to send, Shift+Enter for a newline)"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
        />
        <div className="af-composer-row">
          <span className="af-hint">
            project <code>{STANDALONE_PROJECT_ID}</code> · keys stay in the server keystore
          </span>
          <span className="af-spacer" />
          {running ? (
            <button className="af-button" type="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              className="af-button"
              data-variant="primary"
              type="button"
              onClick={() => void send()}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
