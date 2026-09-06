import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ACTIONS, bindingLabel, defaultControls, isBinding, proposeBinding, resetActionControls,
  type ActionId, type Binding, type BindingSlot, type ControlsSettings,
} from './game/controls';
import type { Settings } from './game/settings';
import { defaultAudioSettings, type AudioSettings } from './game/audioSettings';
import { defaultGraphics, GRAPHICS_PRESETS, graphicsPreset, type GraphicsSettings, type GraphicsPreset } from './game/graphics';
import { performanceReport } from './game/performanceReport';
import './settings-screen.css';

type SettingsTab = 'bindings' | 'aiming' | 'audio' | 'graphics' | 'motion';
type CaptureTarget = { action: ActionId; slot: BindingSlot };
type Proposal = ReturnType<typeof proposeBinding>;
type Review = { proposal: Proposal; title: string; confirm: string; notes?: string[] };
type BehaviorKey = keyof ControlsSettings['behavior'];
const TABS: { id: SettingsTab; label: string; number: string }[] = [
  { id: 'bindings', label: 'Bindings', number: '01' },
  { id: 'aiming', label: 'Aiming', number: '02' },
  { id: 'audio', label: 'Audio', number: '03' },
  { id: 'graphics', label: 'Graphics', number: '04' },
  { id: 'motion', label: 'Motion', number: '05' },
];
const AUDIO_CHANNELS: { id: keyof AudioSettings; label: string; description: string }[] = [
  { id: 'masterVolume', label: 'Master volume', description: 'Overall level for all music and effects.' },
  { id: 'musicVolume', label: 'Menu music volume', description: 'Original percussion and menu music. Default: 10%.' },
  { id: 'weaponsVolume', label: 'Weapons & reload volume', description: 'Gunfire, magazine changes and weapon handling.' },
  { id: 'movementVolume', label: 'Movement & jetpack volume', description: 'Footsteps, jumps, landings and boot thrusters.' },
  { id: 'uiVolume', label: 'Menu effects volume', description: 'Hover and click feedback on menu buttons.' },
  { id: 'feedbackVolume', label: 'Combat feedback volume', description: 'Kill confirmation, pickups, drop warning and low-health heartbeat.' },
];
const DESCRIPTIONS: Record<ActionId, string> = {
  moveLeft: 'Movement mode applies to both directions.', moveRight: 'Steer your pilot to the right.',
  crouch: 'Stay low; stand when there is enough room.', jump: 'Jump, or tap before landing to hop.',
  jetpack: 'Power your boot thrusters in midair.', fire: 'Fire your equipped weapon.',
  aimSwitch: 'Switch between the aim line and pointer.', reload: 'Reload your weapon.',
  zoom: 'Cycle view range, limited by your equipped weapon.', pause: 'Escape always pauses. Add an alternate below.',
  pickup: 'Take a nearby weapon as your main weapon.', pair: 'Pair a nearby pistol or SMG with a compatible weapon.', punch: 'Throw a short-range punch and push an opponent back.',
};
const actionLabel = (action: ActionId) => ACTIONS.find(item => item.id === action)?.label ?? action;
const slotLabel = (slot: BindingSlot) => slot === 0 ? 'primary' : 'secondary';
const behaviorKey = (action: ActionId): BehaviorKey | null => {
  if (action === 'moveLeft' || action === 'moveRight') return 'movement';
  return ['crouch', 'jetpack', 'fire', 'aimSwitch'].includes(action) ? action as BehaviorKey : null;
};

function containFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
  )].filter(element => !element.closest('[inert]') && element.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

export default function SettingsScreen({ settings, onChange, onClose, storageAvailable, embedded = false, active = true }: {
  settings: Settings;
  onChange: Dispatch<SetStateAction<Settings>>;
  onClose: () => void;
  storageAvailable: boolean;
  embedded?: boolean;
  active?: boolean;
}) {
  const [tab, setTab] = useState<SettingsTab>('bindings');
  const [capture, setCapture] = useState<CaptureTarget | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const captureHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const mouseToSuppress = useRef<number | null>(null);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const controls = settings.controls;
  const graphics = settings.graphics;
  const changeGraphics = <K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]) =>
    onChange(current => ({ ...current, graphics: { ...current.graphics, [key]: value } }));

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    headingRef.current?.focus({ preventScroll: true });
    if (!embedded) window.scrollTo(0, 0);
    return () => {
      previousFocus?.focus({ preventScroll: true });
      if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
    };
  }, [embedded]);
  useEffect(() => {
    if (capture) captureHeadingRef.current?.focus();
    else if (review) reviewCancelRef.current?.focus();
  }, [capture, review]);

  const returnFocus = () => requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
  const commit = (next: ControlsSettings, message: string) => {
    onChange(current => ({ ...current, controls: next }));
    setNotice(message);
  };
  const applyProposal = (proposal: Proposal, message: string) => {
    if (proposal.conflict) setReview({ proposal, title: 'This binding is already in use.', confirm: 'Swap bindings' });
    else { commit(proposal.controls, message); returnFocus(); }
  };
  const cancelCapture = () => { setCapture(null); setNotice('Binding unchanged.'); returnFocus(); };
  const cancelReview = () => { setReview(null); setNotice('Controls unchanged.'); returnFocus(); };

  useEffect(() => {
    if (!active) return;
    const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const chooseBinding = (binding: Binding) => {
      if (!capture) return;
      const proposal = proposeBinding(settingsRef.current.controls, capture.action, capture.slot, binding);
      setCapture(null);
      applyProposal(proposal, `${actionLabel(capture.action)} ${slotLabel(capture.slot)}: ${bindingLabel(binding)}.`);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (capture) {
        stop(event);
        if (event.repeat) return;
        if (event.code === 'Escape') { cancelCapture(); return; }
        if (isBinding(event.code)) chooseBinding(event.code);
        else setNotice(event.code === 'F3' ? 'F3 is reserved for the debug display.' : 'That key cannot be assigned. Try another key or mouse button.');
      } else if (event.code === 'Escape') {
        stop(event);
        if (event.repeat) return;
        if (review) cancelReview(); else onClose();
      }
    };
    const mouseDown = (event: MouseEvent) => {
      if (!capture || (event.button === 0 && event.target instanceof Element && event.target.closest('[data-capture-cancel]'))) return;
      stop(event);
      const binding = `Mouse${event.button}`;
      if (!isBinding(binding)) { setNotice('Use the left, middle, right, back, or forward mouse button.'); return; }
      mouseToSuppress.current = event.button;
      chooseBinding(binding);
    };
    const mouseUp = (event: MouseEvent) => {
      if (mouseToSuppress.current !== event.button) return;
      stop(event);
      // A binding press must not click a newly revealed button or navigate browser history.
      if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
      suppressTimer.current = setTimeout(() => { mouseToSuppress.current = null; }, 0);
    };
    const mouseDefault = (event: MouseEvent) => {
      if (mouseToSuppress.current === event.button || (capture && event.type === 'contextmenu')) stop(event);
    };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('mouseup', mouseUp, true);
    window.addEventListener('click', mouseDefault, true);
    window.addEventListener('auxclick', mouseDefault, true);
    window.addEventListener('contextmenu', mouseDefault, true);
    return () => {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('mousedown', mouseDown, true);
      window.removeEventListener('mouseup', mouseUp, true);
      window.removeEventListener('click', mouseDefault, true);
      window.removeEventListener('auxclick', mouseDefault, true);
      window.removeEventListener('contextmenu', mouseDefault, true);
    };
  }, [capture, review, onClose, onChange, active]);

  const updateBehavior = (key: BehaviorKey, value: 'hold' | 'toggle') => {
    onChange(current => ({ ...current, controls: { ...current.controls, behavior: { ...current.controls.behavior, [key]: value } } }));
    setNotice(`${key === 'aimSwitch' ? 'Alternate aim' : key[0].toUpperCase() + key.slice(1)}: ${value}.`);
  };
  const behaviorSelect = (key: BehaviorKey, label: string) => <select aria-label={label} value={controls.behavior[key]}
    onChange={event => updateBehavior(key, event.target.value as 'hold' | 'toggle')}>
    <option value="hold">Hold</option><option value="toggle">Toggle</option>
  </select>;
  const resetAll = (trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    const next = defaultControls();
    const changes: Proposal['changes'] = ACTIONS.flatMap(({ id: action }) => ([0, 1] as const).flatMap(slot =>
      controls.bindings[action][slot] === next.bindings[action][slot] ? [] : [{ action, slot, from: controls.bindings[action][slot], to: next.bindings[action][slot] }]));
    setReview({ proposal: { controls: next, changes, conflict: changes.length > 0 }, title: 'Restore default controls?', confirm: 'Reset controls',
      notes: ['Restore hold behavior, combined jump and jetpack, and the aim line as default.'] });
  };

  return <section className={`settings-screen${embedded ? ' settings-embedded' : ''}`} data-testid="settings-screen"
    role={embedded ? 'dialog' : undefined} aria-modal={embedded ? true : undefined} aria-labelledby="settings-title"
    onKeyDown={embedded ? containFocus : undefined}>
    <div className="settings-content" inert={!!capture || !!review}>
      <header className="settings-header">
        <button className="settings-back" onClick={onClose}><span aria-hidden="true">←</span> {embedded ? 'Back to pause' : 'Back to menu'}</button>
        <span className="settings-wordmark">BURNHOP</span>
      </header>
      <div className="settings-intro">
        <h1 id="settings-title" ref={headingRef} tabIndex={-1}>SETTINGS</h1>
      </div>
      {!storageAvailable && <p className="settings-storage-note" role="status">Changes work for this visit; local saving is unavailable.</p>}
      <div className="settings-workbench">
        <div className="settings-tabs" role="tablist" aria-label="Settings categories">
          {TABS.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`} role="tab"
            aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)} onKeyDown={event => {
              let next = index;
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % TABS.length;
              else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = TABS.length - 1;
              else return;
              event.preventDefault(); setTab(TABS[next].id);
              document.getElementById(`settings-tab-${TABS[next].id}`)?.focus();
            }}><span className="settings-tab-number">{item.number}</span><span>{item.label}</span><span aria-hidden="true">↗</span></button>)}
        </div>
        <div className="settings-panel" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'bindings' && <>
            <div className="settings-panel-heading"><div><h2>Bindings</h2>
              <p>Choose a slot, then press a key or mouse button. Hold keeps an action active while pressed; toggle switches it on and off.</p></div>
              <button className="settings-reset-all" onClick={event => resetAll(event.currentTarget)}>Reset controls <span aria-hidden="true">↺</span></button>
            </div>
            <label className="settings-source"><span><strong>Jump & jetpack</strong><small>Share one control, or give your thrusters their own.</small></span>
              <select aria-label="Jump and jetpack controls" value={controls.jetpackSource} onChange={event => {
                const jetpackSource = event.target.value as ControlsSettings['jetpackSource'];
                onChange(current => ({ ...current, controls: { ...current.controls, jetpackSource } }));
                setNotice(jetpackSource === 'combined' ? 'Jump and jetpack share the jump binding.' : 'Jetpack uses its separate binding.');
              }}><option value="combined">Combined</option><option value="separate">Separate</option></select>
            </label>
            <div className="settings-binding-table">
              <div className="settings-binding-head" aria-hidden="true"><span>ACTION</span><span>PRIMARY</span><span>SECONDARY</span><span>BEHAVIOR</span><span /></div>
              {ACTIONS.map(({ id: action, label }) => {
                const inherited = action === 'jetpack' && controls.jetpackSource === 'combined';
                const bindings = inherited ? controls.bindings.jump : controls.bindings[action];
                const key = behaviorKey(action);
                return <div className={`settings-binding-row${inherited ? ' settings-binding-inherited' : ''}`} key={action}>
                  <div className="settings-action-label"><strong>{label}</strong><small>{inherited ? 'Uses Jump. Release, then press again in midair.'
                    : action === 'jetpack' ? 'Fly directly from the ground or thrust in midair.' : DESCRIPTIONS[action]}</small></div>
                  {([0, 1] as const).map(slot => <div className="settings-binding-slot" key={slot}>
                    <button className="settings-binding-key" disabled={inherited} aria-label={`Change ${label} ${slotLabel(slot)} binding`}
                      onClick={event => { returnFocusRef.current = event.currentTarget; setNotice(''); setCapture({ action, slot }); }}>
                      <span className="settings-mobile-slot">{slotLabel(slot)}</span><kbd>{bindingLabel(bindings[slot])}</kbd>
                    </button>
                    {!inherited && bindings[slot] !== null && <button className="settings-clear" aria-label={`Clear ${label} ${slotLabel(slot)} binding`}
                      onClick={event => { returnFocusRef.current = event.currentTarget.previousElementSibling as HTMLElement;
                        applyProposal(proposeBinding(controls, action, slot, null), `${label} ${slotLabel(slot)} binding cleared.`); }}>×</button>}
                  </div>)}
                  <div className="settings-binding-behavior">{key ? behaviorSelect(key, `${label} behavior`) : <span>Press</span>}</div>
                  <button className="settings-row-reset" aria-label={`Reset ${label} controls`} title={`Reset ${label} controls`}
                    onClick={event => { returnFocusRef.current = event.currentTarget;
                      applyProposal(resetActionControls(controls, action), `${label} controls reset.`); }}><span aria-hidden="true">↺</span></button>
                </div>;
              })}
            </div>
            <p className="settings-footnote"><kbd>ESC</kbd> always pauses and releases mouse capture. Jump, reload, view range, pickups, punch and pause activate once per press.</p>
          </>}
          {tab === 'aiming' && <>
            <div className="settings-panel-heading"><div><h2>Aiming</h2>
              <p>Your alternate-aim control switches to the other style. Both styles aim and fire the same weapon.</p></div></div>
            <div className="settings-aim-options" role="group" aria-label="Default aim style">
              {(['radial', 'pointer'] as const).map(mode => <button key={mode} className="settings-aim-card" aria-pressed={controls.defaultAimMode === mode}
                aria-label={mode === 'radial' ? 'Default aim: aim line' : 'Default aim: pointer crosshair'}
                onClick={() => { onChange(current => ({ ...current, controls: { ...current.controls, defaultAimMode: mode } }));
                  setNotice(`${mode === 'radial' ? 'Aim line' : 'Pointer crosshair'} is now your default aim.`); }}>
                <div className={`settings-aim-visual settings-aim-${mode}`} aria-hidden="true"><span className="settings-aim-pilot" />
                  <span className="settings-aim-rifle" /><span className="settings-aim-mark" /></div>
                <span className="settings-aim-caption"><strong>{mode === 'radial' ? 'Aim line' : 'Pointer crosshair'}</strong><span className="settings-aim-check" aria-hidden="true">{controls.defaultAimMode === mode ? '✓' : '+'}</span></span>
                <small>{mode === 'radial' ? 'A short line near your weapon shows the firing direction.' : 'A crosshair follows your pointer across the playfield.'}</small>
                <span className="settings-aim-default">{controls.defaultAimMode === mode ? 'DEFAULT AIM' : 'SET AS DEFAULT'}</span>
              </button>)}
            </div>
            <label className="settings-preference"><span><strong>Alternate aim behavior</strong><small>{controls.behavior.aimSwitch === 'hold' ? 'Hold to use the other style; release to return.' : 'Press once to change style; press again to return.'}</small></span>
              {behaviorSelect('aimSwitch', 'Alternate aim behavior')}</label>
            <div className="settings-aim-binding"><span>ALTERNATE AIM</span><div>{controls.bindings.aimSwitch.filter(binding => binding !== null).map(binding => <kbd key={binding}>{bindingLabel(binding)}</kbd>)}
              {controls.bindings.aimSwitch.every(binding => binding === null) && <span>Unbound</span>}</div><button onClick={() => setTab('bindings')}>Change binding <span aria-hidden="true">↗</span></button></div>
          </>}
          {tab === 'audio' && <>
            <div className="settings-panel-heading"><div><h2>Audio</h2>
              <p>{storageAvailable ? 'Changes apply immediately and save on this device.' : 'Changes apply immediately for this visit.'} Set each level from 0–100%.</p></div>
              <button className="settings-reset-all" onClick={() => {
                onChange(current => ({ ...current, audio: defaultAudioSettings() })); setNotice('Default audio levels restored.');
              }}>Reset audio to defaults <span aria-hidden="true">↺</span></button>
            </div>
            <label className="settings-preference"><span><strong>Master sound</strong><small>Enable all music and effects. Your volume mix stays saved while muted.</small></span>
              <span className="settings-switch"><input type="checkbox" checked={!settings.muted} aria-label="Master sound"
                onChange={event => { const muted = !event.target.checked; onChange(current => ({ ...current, muted })); }} /><span aria-hidden="true" /></span></label>
            <div className="settings-audio-mix">
              {AUDIO_CHANNELS.map(channel => {
                const percentage = Math.round(settings.audio[channel.id] * 100);
                const inputId = `settings-audio-${channel.id}`;
                return <div className="settings-audio-channel" key={channel.id}>
                  <label htmlFor={inputId}><strong>{channel.label}</strong><small id={`${inputId}-description`}>{channel.description}</small></label>
                  <div className="settings-audio-level"><input id={inputId} type="range" min="0" max="100" step="1"
                    aria-label={channel.label} aria-describedby={`${inputId}-description`} aria-valuetext={`${percentage}%`} value={percentage}
                    onChange={event => { const volume = Number(event.target.value) / 100;
                      onChange(current => ({ ...current, audio: { ...current.audio, [channel.id]: volume } })); }} />
                    <output htmlFor={inputId}>{percentage}%</output></div>
                </div>;
              })}
            </div>
          </>}
          {tab === 'graphics' && <>
            <div className="settings-panel-heading"><div><h2>Graphics</h2>
              <p>Balance image detail and smoothness. Changes apply immediately{storageAvailable ? ' and save on this device' : ''}.</p></div>
              <button className="settings-reset-all" onClick={() => { onChange(current => ({ ...current, graphics: defaultGraphics() })); setNotice('Balanced graphics restored.'); }}>Reset graphics <span aria-hidden="true">↺</span></button>
            </div>
            <div className="settings-graphics-presets" role="group" aria-label="Graphics preset">
              {(['low', 'balanced', 'high'] as GraphicsPreset[]).map(preset => <button key={preset} aria-pressed={graphicsPreset(graphics) === preset}
                onClick={() => { onChange(current => ({ ...current, graphics: { ...GRAPHICS_PRESETS[preset] } })); setNotice(`${preset[0].toUpperCase() + preset.slice(1)} graphics applied.`); }}>
                <strong>{preset === 'low' ? 'Low' : preset === 'balanced' ? 'Balanced' : 'High'}</strong>
                <small>{preset === 'low' ? 'More room for smooth play' : preset === 'balanced' ? 'Recommended starting point' : 'Full detail and display rate'}</small>
              </button>)}
            </div>
            {graphicsPreset(graphics) === 'custom' && <p className="settings-footnote">Custom graphics settings</p>}
            <label className="settings-preference"><span><strong>Render resolution</strong><small>Lower values draw fewer pixels. Menus and the HUD stay sharp.</small></span>
              <select aria-label="Render resolution" value={graphics.renderScale} onChange={event => changeGraphics('renderScale', Number(event.target.value) as GraphicsSettings['renderScale'])}>
                <option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option></select></label>
            <label className="settings-preference"><span><strong>Frame-rate limit</strong><small>Choose a sustainable rate for your display. Movement and weapon timing stay the same.</small></span>
              <select aria-label="Frame-rate limit" value={graphics.frameRate} onChange={event => changeGraphics('frameRate', Number(event.target.value) as GraphicsSettings['frameRate'])}>
                <option value="60">60 FPS</option><option value="120">120 FPS</option><option value="0">Display refresh rate</option></select></label>
            <label className="settings-preference"><span><strong>Terrain detail</strong><small>Controls scenery texture resolution. Every platform and opening remains visible.</small></span>
              <select aria-label="Terrain detail" value={graphics.scenery} onChange={event => changeGraphics('scenery', event.target.value as GraphicsSettings['scenery'])}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label className="settings-preference"><span><strong>Effects</strong><small>Adjusts decorative particles and shading. Firing and hit feedback remain visible.</small></span>
              <select aria-label="Effects" value={graphics.effects} onChange={event => changeGraphics('effects', event.target.value as GraphicsSettings['effects'])}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <div className="settings-performance-report"><div><strong>Playtest performance report</strong><p>Copy measurements from your current or last session to help investigate stutters.</p></div>
              <button className="settings-reset-all" onClick={async () => {
                const text = performanceReport();
                try { await navigator.clipboard.writeText(text); setReport(''); setNotice('Performance report copied.'); }
                catch { setReport(text); setNotice('Select and copy the report below.'); }
              }}>Copy performance report</button>
            </div>
            {report && <textarea className="settings-report-text" aria-label="Performance report" readOnly value={report} onFocus={event => event.currentTarget.select()} />}
          </>}
          {tab === 'motion' && <>
            <div className="settings-panel-heading"><div><h2>Motion</h2></div></div>
            <label className="settings-preference"><span><strong>Reduced motion</strong><small>Reduce camera effects, exhaust and menu animation.</small></span>
              <span className="settings-switch"><input type="checkbox" checked={settings.reducedMotion} aria-label="Reduced motion"
                onChange={event => { const reducedMotion = event.target.checked; onChange(current => ({ ...current, reducedMotion })); }} /><span aria-hidden="true" /></span></label>
            <div className="settings-audio-channel">
              <label htmlFor="feedback-intensity"><strong>Screen feedback intensity</strong><small>Red damage and blue elimination edges. The aiming area stays clear.</small></label>
              <div className="settings-audio-level"><input id="feedback-intensity" type="range" min="0" max="100" step="5" aria-label="Screen feedback intensity"
                value={Math.round(settings.feedback.intensity * 100)} onChange={event => {
                  const intensity = Number(event.target.value) / 100;
                  onChange(current => ({ ...current, feedback: { ...current.feedback, intensity } }));
                }} /><output htmlFor="feedback-intensity">{Math.round(settings.feedback.intensity * 100)}%</output></div>
            </div>
            <label className="settings-preference"><span><strong>Low-health heartbeat</strong><small>A quiet pulse below 25 health; stops when you recover above 30.</small></span>
              <span className="settings-switch"><input type="checkbox" checked={settings.feedback.heartbeat} aria-label="Low-health heartbeat"
                onChange={event => { const heartbeat = event.target.checked; onChange(current => ({ ...current, feedback: { ...current.feedback, heartbeat } })); }} /><span aria-hidden="true" /></span></label>
          </>}
        </div>
      </div>
      <footer className="settings-footer"><span role="status" aria-live="polite">{notice}</span><span><kbd>ESC</kbd> BACK</span></footer>
    </div>
    {capture && <div className="settings-dialog-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="binding-capture-title" aria-describedby="binding-capture-description">
      <p className="eyebrow">{actionLabel(capture.action)} / {slotLabel(capture.slot)}</p>
      <h2 ref={captureHeadingRef} tabIndex={-1} id="binding-capture-title">Press a key or mouse button.</h2>
      <p id="binding-capture-description">Tab can be assigned here. Escape cancels. Mouse buttons 1–5 are supported.</p>
      <div className="settings-listening" aria-hidden="true"><span /> LISTENING FOR YOUR INPUT</div>
      <p className="settings-capture-notice" role="status">{notice}</p>
      <button className="button button-outline" data-capture-cancel onClick={cancelCapture}>Cancel <kbd>ESC</kbd></button>
    </section></div>}
    {review && <div className="settings-dialog-backdrop"><section className="settings-dialog settings-review" role="dialog" aria-modal="true" aria-labelledby="binding-review-title" onKeyDown={containFocus}>
      <h2 id="binding-review-title">{review.title}</h2>
      <p>{review.confirm === 'Swap bindings' ? 'Apply these changes together, or keep your current controls.' : 'Your pilot, saved looks, sound and motion settings stay as they are.'}</p>
      {review.proposal.changes.length > 0 && <ul className="settings-change-list">{review.proposal.changes.map(change => <li key={`${change.action}-${change.slot}`}>
        <span>{actionLabel(change.action)}<small>{slotLabel(change.slot)}</small></span><span><kbd>{bindingLabel(change.from)}</kbd><span aria-hidden="true">→</span><kbd>{bindingLabel(change.to)}</kbd></span>
      </li>)}</ul>}
      {review.notes?.map(note => <p key={note} className="settings-review-note">{note}</p>)}
      <div className="settings-dialog-actions"><button ref={reviewCancelRef} className="button button-outline" onClick={cancelReview}>Cancel</button>
        <button className="button button-amber" onClick={() => { commit(review.proposal.controls, review.confirm === 'Reset controls' ? 'Default controls restored.' : 'Bindings swapped.'); setReview(null); returnFocus(); }}>{review.confirm}</button></div>
    </section></div>}
  </section>;
}
