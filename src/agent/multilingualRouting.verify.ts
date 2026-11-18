// Verifies routing works for users in ANY language.
//
// The bug this guards against: `routingTermPattern` used
// `if (!/^[a-z][a-z -]*$/.test(term)) return null`, so any keyword outside ASCII
// matched nothing. Combined with English-only `READ_ONLY_TERMS`, a non-English
// user got the worst of both worlds — their edit requests were not recognised as
// edits (so editing tools were never offered), and their "don't change anything,
// just show me" requests were not recognised as read-only (so editing tools were
// offered anyway). Two opposite failures from one assumption.
//
// The visible symptom was `tool-activation.verify.ts` failing on
// "把 V1 轨道片段移动并剪辑一下".
import assert from 'node:assert/strict';
import { ToolActivation } from './tool-activation';
import { TOOL_SCHEMAS } from './tools';
import { hasMutationRoutingIntent, routedToolNames } from './tool-routing';

function names(prompt: string): readonly string[] {
  return new ToolActivation(TOOL_SCHEMAS, [{ role: 'user', content: prompt }]).names();
}

function has(prompt: string, tool: string): boolean {
  return names(prompt).includes(tool);
}

// ── 1. Edit requests are recognised as edits in every script ────────────────
// Both the verb AND the target must be present for the contextual edit group, so
// each phrase below pairs a native verb with a native target — exactly how a
// real user writes it.
const EDIT_REQUESTS: [lang: string, prompt: string][] = [
  ['zh', '把 V1 轨道片段移动并剪辑一下'],
  ['zh', '把开头那段剪掉'],
  ['zh', '给这个片段加个标题'],
  ['ja', 'クリップを移動して分割する'],
  ['ja', 'トラックのクリップを編集'],
  ['ko', '클립을 이동하고 분할하기'],
  ['ko', '트랙 클립 편집'],
  ['ru', 'переместить клип на дорожке и обрезать'],
  ['ru', 'отредактировать последовательность'],
  ['es', 'mover el clip en la pista y recortar'],
  ['fr', 'déplacer le clip sur la piste et couper'],
  ['de', 'clip auf der spur verschieben und schneiden'],
  ['pt', 'mover o clipe na faixa e cortar'],
  ['it', 'spostare il clip sulla traccia e tagliare'],
  ['th', 'ย้ายคลิปบนแทร็กแล้วตัด'],
  ['hi', 'ट्रैक पर क्लिप ले जाएं और काटें'],
  ['ar', 'نقل المقطع على المسار وقص'],
];
for (const [lang, prompt] of EDIT_REQUESTS) {
  assert.ok(hasMutationRoutingIntent(prompt.toLowerCase()),
    `[${lang}] "${prompt}" must be recognised as a mutation`);
}

// ── 2. Read-only requests suppress editing tools in every script ────────────
// The mirror image: an explicit "just show me" must NOT hand out edit tools.
const READ_ONLY_REQUESTS: [lang: string, prompt: string][] = [
  ['zh', '查看当前时间线，只告诉我片段信息，不要修改'],
  ['zh', '只查看标题内容，不要修改'],
  ['ja', 'タイムラインを見るだけで、変更しないで'],
  ['ko', '타임라인을 보기만 하고 수정하지 마'],
  ['ru', 'показать таймлайн, не редактировать'],
  ['es', 'solo lectura del timeline, no modificar'],
  ['fr', 'lecture seule, ne pas modifier'],
  ['de', 'nur lesen, nicht ändern'],
  ['pt', 'somente leitura, não modificar'],
  ['it', 'solo lettura, non modificare'],
  ['th', 'อ่านเท่านั้น ห้ามแก้ไข'],
  ['hi', 'केवल पढ़ें, बदलें नहीं'],
  ['ar', 'للقراءة فقط، لا تعدل'],
  ['en', "Tell me what the title says; don't edit."],
];
for (const [lang, prompt] of READ_ONLY_REQUESTS) {
  assert.ok(!has(prompt, 'edit_item'),
    `[${lang}] "${prompt}" must not expose edit_item`);
}

// ── 3. Read-only intent still wins when a mutation word is present ──────────
// "不要修改原片，只加标题" = "don't touch the original, just add a title".
// The trailing edit is real intent, so this MUST stay mutating — the read-only
// phrase is scoped to the original, not to the whole request.
assert.ok(hasMutationRoutingIntent('不要修改原片，只加标题'.toLowerCase()),
  'a scoped "don\'t modify X" followed by a real edit must stay mutating');

// ── 4. Non-English vision requests reach the frame tools ───────────────────
// Mirrors the English look-request coverage in agentVision.verify.ts.
for (const prompt of [
  '看看这个画面有什么问题',
  'チェックしてください、おかしいです',
  '화면을 확인해줘',
  'посмотреть кадр, что не так',
  'revisar la imagen, hay un problema',
  'überprüfen sie das bild',
  'ดูภาพนี้หน่อย มีปัญหา',
]) {
  assert.ok(has(prompt, 'view_timeline_frames'),
    `"${prompt}" must surface view_timeline_frames`);
}

// ── 5. Latin routing keeps its old behaviour (no regression) ───────────────
assert.ok(routedToolNames('trim the clip and split it', false).has('edit_item'));
assert.ok(!routedToolNames('trim the clip and split it', true).has('edit_item'),
  'read-only flag still suppresses the mutating group');

// English word-boundary semantics must survive the matcher rewrite: "clipping"
// is a different word from "clip", so a clip target alone must not drag in the
// edit group. (No verb + no real target = no edit routing.)
assert.ok(!hasMutationRoutingIntent('the clipping is too aggressive'),
  'English still matches on word boundaries, not substrings');

console.log('multilingualRouting.verify: edit/read-only/vision intent resolves in zh ja ko ru es fr de pt it th hi ar');
