import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  APPEARANCE_PARTS, COLOR_CHOICES, OUTFITS, applyOutfit, updateAppearancePart, clothingMaterial,
  type AppearancePartId, type DetailedAppearance, type ClothingColorId, type ClothingSlot,
} from './game/appearance';
import { drawDetailedCharacter } from './game/detailedCharacter';
import type { CharacterPose } from './game/character';
import { CHARACTER_SCALE } from './game/stance';
import {
  saveNewLook, restoreSavedLook, updateSavedLook, renameSavedLook, deleteSavedLook, undoDeleteSavedLook,
  type SavedLook, type Settings,
} from './game/settings';
import type { GameAssets } from './game/assets';
import './character-creator.css';

type Section = AppearancePartId | 'outfits' | 'saved';
type Pose = 'stand' | 'crouch' | 'walk' | 'jump' | 'jet';
type Focus = 'head' | 'body' | 'boots' | 'legs' | 'hands' | 'waist' | 'full' | 'native';
interface Controls { facing: 1 | -1; pitch: number; pose: Pose; motion: boolean; reducedMotion: boolean }
const STATIC_CONTROLS: Controls = { facing: 1, pitch: 0, pose: 'stand', motion: false, reducedMotion: true };
const GROUPS = ['Face', 'Hair', 'Clothing', 'Equipment'] as const;
const POSES: { id: Pose; label: string }[] = [
  { id: 'stand', label: 'Stand' }, { id: 'crouch', label: 'Crouch' },
  { id: 'walk', label: 'Walk' }, { id: 'jump', label: 'Jump' }, { id: 'jet', label: 'Jet' },
];

function characterPose(controls: Controls, phase: number): CharacterPose {
  const pitch = Math.max(-Math.PI / 2 + 1e-8, Math.min(Math.PI / 2 - 1e-8, controls.pitch * Math.PI / 180));
  const airborne = controls.pose === 'jump' || controls.pose === 'jet';
  return {
    aimAngle: controls.facing === 1 ? pitch : Math.PI - pitch,
    crouchAmount: controls.pose === 'crouch' ? 1 : 0, locomotion: true,
    moving: controls.pose === 'walk', walkAmount: controls.pose === 'walk' ? 1 : 0,
    moveSpeed: controls.facing * 320, walkPhase: phase * Math.PI * 2,
    airborne, airborneAmount: Number(airborne), verticalSpeed: controls.pose === 'jump' ? -320 : -200,
    thrusting: controls.pose === 'jet', thrustAmount: controls.pose === 'jet' ? 1 : 0,
    time: phase * 1.3, reducedMotion: controls.reducedMotion,
  };
}

function Mannequin({ appearance, assets, focus = 'full', controls = STATIC_CONTROLS, label }: {
  appearance: DetailedAppearance; assets: GameAssets; focus?: Focus; controls?: Controls; label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0, width = 0, height = 0;
    const animated = controls.motion && !controls.reducedMotion && ['walk', 'jet', 'jump'].includes(controls.pose);
    const draw = (now: number) => {
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      const phase = animated ? (now / 1300) % 1 : .125;
      let scale: number, y: number, centerX = width / 2;
      if (focus === 'head') {
        scale = Math.min(width / 42, height / 37); y = height / 2 + 69.5 * scale;
      } else if (focus === 'body') {
        scale = Math.min(width / 49, height / 38); y = height / 2 + 44 * scale;
      } else if (focus === 'legs') {
        scale = Math.min(width / 38, height / 40); y = height / 2 + 19 * scale;
      } else if (focus === 'hands') {
        scale = Math.min(width / 41, height / 27); y = height / 2 + 43 * scale; centerX -= 11 * scale;
      } else if (focus === 'waist') {
        scale = Math.min(width / 39, height / 20); y = height / 2 + 34 * scale;
      } else if (focus === 'boots') {
        scale = Math.min(width / 42, height / 25); y = height / 2 + 10 * scale;
      } else {
        scale = focus === 'native' ? CHARACTER_SCALE : Math.min(4.2, (width - 42) / 74, (height - 43) / 95);
        y = height - 18;
        ctx.strokeStyle = '#8a9d7159'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(10, y + 1); ctx.lineTo(width - 10, y + 1); ctx.stroke();
        ctx.fillStyle = '#07130f5c'; ctx.beginPath(); ctx.ellipse(width / 2, y + 2, 22 * scale, 2 * scale, 0, 0, Math.PI * 2); ctx.fill();
        if (controls.pose === 'jet' || controls.pose === 'jump') y -= 9 * scale;
      }
      drawDetailedCharacter(ctx, centerX, y, scale, characterPose(controls, phase), appearance, assets.images);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); draw(performance.now());
    };
    const animate = (now: number) => { draw(now); if (!document.hidden) frame = requestAnimationFrame(animate); };
    const visibility = () => { cancelAnimationFrame(frame); if (!document.hidden && animated) frame = requestAnimationFrame(animate); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    if (animated) frame = requestAnimationFrame(animate);
    document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [appearance, assets, controls, focus]);
  return <canvas ref={ref} className={`creator-canvas creator-canvas-${focus}`} role={label ? 'img' : undefined}
    aria-label={label} aria-hidden={label ? undefined : true} />;
}

// Item cards expose their own silhouette, even when another selected accessory
// covers it on the live character. The active appearance is never changed here.
function itemAppearance(appearance: DetailedAppearance, id: AppearancePartId, value: string): DetailedAppearance {
  const next = updateAppearancePart(appearance, id, value);
  if (['faceShape', 'eyes', 'eyebrows', 'mouth', 'skin'].includes(id)) return {
    ...next, headgear: 'none', eyewear: 'none', hair: 'none', sideburns: 'none', moustache: 'none', beard: 'none',
  };
  if (['hair', 'sideburns', 'moustache', 'beard'].includes(id)) {
    return { ...next, headgear: 'none', eyewear: 'none', ...(id === 'moustache' ? { beard: 'none' as const } : {}) };
  }
  if (id === 'top') return { ...next, vest: 'none', belt: 'none' };
  return next;
}

export default function CharacterCreator({ assets, settings, onChange, onExit, storageAvailable }: {
  assets: GameAssets; settings: Settings; onChange: (next: Settings) => void; onExit: () => void; storageAvailable: boolean;
}) {
  const [section, setSection] = useState<Section>('faceShape');
  const [facing, setFacing] = useState<1 | -1>(1), [pitch, setPitch] = useState(0);
  const [pose, setPose] = useState<Pose>('stand'), [motion, setMotion] = useState(false);
  const [newName, setNewName] = useState(''), [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState(''), [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState<{ look: SavedLook; index: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const savedCategory = useRef<HTMLButtonElement>(null);
  const appearance = settings.appearance;
  const part = APPEARANCE_PARTS.find(item => item.id === section);
  const controls = useMemo(() => ({ facing, pitch, pose, motion, reducedMotion: settings.reducedMotion }), [facing, pitch, pose, motion, settings.reducedMotion]);
  const colorChoices = part?.colorFamily ? COLOR_CHOICES[part.colorFamily] : [];
  const activeColor = part?.colorKey ? appearance[part.colorKey] : undefined;
  const title = part?.label ?? (section === 'outfits' ? 'Complete outfits' : 'Saved looks');

  useEffect(() => { window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (renameId) { renameInput.current?.focus(); renameInput.current?.select(); } }, [renameId]);
  const edit = (next: DetailedAppearance, message?: string) => {
    onChange({ ...settings, appearance: next }); if (message) setNotice(message);
  };
  const selectSection = (next: Section) => { setSection(next); setRenameId(null); };
  const restore = (look: SavedLook) => { onChange(restoreSavedLook(settings, look.id)); setNotice(`${look.name} applied.`); };
  const remove = (look: SavedLook) => {
    setDeleted({ look: { ...look, appearance: { ...look.appearance } }, index: settings.savedLooks.findIndex(item => item.id === look.id) });
    onChange(deleteSavedLook(settings, look.id)); setNotice(`${look.name} deleted. You can undo this.`);
    if (renameId === look.id) setRenameId(null);
    nameInput.current?.focus({ preventScroll: true });
  };
  const undo = () => {
    if (!deleted) return;
    onChange(undoDeleteSavedLook(settings, deleted.look, deleted.index));
    setNotice(`${deleted.look.name} restored to saved looks.`); setDeleted(null);
    requestAnimationFrame(() => (section === 'saved' ? nameInput.current : savedCategory.current)?.focus({ preventScroll: true }));
  };

  return <main className="character-creator" data-testid="character-creator">
    <header className="creator-header">
      <button className="creator-back" onClick={onExit}><span aria-hidden="true">←</span> Back to menu</button>
      <span className="creator-wordmark">BURNHOP</span>
    </header>
    <div className="creator-intro">
      <h1 ref={heading} tabIndex={-1}>OUTFITTER</h1>
    </div>
    {!storageAvailable && <p className="creator-storage-note" role="status">Changes work for this visit; local saving is unavailable.</p>}

    <div className="creator-workbench">
      <nav className="creator-categories" aria-label="Character categories">
        {GROUPS.map(group => <div className="creator-category-group" key={group}>
          <span className="creator-group-title">{group}</span>
          {APPEARANCE_PARTS.filter(item => item.group === group).map(item => <button key={item.id}
            aria-pressed={section === item.id} onClick={() => selectSection(item.id)}>
            <span>{item.label}</span><span aria-hidden="true">{section === item.id ? '›' : '+'}</span>
          </button>)}
        </div>)}
        <div className="creator-category-group creator-looks-nav"><span className="creator-group-title">Your wardrobe</span>
          <button aria-pressed={section === 'outfits'} onClick={() => selectSection('outfits')}><span>Complete outfits</span><span aria-hidden="true">↗</span></button>
          <button ref={savedCategory} aria-label="Saved looks" aria-pressed={section === 'saved'} onClick={() => selectSection('saved')}><span>Saved looks</span><span className="creator-count" aria-hidden="true">{settings.savedLooks.length}</span></button>
        </div>
      </nav>

      <section className="creator-selection" aria-labelledby="creator-selection-title">
        <div className="creator-selection-heading">
          <h2 id="creator-selection-title">{title}</h2>
          {section === 'outfits' && <p>Outfits change your gear. Face, hair and build stay the same.</p>}
        </div>
        {part && <>
          <div className="creator-items" role="group" aria-label={`${part.label} styles`}>
            {part.options.map(option => <button className="creator-item" key={option.id} aria-label={option.label}
              aria-pressed={appearance[part.id] === option.id} onClick={() => edit(updateAppearancePart(appearance, part.id, option.id), `${part.label}: ${option.label}.`)}>
              <Mannequin appearance={itemAppearance(appearance, part.id, option.id)} focus={part.id === 'build' ? 'full'
                : part.id === 'trousers' ? 'legs' : part.id === 'gloves' ? 'hands' : part.id === 'belt' ? 'waist' : part.previewFocus} assets={assets} />
              <span className="creator-item-caption"><span>{option.label}</span><span aria-hidden="true">{appearance[part.id] === option.id ? '✓' : ''}</span></span>
            </button>)}
          </div>
          {!!colorChoices.length && part.colorKey && <div className="creator-colors">
            <div><h3>{part.label} colour</h3><span>{colorChoices.find(color => color.id === activeColor)?.label}</span></div>
            <div className="creator-swatches" role="group" aria-label={`${part.label} colours`}>
              {colorChoices.map(color => <button key={color.id} className="creator-swatch" aria-label={`${part.label} colour: ${color.label}`}
                aria-pressed={activeColor === color.id} onClick={() => edit({ ...appearance, [part.colorKey!]: color.id }, `${part.label} colour: ${color.label}.`)}>
                <span style={{ '--creator-swatch': part.colorFamily === 'clothing' ? clothingMaterial(color.id as ClothingColorId, part.id as ClothingSlot).base : color.hex } as CSSProperties} aria-hidden="true">{activeColor === color.id ? '✓' : ''}</span><small>{color.label}</small>
              </button>)}
            </div>
            {appearance[part.id] === 'none' && <p className="creator-hint">This colour will be ready when you add a style.</p>}
          </div>}
          {part.id === 'hair' && appearance.headgear !== 'none' && <p className="creator-hint">Your headgear covers some hair. The hairstyle stays selected underneath.</p>}
          {part.id === 'build' && <p className="creator-hint">Three silhouettes. The same height, reach, and movement.</p>}
        </>}

        {section === 'outfits' && <div className="creator-outfits">
          {OUTFITS.map(outfit => <button key={outfit.id} className="creator-outfit" aria-label={`Wear ${outfit.name}`}
            aria-pressed={JSON.stringify(applyOutfit(appearance, outfit.id)) === JSON.stringify(appearance)}
            onClick={() => edit(applyOutfit(appearance, outfit.id), `${outfit.name} outfit applied. Your face, hair, and build are unchanged.`)}>
            <Mannequin appearance={applyOutfit(appearance, outfit.id)} assets={assets} />
            <span><strong>{outfit.name}</strong><small>{outfit.description}</small><b>WEAR OUTFIT <span aria-hidden="true">↗</span></b></span>
          </button>)}
        </div>}

        {section === 'saved' && <div className="creator-saved">
          <form className="creator-name-form" onSubmit={event => {
            event.preventDefault(); const name = newName.trim(); if (!name) { nameInput.current?.focus(); return; }
            const next = saveNewLook(settings, name); onChange(next); setNewName(''); setNotice(`${next.savedLooks.at(-1)?.name ?? name} saved.`);
          }}>
            <label htmlFor="creator-new-name">Name this look</label>
            <div><input ref={nameInput} id="creator-new-name" placeholder="e.g. Night shift" value={newName} maxLength={40} required
              onChange={event => setNewName(event.target.value)} /><button type="submit" disabled={!newName.trim()}>Save new look <span aria-hidden="true">+</span></button></div>
            <small>Saves every part and colour. Your pilot’s callsign stays the same.</small>
          </form>
          {settings.savedLooks.length === 0 && <div className="creator-empty"><span aria-hidden="true">＋</span><h3>No saved looks</h3><p>Name your current look to save it.</p></div>}
          <div className="creator-saved-list">
            {settings.savedLooks.map(look => <article key={look.id} className="creator-saved-look" aria-label={`Saved look: ${look.name}`}>
              <button className="creator-saved-art" aria-label={`Restore ${look.name}`} onClick={() => restore(look)}>
                <Mannequin appearance={look.appearance} assets={assets} />
              </button>
              <div className="creator-saved-details"><h3>{look.name}</h3>
                {renameId === look.id ? <form className="creator-rename" onSubmit={event => {
                  event.preventDefault(); const name = renameName.trim(); if (!name) return;
                  onChange(renameSavedLook(settings, look.id, name)); setRenameId(null); setNotice(`Look renamed to ${name}.`);
                  requestAnimationFrame(() => document.getElementById(`creator-rename-${look.id}`)?.focus());
                }}><label className="creator-sr-only" htmlFor="creator-rename-input">New name for {look.name}</label>
                  <input ref={renameInput} id="creator-rename-input" value={renameName} maxLength={40} required onChange={event => setRenameName(event.target.value)} />
                  <button type="submit" disabled={!renameName.trim()}>Save name</button><button type="button" onClick={() => {
                    setRenameId(null); requestAnimationFrame(() => document.getElementById(`creator-rename-${look.id}`)?.focus());
                  }}>Cancel</button></form>
                  : <><button className="creator-restore" onClick={() => restore(look)} aria-label={`Apply ${look.name}`}
                    aria-pressed={JSON.stringify(look.appearance) === JSON.stringify(appearance)}>Apply look <span aria-hidden="true">↗</span></button>
                    <div className="creator-look-actions">
                      <button aria-label={`Update ${look.name} with current appearance`} onClick={() => { onChange(updateSavedLook(settings, look.id)); setNotice(`${look.name} updated with your current appearance.`); }}>Update</button>
                      <button id={`creator-rename-${look.id}`} aria-label={`Rename ${look.name}`} onClick={() => { setRenameId(look.id); setRenameName(look.name); }}>Rename</button>
                      <button aria-label={`Delete ${look.name}`} onClick={() => remove(look)}>Delete</button>
                    </div></>}
              </div>
            </article>)}
          </div>
          <p className="creator-hint">Use Update to replace a saved look with your current appearance.</p>
        </div>}
      </section>

      <aside className="creator-preview-panel" aria-label="Your character preview">
        <div className="creator-preview-title"><span className="creator-overline">PREVIEW</span><span className="creator-build">{appearance.build} build</span></div>
        <div className="creator-stage">
          <span className="creator-stage-cross creator-stage-cross-top" aria-hidden="true">+</span>
          <Mannequin appearance={appearance} controls={controls} assets={assets} label={`Your character, ${pose}, facing ${facing === 1 ? 'right' : 'left'}, aim ${pitch} degrees`} />
          <figure className="creator-native"><Mannequin appearance={appearance} controls={controls} focus="native" assets={assets} label="Your character at gameplay size" /><figcaption>GAMEPLAY 1×</figcaption></figure>
        </div>
        <div className="creator-pose-controls">
          <div role="group" aria-label="Preview pose" className="creator-poses">{POSES.map(option => <button key={option.id} aria-pressed={pose === option.id} onClick={() => setPose(option.id)}>{option.label}</button>)}</div>
          <div className="creator-aim-label"><label htmlFor="creator-aim">Look direction</label><output htmlFor="creator-aim">{pitch === 0 ? 'Level' : `${Math.abs(pitch)}° ${pitch < 0 ? 'up' : 'down'}`}</output></div>
          <input id="creator-aim" type="range" min="-90" max="90" value={pitch} onChange={event => setPitch(Number(event.target.value))} />
          <div className="creator-preview-actions"><button onClick={() => setFacing(current => current === 1 ? -1 : 1)}><span aria-hidden="true">↔</span> Face {facing === 1 ? 'left' : 'right'}</button>
            <label><input type="checkbox" checked={motion && !settings.reducedMotion} disabled={settings.reducedMotion} onChange={event => setMotion(event.target.checked)} /> Preview motion</label>
          </div>
          {settings.reducedMotion && <p className="creator-hint">Reduced motion is on. Pose and aim controls still work.</p>}
        </div>
        <button className="creator-open-saved" onClick={() => { selectSection('saved'); requestAnimationFrame(() => nameInput.current?.focus()); }}>Keep this look <span aria-hidden="true">+</span></button>
      </aside>
    </div>
    <footer className="creator-footer"><div role="status" aria-live="polite" aria-atomic="true">{notice}</div>
      {deleted && <button onClick={undo}>Undo delete</button>}<button className="creator-done" onClick={onExit}>Done <span aria-hidden="true">↗</span></button>
    </footer>
  </main>;
}
