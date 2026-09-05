/** Cosmetic choices are independent of the character's pose and gameplay dimensions. */
export type CharacterLookId = 'base' | 'field' | 'scout' | 'heavy';
export type BodyBuild = 'slim' | 'standard' | 'broad';
export type ClothingColorId = 'olive' | 'sand' | 'slate' | 'rust' | 'navy' | 'forest' | 'charcoal' | 'cream';
export type HairColorId = 'black' | 'brown' | 'chestnut' | 'blond' | 'grey' | 'white';
export type SkinColorId = 'porcelain' | 'light' | 'tan' | 'warm' | 'brown' | 'deep';

export interface DetailedAppearance {
  build: BodyBuild;
  faceShape: 'oval' | 'round' | 'square';
  eyes: 'round' | 'narrow' | 'relaxed';
  eyebrows: 'straight' | 'angled' | 'thick';
  mouth: 'neutral' | 'smile' | 'teeth';
  skin: SkinColorId;
  hair: 'none' | 'buzz' | 'crop' | 'swept' | 'spiky' | 'tied-back';
  hairColor: HairColorId;
  sideburns: 'none' | 'short' | 'long';
  sideburnColor: HairColorId;
  moustache: 'none' | 'pencil' | 'handlebar';
  moustacheColor: HairColorId;
  beard: 'none' | 'stubble' | 'short' | 'goatee' | 'full';
  beardColor: HairColorId;
  headgear: 'none' | 'helmet' | 'cap' | 'beret';
  headgearColor: ClothingColorId;
  eyewear: 'none' | 'glasses' | 'sunglasses' | 'goggles';
  eyewearColor: ClothingColorId;
  top: 'field-jacket' | 't-shirt' | 'tactical-shirt';
  topColor: ClothingColorId;
  trousers: 'fatigues' | 'cargo' | 'reinforced';
  trousersColor: ClothingColorId;
  gloves: 'none' | 'fingerless' | 'full';
  glovesColor: ClothingColorId;
  vest: 'none' | 'utility' | 'armoured';
  vestColor: ClothingColorId;
  belt: 'none' | 'webbing' | 'pouches';
  beltColor: ClothingColorId;
  boots: 'light' | 'combat' | 'armoured';
  bootsColor: ClothingColorId;
}

export interface MaterialColors { base: string; light: string; dark: string; seam: string }

/** Named colour roles keep drawing independent of old visor-specific substitutions. */
export const CLOTHING_COLORS: Readonly<Record<ClothingColorId, MaterialColors>> = {
  olive: { base: '#849465', light: '#a7b180', dark: '#586648', seam: '#c6c49a' },
  sand: { base: '#c99b65', light: '#e0be88', dark: '#8b6b48', seam: '#f1d5a3' },
  slate: { base: '#688994', light: '#8ba9ae', dark: '#405f6c', seam: '#b9c9c0' },
  rust: { base: '#b96e50', light: '#d9966d', dark: '#784d3e', seam: '#e9ba8c' },
  navy: { base: '#4e6b84', light: '#7995aa', dark: '#35475b', seam: '#adc2ca' },
  forest: { base: '#4d7563', light: '#7f9a7b', dark: '#355345', seam: '#b9c69a' },
  charcoal: { base: '#414e4b', light: '#74817a', dark: '#2b3634', seam: '#9eab99' },
  cream: { base: '#cfccb1', light: '#e4dfc5', dark: '#96947c', seam: '#f5ecd0' },
};

export const HAIR_COLORS: Readonly<Record<HairColorId, { base: string; light: string }>> = {
  black: { base: '#30342d', light: '#535649' },
  brown: { base: '#5b4431', light: '#806046' },
  chestnut: { base: '#874d32', light: '#af754c' },
  blond: { base: '#b39555', light: '#dcc580' },
  grey: { base: '#838b7f', light: '#b1b8a5' },
  white: { base: '#cbd0b9', light: '#ecebd3' },
};

export const SKIN_COLORS: Readonly<Record<SkinColorId, MaterialColors>> = {
  porcelain: { base: '#eed1ad', light: '#ffdfbd', dark: '#bb8e73', seam: '#8e6251' },
  light: { base: '#e3bc90', light: '#f7d4a3', dark: '#b68961', seam: '#815b43' },
  tan: { base: '#cc9a6c', light: '#e9b782', dark: '#9a6c4c', seam: '#684b3a' },
  warm: { base: '#b98055', light: '#dba374', dark: '#865a3d', seam: '#5b4233' },
  brown: { base: '#946542', light: '#b78459', dark: '#674631', seam: '#48382c' },
  deep: { base: '#6b4936', light: '#93684a', dark: '#493629', seam: '#302b24' },
};

export const BASE_APPEARANCE: Readonly<DetailedAppearance> = {
  build: 'standard', faceShape: 'oval', eyes: 'round', eyebrows: 'angled', mouth: 'neutral', skin: 'light',
  hair: 'crop', hairColor: 'brown', sideburns: 'short', sideburnColor: 'brown',
  moustache: 'none', moustacheColor: 'brown', beard: 'none', beardColor: 'brown',
  headgear: 'none', headgearColor: 'olive', eyewear: 'none', eyewearColor: 'charcoal',
  top: 'field-jacket', topColor: 'olive', trousers: 'fatigues', trousersColor: 'forest',
  gloves: 'none', glovesColor: 'charcoal', vest: 'none', vestColor: 'olive',
  belt: 'webbing', beltColor: 'charcoal', boots: 'combat', bootsColor: 'charcoal',
};

/** Review looks are immutable source recipes; the preview keeps its own temporary selection. */
export const CHARACTER_LOOKS: ReadonlyArray<{
  id: CharacterLookId;
  name: string;
  description: string;
  buildLabel: string;
  appearance: Readonly<DetailedAppearance>;
}> = [
  { id: 'base', name: 'Base', description: 'An open face, bare hands, and the essential field uniform.', buildLabel: 'Standard build', appearance: { ...BASE_APPEARANCE } },
  { id: 'field', name: 'Field', description: 'Open-brim helmet, short beard, and olive field equipment.', buildLabel: 'Standard build', appearance: {
    ...BASE_APPEARANCE, headgear: 'helmet', beard: 'short', moustache: 'pencil',
    gloves: 'fingerless', vest: 'utility', belt: 'pouches',
  } },
  { id: 'scout', name: 'Scout', description: 'A sand cap, light layers, and a quick-footed silhouette.', buildLabel: 'Slim build', appearance: {
    ...BASE_APPEARANCE, build: 'slim', faceShape: 'round', eyes: 'relaxed', eyebrows: 'straight', mouth: 'smile', skin: 'tan',
    hair: 'swept', hairColor: 'chestnut', sideburnColor: 'chestnut', beard: 'stubble', beardColor: 'chestnut',
    headgear: 'cap', headgearColor: 'sand', top: 't-shirt', topColor: 'sand', trousers: 'cargo', trousersColor: 'sand',
    beltColor: 'sand', boots: 'light', bootsColor: 'sand',
  } },
  { id: 'heavy', name: 'Heavy', description: 'A broad jacket, full beard, slate armour, and reinforced boots.', buildLabel: 'Broad build', appearance: {
    ...BASE_APPEARANCE, build: 'broad', faceShape: 'square', eyes: 'narrow', eyebrows: 'thick', skin: 'warm',
    hair: 'crop', hairColor: 'black', sideburns: 'long', sideburnColor: 'black',
    beard: 'full', beardColor: 'black', moustache: 'pencil', moustacheColor: 'black',
    headgear: 'beret', headgearColor: 'slate', top: 'tactical-shirt', topColor: 'slate',
    trousers: 'reinforced', trousersColor: 'slate', gloves: 'full', vest: 'armoured', vestColor: 'slate',
    belt: 'pouches', boots: 'armoured', bootsColor: 'slate',
  } },
];

for (const look of CHARACTER_LOOKS) {
  Object.freeze(look.appearance);
  Object.freeze(look);
}
Object.freeze(CHARACTER_LOOKS);
Object.freeze(BASE_APPEARANCE);

export type AppearanceColorKey = Extract<keyof DetailedAppearance, `${string}Color`>;
export type AppearancePartId = Exclude<keyof DetailedAppearance, AppearanceColorKey>;
export type ClothingSlot = 'headgear' | 'eyewear' | 'top' | 'trousers' | 'gloves' | 'vest' | 'belt' | 'boots';
export interface AppearancePart {
  id: AppearancePartId;
  label: string;
  group: 'Face' | 'Hair' | 'Clothing' | 'Equipment';
  options: ReadonlyArray<{ id: string; label: string }>;
  colorKey?: AppearanceColorKey;
  colorFamily?: 'hair' | 'clothing';
  previewFocus: 'head' | 'body' | 'boots';
  compatibility?: { masksHair?: boolean };
}

const options = <T extends string>(values: ReadonlyArray<readonly [T, string]>) => values.map(([id, label]) => ({ id, label }));

/** One catalog drives validation, labels, item thumbnails, and creator navigation. */
export const APPEARANCE_PARTS: ReadonlyArray<AppearancePart> = [
  { id: 'faceShape', label: 'Face shape', group: 'Face', previewFocus: 'head', options: options([['oval', 'Oval'], ['round', 'Round'], ['square', 'Square']]) },
  { id: 'eyes', label: 'Eyes', group: 'Face', previewFocus: 'head', options: options([['round', 'Round'], ['narrow', 'Narrow'], ['relaxed', 'Relaxed']]) },
  { id: 'eyebrows', label: 'Eyebrows', group: 'Face', previewFocus: 'head', options: options([['straight', 'Straight'], ['angled', 'Angled'], ['thick', 'Thick']]) },
  { id: 'mouth', label: 'Mouth', group: 'Face', previewFocus: 'head', options: options([['neutral', 'Neutral'], ['smile', 'Smile'], ['teeth', 'Clenched teeth']]) },
  { id: 'skin', label: 'Skin tone', group: 'Face', previewFocus: 'head', options: options([['porcelain', 'Porcelain'], ['light', 'Light'], ['tan', 'Tan'], ['warm', 'Warm'], ['brown', 'Brown'], ['deep', 'Deep']]) },
  { id: 'build', label: 'Body build', group: 'Face', previewFocus: 'body', options: options([['slim', 'Slim'], ['standard', 'Standard'], ['broad', 'Broad']]) },
  { id: 'hair', label: 'Hair', group: 'Hair', previewFocus: 'head', colorKey: 'hairColor', colorFamily: 'hair', options: options([['none', 'None'], ['buzz', 'Buzz cut'], ['crop', 'Short crop'], ['swept', 'Swept'], ['spiky', 'Spiky'], ['tied-back', 'Tied back']]) },
  { id: 'sideburns', label: 'Sideburns', group: 'Hair', previewFocus: 'head', colorKey: 'sideburnColor', colorFamily: 'hair', options: options([['none', 'None'], ['short', 'Short'], ['long', 'Long']]) },
  { id: 'moustache', label: 'Moustache', group: 'Hair', previewFocus: 'head', colorKey: 'moustacheColor', colorFamily: 'hair', options: options([['none', 'None'], ['pencil', 'Pencil'], ['handlebar', 'Handlebar']]) },
  { id: 'beard', label: 'Beard', group: 'Hair', previewFocus: 'head', colorKey: 'beardColor', colorFamily: 'hair', options: options([['none', 'None'], ['stubble', 'Stubble'], ['short', 'Short beard'], ['goatee', 'Goatee'], ['full', 'Full beard']]) },
  { id: 'top', label: 'Top', group: 'Clothing', previewFocus: 'body', colorKey: 'topColor', colorFamily: 'clothing', options: options([['field-jacket', 'Field jacket'], ['t-shirt', 'T-shirt'], ['tactical-shirt', 'Tactical shirt']]) },
  { id: 'trousers', label: 'Trousers', group: 'Clothing', previewFocus: 'body', colorKey: 'trousersColor', colorFamily: 'clothing', options: options([['fatigues', 'Fatigues'], ['cargo', 'Cargo'], ['reinforced', 'Reinforced']]) },
  { id: 'gloves', label: 'Gloves', group: 'Clothing', previewFocus: 'body', colorKey: 'glovesColor', colorFamily: 'clothing', options: options([['none', 'None'], ['fingerless', 'Fingerless'], ['full', 'Full gloves']]) },
  { id: 'boots', label: 'Boots', group: 'Clothing', previewFocus: 'boots', colorKey: 'bootsColor', colorFamily: 'clothing', options: options([['light', 'Light boots'], ['combat', 'Combat boots'], ['armoured', 'Armoured boots']]) },
  { id: 'headgear', label: 'Headgear', group: 'Equipment', previewFocus: 'head', colorKey: 'headgearColor', colorFamily: 'clothing', compatibility: { masksHair: true }, options: options([['none', 'None'], ['helmet', 'Helmet'], ['cap', 'Cap'], ['beret', 'Beret']]) },
  { id: 'eyewear', label: 'Eyewear', group: 'Equipment', previewFocus: 'head', colorKey: 'eyewearColor', colorFamily: 'clothing', options: options([['none', 'None'], ['glasses', 'Glasses'], ['sunglasses', 'Sunglasses'], ['goggles', 'Goggles']]) },
  { id: 'vest', label: 'Vest', group: 'Equipment', previewFocus: 'body', colorKey: 'vestColor', colorFamily: 'clothing', options: options([['none', 'None'], ['utility', 'Utility vest'], ['armoured', 'Armoured vest']]) },
  { id: 'belt', label: 'Belt', group: 'Equipment', previewFocus: 'body', colorKey: 'beltColor', colorFamily: 'clothing', options: options([['none', 'None'], ['webbing', 'Webbing'], ['pouches', 'Pouches']]) },
];

export const COLOR_CHOICES: {
  hair: ReadonlyArray<{ id: HairColorId; label: string; hex: string }>;
  clothing: ReadonlyArray<{ id: ClothingColorId; label: string; hex: string }>;
} = {
  hair: (Object.keys(HAIR_COLORS) as HairColorId[]).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), hex: HAIR_COLORS[id].base })),
  clothing: (Object.keys(CLOTHING_COLORS) as ClothingColorId[]).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), hex: CLOTHING_COLORS[id].base })),
};

/** A role-specific legacy palette preserves the three original saved swatches exactly. */
const LEGACY_BASE_COLORS = {
  headgear: { olive: '#677d54', sand: '#c99151', slate: '#658e9a' },
  top: { olive: '#849465', sand: '#d1855d', slate: '#688994' },
  trousers: { olive: '#444e39', sand: '#786149', slate: '#3f6070' },
} as const;

function recolorMaterial(source: MaterialColors, base: string): MaterialColors {
  const channels = (hex: string) => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
  const oldBase = channels(source.base), newBase = channels(base);
  const shade = (hex: string) => '#' + channels(hex).map((value, index) =>
    Math.max(0, Math.min(255, value + newBase[index] - oldBase[index])).toString(16).padStart(2, '0'),
  ).join('');
  return Object.freeze({ base, light: shade(source.light), dark: shade(source.dark), seam: shade(source.seam) });
}

const SLOT_MATERIALS = Object.fromEntries(Object.entries(LEGACY_BASE_COLORS).map(([slot, colors]) => [
  slot, Object.fromEntries(Object.entries(colors).map(([color, base]) => [color, recolorMaterial(CLOTHING_COLORS[color as ClothingColorId], base)])),
])) as Record<keyof typeof LEGACY_BASE_COLORS, Record<'olive' | 'sand' | 'slate', MaterialColors>>;

/** Materials are prepared once; rendering does no colour decoding or resource requests. */
export function clothingMaterial(color: ClothingColorId, slot?: ClothingSlot): MaterialColors {
  if (slot && Object.hasOwn(SLOT_MATERIALS, slot) && (color === 'olive' || color === 'sand' || color === 'slate')) {
    return SLOT_MATERIALS[slot as keyof typeof SLOT_MATERIALS][color];
  }
  return CLOTHING_COLORS[color] ?? CLOTHING_COLORS.olive;
}

export const DEFAULT_APPEARANCE: Readonly<DetailedAppearance> = Object.freeze({
  ...CHARACTER_LOOKS[1].appearance,
  trousersColor: 'olive',
});

/** The training target owns its recipe, independent of the player's active appearance. */
export const BOT_APPEARANCE: Readonly<DetailedAppearance> = Object.freeze({
  ...BASE_APPEARANCE,
  build: 'standard', faceShape: 'square', eyes: 'narrow', eyebrows: 'straight', mouth: 'neutral', skin: 'tan',
  hair: 'buzz', hairColor: 'black', sideburns: 'none', sideburnColor: 'black',
  beard: 'stubble', beardColor: 'black', moustache: 'none', moustacheColor: 'black',
  headgear: 'cap', headgearColor: 'sand', eyewear: 'none', eyewearColor: 'charcoal',
  top: 'tactical-shirt', topColor: 'sand', trousers: 'cargo', trousersColor: 'sand',
  gloves: 'fingerless', glovesColor: 'charcoal', vest: 'utility', vestColor: 'sand',
  belt: 'pouches', beltColor: 'charcoal', boots: 'combat', bootsColor: 'charcoal',
});

export type OutfitId = Exclude<CharacterLookId, 'base'>;
export const OUTFITS: ReadonlyArray<{ id: OutfitId; name: string; description: string; appearance: Readonly<DetailedAppearance> }> = Object.freeze(
  CHARACTER_LOOKS.filter(look => look.id !== 'base').map(look => Object.freeze({
    id: look.id as OutfitId, name: look.name,
    description: look.id === 'field' ? 'Olive field gear and combat boots.' : look.id === 'scout' ? 'Sand clothing, a cap, and light boots.' : 'Slate armour, a beret, and reinforced boots.',
    appearance: look.appearance,
  })),
);

const PART_VALUES = new Map(APPEARANCE_PARTS.map(part => [part.id, new Set(part.options.map(option => option.id))]));
const COLOR_VALUES = new Map(APPEARANCE_PARTS.filter(part => part.colorKey).map(part => [
  part.colorKey!, new Set<string>(COLOR_CHOICES[part.colorFamily!].map(color => color.id)),
]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Invalid saved identifiers fall back independently, leaving every valid selection intact. */
export function normalizeAppearance(value: unknown): DetailedAppearance {
  const result: DetailedAppearance = { ...DEFAULT_APPEARANCE };
  if (!isRecord(value)) return result;
  for (const part of APPEARANCE_PARTS) {
    const selected = value[part.id];
    if (typeof selected === 'string' && PART_VALUES.get(part.id)!.has(selected)) {
      Object.assign(result, { [part.id]: selected });
    }
    if (part.colorKey) {
      const color = value[part.colorKey];
      if (typeof color === 'string' && COLOR_VALUES.get(part.colorKey)!.has(color)) {
        Object.assign(result, { [part.colorKey]: color });
      }
    }
  }
  return result;
}

export function updateAppearancePart(appearance: DetailedAppearance, id: AppearancePartId, value: string): DetailedAppearance {
  const next = normalizeAppearance(appearance);
  if (PART_VALUES.get(id)?.has(value)) Object.assign(next, { [id]: value });
  return next;
}

/** Outfits are equipment recipes: face, hair, their colours, and build stay the player's own. */
export function applyOutfit(appearance: DetailedAppearance, id: OutfitId | string): DetailedAppearance {
  const next = normalizeAppearance(appearance), outfit = OUTFITS.find(item => item.id === id);
  if (!outfit) return next;
  for (const part of APPEARANCE_PARTS) {
    if (part.group !== 'Clothing' && part.group !== 'Equipment') continue;
    Object.assign(next, { [part.id]: outfit.appearance[part.id] });
    if (part.colorKey) Object.assign(next, { [part.colorKey]: outfit.appearance[part.colorKey] });
  }
  return next;
}
