import { DEFAULT_APPEARANCE, normalizeAppearance, type ClothingColorId, type DetailedAppearance } from './appearance';
import { defaultControls, normalizeControls, type ControlsSettings } from './controls';
import { defaultAudioSettings, normalizeAudioSettings, type AudioSettings } from './audioSettings';
import { defaultGraphics, normalizeGraphics, type GraphicsSettings } from './graphics';
import { defaultFeedbackSettings, normalizeFeedbackSettings, type FeedbackSettings } from './feedback';

export const SETTINGS_VERSION = 3 as const;
export const SETTINGS_STORAGE_KEY = 'burnhop-settings';
export const LEGACY_SETTINGS_STORAGE_KEY = 'low-altitude-settings';
export const MAX_LOOK_NAME_LENGTH = 40;

export interface SavedLook {
  id: string;
  name: string;
  appearance: DetailedAppearance;
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
  appearance: DetailedAppearance;
  savedLooks: SavedLook[];
  muted: boolean;
  reducedMotion: boolean;
  controls: ControlsSettings;
  audio: AudioSettings;
  graphics: GraphicsSettings;
  feedback: FeedbackSettings;
}

const LEGACY_COLOR_IDS: ReadonlyArray<ClothingColorId> = ['olive', 'sand', 'slate'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function defaultSettings(defaultReducedMotion: boolean): Settings {
  return {
    version: SETTINGS_VERSION, appearance: { ...DEFAULT_APPEARANCE }, savedLooks: [],
    muted: false, reducedMotion: defaultReducedMotion, controls: defaultControls(), audio: defaultAudioSettings(), graphics: defaultGraphics(), feedback: defaultFeedbackSettings(),
  };
}

export function normalizeLookName(name: unknown): string {
  return (typeof name === 'string' ? name.trim().slice(0, MAX_LOOK_NAME_LENGTH) : '') || 'Untitled look';
}

function normalizeSavedLooks(value: unknown): SavedLook[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim() || !isRecord(item.appearance)) return [];
    const id = item.id.trim();
    if (ids.has(id)) return [];
    ids.add(id);
    return [{ id, name: normalizeLookName(item.name), appearance: normalizeAppearance(item.appearance) }];
  });
}

/** Returns null for an unrelated or unsupported record, so a usable legacy save can be tried. */
function decodeSettings(value: unknown, defaultReducedMotion: boolean): Settings | null {
  if (!isRecord(value)) return null;
  if (value.version !== undefined && value.version !== 1 && value.version !== 2 && value.version !== SETTINGS_VERSION) return null;
  if (value.version === undefined && !['cosmetics', 'appearance', 'muted', 'reducedMotion'].some(key => Object.hasOwn(value, key))) return null;
  const next = defaultSettings(defaultReducedMotion);
  if (value.version === 2 || value.version === SETTINGS_VERSION) {
    next.appearance = normalizeAppearance(value.appearance);
    next.savedLooks = normalizeSavedLooks(value.savedLooks);
  } else if (isRecord(value.cosmetics)) {
    const colors = value.cosmetics;
    for (const [legacy, current] of [['headgear', 'headgearColor'], ['shirt', 'topColor'], ['trousers', 'trousersColor']] as const) {
      const index = colors[legacy];
      if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < LEGACY_COLOR_IDS.length) {
        next.appearance[current] = LEGACY_COLOR_IDS[index];
      }
    }
  } else if (isRecord(value.appearance)) {
    next.appearance = normalizeAppearance(value.appearance);
    next.savedLooks = normalizeSavedLooks(value.savedLooks);
  }
  if (typeof value.muted === 'boolean') next.muted = value.muted;
  if (typeof value.reducedMotion === 'boolean') next.reducedMotion = value.reducedMotion;
  if (value.version === SETTINGS_VERSION) next.controls = normalizeControls(value.controls);
  next.audio = normalizeAudioSettings(value.audio);
  next.graphics = normalizeGraphics(value.graphics);
  next.feedback = normalizeFeedbackSettings(value.feedback);
  return next;
}

function localStorageOrUndefined(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    // Browsers may deny the storage property itself, before getItem can be called.
    return undefined;
  }
}

/** Reading and migration never write: isolated previews can inspect preferences without altering saves. */
export function readSettings(defaultReducedMotion: boolean, storage?: Storage): Settings {
  const available = localStorageOrUndefined(storage);
  if (!available) return defaultSettings(defaultReducedMotion);
  for (const key of [SETTINGS_STORAGE_KEY, LEGACY_SETTINGS_STORAGE_KEY]) {
    try {
      const text = available.getItem(key);
      if (text === null) continue;
      const decoded = decodeSettings(JSON.parse(text), defaultReducedMotion);
      if (decoded) return decoded;
    } catch {
      // A corrupt primary record or a denied read must not prevent trying the legacy fallback.
    }
  }
  return defaultSettings(defaultReducedMotion);
}

/** Persistence failures leave the in-memory creator and gameplay fully usable. */
export function writeSettings(settings: Settings, storage?: Storage): boolean {
  const available = localStorageOrUndefined(storage);
  if (!available) return false;
  try {
    const normalized = decodeSettings(settings, settings.reducedMotion) ?? defaultSettings(settings.reducedMotion);
    available.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

let nextLookId = 0;
function uniqueLookId(existingLooks: ReadonlyArray<SavedLook>): string {
  const ids = new Set(existingLooks.map(look => look.id));
  let id: string;
  do {
    id = `look-${Date.now().toString(36)}-${(++nextLookId).toString(36)}`;
  } while (ids.has(id));
  return id;
}

export function createSavedLook(name: string, appearance: DetailedAppearance, existingLooks: ReadonlyArray<SavedLook> = []): SavedLook {
  return { id: uniqueLookId(existingLooks), name: normalizeLookName(name), appearance: normalizeAppearance(appearance) };
}

export function saveNewLook(settings: Settings, name: string): Settings {
  return { ...settings, savedLooks: [...settings.savedLooks, createSavedLook(name, settings.appearance, settings.savedLooks)] };
}

export function restoreSavedLook(settings: Settings, id: string): Settings {
  const look = settings.savedLooks.find(item => item.id === id);
  return look ? { ...settings, appearance: normalizeAppearance(look.appearance) } : settings;
}

export function updateSavedLook(settings: Settings, id: string): Settings {
  if (!settings.savedLooks.some(look => look.id === id)) return settings;
  return {
    ...settings,
    savedLooks: settings.savedLooks.map(look => look.id === id ? { ...look, appearance: normalizeAppearance(settings.appearance) } : look),
  };
}

export function renameSavedLook(settings: Settings, id: string, name: string): Settings {
  if (!settings.savedLooks.some(look => look.id === id)) return settings;
  return { ...settings, savedLooks: settings.savedLooks.map(look => look.id === id ? { ...look, name: normalizeLookName(name) } : look) };
}

export function deleteSavedLook(settings: Settings, id: string): Settings {
  if (!settings.savedLooks.some(look => look.id === id)) return settings;
  return { ...settings, savedLooks: settings.savedLooks.filter(look => look.id !== id) };
}

/** Reinsert a deleted snapshot without reverting changes made since deletion. */
export function undoDeleteSavedLook(settings: Settings, deleted: SavedLook, index: number): Settings {
  if (settings.savedLooks.some(look => look.id === deleted.id)) return settings;
  const savedLooks = [...settings.savedLooks];
  const insertionIndex = Number.isFinite(index) ? Math.max(0, Math.min(savedLooks.length, Math.floor(index))) : savedLooks.length;
  savedLooks.splice(insertionIndex, 0, { id: deleted.id, name: normalizeLookName(deleted.name), appearance: normalizeAppearance(deleted.appearance) });
  return { ...settings, savedLooks };
}
