import { retainHud } from './game/hud';
import { useCallback, useEffect, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from 'react';
import CombatHud from './CombatHud';
import CombatFeedback from './CombatFeedback';
import type { ZoomLevel } from './game/camera';
import SettingsScreen from './SettingsScreen';
import KeyboardCaptureNotice from './KeyboardCaptureNotice';
import { drawDetailedCharacter } from './game/detailedCharacter';
import type { DetailedAppearance } from './game/appearance';
import type { GameAssets } from './game/assets';
import type { GameCapture, KeyboardCaptureStatus } from './game/capture';
import { loadGame } from './game/loading';
import type { Settings } from './game/settings';
import type { HudState } from './game/types';
import { OnlineConnection } from './online/connection';
import { OnlineRuntime } from './online/runtime';
import { OUTPOST_ARENA } from './multiplayer/model';
import './multiplayer.css';

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  captureRef: RefObject<GameCapture | null>;
  pauseRef: RefObject<(() => void) | null>;
  active: boolean;
  settings: Settings;
  onChangeSettings: Dispatch<SetStateAction<Settings>>;
  storageAvailable: boolean;
  onBack: () => void;
  onActiveChange: (active: boolean) => void;
  keyboardStatus: KeyboardCaptureStatus;
  onRetryKeyboard: () => void;
}
const EMPTY_HUD: HudState = { health: 100, fuel: 100, ammo: 30, reloadProgress: -1, shotsFired: 0, hits: 0, kills: 0, targetHealth: 100 };
function savedNickname() {
  try { return sessionStorage.getItem('burnhop-nickname') ?? ''; } catch { return ''; }
}
function Pilot({ appearance, assets, name }: { appearance: DetailedAppearance; assets: GameAssets | null; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !assets) return;
    ctx.clearRect(0, 0, 180, 230);
    drawDetailedCharacter(ctx, 82, 215, 2.15, { aimAngle: -0.12, crouchAmount: 0, reducedMotion: true }, appearance, assets.images);
  }, [appearance, assets]);
  return <canvas ref={canvas} width={180} height={230} className="online-pilot" role="img" aria-label={`${name}'s pilot appearance`} />;
}
function clock(ticks: number) {
  const seconds = Math.max(0, Math.ceil(ticks / 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function MultiplayerScreen({ canvasRef, captureRef, pauseRef, active, settings, onChangeSettings, storageAvailable, onBack, onActiveChange, keyboardStatus, onRetryKeyboard }: Props) {
  const [connection] = useState(() => new OnlineConnection({}));
  const [snapshot, setSnapshot] = useState(() => connection.getSnapshot());
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [progress, setProgress] = useState(0);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(savedNickname);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [working, setWorking] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [paused, setPaused] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hud, setHud] = useState(EMPTY_HUD);
  const [viewRange, setViewRange] = useState<ZoomLevel>(1);
  const [fps, setFps] = useState<number | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const runtimeRef = useRef<OnlineRuntime | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const disposed = useRef(false);
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const captureAttempt = useRef(0);
  const pause = useCallback(() => {
    captureAttempt.current++;
    runtimeRef.current?.pause();
    setPaused(true);
    onActiveChange(false);
    if (document.pointerLockElement === canvasRef.current) void captureRef.current?.pause();
  }, [canvasRef, captureRef, onActiveChange]);

  const prepareAssets = useCallback(() => {
    setAssetError(null);
    void loadGame(state => { if (!disposed.current) setProgress(state.progress); }, 'outpost').then(result => {
      if (!disposed.current) setAssets({ ...result, arena: OUTPOST_ARENA });
    }).catch(reason => { if (!disposed.current) setAssetError(reason instanceof Error ? reason.message : 'Outpost could not load.'); });
  }, []);

  useEffect(() => {
    disposed.current = false;
    clearTimeout(cleanupTimer.current);
    const unsubscribe = connection.subscribe(() => setSnapshot(connection.getSnapshot()));
    // React's development effect rehearsal must not consume the refresh token twice.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      prepareAssets();
      void connection.recover().catch(() => undefined).finally(() => { if (!disposed.current) setRecovering(false); });
    });
    return () => {
      cancelled = true;
      disposed.current = true;
      unsubscribe();
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
      cleanupTimer.current = setTimeout(() => connection.dispose(), 0);
    };
  }, [connection, prepareAssets]);

  useEffect(() => {
    pauseRef.current = pause;
    return () => { pauseRef.current = null; };
  }, [pauseRef, pause]);
  useEffect(() => {
    // An initially gated, lazily loaded screen must not cancel the entrance's
    // in-flight fullscreen request. App/GameCapture already own capture loss.
    if (!active) { runtimeRef.current?.pause(); setPaused(true); onActiveChange(false); }
  }, [active, onActiveChange]);
  useEffect(() => {
    if (!assets || !snapshot.sessionId || !canvasRef.current) return;
    const runtime = new OnlineRuntime(canvasRef.current, assets, connection, { onHud: next => setHud(previous => retainHud(previous, next)), onPause: pause, onPerformance: setFps, onZoom: setViewRange });
    runtimeRef.current = runtime;
    const current = settingsRef.current;
    runtime.setAppearance(current.appearance);
    runtime.setMuted(current.muted);
    runtime.setAudioVolumes(current.audio);
    runtime.setFeedback(current.feedback);
    runtime.setReducedMotion(current.reducedMotion);
    runtime.setGraphics(current.graphics);
    runtime.setControls(current.controls);
    runtime.start();
    setRuntimeReady(true);
    return () => { runtime.destroy(); if (runtimeRef.current === runtime) runtimeRef.current = null; setRuntimeReady(false); };
  }, [assets, snapshot.sessionId, canvasRef, connection, pause]);
  useEffect(() => {
    const runtime = runtimeRef.current;
    runtime?.setAppearance(settings.appearance);
    runtime?.setMuted(settings.muted);
    runtime?.setAudioVolumes(settings.audio);
    runtime?.setFeedback(settings.feedback);
    runtime?.setReducedMotion(settings.reducedMotion);
    runtime?.setGraphics(settings.graphics);
    runtime?.setControls(settings.controls);
  }, [settings]);
  useEffect(() => {
    if (snapshot.phase !== 'playing' || snapshot.status !== 'connected') pause();
  }, [snapshot.phase, snapshot.status, pause]);
  useEffect(() => {
    if (!snapshot.code) return;
    setCode(snapshot.code);
    const url = new URL(location.href);
    url.searchParams.set('room', snapshot.code);
    url.searchParams.delete('online');
    history.replaceState(null, '', url);
  }, [snapshot.code]);

  const act = async (action: () => void | Promise<unknown>) => {
    if (working) return;
    setWorking(true); setActionError(null); connection.clearError();
    try { await action(); }
    catch (reason) { if (!disposed.current) setActionError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { if (!disposed.current) setWorking(false); }
  };
  const connect = (join: boolean) => void act(async () => {
    const name = nickname.trim();
    if (!name) throw new Error('Enter a nickname first.');
    try { sessionStorage.setItem('burnhop-nickname', name); } catch { /* Guest play does not require storage. */ }
    if (join) await connection.join(code.trim(), name, settings.appearance);
    else await connection.create(name, settings.appearance);
  });
  const leave = () => void act(async () => {
    pause();
    await connection.leave();
    onBack();
  });
  const resume = () => {
    const capture = captureRef.current;
    if (!capture || !runtimeRef.current || !runtimeReady || !active || working || snapshot.phase !== 'playing' || snapshot.status !== 'connected') return;
    const attempt = ++captureAttempt.current;
    setWorking(true); setActionError(null);
    void capture.enter().then(() => {
      if (disposed.current || captureAttempt.current !== attempt || !capture.isActive()) return;
      runtimeRef.current?.resume();
      setPaused(false); setShowSettings(false); onActiveChange(true); canvasRef.current?.focus();
    }).catch(reason => setActionError(reason instanceof Error ? reason.message : 'Mouse capture was interrupted. Please retry.'))
      .finally(() => { if (!disposed.current) setWorking(false); });
  };
  const copyInvite = () => void act(async () => {
    const invite = new URL('https://burnhop.lowhp.studio/');
    invite.searchParams.set('room', snapshot.code);
    try { await navigator.clipboard.writeText(invite.href); setCopied(true); }
    catch { throw new Error('Clipboard unavailable. Select and copy the invite link below.'); }
  });

  const me = snapshot.players.find(player => player.id === snapshot.sessionId);
  const host = snapshot.players.find(player => player.id === snapshot.hostId);
  const connectedPlayers = snapshot.players.filter(player => player.connected);
  const isHost = snapshot.hostId === snapshot.sessionId;
  const joined = Boolean(snapshot.sessionId);
  const isPlaying = snapshot.phase === 'playing';
  const results = snapshot.phase === 'results';
  const error = actionError ?? snapshot.error;
  const standings = [...snapshot.players].sort((a, b) => b.kills - a.kills || a.joinedOrder - b.joinedOrder);
  const allReady = connectedPlayers.length >= 2 && connectedPlayers.every(player => player.ready);
  const winnerNames = snapshot.winnerIds.map(id => snapshot.players.find(player => player.id === id)?.nickname ?? 'Departed player');
  const unavailable = !import.meta.env.VITE_COLYSEUS_URL;

  if (isPlaying) return <main className="game-screen online-game" data-testid="online-match">
    <CombatFeedback health={hud.health} damagePulse={hud.damageSequence ?? 0} killPulse={hud.killSequence ?? 0}
      reducedMotion={settings.reducedMotion} intensity={settings.feedback.intensity}
      active={!paused && active && snapshot.status === 'connected'} />
    <div className="hud-layer" inert={paused || !active} aria-hidden={paused || !active}>
      <button className="pause-trigger" aria-label="Open match menu" onClick={pause}><span aria-hidden="true">Ⅱ</span><kbd>ESC</kbd></button>
      <span className="arena-readout">Outpost · Free-for-all</span>
      <div className="online-clock" aria-label="Time remaining">{clock(snapshot.remainingTicks)}</div>
      <CombatHud hud={hud} />
      <span className="zoom-readout" title="Higher values show more arena">View range {viewRange}×</span>
      <div className="online-score-mini" aria-label="Match score"><b>{me?.kills ?? 0}</b> KILLS <span>/</span> <b>{me?.deaths ?? 0}</b> DEATHS</div>
      {me && me.health === 0 && <div className="online-respawn" role="status">{me.connected ? `Respawning in ${Math.max(1, Math.ceil(me.respawnTicks / 60))}…` : 'Waiting to reconnect…'}</div>}
      {me && me.health > 0 && me.protectionTicks > 0 && <div className="online-protection">SPAWN PROTECTION · ATTACKING ENDS IT</div>}
      <span className="fps-readout">{fps === null ? '—' : Math.round(fps)} FPS</span>
    </div>
    {paused && <div className="pause-backdrop">
      {showSettings ? <SettingsScreen embedded active={active} settings={settings} onChange={onChangeSettings} storageAvailable={storageAvailable} onClose={() => setShowSettings(false)} /> : <section className="online-panel online-match-menu" role="dialog" aria-modal="true" aria-labelledby="online-pause-title">
        <p className="eyebrow">OUTPOST · {clock(snapshot.remainingTicks)} REMAINING</p>
        <h1 id="online-pause-title">{snapshot.status === 'reconnecting' ? 'RECONNECTING' : 'MATCH CONTINUES'}</h1>
        <KeyboardCaptureNotice status={keyboardStatus} onRetry={onRetryKeyboard} />
        <p>{snapshot.status === 'reconnecting' ? 'Your slot is reserved for 30 seconds. Reconnecting automatically…' : 'You are still in the match while this menu is open.'}</p>
        {error && <p className="capture-error" role="alert">{error}</p>}
        <table className="online-standings"><thead><tr><th>Pilot</th><th>Kills</th><th>Deaths</th></tr></thead><tbody>{standings.map(player => <tr key={player.id} data-self={player.id === snapshot.sessionId}><td>{player.nickname}{!player.connected && <small> Reconnecting</small>}</td><td>{player.kills}</td><td>{player.deaths}</td></tr>)}</tbody></table>
        {assetError && <p className="capture-error" role="alert">{assetError} <button className="text-button" onClick={prepareAssets}>Retry loading Outpost</button></p>}
        <button className="button button-amber" disabled={working || !runtimeReady || snapshot.status !== 'connected'} onClick={resume}>{!runtimeReady ? `Loading Outpost ${Math.round(progress * 100)}%` : working ? 'Capturing mouse…' : 'Enter match'}</button>
        <button className="menu-option" onClick={() => setShowSettings(true)}>Settings & controls <span>↗</span></button>
        <button className="menu-option" onClick={leave} disabled={working} aria-label="Leave match">Leave match <span aria-hidden="true">←</span></button>
      </section>}
    </div>}
  </main>;

  return <main className="online-screen" data-testid="multiplayer-screen">
    <header className="online-header"><button className="text-button" onClick={joined ? leave : onBack} disabled={working}>← {joined ? 'Leave room' : 'Main menu'}</button><span>BURNHOP <i>/</i> MULTIPLAYER</span><span>FRANKFURT</span></header>
    <div className="online-content">
      <KeyboardCaptureNotice status={keyboardStatus} onRetry={onRetryKeyboard} />
      <div className="online-heading"><p className="eyebrow">{results ? 'MATCH COMPLETE' : joined ? 'PRIVATE ROOM' : 'YOUR FRIENDS. ONE OUTPOST.'}</p><h1>{results ? (snapshot.winnerIds.length > 1 ? 'DRAW' : 'MATCH RESULTS') : joined ? 'OUTPOST' : 'SQUAD UP.\nSPLIT UP.'}</h1><p>{results ? (winnerNames.length ? `${winnerNames.join(' & ')} ${winnerNames.length > 1 ? 'share the win.' : 'wins.'}` : 'Match complete.') : 'Free-for-all · 2–8 pilots · 5 minutes'}</p></div>
      {error && <p className="capture-error" role="alert">{error}</p>}
      {recovering && <p role="status">Checking your previous session…</p>}
      {snapshot.status === 'reconnecting' && <p className="online-notice" role="status">Connection interrupted. Your slot is reserved for 30 seconds; retrying automatically.</p>}
      {!joined ? <section className="online-entry online-panel" aria-label="Create or join a private match">
        <div className="online-entry-pilot"><Pilot appearance={settings.appearance} assets={assets} name="Your" /><small>Your equipped pilot</small></div>
        <div className="online-entry-form">
          {unavailable && <p className="online-notice" role="status">Multiplayer is unavailable on this deployment. Solo practice is ready in the main menu.</p>}
          <label htmlFor="online-nickname">Nickname</label><input id="online-nickname" autoComplete="nickname" maxLength={20} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="Your callsign" />
          <button className="button button-amber" disabled={working || recovering || unavailable || !nickname.trim()} onClick={() => connect(false)}>{working ? 'Connecting…' : 'Create private room'}</button>
          <div className="online-divider"><span>OR JOIN A FRIEND</span></div>
          <label htmlFor="online-code">Invitation code</label><input id="online-code" autoCapitalize="none" spellCheck={false} maxLength={80} value={code} onChange={event => setCode(event.target.value)} placeholder="Paste your invitation code" />
          <button className="button online-secondary" disabled={working || recovering || unavailable || !nickname.trim() || !code.trim()} onClick={() => connect(true)}>Join room</button>
          <p className="online-fineprint">Guest session. No account needed. Scores last for this match.</p>
        </div>
      </section> : <>
        {!results && <section className="online-invite" aria-label="Room invitation"><div><span className="eyebrow">INVITE YOUR FRIENDS</span><input readOnly aria-label="Invite link" value={`https://burnhop.lowhp.studio/?room=${snapshot.code}`} onFocus={event => event.target.select()} /><span className="online-code">Code: {snapshot.code}</span></div><button className="button online-secondary" onClick={copyInvite}>{copied ? 'Copied ✓' : 'Copy invite'}</button></section>}
        <section className="online-roster" aria-label="Players in room">{snapshot.players.map(player => <article className="online-player" key={player.id} data-self={player.id === snapshot.sessionId} data-connected={player.connected}>
          <div className="online-player-top"><span>{player.id === snapshot.hostId ? 'HOST' : player.id === snapshot.sessionId ? 'YOU' : 'PILOT'}</span><span className={player.connected && player.ready ? 'is-ready' : ''}>{!player.connected ? 'RECONNECTING' : results ? `${player.kills} K / ${player.deaths} D` : player.ready ? 'READY' : 'NOT READY'}</span></div>
          <Pilot appearance={player.appearance} assets={assets} name={player.nickname} /><h2>{player.nickname}</h2>
        </article>)}{!results && Array.from({ length: Math.max(0, 8 - snapshot.players.length) }, (_, index) => <article className="online-empty" key={`empty-${index}`} aria-label="Open player slot"><span>+</span><small>OPEN SLOT</small></article>)}</section>
        <footer className="online-lobby-footer"><div><b>{results ? 'Ready for another round?' : snapshot.phase === 'countdown' ? `STARTING IN ${Math.ceil(snapshot.countdownTicks / 60)}` : `${connectedPlayers.length} / 8 PILOTS CONNECTED`}</b><p>{results ? 'The host can return everyone to the lobby.' : snapshot.phase === 'countdown' ? 'Get ready. New joins are closed.' : connectedPlayers.length < 2 ? 'Invite at least one friend to begin.' : allReady ? `${host?.nickname ?? 'The host'} can start the match.` : 'Every connected pilot must mark ready before the host starts.'}</p></div>
          <div className="online-lobby-actions">{results ? isHost && <button className="button button-amber" disabled={working} onClick={() => void act(() => connection.rematch())}>Return everyone to lobby</button> : <>
            <button className={`button ${me?.ready ? 'online-secondary' : 'button-amber'}`} disabled={!assets || working || snapshot.status !== 'connected'} onClick={() => void act(() => connection.ready(!me?.ready))}>{!assets ? `Loading Outpost ${Math.round(progress * 100)}%` : me?.ready ? 'Not ready' : 'Mark ready'}</button>
            {isHost && <button className="button online-secondary" disabled={!allReady || working || snapshot.phase === 'countdown' || snapshot.status !== 'connected'} onClick={() => void act(() => connection.startMatch())}>Start match</button>}
          </>}</div>
        </footer>
      </>}
      {assetError && <p className="capture-error" role="alert">{assetError} <button className="text-button" onClick={prepareAssets}>Retry loading Outpost</button></p>}
    </div>
  </main>;
}
