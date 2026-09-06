import { retainHud } from './game/hud';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import CrouchPreview from './CrouchPreview';
import CharacterCreator from './CharacterCreator';
import CharacterPreview from './CharacterPreview';
import MenuBackdrop from './MenuBackdrop';
import ArenaSelector from './ArenaSelector';
import CombatHud from './CombatHud';
import CombatFeedback from './CombatFeedback';
import EntryLandscape from './EntryLandscape';
import DancePilot from './DancePilot';
import FullscreenEscapeHold from './FullscreenEscapeHold';
import KeyboardCaptureNotice from './KeyboardCaptureNotice';
import SettingsScreen from './SettingsScreen';
import { useMenuAudio } from './useMenuAudio';
import { controlHelp } from './game/controls';
import { DEFAULT_ZOOM_LEVEL, type ZoomLevel } from './game/camera';
import { readSettings, writeSettings, type Settings } from './game/settings';
import { GameCapture, type KeyboardCaptureStatus } from './game/capture';
import { loadGame } from './game/loading';
import { arenaIdFromSearch, getArena, type ArenaDefinition, type ArenaId } from './game/arenas';
import type { GameAssets } from './game/assets';
import type { HudState } from './game/types';
import { WEAPONS, type WeaponId } from './game/weapons';
const MultiplayerScreen = lazy(() => import('./MultiplayerScreen'));
import type { GameRuntime } from './game/runtime';

type Screen = 'menu' | 'multiplayer' | 'loading' | 'customize' | 'practice' | 'crouch-preview' | 'character-preview' | 'settings';
const EMPTY_HUD: HudState = { health: 100, fuel: 100, ammo: 30, reloadProgress: -1, shotsFired: 0, hits: 0, kills: 0, targetHealth: 100 };

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.6" /></svg>;
}
function Mark() {
  return <svg className="burnhop-mark" aria-hidden="true" viewBox="0 0 48 48" fill="none"><path d="m24 5 18 34H31l-7-15-7 15H6L24 5Z" fill="currentColor" /><path d="m21 35 3 8 3-8" fill="currentColor" /></svg>;
}
function SoundIcon({ muted }: { muted: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 9h4l5-4v14l-5-4H4Z" stroke="currentColor" strokeWidth="1.6" /><path d={muted ? 'm17 9 5 6m0-6-5 6' : 'M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'} stroke="currentColor" strokeWidth="1.6" /></svg>;
}
function containFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(el => el.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
function LoadingScreen({ arena, progress, error, retry, onBack }: { arena: ArenaDefinition; progress: number; error: string | null; retry: () => void; onBack: () => void }) {
  return <section className="loading-screen" data-testid="loading-screen" aria-label={`Loading ${arena.name.toLowerCase()}`}>
    <Mark />
    <div className="loading-content">
      <h1>{error ? 'UNABLE TO LOAD' : arena.name.toUpperCase()}</h1>
      <div className="loading-status" role="status"><span>{error ? `Unable to load ${arena.name.toLowerCase()}` : progress >= 1 ? `Entering ${arena.name.toLowerCase()}` : 'Loading'}</span><span>{Math.round(progress * 100)}%</span></div>
      <div className="loading-track" role="progressbar" aria-label="Loading game" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress * 100}%` }} /></div>
      {error && <><p className="capture-error" role="alert">{error}</p><button className="button button-amber" onClick={retry}>Retry loading <Arrow /></button></>}
      <button className="text-button loading-back" onClick={onBack}>Back to menu</button>
    </div>
  </section>;
}

export default function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const onlinePauseRef = useRef<(() => void) | null>(null);
  const [onlineActive, setOnlineActive] = useState(false);
  const captureRef = useRef<GameCapture | null>(null);
  const [keyboardStatus, setKeyboardStatus] = useState<KeyboardCaptureStatus>('idle');
  const retryKeyboard = useCallback(() => captureRef.current?.retryKeyboard(), []);
  const assetRequest = useRef(0);
  const runtimeArenaRef = useRef<ArenaId | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const busy = useRef(false);
  const pausedRef = useRef(true);
  const [screen, setScreen] = useState<Screen>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('room') || params.get('online') === '1') return 'multiplayer';
    const preview = params.get('preview');
    return preview === 'character' ? 'character-preview' : preview === 'crouch' ? 'crouch-preview' : 'menu';
  });
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [selectedArenaId, setSelectedArenaId] = useState<ArenaId>(() => arenaIdFromSearch(window.location.search));
  const [activeArenaId, setActiveArenaId] = useState<ArenaId>(selectedArenaId);
  const [loading, setLoading] = useState({ progress: 0, label: 'Loading' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [paused, setPaused] = useState(true);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [fps, setFps] = useState<number | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel>(DEFAULT_ZOOM_LEVEL);
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [gatePending, setGatePending] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [entrySoundStarted, setEntrySoundStarted] = useState(false);
  const gateVisible = !entered || !fullscreen;
  const gateVisibleRef = useRef(gateVisible);
  gateVisibleRef.current = gateVisible;
  const gateButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState<Settings>(() => readSettings(window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [storageAvailable, setStorageAvailable] = useState(true);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const menuAudio = useMenuAudio(settings.muted, gateVisible || (screen !== 'practice' && screen !== 'loading' && screen !== 'multiplayer'), settings.audio, true);

  const pause = useCallback(() => {
    generation.current++;
    assetRequest.current++;
    pausedRef.current = true;
    runtimeRef.current?.pause();
    onlinePauseRef.current?.();
    setPaused(true);
    setFps(null);
    setPending(false);
    busy.current = false;
    void captureRef.current?.pause();
    if (screenRef.current === 'loading') setScreen(runtimeRef.current ? 'practice' : 'menu');
  }, []);

  useEffect(() => {
    alive.current = true;
    const capture = new GameCapture(canvasRef.current!, shellRef.current!, pause, setKeyboardStatus);
    captureRef.current = capture;
    const changed = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      alive.current = false;
      generation.current++;
      assetRequest.current++;
      capture.destroy();
      captureRef.current = null;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
      document.removeEventListener('fullscreenchange', changed);
    };
  }, [pause]);

  const ensureAssets = useCallback((arenaId: ArenaId = 'range') => {
    const request = ++assetRequest.current;
    const isCurrent = () => alive.current && request === assetRequest.current;
    setLoadError(null);
    setLoading({ progress: 0, label: 'Loading' });
    return loadGame(status => { if (isCurrent()) setLoading(status); }, arenaId).then(result => {
      // Studio previews always use the training ground; gameplay receives its selected arena directly.
      if (isCurrent() && arenaId === 'range') setAssets(result);
      return result;
    }).catch(reason => {
      if (isCurrent()) setLoadError(reason instanceof Error ? reason.message : 'The arena could not load. Please retry.');
      throw reason;
    });
  }, []);

  useEffect(() => {
    if (!gateVisible && ['customize', 'character-preview', 'crouch-preview'].includes(screen)) void ensureAssets().catch(() => undefined);
  }, [screen, ensureAssets, gateVisible]);
  useEffect(() => {
    if (screen !== 'character-preview') setStorageAvailable(writeSettings(settings));
    const runtime = runtimeRef.current;
    runtime?.setAppearance(settings.appearance);
    runtime?.setMuted(settings.muted);
    runtime?.setAudioVolumes(settings.audio);
    runtime?.setFeedback(settings.feedback);
    runtime?.setReducedMotion(settings.reducedMotion);
    runtime?.setGraphics(settings.graphics);
    runtime?.setControls(settings.controls);
  }, [settings, screen]);
  useEffect(() => {
    if (gateVisible) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !focused.closest('.fullscreen-gate')) previousFocusRef.current = focused;
      gateButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    if (previousFocusRef.current?.isConnected) {
      previousFocusRef.current.focus({ preventScroll: true });
      previousFocusRef.current = null;
    }
    if (screen === 'practice' && paused && !showSettings && !pending) resumeRef.current?.focus();
    if (screen === 'menu' && !pending) launchRef.current?.focus({ preventScroll: true });
  }, [screen, paused, pending, showSettings, gateVisible, gatePending]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented || showSettings || gateVisibleRef.current) return;
      // A tap can cancel loading; gameplay owns pause and the hold component owns fullscreen exit.
      if (screenRef.current === 'loading') { event.preventDefault(); pause(); }
    };
    const blur = () => { if (screenRef.current === 'loading' && busy.current) pause(); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [pause, showSettings]);

  const exitFullscreen = useCallback(() => {
    pause();
    void captureRef.current?.release();
  }, [pause]);

  const enterShell = () => {
    const capture = captureRef.current;
    if (!capture || gatePending) return;
    menuAudio.unlock();
    setEntrySoundStarted(true);
    setGatePending(true);
    setGateError(null);
    // Fullscreen belongs to the entrance. The menu keeps the cursor until practice starts.
    void capture.enterMenu().then(() => {
      if (!alive.current || !capture.isFullscreen()) return;
      setFullscreen(true);
      setEntered(true);
    }).catch(reason => {
      if (alive.current) setGateError(reason instanceof Error ? reason.message : 'Fullscreen could not start. Please try again.');
    }).finally(() => { if (alive.current) setGatePending(false); });
  };

  const enterPractice = (restart = false) => {
    const capture = captureRef.current;
    if (!capture || busy.current || gateVisibleRef.current) return;
    if (!capture.isFullscreen()) { setFullscreen(false); return; }
    const arenaId = runtimeArenaRef.current ?? selectedArenaId;
    busy.current = true;
    const attempt = ++generation.current;
    setCaptureError(null);
    setLoadError(null);
    setPending(true);
    // The main menu is already fullscreen. Capture the pointer on this deliberate play click.
    const preparation = capture.enter();
    if (!runtimeRef.current) setScreen('loading');
    let assetsFailed = false;
    const assetTask = ensureAssets(arenaId).catch(reason => { assetsFailed = true; throw reason; });
    void Promise.all([preparation, assetTask]).then(async ([, gameAssets]) => {
      const { GameRuntime: Runtime } = await import('./game/runtime');
      if (!alive.current || attempt !== generation.current) return;
      if (!capture.isActive()) throw new Error('Mouse capture was interrupted. Start practice again to continue.');
      if (!runtimeRef.current) {
        const runtime = new Runtime(canvasRef.current!, gameAssets, { onHud: next => setHud(previous => retainHud(previous, next)), onPause: pause, onPerformance: setFps, onZoom: setZoom });
        runtime.setAppearance(settingsRef.current.appearance);
        runtime.setMuted(settingsRef.current.muted);
        runtime.setAudioVolumes(settingsRef.current.audio);
        runtime.setFeedback(settingsRef.current.feedback);
        runtime.setReducedMotion(settingsRef.current.reducedMotion);
        runtime.setGraphics(settingsRef.current.graphics);
        runtime.setControls(settingsRef.current.controls);
        runtimeRef.current = runtime;
        runtimeArenaRef.current = arenaId;
        setActiveArenaId(arenaId);
      }
      if (restart) { runtimeRef.current.reset(); setHud(EMPTY_HUD); }
      pausedRef.current = false;
      busy.current = false;
      setPending(false);
      setPaused(false);
      setScreen('practice');
      setShowSettings(false);
      runtimeRef.current.resume();
      canvasRef.current?.focus();
    }).catch(reason => {
      if (!alive.current || attempt !== generation.current) return;
      busy.current = false;
      setPending(false);
      pausedRef.current = true;
      setPaused(true);
      void capture.pause();
      setCaptureError(reason instanceof Error ? reason.message : 'Mouse capture could not start. Please try again.');
      setScreen(runtimeRef.current ? 'practice' : assetsFailed ? 'loading' : 'menu');
    });
  };
  const backToMenu = () => {
    pause();
    runtimeRef.current?.destroy();
    runtimeRef.current = null;
    runtimeArenaRef.current = null;
    setHud(EMPTY_HUD);
    setZoom(DEFAULT_ZOOM_LEVEL);
    setShowSettings(false);
    setCaptureError(null);
    setScreen('menu');
    const url = new URL(window.location.href);
    url.searchParams.delete('preview');
    url.searchParams.delete('room');
    url.searchParams.delete('online');
    window.history.replaceState(null, '', url);
  };
  const preview = (kind: 'character' | 'crouch') => {
    const url = new URL(window.location.href);
    url.searchParams.set('preview', kind);
    window.history.replaceState(null, '', url);
    setScreen(`${kind}-preview`);
  };
  const closeSettings = useCallback(() => {
    setShowSettings(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);
  const accuracy = hud.shotsFired ? Math.round(hud.hits / hud.shotsFired * 100) : 0;
  const selectedArena = getArena(selectedArenaId);
  const activeArena = getArena(activeArenaId);
  const selectArena = (id: ArenaId) => {
    assetRequest.current++;
    setSelectedArenaId(id);
    setCaptureError(null);
    setLoadError(null);
    const url = new URL(window.location.href);
    if (id === 'range') url.searchParams.delete('map'); else url.searchParams.set('map', id);
    window.history.replaceState(null, '', url);
  };
  const loadingVisible = screen === 'loading' || (!assets && ['customize', 'character-preview', 'crouch-preview'].includes(screen));

  return <div ref={shellRef} className="game-shell" data-reduced-motion={settings.reducedMotion} {...menuAudio.handlers}>
    <div className="game-content" inert={gateVisible} aria-hidden={gateVisible} data-ui-audio={!gateVisible && (screen !== 'practice' || paused)}>
    <canvas ref={canvasRef} className="game-canvas" data-testid="game-canvas" tabIndex={((screen === 'practice' && !paused) || onlineActive) && !gateVisible ? 0 : -1}
      aria-hidden={!((screen === 'practice' && !paused) || onlineActive) || gateVisible}
      aria-label={`${activeArena.name}. Mouse aims. ${controlHelp(settings.controls).map(item => `${item.keys.join(' or ') || 'Unbound'}: ${item.description}.`).join(' ')}`} />
    {screen === 'menu' && !gateVisible && <main className="menu-screen" data-testid="menu-screen">
      <MenuBackdrop appearance={settings.appearance} reducedMotion={settings.reducedMotion} getDanceTime={menuAudio.getDanceTime} />
      <div className="menu-vignette" />
      <div className="menu-corner"><Mark /><span>BURNHOP</span></div>
      <section className="menu-copy">
        <h1>BURN<span>HOP</span></h1>
        <div className="menu-actions">
          <ArenaSelector selected={selectedArenaId} onChange={selectArena} />
          <button ref={launchRef} className="launch-button" onClick={() => enterPractice()} disabled={pending} aria-label="Enter practice" aria-describedby="arena-selection-summary"><span><strong>{pending ? 'ENTERING…' : 'ENTER PRACTICE'}</strong><small>{selectedArena.name} <span aria-hidden="true">/</span> Solo session</small></span><Arrow /></button>
          <button className="multiplayer-button" onClick={() => { const url = new URL(window.location.href); url.searchParams.set('online', '1'); window.history.replaceState(null, '', url); setScreen('multiplayer'); }} aria-label="Multiplayer">
            <span>MULTIPLAYER</span><small>PRIVATE MATCH · 2–8 PLAYERS</small>
          </button>
          {captureError && <p className="capture-error" role="alert" data-testid="capture-error">{captureError}</p>}
          <KeyboardCaptureNotice status={keyboardStatus} onRetry={retryKeyboard} />
          <nav className="menu-secondary" aria-label="Pilot and preferences">
            <button className="menu-option" onClick={() => setScreen('customize')} aria-label="Customize"><span>Customize pilot</span><span aria-hidden="true">↗</span></button>
            <button className="menu-option" onClick={() => setScreen('settings')} aria-label="Settings & Controls"><span>Settings & controls</span><span aria-hidden="true">↗</span></button>
          </nav>
        </div>
      </section>
      <footer className="menu-footer">
        <button className="sound-button" onClick={() => setSettings(current => ({ ...current, muted: !current.muted }))} aria-label={`Sound: ${settings.muted ? 'off' : 'on'}`}><SoundIcon muted={settings.muted} /></button>
      </footer>
      {import.meta.env.DEV && <details className="studio-tools"><summary>Studio</summary><button onClick={() => preview('character')}>Character preview</button><button onClick={() => preview('crouch')}>Crouch preview</button></details>}
    </main>}
    {screen === 'multiplayer' && <Suspense fallback={<div className="loading-screen" role="status">Opening multiplayer…</div>}><MultiplayerScreen canvasRef={canvasRef} captureRef={captureRef} pauseRef={onlinePauseRef} active={!gateVisible} settings={settings} onChangeSettings={setSettings} storageAvailable={storageAvailable} onBack={backToMenu} onActiveChange={setOnlineActive} keyboardStatus={keyboardStatus} onRetryKeyboard={retryKeyboard} /></Suspense>}
    {loadingVisible && <LoadingScreen arena={screen === 'loading' ? selectedArena : getArena('range')} progress={loading.progress} error={loadError} retry={() => screen === 'loading' ? enterPractice() : void ensureAssets().catch(() => undefined)} onBack={backToMenu} />}
    {assets && screen === 'customize' && <div className="app-surface"><CharacterCreator assets={assets} settings={settings} onChange={setSettings} storageAvailable={storageAvailable} onExit={backToMenu} /></div>}
    {screen === 'settings' && <div className="app-surface"><SettingsScreen active={!gateVisible} settings={settings} onChange={setSettings} storageAvailable={storageAvailable} onClose={backToMenu} /></div>}
    {assets && screen === 'crouch-preview' && <div className="app-surface"><CrouchPreview assets={assets} appearance={settings.appearance} reducedMotion={settings.reducedMotion} onExit={backToMenu} onPractice={() => enterPractice()} /></div>}
    {assets && screen === 'character-preview' && <div className="app-surface"><CharacterPreview assets={assets} reducedMotion={settings.reducedMotion} onExit={backToMenu} /></div>}
    {screen === 'practice' && <main className="game-screen">
      <CombatFeedback health={hud.health} damagePulse={hud.damageSequence ?? 0} killPulse={hud.killSequence ?? 0}
        reducedMotion={settings.reducedMotion} intensity={settings.feedback.intensity} active={!paused && !gateVisible} />
      <div className="hud-layer" inert={paused || gateVisible} aria-hidden={paused || gateVisible}>
        <button className="pause-trigger" aria-label="Pause practice" onClick={pause}><span aria-hidden="true">Ⅱ</span><kbd>ESC</kbd></button>
        <span className="arena-readout" data-testid="arena-name">{activeArena.name}</span>
        <CombatHud hud={hud} />
        <span className="zoom-readout" aria-label={`View range ${zoom}x`} title="Higher view range shows more arena" data-testid="zoom-level">View range {zoom}x</span>
        <span className="fps-readout" data-testid="fps" aria-label="Frames per second">{fps === null ? '—' : Math.round(fps)} FPS</span>
      </div>
      {paused && <div className="pause-backdrop" data-testid="capture-overlay">
        {showSettings ? <SettingsScreen embedded active={!gateVisible} settings={settings} onChange={setSettings} storageAvailable={storageAvailable} onClose={closeSettings} /> : <section className="pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title" onKeyDown={containFocus}>
          <p className="pause-arena">{activeArena.name}</p>
          <h1 id="pause-title">PAUSED</h1>
          <KeyboardCaptureNotice status={keyboardStatus} onRetry={retryKeyboard} />
          <div className="pause-statistics"><span><b data-testid="kills">{hud.kills.toString().padStart(2, '0')}</b> Eliminations</span><span><b>{accuracy}%</b> Accuracy</span></div>
          <div className="practice-loadout" aria-label="Practice loadout">
            <label htmlFor="practice-main">Practice weapon<select id="practice-main" value={hud.weaponId ?? 'pistol'} onChange={event => {
              const main = event.target.value as WeaponId;
              runtimeRef.current?.setPracticeLoadout(main, WEAPONS[main].dualWield ? hud.offhand?.weaponId ?? null : null);
            }}>{Object.values(WEAPONS).map(weapon => <option value={weapon.id} key={weapon.id}>{weapon.name}</option>)}</select></label>
            <label htmlFor="practice-offhand">Second hand<select id="practice-offhand" value={hud.offhand?.weaponId ?? ''}
              disabled={!WEAPONS[hud.weaponId ?? 'pistol'].dualWield} onChange={event => {
                runtimeRef.current?.setPracticeLoadout(hud.weaponId ?? 'pistol', event.target.value ? event.target.value as WeaponId : null);
              }}><option value="">None</option>{Object.values(WEAPONS).filter(weapon => weapon.dualWield).map(weapon => <option value={weapon.id} key={weapon.id}>{weapon.name}</option>)}</select></label>
          </div>
          {captureError && <p className="capture-error" role="alert" data-testid="capture-error">{captureError}</p>}
          {pending && <p role="status" className="capture-status">Capturing mouse…</p>}
          <div className="pause-actions">
            <button ref={resumeRef} className="button button-amber" disabled={pending} onClick={() => enterPractice()}>{captureError ? 'Retry capture' : 'Resume'}<Arrow /></button>
            <button className="menu-option" disabled={pending} onClick={() => enterPractice(true)} aria-label="Restart practice">Restart practice <span aria-hidden="true">↻</span></button>
            <button ref={settingsButtonRef} className="menu-option" disabled={pending} onClick={() => setShowSettings(true)}>Settings <span aria-hidden="true">↗</span></button>
            <button className="menu-option" onClick={backToMenu} aria-label="Back to menu">Main menu <span aria-hidden="true">←</span></button>
          </div>
          <details className="pause-controls"><summary>Controls</summary><div className="controls-grid">{controlHelp(settings.controls).map(item => <div key={item.action}><span className="keys">{(item.keys.length ? item.keys : ['Unbound']).map(key => <kbd key={key}>{key}</kbd>)}</span><span>{item.description}</span></div>)}</div></details>
          <div className="pause-display-actions"><button className="text-button" onClick={exitFullscreen}>Exit fullscreen</button><span className="escape-hold-hint">Hold <kbd>ESC</kbd> · 2s</span></div>
        </section>}
      </div>}
    </main>}
    </div>
    <FullscreenEscapeHold target={shellRef} enabled={!gateVisible} onExit={exitFullscreen} />
    {gateVisible && <main className="fullscreen-gate" data-testid="fullscreen-gate" aria-label={entered ? 'Fullscreen required' : 'Enter Burnhop'} onKeyDown={containFocus}>
      <EntryLandscape reducedMotion={settings.reducedMotion} />
      <div className="entry-shade" />
      <DancePilot appearance={settings.appearance} reducedMotion={settings.reducedMotion} getDanceTime={menuAudio.getDanceTime} />
      <div className="entry-action">
        <p className="entry-eyebrow"><Mark /><span>JETPACKS ON. GOOD SENSE OFF.</span></p>
        <h1 className="entry-wordmark">BURN<span>HOP</span></h1>
        <p className="entry-tagline">Small pilots. Poor impulse control.</p>
        <button ref={gateButtonRef} className="entry-button" disabled={gatePending} onClick={enterShell}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" stroke="currentColor" strokeWidth="1.3" /></svg>
          {gatePending ? 'Entering fullscreen…' : entered ? 'Return to fullscreen' : 'Enter game'}
        </button>
        <button className="entry-sound" aria-label={`Entry sound: ${entrySoundStarted && !settings.muted ? 'on' : 'off'}`} onClick={() => {
          const muted = entrySoundStarted ? !settings.muted : false;
          setSettings(current => ({ ...current, muted }));
          setEntrySoundStarted(true); menuAudio.unlock();
        }}><SoundIcon muted={!entrySoundStarted || settings.muted} /><span>{entrySoundStarted && !settings.muted ? 'SOUND ON' : 'SOUND OFF · TAP FOR THE BEAT'}</span></button>
        {entered && <p className="gate-note">Fullscreen is required to continue.</p>}
        {entered && screen === 'practice' && <p className="gate-note">Your practice session is paused and ready to resume.</p>}
        {entered && <KeyboardCaptureNotice status={keyboardStatus} />}
        {gateError && <p className="gate-error" role="alert" data-testid="fullscreen-error">{gateError}</p>}
      </div>
    </main>}
  </div>;
}
