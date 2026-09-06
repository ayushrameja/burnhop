import { describe, expect, it } from 'vitest';
import { defaultGraphics } from './graphics';
import { defaultControls } from './controls';
import { defaultAudioSettings, normalizeAudioSettings } from './audioSettings';
import {
  APPEARANCE_PARTS, BASE_APPEARANCE, BOT_APPEARANCE, CHARACTER_LOOKS, COLOR_CHOICES, DEFAULT_APPEARANCE, OUTFITS,
  applyOutfit, clothingMaterial, normalizeAppearance, updateAppearancePart, type DetailedAppearance,
} from './appearance';
import {
  LEGACY_SETTINGS_STORAGE_KEY, SETTINGS_STORAGE_KEY, createSavedLook, defaultSettings, deleteSavedLook,
  readSettings, renameSavedLook, restoreSavedLook, saveNewLook, undoDeleteSavedLook, updateSavedLook, writeSettings,
} from './settings';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  writes = 0;
  failWrites = false;
  unreadable = new Set<string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) {
    if (this.unreadable.has(key)) throw new Error('Storage unavailable');
    return this.values.get(key) ?? null;
  }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('Storage quota exceeded');
    this.writes++;
    this.values.set(key, value);
  }
  seed(key: string, value: unknown) { this.values.set(key, JSON.stringify(value)); }
}

describe('typed appearance catalog', () => {
  it('covers every part and independent colour exactly once, with valid defaults and recipes', () => {
    const keys = APPEARANCE_PARTS.flatMap(part => [part.id, ...(part.colorKey ? [part.colorKey] : [])]);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(DEFAULT_APPEARANCE).sort());
    expect(COLOR_CHOICES.hair).toHaveLength(6);
    expect(COLOR_CHOICES.clothing).toHaveLength(8);
    for (const appearance of [BASE_APPEARANCE, DEFAULT_APPEARANCE, BOT_APPEARANCE, ...CHARACTER_LOOKS.map(look => look.appearance)]) {
      expect(normalizeAppearance(appearance)).toEqual(appearance);
    }
    for (const part of APPEARANCE_PARTS) {
      for (const option of part.options) {
        const appearance = updateAppearancePart({ ...DEFAULT_APPEARANCE }, part.id, option.id);
        expect(appearance[part.id]).toBe(option.id);
        expect(normalizeAppearance(appearance)).toEqual(appearance);
      }
    }
  });

  it('includes every newly promised style while preserving the reviewed short beard', () => {
    const ids = (key: string) => APPEARANCE_PARTS.find(part => part.id === key)!.options.map(option => option.id);
    expect(ids('hair')).toEqual(['none', 'buzz', 'crop', 'swept', 'spiky', 'tied-back']);
    expect(ids('moustache')).toEqual(['none', 'pencil', 'handlebar']);
    expect(ids('beard')).toEqual(['none', 'stubble', 'short', 'goatee', 'full']);
    expect(APPEARANCE_PARTS.find(part => part.id === 'headgear')?.compatibility?.masksHair).toBe(true);
  });

  it('falls back per identifier without discarding valid parts or independent colours', () => {
    const appearance = normalizeAppearance({
      ...DEFAULT_APPEARANCE, build: 'broad', hair: 'tied-back', hairColor: 'white', sideburnColor: 'chestnut',
      beard: 'laser-beard', beardColor: 'blond', top: 'bad-top', topColor: 'navy', bootsColor: 'bad-colour',
      extra: 'ignored',
    });
    expect(appearance.build).toBe('broad');
    expect(appearance.hair).toBe('tied-back');
    expect(appearance.hairColor).toBe('white');
    expect(appearance.sideburnColor).toBe('chestnut');
    expect(appearance.beard).toBe(DEFAULT_APPEARANCE.beard);
    expect(appearance.beardColor).toBe('blond');
    expect(appearance.top).toBe(DEFAULT_APPEARANCE.top);
    expect(appearance.topColor).toBe('navy');
    expect(appearance.bootsColor).toBe(DEFAULT_APPEARANCE.bootsColor);
    expect(appearance).not.toHaveProperty('extra');
    for (const invalid of [null, false, 9, 'field', [], { hair: 1, skin: null }]) {
      expect(normalizeAppearance(invalid)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it('validates a selection against its own slot and keeps recipes immutable', () => {
    const before = { ...BASE_APPEARANCE };
    const next = updateAppearancePart(before, 'hair', 'tied-back');
    expect(before).toEqual(BASE_APPEARANCE);
    expect(next.hair).toBe('tied-back');
    expect(updateAppearancePart(next, 'hair', 'armoured')).toEqual(next);
    expect(Object.isFrozen(CHARACTER_LOOKS)).toBe(true);
    expect(CHARACTER_LOOKS.every(look => Object.isFrozen(look) && Object.isFrozen(look.appearance))).toBe(true);
    expect(Object.isFrozen(DEFAULT_APPEARANCE)).toBe(true);
  });

  it('changes all outfit clothing and equipment while preserving the full personal identity', () => {
    const original: DetailedAppearance = {
      ...BASE_APPEARANCE, build: 'broad', faceShape: 'round', eyes: 'relaxed', skin: 'deep',
      hair: 'spiky', hairColor: 'white', sideburns: 'long', sideburnColor: 'chestnut',
      moustache: 'handlebar', moustacheColor: 'blond', beard: 'goatee', beardColor: 'grey',
      headgear: 'none', eyewear: 'goggles',
    };
    for (const outfit of OUTFITS) {
      const dressed = applyOutfit(original, outfit.id);
      for (const part of APPEARANCE_PARTS) {
        const source = part.group === 'Face' || part.group === 'Hair' ? original : outfit.appearance;
        expect(dressed[part.id]).toBe(source[part.id]);
        if (part.colorKey) expect(dressed[part.colorKey]).toBe(source[part.colorKey]);
      }
    }
    expect(applyOutfit(original, 'unknown-outfit')).toEqual(original);
    expect(original.headgear).toBe('none');
    expect(original.eyewear).toBe('goggles');
  });

  it('retains the nine legacy role colours and reuses prepared shading materials', () => {
    const legacy = {
      headgear: ['#677d54', '#c99151', '#658e9a'],
      top: ['#849465', '#d1855d', '#688994'],
      trousers: ['#444e39', '#786149', '#3f6070'],
    } as const;
    for (const slot of ['headgear', 'top', 'trousers'] as const) {
      for (const [index, color] of (['olive', 'sand', 'slate'] as const).entries()) {
        const material = clothingMaterial(color, slot);
        expect(material.base).toBe(legacy[slot][index]);
        expect(clothingMaterial(color, slot)).toBe(material);
        for (const shade of Object.values(material)) expect(shade).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(clothingMaterial('navy', 'top')).toBe(clothingMaterial('navy', 'boots'));
    expect(clothingMaterial('olive', 'vest')).toBe(clothingMaterial('olive'));
  });
});

describe('versioned settings and migration', () => {
  it('creates independent default appearances and follows the system motion preference until saved', () => {
    const a = readSettings(true, new MemoryStorage()), b = readSettings(false, new MemoryStorage());
    expect(a).toEqual({ version: 3, appearance: DEFAULT_APPEARANCE, savedLooks: [], muted: false, reducedMotion: true, controls: defaultControls(), audio: defaultAudioSettings(), graphics: defaultGraphics() });
    expect(b.reducedMotion).toBe(false);
    a.appearance.build = 'slim';
    expect(b.appearance.build).toBe('standard');
    expect(DEFAULT_APPEARANCE.build).toBe('standard');
    a.controls.bindings.moveLeft[0] = 'KeyJ';
    expect(b.controls.bindings.moveLeft[0]).toBe('KeyA');
    a.audio.musicVolume = 0.7;
    expect(b.audio.musicVolume).toBe(0.1);
  });

  it('adds the default audio mix to existing v3 saves without changing controls, mute or looks', () => {
    const storage = new MemoryStorage();
    const original = saveNewLook({ ...defaultSettings(false), muted: true,
      appearance: { ...BASE_APPEARANCE, hair: 'tied-back', topColor: 'navy' } }, 'Night shift');
    original.controls.bindings.moveLeft = ['KeyJ', null];
    const { audio: _audio, ...beforeAudio } = original;
    storage.seed(SETTINGS_STORAGE_KEY, beforeAudio);
    expect(readSettings(true, storage)).toEqual(original);
    expect(readSettings(true, storage).audio.musicVolume).toBe(0.1);
    expect(storage.writes).toBe(0);
  });

  it('clamps finite audio gains and defaults each malformed channel independently', () => {
    expect(normalizeAudioSettings({ masterVolume: 2, musicVolume: -0.5, weaponsVolume: 0.43,
      movementVolume: '0.25', uiVolume: NaN, extra: 1 }))
      .toEqual({ masterVolume: 1, musicVolume: 0, weaponsVolume: 0.43, movementVolume: 0.85, uiVolume: 1 });
    expect(normalizeAudioSettings({ masterVolume: Infinity, musicVolume: -Infinity, weaponsVolume: null,
      movementVolume: false, uiVolume: 0 })).toEqual({ ...defaultAudioSettings(), uiVolume: 0 });
    for (const invalid of [undefined, null, 1, 'loud', [], true]) {
      expect(normalizeAudioSettings(invalid)).toEqual(defaultAudioSettings());
    }
  });

  it('round-trips a saved audio mix and preserves silent channels', () => {
    const storage = new MemoryStorage();
    const settings = { ...defaultSettings(false), muted: true,
      audio: { masterVolume: 0.74, musicVolume: 0.06, weaponsVolume: 0, movementVolume: 0.67, uiVolume: 0.29 } };
    expect(writeSettings(settings, storage)).toBe(true);
    expect(readSettings(true, storage)).toEqual(settings);
    storage.seed(SETTINGS_STORAGE_KEY, { ...settings, audio: { ...settings.audio, musicVolume: 'invalid', movementVolume: 5 } });
    expect(readSettings(true, storage)).toEqual({ ...settings,
      audio: { ...settings.audio, musicVolume: 0.1, movementVolume: 1 } });
  });

  it('migrates both current and legacy old-format saves without writing or losing preferences', () => {
    for (const key of [SETTINGS_STORAGE_KEY, LEGACY_SETTINGS_STORAGE_KEY]) {
      for (const index of [0, 1, 2]) {
        const storage = new MemoryStorage();
        storage.seed(key, { cosmetics: { headgear: index, shirt: index, trousers: index }, muted: true, reducedMotion: false });
        const settings = readSettings(true, storage);
        expect(settings.version).toBe(3);
        expect([settings.appearance.headgearColor, settings.appearance.topColor, settings.appearance.trousersColor])
          .toEqual(Array(3).fill(['olive', 'sand', 'slate'][index]));
        expect(settings.appearance.hair).toBe(DEFAULT_APPEARANCE.hair);
        expect(settings.muted).toBe(true);
        expect(settings.reducedMotion).toBe(false);
        expect(settings.savedLooks).toEqual([]);
        expect(storage.writes).toBe(0);
      }
    }
  });

  it('migrates v2 appearance and saved looks before any v3 autosave', () => {
    const storage = new MemoryStorage();
    const appearance = { ...BASE_APPEARANCE, hair: 'tied-back', topColor: 'navy' };
    storage.seed(SETTINGS_STORAGE_KEY, {
      version: 2, appearance, savedLooks: [{ id: 'favourite', name: 'Night shift', appearance }],
      muted: true, reducedMotion: false,
    });
    const migrated = readSettings(true, storage);
    expect(migrated).toMatchObject({ version: 3, appearance, muted: true, reducedMotion: false,
      savedLooks: [{ id: 'favourite', name: 'Night shift', appearance }], controls: defaultControls() });
    expect(storage.writes).toBe(0);
    expect(writeSettings(migrated, storage)).toBe(true);
    expect(readSettings(true, storage)).toEqual(migrated);
  });

  it('normalizes corrupt controls without discarding the rest of a v3 save', () => {
    const storage = new MemoryStorage();
    const original = saveNewLook({ ...defaultSettings(false), muted: true,
      appearance: { ...BASE_APPEARANCE, build: 'broad' } }, 'Heavy weather');
    storage.seed(SETTINGS_STORAGE_KEY, { ...original, controls: { bindings: null, behavior: 'bad', defaultAimMode: 'invalid' } });
    expect(readSettings(true, storage)).toEqual(original);
    expect(storage.writes).toBe(0);
  });

  it('round-trips remapped controls, toggle preferences and pointer aiming', () => {
    const storage = new MemoryStorage();
    const settings = defaultSettings(false);
    settings.controls.bindings.moveLeft = ['KeyJ', 'ArrowLeft'];
    settings.controls.bindings.fire = ['Mouse3', null];
    settings.controls.behavior.crouch = 'toggle';
    settings.controls.behavior.aimSwitch = 'toggle';
    settings.controls.jetpackSource = 'separate';
    settings.controls.defaultAimMode = 'pointer';
    expect(writeSettings(settings, storage)).toBe(true);
    expect(readSettings(true, storage)).toEqual(settings);
  });

  it('preserves mixed legacy colours and defaults invalid indices separately', () => {
    const storage = new MemoryStorage();
    storage.seed(SETTINGS_STORAGE_KEY, { cosmetics: { headgear: 2, shirt: 1, trousers: -1 }, muted: 'false', reducedMotion: 0 });
    const settings = readSettings(true, storage);
    expect(settings.appearance.headgearColor).toBe('slate');
    expect(settings.appearance.topColor).toBe('sand');
    expect(settings.appearance.trousersColor).toBe(DEFAULT_APPEARANCE.trousersColor);
    expect(settings.muted).toBe(false);
    expect(settings.reducedMotion).toBe(true);
    for (const invalid of [3, 2.5, '1', null]) {
      storage.seed(SETTINGS_STORAGE_KEY, { cosmetics: { headgear: invalid } });
      expect(readSettings(false, storage).appearance.headgearColor).toBe(DEFAULT_APPEARANCE.headgearColor);
    }
  });

  it('uses a valid primary save ahead of legacy data and honours explicitly false preferences', () => {
    const storage = new MemoryStorage();
    storage.seed(SETTINGS_STORAGE_KEY, { ...defaultSettings(false), appearance: { ...BASE_APPEARANCE, build: 'slim' } });
    storage.seed(LEGACY_SETTINGS_STORAGE_KEY, { cosmetics: { headgear: 2 }, muted: true, reducedMotion: true });
    const settings = readSettings(true, storage);
    expect(settings.appearance.build).toBe('slim');
    expect(settings.appearance.headgearColor).toBe('olive');
    expect(settings.muted).toBe(false);
    expect(settings.reducedMotion).toBe(false);
  });

  it('falls through malformed or unsupported primary data to the legacy fallback', () => {
    for (const primary of ['{not-json', 'null', '[]', '17', '{}', '{"version":99}', '{"unrelated":true}']) {
      const storage = new MemoryStorage();
      storage.values.set(SETTINGS_STORAGE_KEY, primary);
      storage.seed(LEGACY_SETTINGS_STORAGE_KEY, { cosmetics: { headgear: 1, shirt: 2, trousers: 1 }, muted: true });
      const settings = readSettings(false, storage);
      expect(settings.appearance.headgearColor).toBe('sand');
      expect(settings.appearance.topColor).toBe('slate');
      expect(settings.muted).toBe(true);
      expect(storage.writes).toBe(0);
    }
  });

  it('normalizes invalid current identifiers and saved snapshots independently', () => {
    const storage = new MemoryStorage();
    storage.seed(SETTINGS_STORAGE_KEY, {
      version: 2, muted: true, reducedMotion: false,
      appearance: { ...BASE_APPEARANCE, hair: 'tied-back', boots: 'invalid', topColor: 'rust' },
      savedLooks: [
        { id: 'one', name: '   My patrol   ', appearance: { ...BASE_APPEARANCE, build: 'broad', hairColor: 'bad' } },
        { id: 'one', name: 'Duplicate id', appearance: BASE_APPEARANCE },
        { id: '', name: 'Empty id', appearance: BASE_APPEARANCE },
        { id: 'no-appearance', name: 'Bad' },
        null, 'bad',
        { id: 'two', name: 'x'.repeat(100), appearance: BASE_APPEARANCE },
      ],
    });
    const settings = readSettings(true, storage);
    expect(settings.appearance.hair).toBe('tied-back');
    expect(settings.appearance.boots).toBe(DEFAULT_APPEARANCE.boots);
    expect(settings.appearance.topColor).toBe('rust');
    expect(settings.savedLooks).toHaveLength(2);
    expect(settings.savedLooks[0].name).toBe('My patrol');
    expect(settings.savedLooks[0].appearance.build).toBe('broad');
    expect(settings.savedLooks[0].appearance.hairColor).toBe(DEFAULT_APPEARANCE.hairColor);
    expect(settings.savedLooks[1].name).toHaveLength(40);
    expect(settings.muted).toBe(true);
    expect(settings.reducedMotion).toBe(false);
  });

  it('handles invalid whole appearances, saved-look collections, and all-invalid storage', () => {
    const storage = new MemoryStorage();
    storage.seed(SETTINGS_STORAGE_KEY, { version: 2, appearance: 'bad', savedLooks: {}, reducedMotion: true });
    expect(readSettings(false, storage)).toEqual(defaultSettings(true));
    storage.values.set(SETTINGS_STORAGE_KEY, 'broken');
    storage.values.set(LEGACY_SETTINGS_STORAGE_KEY, 'also broken');
    expect(readSettings(false, storage)).toEqual(defaultSettings(false));
  });

  it('tolerates denied reads and quota errors without mutating active settings', () => {
    const storage = new MemoryStorage();
    storage.unreadable.add(SETTINGS_STORAGE_KEY);
    storage.seed(LEGACY_SETTINGS_STORAGE_KEY, { muted: true });
    expect(readSettings(false, storage).muted).toBe(true);
    storage.unreadable.add(LEGACY_SETTINGS_STORAGE_KEY);
    expect(readSettings(true, storage)).toEqual(defaultSettings(true));
    const settings = saveNewLook(defaultSettings(false), 'Patrol');
    const before = structuredClone(settings);
    storage.failWrites = true;
    expect(writeSettings(settings, storage)).toBe(false);
    expect(settings).toEqual(before);
  });

  it('handles browsers that deny the localStorage property before any method can be called', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    try {
      expect(readSettings(true)).toEqual(defaultSettings(true));
      expect(writeSettings(defaultSettings(false))).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('round-trips versioned saves and leaves the original legacy key untouched', () => {
    const storage = new MemoryStorage();
    storage.seed(LEGACY_SETTINGS_STORAGE_KEY, { muted: true, cosmetics: { headgear: 2 } });
    const legacy = storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    const settings = saveNewLook(readSettings(false, storage), 'Sand patrol');
    expect(writeSettings(settings, storage)).toBe(true);
    expect(readSettings(true, storage)).toEqual(settings);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).not.toHaveProperty('cosmetics');
    expect(storage.getItem(LEGACY_SETTINGS_STORAGE_KEY)).toBe(legacy);
  });
});

describe('independent named-look snapshots', () => {
  it('saves cloned appearances, permits duplicate names, and always supplies distinct ids', () => {
    const initial = defaultSettings(false);
    const first = saveNewLook(initial, '  Patrol  ');
    const second = saveNewLook(first, 'Patrol');
    expect(initial.savedLooks).toEqual([]);
    expect(second.savedLooks.map(look => look.name)).toEqual(['Patrol', 'Patrol']);
    expect(new Set(second.savedLooks.map(look => look.id)).size).toBe(2);
    second.appearance.hair = 'spiky';
    expect(second.savedLooks.every(look => look.appearance.hair === DEFAULT_APPEARANCE.hair)).toBe(true);
    second.savedLooks[1].appearance.build = 'slim';
    expect(second.savedLooks[0].appearance.build).toBe('standard');
    expect(createSavedLook('   ', { ...BASE_APPEARANCE }).name).toBe('Untitled look');
    expect(createSavedLook('z'.repeat(60), { ...BASE_APPEARANCE }).name).toHaveLength(40);
  });

  it('restores a full cloned appearance immediately without later edits changing the snapshot', () => {
    const saved = saveNewLook({ ...defaultSettings(false), appearance: { ...BASE_APPEARANCE, build: 'slim', hairColor: 'white' } }, 'Scout');
    const id = saved.savedLooks[0].id;
    const edited = { ...saved, appearance: { ...saved.appearance, build: 'broad' as const, hairColor: 'black' as const } };
    const restored = restoreSavedLook(edited, id);
    expect(restored.appearance).toEqual(saved.savedLooks[0].appearance);
    expect(restored.appearance).not.toBe(saved.savedLooks[0].appearance);
    expect(edited.appearance.build).toBe('broad');
    restored.appearance.skin = 'deep';
    expect(saved.savedLooks[0].appearance.skin).toBe(BASE_APPEARANCE.skin);
  });

  it('updates only the explicitly chosen saved look and renames without touching the active pilot', () => {
    const saved = saveNewLook(saveNewLook(defaultSettings(false), 'First'), 'Second');
    const id = saved.savedLooks[0].id;
    const edited = { ...saved, appearance: { ...saved.appearance, beard: 'goatee' as const } };
    const updated = updateSavedLook(edited, id);
    expect(updated.savedLooks[0].appearance.beard).toBe('goatee');
    expect(updated.savedLooks[1].appearance.beard).toBe(DEFAULT_APPEARANCE.beard);
    expect(saved.savedLooks[0].appearance.beard).toBe(DEFAULT_APPEARANCE.beard);
    expect(updated.savedLooks[0].appearance).not.toBe(edited.appearance);
    const renamed = renameSavedLook(updated, id, '  Moon patrol  ');
    expect(renamed.savedLooks[0].name).toBe('Moon patrol');
    expect(updated.savedLooks[0].name).toBe('First');
    expect(renamed.appearance).toBe(updated.appearance);
    expect(renamed).not.toHaveProperty('callsign');
  });

  it('deletes and undoes in place while retaining any intervening active edits and newly saved looks', () => {
    const initial = saveNewLook(saveNewLook(defaultSettings(false), 'First'), 'Second');
    const deleted = initial.savedLooks[0];
    const removed = deleteSavedLook(initial, deleted.id);
    expect(removed.savedLooks.map(look => look.name)).toEqual(['Second']);
    expect(initial.savedLooks).toHaveLength(2);
    const edited = saveNewLook({ ...removed, appearance: { ...removed.appearance, hair: 'buzz' as const } }, 'Third');
    const restored = undoDeleteSavedLook(edited, deleted, 0);
    expect(restored.savedLooks.map(look => look.name)).toEqual(['First', 'Second', 'Third']);
    expect(restored.appearance.hair).toBe('buzz');
    expect(restored.savedLooks[0].appearance).not.toBe(deleted.appearance);
    expect(undoDeleteSavedLook(restored, deleted, 0)).toBe(restored);
    expect(restoreSavedLook(restored, 'missing')).toBe(restored);
    expect(updateSavedLook(restored, 'missing')).toBe(restored);
    expect(renameSavedLook(restored, 'missing', 'Name')).toBe(restored);
    expect(deleteSavedLook(restored, 'missing')).toBe(restored);
  });
});
