import { DESIGN_STYLE_PRESETS } from '../../editor/design-presets';
import type { Locale } from '../../i18n/locale';

const PRESET_NAME_ZH: Record<string, string> = {
  'Terracotta Editorial': 'Terracotta magazine style',
  'Retro Duotone Print': 'Retro two-color print',
  'Highlighter Notebook': 'Neon notebook',
  'Soft Organic Gradient': 'Soft organic gradient',
  'Doodle Explainer': 'Hand-drawn explainer style',
  'Emerald Deco': 'Emerald Art Deco',
  'Black Yellow Type': 'Black-and-yellow typography',
  'Electric Impact Type': 'Electric impact font',
  'Acid Script Poster': 'Acid handwritten poster',
  'Neon Grid Commerce': 'Neon grid business style',
  'Pale Tech Dashboard': 'Light tech dashboard',
  'Liquid Aura': 'Flowing Light Ambience',
  'Grainy Heatwave': 'Grainy Heatwave',
  'Blush Watercolor': 'Blush Watercolor',
  'Archive Typewriter': 'Archive typewriter',
  'Cubist Collage': 'Cubist collage',
  'Redline Tech': 'Red Line Tech',
  'Black & White Neon': 'B&W Neon',
  'Violet Aura': 'Violet glow',
  'Warm Paper': 'Warm Paper',
  'Modern Editorial': 'Modern magazine editorial style',
  'Orange Minimal': 'Orange Minimal',
  'Crimson Night Glass': 'Crimson night glass',
  'Jewel Deco': 'Gemstone Art Deco',
};

const PRESET_GUIDE_ZH: Record<string, string> = {
  'Terracotta Editorial': 'Terracotta editorial style: calm spring entrances and staggered group animations; title, name, key points, and timeline enter gently from different directions. Terracotta red, copper, and amber palette with white text and elegant serif accents.',
  'Retro Duotone Print': 'Retro two-color print: text appears typewriter-style character by character, charts and timelines grow linearly, with no opacity or scale animations. Warm beige base with only deep blue and orange-red as primary colors.',
  'Highlighter Notebook': 'Highlighter notebook: highlighter strokes sweep left to right over text, checkmark lines draw progressively, sticky notes and decorative elements pop in lightly. Soft teal, white paper, yellow highlighter, and dark gray text.',
  'Soft Organic Gradient': 'Soft organic gradients: cream-white canvas with peach and sage green gradient blocks; animation is smooth and restrained, with no bounce. Serif italic section numbers, large serif headings, and clear sans-serif body text.',
  'Doodle Explainer': 'Hand-drawn explainer style: Elements appear with light bounces, and hand-drawn asterisks, crosses, and borders are drawn in sequence. Warm white background with deep blue and red; suitable for friendly, relaxed educational content.',
  'Emerald Deco': 'Emerald Art Deco: title, charts, and timeline enter with soft spring animations; gold lines expand from the center. Deep emerald green background with cream text and matte gold accents for an elegant, composed look.',
  'Black Yellow Type': 'Black-yellow typography style: Titles slide up from a mask; charts and timelines expand cleanly. Use only pure black and bright yellow as primary colors, avoiding gray and gradients for strong typographic impact.',
  'Electric Impact Type': 'Electric impact type: text appears word by word with hard cuts; charts and nodes appear directly in sequence. Deep electric blue background with pure red and white, suited to high-tempo, information-dense titles and data displays.',
  'Acid Script Poster': 'Acid handwritten poster: title appears character by character, mixing condensed type and decorative handwriting; curved ornaments draw progressively. Fluorescent yellow-green background with pure black text and white badges for an experimental poster feel.',
  'Neon Grid Commerce': 'Neon grid business style: Content pops in as grid cards, neon borders and charts grow linearly, and annotations appear character by character in monospace. Black background with fluorescent yellow-green and white body text.',
  'Pale Tech Dashboard': 'Light tech dashboard: near-white background with soft purple-blue light blocks; numbers scale in slightly, charts grow smoothly. Monospace headings, pixel numbers, and clear body text convey a technical, data-driven feel.',
  'Liquid Aura': 'Flowing light atmosphere: slowly moving purple, magenta, and blue light orbs on a deep purple-blue background; text enters smoothly; progress rings and metrics draw progressively. Immersive, flowing, and atmospheric.',
  'Grainy Heatwave': 'Grainy heatwave: Elements gradually emerge from noise texture; slow, dreamy pacing; charts use highly saturated orange and magenta. Background uses an orange-purple gradient with visible grain; text stays pure white.',
  'Blush Watercolor': 'Blush watercolor: pink, blue, and peach watercolor washes spread slowly; text and charts enter softly; lines draw naturally. Light serif headings and clear body text create a hand-drawn, organic texture.',
  'Archive Typewriter': 'Archive typewriter: All text appears character by character at typewriter pace; charts and timelines are drawn linearly; elements enter in sequence. Warm parchment background with black text and warm gold accents.',
  'Cubist Collage': 'Cubist collage: color blocks pop in from the center, text slides in from different directions, triangle, diamond, and circle decorations rotate in. Cream white base with saturated blue, yellow, red, cyan, and orange.',
  'Redline Tech': 'Redline tech: deep charcoal surfaces, dot-matrix textures, sharp red panels, and diagonal transitions form an industrial tech language. Red drives focal actions, white carries primary content, gray is used only for secondary information.',
  'Black & White Neon': 'Black-and-white neon: near-black background with glowing white text, white rings, polylines, and outlines; a small amount of cool purple serves only as accent glow. Each frame keeps one clear focal point with ample quiet space.',
  'Violet Aura': 'Violet glow: deep purple-black background, purple-pink gradient glows, translucent large numbers, and rounded cards create a dreamy explainer style. Each frame centers on one core question, number, chart, or statement.',
  'Warm Paper': 'Warm paper: Cream-colored paper, fine texture, coral-orange accents, organic waves, and pebble badges create a warm magazine style. Serif headlines set the mood; coral only marks true focal points.',
  'Modern Editorial': 'Modern magazine editorial style: warm gray paper, notebook or newspaper grid, serif headings, and clear Roboto body text. Overall like a data journalist\'s annotated notes, mostly black and gray, with orange or yellow used only to highlight key numbers and statements.',
  'Orange Minimal': 'Orange minimal: paper-textured neutral background, flat geometric blocks, bold typography, numbered badges, and clean charts create a friendly, direct business-explainer style. Orange is used only for key numbers, nodes, or banners.',
  'Crimson Night Glass': 'Crimson night glass: elements enter softly from the dark; title and charts have a restrained red glow; rounded glass cards appear progressively. Near-black background with dark red ambient light and white body text, suited to premium dark presentations.',
  'Jewel Deco': 'Jewel Art Deco: decorative borders draw first, content then fades in by group, charts use warm gradients with slight rotation. Near-black warm background with coral, gold, teal, wine red, and pink jewel tones.',
};

const ROLE_ZH: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent color',
  background: 'Background',
  text: 'Text',
  'text secondary': 'Secondary Text',
  'text-secondary': 'Secondary Text',
  'text-on-dark': 'Text on dark background',
  heading: 'Heading Font',
  body: 'Body Font',
  quote: 'Quote Font',
  display: 'Display Font',
  'display number': 'Digital display font',
  mono: 'Monospace Font',
  script: 'Handwriting Font',
  'heading serif': 'Serif heading font',
  Chinese: 'Chinese Font',
  'Chinese heading': 'Chinese heading font',
  'Chinese body': 'Chinese body font',
  'Chinese accent': 'Chinese emphasis font',
  'Chinese quote': 'Chinese quotation font',
  'accent copper': 'Copper Accent',
  'accent amber': 'Amber accent',
  'accent tan': 'Sepia accent',
  'accent gradient start': 'Accent gradient start color',
  'accent gradient end': 'Accent gradient end color',
  'accent-red': 'Red Accent',
  'accent-red-dark': 'Deep red accent',
  'accent-red-panel': 'Panel accent red',
  'accent-red-vivid': 'Vivid accent red',
  axis: 'Axis',
  'background-chart': 'Chart Background',
  'background-neutral': 'Neutral background',
  'background-warm': 'Warm background',
  'background gradient start': 'Background gradient start color',
  'background gradient end': 'Background gradient end color',
  'chart-warm-light': 'Chart warm light tone',
  'chart-warm-mid': 'Chart warm midtone',
  'chart-warm-dark': 'Chart warm dark tone',
  'chart-warm-deep': 'Chart warm deepest tone',
  'chart accent 1': 'Chart accent color 1',
  'chart accent 2': 'Chart accent color 2',
  'chart accent 3': 'Chart accent color 3',
  highlight: 'Highlight color',
  badge: 'Badge color',
  callout: 'Annotation color',
  divider: 'Divider',
  grid: 'Gridline',
  paper: 'Paper color',
  sticky: 'Sticky note color',
  texture: 'Texture color',
  glow: 'Glow color',
  'glow-main': 'Primary glow',
  'glow-soft': 'Soft glow',
  'inner-glow': 'Inner glow',
  'meta-text': 'Secondary text',
  impact: 'Impact color',
  neon: 'Neon color',
  'price-card': 'Pricing card',
  'blob blue': 'Blue glow',
  'blob deep purple': 'Deep purple glow',
  'blob green': 'Green glow',
  'blob magenta': 'Magenta glow',
  'blob purple': 'Purple glow',
  'blob warm': 'Warm glow',
  'wash blue': 'Blue watercolor',
  'wash flower': 'Floral watercolor',
  'wash peach': 'Peach watercolor',
  'wash pink': 'Pink watercolor',
  burgundy: 'Burgundy',
  cobalt: 'Cobalt blue',
  coral: 'Coral',
  gold: 'Gold',
  orange: 'Orange',
  pink: 'Pink',
  red: 'Red',
  teal: 'Teal',
  yellow: 'Yellow',
};

const FONT_ROLE_ZH: Record<string, string> = {
  ...ROLE_ZH,
  accent: 'Accent font',
  callout: 'Label font',
  impact: 'Impact font',
};

const GUIDE_ZH_BY_SOURCE = new Map(
  DESIGN_STYLE_PRESETS
    .filter((preset) => preset.style.styleGuide && PRESET_GUIDE_ZH[preset.name])
    .map((preset) => [preset.style.styleGuide as string, PRESET_GUIDE_ZH[preset.name]]),
);

export function localizeDesignPresetName(name: string, locale: Locale): string {
  return locale === 'zh' ? (PRESET_NAME_ZH[name] ?? name) : name;
}
export function localizeDesignRole(role: string, locale: Locale): string {
  return locale === 'zh' ? (ROLE_ZH[role] ?? role) : role;
}

export function localizeDesignFontRole(role: string, locale: Locale): string {
  return locale === 'zh' ? (FONT_ROLE_ZH[role] ?? role) : role;
}

export function localizeDesignStyleGuide(guide: string, locale: Locale): string {
  return locale === 'zh' ? (GUIDE_ZH_BY_SOURCE.get(guide) ?? guide) : guide;
}
