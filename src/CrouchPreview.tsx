import { useEffect, useRef, useState } from 'react';
import { calculateCharacterAim, calculateCharacterPose } from './game/character';
import { drawDetailedCharacter } from './game/detailedCharacter';
import type { DetailedAppearance } from './game/appearance';
import { CHARACTER_SCALE } from './game/stance';
import type { GameAssets } from './game/types';
import './crouch-preview.css';

type Facing = 'left' | 'right';
const smooth = (value: number) => value * value * (3 - 2 * value);
const lookLabel = (pitch: number) => Math.abs(pitch) < .5 ? 'Level' : `${Math.round(Math.abs(pitch))}° ${pitch < 0 ? 'up' : 'down'}`;

function PoseCanvas({
  depth, aimPitch, facing, joints, native = false, assets, appearance,
}: {
  depth: number; aimPitch: number; facing: Facing; joints: boolean; native?: boolean;
  assets: GameAssets; appearance: DetailedAppearance;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size.width || !size.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { width, height } = size;
    const scale = native ? CHARACTER_SCALE : Math.min(4, (height - 45) / 88, (width - 56) / 90);
    const x = width / 2, floor = height - (native ? 8 : 24);
    const sign = facing === 'right' ? 1 : -1;
    // Keep the chosen facing at exactly vertical aim, where cosine cannot encode a side.
    const pitch = Math.max(-Math.PI / 2 + 1e-8, Math.min(Math.PI / 2 - 1e-8, aimPitch * Math.PI / 180));
    const pose = { aimAngle: facing === 'right' ? pitch : Math.PI - pitch, crouchAmount: depth };
    const geometry = calculateCharacterPose(pose);

    if (!native) {
      const standing = calculateCharacterPose({ aimAngle: 0, crouchAmount: 0 });
      const headY = floor + (-76 + standing.bodyOffset.y) * scale;
      ctx.strokeStyle = '#7c91743d';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(24, headY); ctx.lineTo(width - 24, headY); ctx.stroke();
      ctx.setLineDash([]);
      // Both views use the same scale and a shared standing-height guide.
      ctx.fillStyle = '#a8b5a0'; ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText('STANDING HEIGHT', 25, headY - 10);
    }
    ctx.fillStyle = '#0f1a1360';
    ctx.beginPath(); ctx.ellipse(x, floor + 2, scale * 23, scale * 2.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = native ? '#738667' : '#8ca376'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(native ? 8 : 24, floor + 1); ctx.lineTo(width - (native ? 8 : 24), floor + 1); ctx.stroke();

    drawDetailedCharacter(ctx, x, floor, scale, pose, appearance, assets.images);
    if (joints && !native) {
      ctx.save(); ctx.translate(x, floor); ctx.scale(scale * sign, scale);
      for (const leg of [geometry.farLeg, geometry.nearLeg]) {
        ctx.strokeStyle = '#f4c375'; ctx.lineWidth = .55;
        ctx.beginPath(); ctx.moveTo(leg.hip.x, leg.hip.y);
        ctx.lineTo(leg.knee.x, leg.knee.y); ctx.lineTo(leg.ankle.x, leg.ankle.y); ctx.stroke();
        for (const joint of [leg.hip, leg.knee, leg.ankle]) {
          ctx.beginPath(); ctx.arc(joint.x, joint.y, 1.15, 0, Math.PI * 2);
          ctx.fillStyle = '#14221a'; ctx.fill(); ctx.stroke();
        }
      }
      const aim = calculateCharacterAim(pose, geometry);
      ctx.strokeStyle = '#f4c375'; ctx.lineWidth = .55;
      ctx.beginPath(); ctx.moveTo(aim.torsoPivot.x, aim.torsoPivot.y);
      ctx.lineTo(aim.headPivot.x, aim.headPivot.y); ctx.stroke();
      for (const joint of [aim.torsoPivot, aim.headPivot]) {
        ctx.beginPath(); ctx.arc(joint.x, joint.y, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = '#14221a'; ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }, [aimPitch, assets, appearance, depth, facing, joints, native, size]);

  return <canvas ref={ref} className={native ? 'crouch-native-canvas' : 'crouch-pose-canvas'}
    role="img" aria-label={`${native ? 'Gameplay size' : 'Enlarged'} ${Math.round(depth * 100)} percent crouched character facing ${facing}, looking ${lookLabel(aimPitch).toLowerCase()}`} />;
}

export default function CrouchPreview({ assets, appearance, reducedMotion, onExit, onPractice }: {
  assets: GameAssets; appearance: DetailedAppearance; reducedMotion: boolean; onExit: () => void; onPractice: () => void;
}) {
  const [depth, setDepth] = useState(1);
  const [aimPitch, setAimPitch] = useState(0);
  const [facing, setFacing] = useState<Facing>('right');
  const [joints, setJoints] = useState(false);
  const [playing, setPlaying] = useState(false);
  const animation = useRef(0);
  const aimAnimation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const stop = () => { cancelAnimationFrame(animation.current); setPlaying(false); };
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
    const pause = () => { if (document.hidden) { stop(); cancelAnimationFrame(aimAnimation.current); } };
    document.addEventListener('visibilitychange', pause);
    return () => { cancelAnimationFrame(animation.current); cancelAnimationFrame(aimAnimation.current); document.removeEventListener('visibilitychange', pause); };
  }, []);

  const chooseDepth = (next: number, animate = false) => {
    stop();
    if (!animate || reducedMotion) { setDepth(next); return; }
    const from = depth, start = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - start) / 360);
      setDepth(from + (next - from) * smooth(progress));
      if (progress < 1) animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  };
  const chooseAim = (next: number, animate = false) => {
    cancelAnimationFrame(aimAnimation.current);
    if (!animate || reducedMotion) { setAimPitch(next); return; }
    const from = aimPitch, start = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - start) / 280);
      setAimPitch(from + (next - from) * smooth(progress));
      if (progress < 1) aimAnimation.current = requestAnimationFrame(frame);
    };
    aimAnimation.current = requestAnimationFrame(frame);
  };
  const replay = () => {
    if (playing) { stop(); return; }
    stop(); setPlaying(true); setDepth(0);
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = now - start;
      if (elapsed < 250) setDepth(0);
      else if (elapsed < 850) setDepth(smooth((elapsed - 250) / 600));
      else if (elapsed < 1500) setDepth(1);
      else if (elapsed < 2100) setDepth(1 - smooth((elapsed - 1500) / 600));
      else { setDepth(0); setPlaying(false); return; }
      animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  };
  const label = depth < .005 ? 'Standing' : depth > .995 ? 'Crouching' : 'Between poses';

  return (
    <main className="crouch-preview" data-testid="crouch-preview">
      <header className="crouch-header">
        <button className="crouch-back" onClick={onExit}><span aria-hidden="true">←</span> Back to menu</button>
        <span className="crouch-project">BURNHOP <span>/</span> POSE STUDY 01</span>
        <span className="crouch-tag">CHARACTER PREVIEW</span>
      </header>
      <section className="crouch-intro">
        <div><p className="eyebrow"><span className="status-dot" /> STANCE &amp; SILHOUETTE</p>
          <h1 ref={heading} tabIndex={-1}>A LOWER <span>PROFILE.</span></h1></div>
        <p>Feet planted. Knees bend. Eyes follow the aim.<br />Explore the crouch and a little upper-body movement.</p>
      </section>

      <section className="crouch-study" aria-label="Standing and crouching comparison">
        <div className="crouch-study-bar">
          <span>SAME CHARACTER. TWO STANCES.</span>
          <div className="crouch-view-controls">
            <label><input type="checkbox" checked={joints} onChange={event => setJoints(event.target.checked)} /> Show joints</label>
            <button onClick={() => setFacing(current => current === 'right' ? 'left' : 'right')}>
              <span aria-hidden="true">↔</span> Face {facing === 'right' ? 'left' : 'right'}
            </button>
          </div>
        </div>
        <div className="crouch-comparison">
          <figure>
            <figcaption><span className="crouch-index">01</span><div><h2>Standing</h2><p>Upright reference</p></div><span className="crouch-state">REST</span></figcaption>
            <PoseCanvas depth={0} aimPitch={aimPitch} facing={facing} joints={joints} assets={assets} appearance={appearance} />
          </figure>
          <figure>
            <figcaption><span className="crouch-index">02</span><div><h2>{label}</h2><p>Lowered hips, planted boots</p></div><span className="crouch-state crouch-state-active">{Math.round(depth * 100)}%</span></figcaption>
            <PoseCanvas depth={depth} aimPitch={aimPitch} facing={facing} joints={joints} assets={assets} appearance={appearance} />
          </figure>
        </div>
        <div className="crouch-controls">
          <div className="crouch-scrubber">
            <div><label htmlFor="crouch-depth">Crouch depth</label><output htmlFor="crouch-depth">{Math.round(depth * 100)}%</output></div>
            <input id="crouch-depth" type="range" min="0" max="100" step="1" value={Math.round(depth * 100)}
              aria-valuetext={`${Math.round(depth * 100)} percent crouched`}
              onChange={event => chooseDepth(Number(event.target.value) / 100)} />
            <div className="crouch-range-labels"><span>STANDING</span><span>FULL CROUCH</span></div>
          </div>
          <div className="crouch-actions">
            <div role="group" aria-label="Choose stance" className="crouch-stance-buttons">
              <button aria-pressed={depth === 0} onClick={() => chooseDepth(0, true)}>Stand</button>
              <button aria-pressed={depth === 1} onClick={() => chooseDepth(1, true)}>Crouch</button>
            </div>
            <button className="crouch-replay" onClick={replay} disabled={reducedMotion}>
              <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span> {playing ? 'Stop transition' : 'Replay transition'}
            </button>
          </div>
        </div>
        <div className="crouch-look-controls">
          <div className="crouch-scrubber">
            <div><label htmlFor="crouch-look">Look direction</label><output htmlFor="crouch-look">{lookLabel(aimPitch)}</output></div>
            <input id="crouch-look" type="range" min="-90" max="90" step="1" value={Math.round(aimPitch)}
              aria-valuetext={lookLabel(aimPitch)} onChange={event => chooseAim(Number(event.target.value))} />
            <div className="crouch-range-labels"><span>UP</span><span>LEVEL</span><span>DOWN</span></div>
          </div>
          <div className="crouch-stance-buttons crouch-look-buttons" role="group" aria-label="Choose look direction">
            <button aria-pressed={aimPitch === -90} onClick={() => chooseAim(-90, true)}>Look up</button>
            <button aria-pressed={aimPitch === 0} onClick={() => chooseAim(0, true)}>Level</button>
            <button aria-pressed={aimPitch === 90} onClick={() => chooseAim(90, true)}>Look down</button>
          </div>
        </div>
      </section>

      <footer className="crouch-notes">
        <div className="crouch-native-sample"><div><span className="eyebrow">AT GAMEPLAY SIZE</span><p>Standing &amp; current pose · 1×</p></div>
          <PoseCanvas native depth={0} aimPitch={aimPitch} facing={facing} joints={false} assets={assets} appearance={appearance} />
          <PoseCanvas native depth={depth} aimPitch={aimPitch} facing={facing} joints={false} assets={assets} appearance={appearance} />
        </div>
        <div className="crouch-practice">
          <p className="crouch-review-note">Hold S or ↓ to crouch in practice. Move the mouse to look around.<br />{reducedMotion ? 'Reduced motion is on. Use the sliders to inspect each pose.' : 'Try looking up and down at full crouch, then replay the transition.'}</p>
          <button className="crouch-replay" onClick={onPractice}>Try in practice <span aria-hidden="true">→</span></button>
        </div>
      </footer>
    </main>
  );
}
