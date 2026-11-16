import assert from 'node:assert/strict';
import type { BrowserExportInspection } from './browserExport';
import { chooseSupportedRoute, recordExportPerformance } from './exportRoutePlanner';
import type { ExportEngineInfo } from './exportWorkflowTypes';

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  },
});

const software: ExportEngineInfo = {
  id: 'libx264',
  label: 'Software (libx264)',
  hardware: false,
  transport: 'server',
};
const hardware: ExportEngineInfo = {
  id: 'h264_videotoolbox',
  label: 'Apple VideoToolbox',
  hardware: true,
  transport: 'server',
};
const efficient: BrowserExportInspection = { status: 'supported', issues: [], powerEfficient: true };
const compatible: BrowserExportInspection = { status: 'supported', issues: [], powerEfficient: false };
const unsupported: BrowserExportInspection = { status: 'unsupported', issues: ['webgl'], reason: '\u5305\u542b WebGL \u8f6c\u573a' };

try {
  assert.equal(chooseSupportedRoute(unsupported, hardware).route, 'server');
  assert.equal(chooseSupportedRoute(efficient, software).route, 'browser');
  assert.equal(chooseSupportedRoute(compatible, hardware).route, 'server');
  // A canvas the local renderer cannot scale to the preset (its exact-scale
  // grid has nothing near it) goes to the browser even when hardware would
  // otherwise win; without a browser it still has to go to the server.
  const unrepresentable = chooseSupportedRoute(compatible, hardware, false);
  assert.equal(unrepresentable.route, 'browser');
  assert.equal(unrepresentable.reason, '\u672c\u673a\u6e32\u67d3\u5668\u65e0\u6cd5\u5c06\u6b64\u753b\u5e03\u7cbe\u786e\u7f29\u653e\u5230\u6240\u9009\u5206\u8fa8\u7387');
  assert.equal(chooseSupportedRoute(unsupported, hardware, false).route, 'server');

  values.set('cc.exportPerformance.v1', JSON.stringify({
    'browser:webcodecs': { samples: 2, workPerMillisecond: 20 },
    'server:libx264': { samples: 2, workPerMillisecond: 40 },
  }));
  const measured = chooseSupportedRoute(efficient, software);
  assert.equal(measured.route, 'server');
  assert.equal(measured.reason, '\u5386\u53f2\u5b9e\u6d4b\u663e\u793a\u672c\u673a\u6e32\u67d3\u5668\u66f4\u5feb');

  values.clear();
  recordExportPerformance(hardware, { width: 1920, height: 1080, frames: 30, elapsedMs: 1000 });
  const stored = JSON.parse(values.get('cc.exportPerformance.v1') ?? '{}') as Record<string, { samples: number }>;
  assert.equal(stored['server:h264_videotoolbox']?.samples, 1);
  console.log('export route planner verification passed');
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}
