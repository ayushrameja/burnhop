import { useEffect, useRef, useState } from 'react';
import { CHARACTER_LOOKS, type CharacterLookId, type DetailedAppearance } from './game/appearance';
import { calculateDetailedCharacterRig, drawDetailedCharacter } from './game/detailedCharacter';
import type { CharacterPose } from './game/character';
import { CHARACTER_SCALE } from './game/stance';
import type { GameAssets } from './game/assets';
import './character-preview.css';

type PoseMode = 'stand' | 'crouch' | 'walk' | 'jump' | 'jet';
type Facing = 'left' | 'right';
type View = 'full' | 'portrait' | 'native' | 'thumbnail';
interface Timeline { phase: number; playing: boolean; startedAt: number }
interface PoseControls {
  mode: PoseMode; facing: Facing; pitch: number; depth: number;
  backward: boolean; reducedMotion: boolean; hit: boolean;
}
const POSES: { id: PoseMode; label: string }[] = [
  { id: 'stand', label: 'Stand' }, { id: 'crouch', label: 'Crouch' },
  { id: 'walk', label: 'Walk' }, { id: 'jump', label: 'Jump' }, { id: 'jet', label: 'Jet' },
];
const still: Timeline = { phase: .125, playing: false, startedAt: 0 };
const levelPose: PoseControls = { mode: 'stand', facing: 'right', pitch: 0, depth: 0, backward: false, reducedMotion: false, hit: false };
const phaseAt = (timeline: Timeline, now: number) => timeline.playing
  ? (timeline.phase + (now - timeline.startedAt) / 1300) % 1 : timeline.phase;
const pitchLabel = (pitch: number) => pitch === 0 ? 'Level' : `${Math.abs(pitch)}° ${pitch < 0 ? 'up' : 'down'}`;

function previewPose(controls: PoseControls, phase: number): CharacterPose {
  // Keep the selected facing at the vertical endpoints, where cosine alone is ambiguous.
  const pitch = Math.max(-Math.PI / 2 + 1e-8, Math.min(Math.PI / 2 - 1e-8, controls.pitch * Math.PI / 180));
  const airborne = controls.mode === 'jump' || controls.mode === 'jet';
  const facing = controls.facing === 'right' ? 1 : -1;
  return {
    aimAngle: facing === 1 ? pitch : Math.PI - pitch,
    crouchAmount: airborne || controls.mode === 'stand' ? 0 : controls.depth,
    locomotion: true,
    moving: controls.mode === 'walk', walkAmount: controls.mode === 'walk' ? 1 : 0,
    moveSpeed: facing * (controls.backward ? -1 : 1) * (controls.depth > .5 ? 160 : 320),
    walkPhase: phase * Math.PI * 2,
    airborne, airborneAmount: Number(airborne),
    verticalSpeed: controls.mode === 'jump' ? -520 * Math.cos(phase * Math.PI) : controls.mode === 'jet' ? -200 : 0,
    thrusting: controls.mode === 'jet', thrustAmount: controls.mode === 'jet' ? 1 : 0,
    reducedMotion: controls.reducedMotion, time: phase * 1.3, hit: controls.hit,
  };
}

function CharacterCanvas({ appearance, name, view, controls = levelPose, timeline = still, joints = false, assets }: {
  appearance: DetailedAppearance; name: string; view: View; controls?: PoseControls;
  timeline?: Timeline; joints?: boolean; assets: GameAssets;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let width = 0, height = 0, frame = 0;
    const draw = (now: number) => {
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const portrait = view === 'portrait';
      const phase = phaseAt(timeline, now);
      const pose = previewPose(portrait ? { ...levelPose, facing: controls.facing, hit: controls.hit } : controls, phase);
      const scale = portrait ? Math.min(width / 44, height / 41)
        : view === 'native' ? CHARACTER_SCALE
        : view === 'thumbnail' ? Math.min((height - 18) / 87, (width - 24) / 70)
        : Math.min(4.4, (height - 76) / 96, (width - 56) / 82);
      const floor = height - (view === 'native' ? 12 : view === 'thumbnail' ? 10 : 35);
      const airborne = controls.mode === 'jump' || controls.mode === 'jet';
      const lift = portrait ? 0 : airborne ? (controls.mode === 'jet' ? 9 : Math.sin(phase * Math.PI) * 9) * scale : 0;
      const x = width / 2 - (portrait ? (controls.facing === 'right' ? 1 : -1) * 1.5 * scale : 0);
      const y = portrait ? height / 2 + 70 * scale : floor - lift;
      if (!portrait) {
        ctx.fillStyle = '#08171160';
        ctx.beginPath(); ctx.ellipse(width / 2, floor + 3, scale * (airborne ? 16 : 22), scale * 1.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = view === 'full' ? '#82966f75' : '#6d805852'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(view === 'full' ? 30 : 6, floor + 1); ctx.lineTo(width - (view === 'full' ? 30 : 6), floor + 1); ctx.stroke();
        if (view === 'full') {
          ctx.strokeStyle = '#8ca07724'; ctx.setLineDash([3, 6]);
          ctx.beginPath(); ctx.moveTo(width / 2, 25); ctx.lineTo(width / 2, floor + 10); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      drawDetailedCharacter(ctx, x, y, scale, pose, appearance, assets.images);
      if (joints && view === 'full') {
        const rig = calculateDetailedCharacterRig(pose);
        ctx.save(); ctx.translate(x, y); ctx.scale(scale * (controls.facing === 'right' ? 1 : -1), scale);
        ctx.lineWidth = .55; ctx.strokeStyle = '#ffcc7c'; ctx.fillStyle = '#14231b';
        for (const points of [
          [rig.geometry.farLeg.hip, rig.geometry.farLeg.knee, rig.geometry.farLeg.ankle],
          [rig.geometry.nearLeg.hip, rig.geometry.nearLeg.knee, rig.geometry.nearLeg.ankle],
          [rig.supportArm.shoulder, rig.supportArm.elbow, rig.supportArm.hand],
          [rig.triggerArm.shoulder, rig.triggerArm.elbow, rig.triggerArm.hand],
          [rig.aim.torsoPivot, rig.aim.headPivot],
        ]) {
          ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
          points.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.stroke();
          points.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 1.05, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
        }
        ctx.restore();
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      draw(performance.now());
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const animate = (now: number) => {
      draw(now);
      if (!document.hidden) frame = requestAnimationFrame(animate);
    };
    if (timeline.playing && !controls.reducedMotion && view !== 'portrait') frame = requestAnimationFrame(animate);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [appearance, assets, controls, joints, timeline, view]);
  const prefix = view === 'native' ? 'Gameplay size' : view === 'portrait' ? 'Face detail' : view === 'thumbnail' ? 'Sample' : 'Enlarged';
  return <canvas ref={ref} className={`character-canvas character-canvas-${view}`} role="img"
    aria-label={`${prefix} ${name}, ${view === 'portrait' ? 'standing, level aim' : `${controls.mode}, ${Math.round(controls.depth * 100)} percent crouch, ${pitchLabel(controls.pitch).toLowerCase()}`}, facing ${controls.facing}${controls.hit ? ', hit flash' : ''}`} />;
}

export default function CharacterPreview({ assets, reducedMotion, onExit }: {
  assets: GameAssets; reducedMotion: boolean; onExit: () => void;
}) {
  const [selected, setSelected] = useState<CharacterLookId>('base');
  const [mode, setMode] = useState<PoseMode>('stand');
  const [facing, setFacing] = useState<Facing>('right');
  const [pitch, setPitch] = useState(0);
  const [depth, setDepth] = useState(0);
  const [backward, setBackward] = useState(false);
  const [joints, setJoints] = useState(false);
  const [clearFace, setClearFace] = useState(false);
  const [hit, setHit] = useState(false);
  const [timeline, setTimeline] = useState<Timeline>(still);
  const heading = useRef<HTMLHeadingElement>(null);
  const look = CHARACTER_LOOKS.find(look => look.id === selected)!;
  const appearance: DetailedAppearance = clearFace ? { ...look.appearance, headgear: 'none', eyewear: 'none' } : look.appearance;
  const controls: PoseControls = { mode, facing, pitch, depth, backward, reducedMotion, hit };
  const stopMotion = () => setTimeline(current => ({ ...current, phase: phaseAt(current, performance.now()), playing: false }));
  useEffect(() => {
    window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true });
    const pause = () => { if (document.hidden) stopMotion(); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  const choosePose = (next: PoseMode) => {
    setMode(next);
    if (next === 'stand' || next === 'jump' || next === 'jet') setDepth(0);
    if (next === 'crouch') setDepth(1);
    setTimeline({ phase: .125, startedAt: performance.now(), playing: !reducedMotion && (next === 'walk' || next === 'jet') });
  };
  const scrubDepth = (next: number) => {
    stopMotion(); setDepth(next);
    if (mode !== 'walk') setMode(next > 0 ? 'crouch' : 'stand');
  };

  return <main className="character-preview" data-testid="character-preview">
    <header className="character-header">
      <button className="character-back" onClick={onExit}><span aria-hidden="true">←</span> Back to menu</button>
      <span className="character-wordmark">BURNHOP <i>/</i> CHARACTER STUDY 02</span>
      <span className="character-preview-tag">DESIGN PREVIEW</span>
    </header>
    <section className="character-intro">
      <div><p className="eyebrow"><span className="status-dot" /> SAME SOLDIER. MORE CHARACTER.</p>
        <h1 ref={heading} tabIndex={-1}>A FACE FOR <span>THE FIELD.</span></h1></div>
      <p>Four looks. Three builds. A little more attitude.<br />Explore the face, the gear, and every bend in between.</p>
    </section>

    <section className="character-look-strip" aria-label="Sample looks">
      {CHARACTER_LOOKS.map((sample, index) => <button key={sample.id} aria-label={sample.name}
        aria-pressed={selected === sample.id} onClick={() => setSelected(sample.id)} className="character-look-card">
        <span className="character-look-number" aria-hidden="true">0{index + 1}</span>
        <CharacterCanvas name={sample.name} view="thumbnail" appearance={sample.appearance} assets={assets} />
        <span className="character-look-label"><strong>{sample.name}</strong><small>{sample.buildLabel}</small></span>
        <span className="character-look-selected" aria-hidden="true">{selected === sample.id ? '●' : '○'}</span>
      </button>)}
    </section>

    <section className="character-workbench" aria-label="Character inspection">
      <div className="character-stage">
        <div className="character-stage-bar"><div><span className="character-section-label">IN FOCUS / {look.buildLabel}</span>
          <h2>{look.name}</h2></div><p>{look.description}</p></div>
        <div className="character-stage-art">
          <figure className="character-figure"><CharacterCanvas name={look.name} view="full" appearance={appearance}
            controls={controls} timeline={timeline} joints={joints} assets={assets} />
            <figcaption><span>FULL CHARACTER</span><span>{mode === 'walk' && backward ? 'BACKWARD WALK' : mode.toUpperCase()} <i>/</i> {pitchLabel(pitch).toUpperCase()}</span></figcaption>
          </figure>
          <figure className="character-portrait"><div className="character-portrait-frame"><CharacterCanvas name={look.name}
            view="portrait" appearance={appearance} controls={controls} assets={assets} /></div>
            <figcaption><span>FACE DETAIL</span><small>Level aim · same selected look</small></figcaption>
            <div className="character-detail-note"><span aria-hidden="true">+</span> Eyes, brows, mouth.<br />The details that make a face.</div>
          </figure>
        </div>
        <div className="character-native-row"><div><span className="character-section-label">AT GAMEPLAY SIZE</span><p>The selected pose, at 1×.</p></div>
          {CHARACTER_LOOKS.map(sample => <figure key={sample.id}><CharacterCanvas name={sample.name} view="native"
            appearance={clearFace ? { ...sample.appearance, headgear: 'none', eyewear: 'none' } : sample.appearance}
            controls={controls} timeline={timeline} assets={assets} /><figcaption>{sample.name}</figcaption></figure>)}
        </div>
      </div>

      <aside className="character-controls" aria-label="Preview controls">
        <div className="character-control-heading"><span className="character-section-label">POSE &amp; EXPRESSION</span><h2>Give it a look.</h2></div>
        <div className="character-control-group"><span className="character-control-label">Pose</span>
          <div className="character-pose-buttons" role="group" aria-label="Choose pose">{POSES.map(pose =>
            <button key={pose.id} aria-pressed={mode === pose.id} onClick={() => choosePose(pose.id)}>{pose.label}</button>)}</div>
        </div>
        <div className="character-slider-group"><div><label htmlFor="character-depth">Crouch depth</label><output htmlFor="character-depth">{Math.round(depth * 100)}%</output></div>
          <input id="character-depth" type="range" min="0" max="100" step="1" value={Math.round(depth * 100)} onChange={event => scrubDepth(Number(event.target.value) / 100)} />
          <div className="character-range-labels"><span>STAND</span><span>CROUCH</span></div>
        </div>
        <div className="character-slider-group"><div><label htmlFor="character-look">Look direction</label><output htmlFor="character-look">{pitchLabel(pitch)}</output></div>
          <input id="character-look" type="range" min="-90" max="90" step="1" value={pitch} aria-valuetext={pitchLabel(pitch)} onChange={event => setPitch(Number(event.target.value))} />
          <div className="character-look-buttons" role="group" aria-label="Aim presets">{[{ name: 'Look up', pitch: -90 }, { name: 'Level', pitch: 0 }, { name: 'Look down', pitch: 90 }].map(option =>
            <button key={option.name} aria-pressed={pitch === option.pitch} onClick={() => setPitch(option.pitch)}>{option.name}</button>)}</div>
        </div>
        <button className="character-facing" onClick={() => setFacing(current => current === 'right' ? 'left' : 'right')}><span aria-hidden="true">↔</span> Face {facing === 'right' ? 'left' : 'right'}</button>
        <div className="character-checks">
          <label><input type="checkbox" checked={clearFace} onChange={event => setClearFace(event.target.checked)} /> Show face clearly</label>
          <small>Temporarily removes headgear and eyewear.</small>
          <label><input type="checkbox" checked={joints} onChange={event => setJoints(event.target.checked)} /> Show joints</label>
          <label><input type="checkbox" checked={hit} onChange={event => setHit(event.target.checked)} /> Show hit flash</label>
          <small>Freezes hit feedback so you can inspect the whole character.</small>
          <label><input type="checkbox" checked={backward} disabled={mode !== 'walk'} onChange={event => setBackward(event.target.checked)} /> Walk backwards</label>
        </div>
        <div className="character-motion"><button disabled={reducedMotion} onClick={() => timeline.playing ? stopMotion() : setTimeline(current => ({ ...current, playing: true, startedAt: performance.now() }))}>
          <span aria-hidden="true">{timeline.playing ? 'Ⅱ' : '▷'}</span> {timeline.playing ? 'Pause motion' : 'Play motion'}</button>
          <div className="character-slider-group"><div><label htmlFor="character-phase">Animation phase</label><span className="character-section-label">SCRUB TO FREEZE</span></div>
            <input id="character-phase" type="range" min="0" max="100" step="1" value={Math.round(timeline.phase * 100)} onChange={event => setTimeline({ phase: Number(event.target.value) / 100, playing: false, startedAt: 0 })} />
          </div>
          <p>{reducedMotion ? 'Reduced motion is on. Choose a pose and scrub to inspect it.' : 'Play a walk or jet pose, or freeze a frame to inspect the details.'}</p>
        </div>
      </aside>
    </section>
    <footer className="character-footer"><span><span className="status-dot" /> BUILT FOR THE SAME BOOTS.</span>
      <p>Sample looks for one customizable pilot. Explore here; save your own look in Customize.</p></footer>
  </main>;
}
