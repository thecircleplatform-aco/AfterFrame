// Canvas sizes behind the dashboard's creation tiles. Creating a project is the
// only action here that needs to decide a frame size up front, so the choice is
// named instead of being passed around as loose width/height numbers.
export type NewProjectPreset = 'blank' | 'video' | 'photo';

export interface NewProjectCanvas {
  width: number;
  height: number;
  fps: number;
}

const PRESETS: Record<NewProjectPreset, NewProjectCanvas> = {
  // Keep `blank` identical to what "New project" has always produced.
  blank: { width: 1920, height: 1080, fps: 30 },
  video: { width: 1920, height: 1080, fps: 30 },
  // A square canvas, the shape a still photo is usually posted in.
  photo: { width: 1080, height: 1080, fps: 30 },
};

export function newProjectCanvas(preset: NewProjectPreset = 'blank'): NewProjectCanvas {
  return { ...(PRESETS[preset] ?? PRESETS.blank) };
}
