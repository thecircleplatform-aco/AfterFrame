import assert from 'node:assert/strict';
import { recoverDevVitePreload } from './vite-preload-recovery';

async function run(): Promise<void> {
  // Success: save first, then navigate, and never report a failure.
  {
    let reloads = 0;
    let failures = 0;
    const didReload = await recoverDevVitePreload({
      save: async () => true,
      reload: () => {
        reloads += 1;
      },
      onSaveFailure: () => {
        failures += 1;
      },
    });
    assert.equal(didReload, true);
    assert.equal(reloads, 1);
    assert.equal(failures, 0);
  }

  // Save failure: report it and DO NOT navigate — unsaved work wins over a
  // working route.
  {
    let reloads = 0;
    let failures = 0;
    const didReload = await recoverDevVitePreload({
      save: async () => false,
      reload: () => {
        reloads += 1;
      },
      onSaveFailure: () => {
        failures += 1;
      },
    });
    assert.equal(didReload, false);
    assert.equal(reloads, 0);
    assert.equal(failures, 1);
  }

  // order: the save must settle before the reload happens.
  {
    const events: string[] = [];
    await recoverDevVitePreload({
      save: async () => {
        events.push('save');
        return true;
      },
      reload: () => {
        events.push('reload');
      },
      onSaveFailure: () => {
        events.push('failure');
      },
    });
    assert.deepEqual(events, ['save', 'reload']);
  }

  process.stdout.write('vite-preload-recovery.verify: ok\n');
}

await run();
