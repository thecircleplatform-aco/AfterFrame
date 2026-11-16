// Runnable check: `npx tsx src/agent/systemPromptOrder.verify.ts`.
//
// The prompt word cache matches the **byte-by-byte prefix**. As long as the part that changes every round (timeline snapshot) is in the middle, the ones behind it
// Everything - the rest of the paragraphs, the hundreds of tool schemas, the entire conversation history - has to be re-billed every round, and a user message
// Can run up to MAX_TOOL_TURNS rounds. So the invariant observed here is: **The variable section is always the last section**,
// As long as the stable section does not change between calls, the public prefix must be covered all the way to the beginning of the volatile section.
import assert from 'node:assert/strict';
import {
  PRODUCT_IDENTITY_PROMPT,
  SYSTEM_PROMPT,
  agentLanguagePrompt,
  assembleSystemPrompt,
  buildAgentSystemPrompt,
  confirmationModePrompt,
  designStylePrompt,
  editorStatePrompt,
} from './systemPrompt';
import { setAgentAutoApply } from './approval-mode';
import { buildCodexSystemPrompt } from './codex/runtime';
import { DEFAULT_AGENT_SETTINGS } from './settings/agentSettings';
import type { AgentContext } from './context';
import type { ProjectDoc, TimelineItem, TimelineState } from '../editor/types';

const commonPrefixLength = (a: string, b: string): number => {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
};

// ── Assembly rules: Stable sections come first, and variable sections end ──
{
  const stable = ['AAA', 'BBB', 'CCC'];
  assert.equal(assembleSystemPrompt(stable, '<state/>'), 'AAABBBCCC<state/>');
  assert.equal(assembleSystemPrompt(stable, ''), 'AAABBBCCC', '\u6613\u53d8\u6bb5\u4e3a\u7a7a\u4e5f\u4e0d\u7559\u591a\u4f59\u5206\u9694');
  assert.equal(assembleSystemPrompt([], 'x'), 'x');

  // The invariant is "**at least** covering all stable segments"; if the two volatile segments happen to have the same head, the common prefix will only be longer.
  // Here we deliberately select two paragraphs with no common beginning, so that the boundary falls exactly at the end of the stable paragraph.
  const one = assembleSystemPrompt(stable, 'XXX-1');
  const two = assembleSystemPrompt(stable, 'YYY-2-LONGER');
  assert.equal(
    commonPrefixLength(one, two),
    stable.join('').length,
    '\u516c\u5171\u524d\u7f00\u5fc5\u987b\u8986\u76d6\u5168\u90e8\u7a33\u5b9a\u6bb5——\u77ed\u4e00\u4e2a\u5b57\u8282\u5c31\u610f\u5473\u7740\u6709\u6613\u53d8\u5185\u5bb9\u6df7\u8fdb\u4e86\u524d\u7f00',
  );
}

{
  assert.match(agentLanguagePrompt('zh'), /interface language is Chinese/);
  assert.match(agentLanguagePrompt('zh'), /in Chinese/);
  assert.match(agentLanguagePrompt('en'), /interface language is English/);
  assert.match(agentLanguagePrompt('en'), /in English/);
  assert.match(agentLanguagePrompt('it'), /interface language is Italian/);
  assert.match(agentLanguagePrompt('it'), /in Italian/);
  assert.match(agentLanguagePrompt('ru'), /interface language is Russian/);
  assert.match(agentLanguagePrompt('ru'), /in Russian/);
  assert.match(agentLanguagePrompt('ko'), /interface language is Korean/);
  assert.match(agentLanguagePrompt('ko'), /in Korean/);
}

// ── Public product identity must override stale names in workflows or conversation memory ──
{
  const workflow = '\n<selected_skill>A legacy workflow calls this product AnotherChatCut.</selected_skill>';
  const system = assembleSystemPrompt([
    SYSTEM_PROMPT,
    workflow,
    PRODUCT_IDENTITY_PROMPT,
  ], '<editor_state/>');

  assert.match(PRODUCT_IDENTITY_PROMPT, /official product name is AfterFrame/);
  assert.match(SYSTEM_PROMPT, /imported document text.*untrusted editing material/);
  assert.match(PRODUCT_IDENTITY_PROMPT, /Do not inherit product identity/);
  assert.ok(
    system.indexOf(PRODUCT_IDENTITY_PROMPT) > system.indexOf(workflow),
    'product identity should follow selected workflow instructions so stale names cannot override it',
  );
}

// ── Go through it with the real editorStatePrompt: you cannot change the prefix when changing the timeline ──
{
  const item = (id: string, startFrame: number): TimelineItem => ({
    id, track: 'V1', startFrame, durationInFrames: 60,
    kind: 'video', name: id, src: '/m/a.mp4',
  } as TimelineItem);

  const ctxOf = (items: TimelineItem[]): AgentContext => {
    const state: TimelineState = {
      fps: 30, width: 1920, height: 1080, selectedId: null,
      tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'], items,
    };
    const doc = {
      version: 3, assets: [], mediaFolders: [], activeTimelineId: 'tl1',
      timelines: [{ ...state, id: 'tl1', name: 'main', order: 0 }],
    } as unknown as ProjectDoc;
    return {
      getState: () => state,
      getDoc: () => doc,
      getCreativeMode: () => null,
    } as unknown as AgentContext;
  };

  const promptContext = ctxOf([item('a', 0)]);
  const apiPrompt = buildAgentSystemPrompt(promptContext, DEFAULT_AGENT_SETTINGS);
  const codexPrompt = buildCodexSystemPrompt(promptContext);
  assert.ok(
    apiPrompt.includes(PRODUCT_IDENTITY_PROMPT),
    'the central API prompt builder must include the product identity section',
  );
  assert.equal(
    codexPrompt,
    apiPrompt,
    'Codex and API backends must share the central prompt builder',
  );

  const stable = ['SYSTEM', 'CAPS', 'SKILLS'];
  const before = assembleSystemPrompt(stable, editorStatePrompt(ctxOf([item('a', 0)])));
  const after = assembleSystemPrompt(stable, editorStatePrompt(ctxOf([item('a', 0), item('b', 60)])));

  assert.notEqual(before, after, '\u65f6\u95f4\u7ebf\u53d8\u4e86,\u6613\u53d8\u6bb5\u5f53\u7136\u8981\u53d8');
  assert.ok(
    commonPrefixLength(before, after) >= stable.join('').length,
    '\u52a0\u4e00\u4e2a\u7247\u6bb5\u53ea\u80fd\u5f71\u54cd\u672b\u5c3e\u90a3\u6bb5;\u524d\u7f00\u4e00\u52a8,\u5de5\u5177 schema \u548c\u5386\u53f2\u7684\u7f13\u5b58\u5c31\u5168\u5e9f\u4e86',
  );
  assert.equal(before.slice(0, stable.join('').length), stable.join(''), '\u7a33\u5b9a\u6bb5\u9010\u5b57\u8282\u4e0d\u53d8');
  assert.ok(before.includes('<editor_state>'), '\u5feb\u7167\u786e\u5b9e\u62fc\u8fdb\u6765\u4e86');
  assert.ok(
    before.indexOf('<editor_state>') >= stable.join('').length,
    '\u5feb\u7167\u6574\u6bb5\u90fd\u843d\u5728\u7a33\u5b9a\u6bb5\u4e4b\u540e',
  );
}

// ── When the stable paragraph itself changes (such as changing the creative mode), the change point cannot be advanced to an earlier paragraph ──
{
  // Similarly select two values with no common beginning, so that the boundary falls exactly at the starting point of the changing section.
  const a = assembleSystemPrompt(['SYSTEM', 'CAPS', 'AAAA'], 'S');
  const b = assembleSystemPrompt(['SYSTEM', 'CAPS', 'BBBB'], 'S');
  assert.equal(commonPrefixLength(a, b), 'SYSTEMCAPS'.length, '\u53ea\u4ece\u771f\u6b63\u53d8\u5316\u7684\u90a3\u4e00\u6bb5\u5f00\u59cb\u5931\u6548');
}

// ── The project creation guide will enter the prompt word and cover all edits instead of just constraining MG ──
{
  const prompt = designStylePrompt({
    colors: [],
    fonts: [],
    styleGuide: '\u5b57\u5e55\u4fdd\u6301\u4e24\u884c\u4ee5\u5185，\u907f\u514d\u70ab\u5149\u8f6c\u573a\u3002',
  });
  assert.match(prompt, /\u5b57\u5e55\u4fdd\u6301\u4e24\u884c\u4ee5\u5185/);
  assert.match(prompt, /Follow it for every edit/);
  assert.match(SYSTEM_PROMPT, /creative direction and asset plan/);
  assert.match(SYSTEM_PROMPT, /Never claim or imply success after an unresolved tool failure/);
}

// ── Auto-apply mode appends a late override; manual mode stays byte-identical ──
{
  // In-app contexts have no getApprovalMode accessor: the composer syncs YOLO
  // into the approval-mode registry, which must drive the built prompt.
  const registryCtx = {
    getState: () => ({ fps: 30, width: 1920, height: 1080, selectedId: null, tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'], items: [] }),
    getDoc: () => ({ version: 3, assets: [], mediaFolders: [], activeTimelineId: 'tl1', timelines: [] }),
    getCreativeMode: () => null,
  } as unknown as AgentContext;
  assert.equal(
    buildAgentSystemPrompt(registryCtx, DEFAULT_AGENT_SETTINGS).includes('# Auto-apply mode (YOLO)'),
    false,
    'the unsynced manual registry must not inject the YOLO override',
  );
  setAgentAutoApply(true);
  try {
    assert.ok(
      buildAgentSystemPrompt(registryCtx, DEFAULT_AGENT_SETTINGS).includes('# Auto-apply mode (YOLO)'),
      'the approval-mode registry must inject the YOLO override when getApprovalMode is absent',
    );
  } finally {
    setAgentAutoApply(false);
  }
  assert.equal(confirmationModePrompt('manual'), '', 'manual (ask) mode must not change the static prompt');
  const auto = confirmationModePrompt('auto');
  assert.match(auto, /# Auto-apply mode \(YOLO\)/);
  assert.match(auto, /overrides the '# Planning and confirmation' rules above/);
  assert.match(auto, /do NOT stop between major stages for confirmation/i);
  assert.match(auto, /do NOT confirm the creative direction or asset plan/i);
  const autoCtx = {
    getState: () => ({ fps: 30, width: 1920, height: 1080, selectedId: null, tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'], items: [] }),
    getDoc: () => ({ version: 3, assets: [], mediaFolders: [], activeTimelineId: 'tl1', timelines: [] }),
    getCreativeMode: () => null,
    getApprovalMode: () => 'auto',
  } as unknown as AgentContext;
  assert.ok(
    buildAgentSystemPrompt(autoCtx, DEFAULT_AGENT_SETTINGS).includes('# Auto-apply mode (YOLO)'),
    'auto-apply mode must inject the YOLO override into the built prompt',
  );
}

console.log('systemPromptOrder.verify: ok (\u6613\u53d8\u6bb5\u6536\u5c3e/\u771f editorStatePrompt \u4e0d\u6c61\u67d3\u524d\u7f00/\u5931\u6548\u70b9\u6700\u5c0f\u5316)');
