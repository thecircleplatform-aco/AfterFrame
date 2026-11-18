import { isExternalGlobalReadTool, isExternalReadTool } from './external-tool-policy';
import { TOOL_SCHEMAS } from './tools';

/** Q&A mode may inspect project/skill state, but never receives mutating tools. */
const ASK_MODE_TOOL_NAMES = new Set([
  ...TOOL_SCHEMAS
    .filter((tool) => isExternalGlobalReadTool(tool.name) || isExternalReadTool(tool.name))
    .map((tool) => tool.name),
  'ToolSearch',
  // Plan mode is sent as `askOnly` (it must not edit), so it lands in this
  // catalog. propose_plan itself mutates nothing — it renders a card — but
  // without it here the model has no way to hand back a plan and falls back to
  // prose. Ask mode simply never calls it.
  'propose_plan',
]);

/** Q&A mode may inspect project/skill state and discover read tools, but never receives mutations. */
export const ASK_MODE_TOOL_SCHEMAS = TOOL_SCHEMAS.filter((tool) => ASK_MODE_TOOL_NAMES.has(tool.name));
