import { join } from 'node:path';

export function modelCachePath(home: string): string {
  return join(home, '.afterframe', 'asr-models');
}
