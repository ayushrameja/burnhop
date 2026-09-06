import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CombatFeedback from '../../src/CombatFeedback';
import { GameAudio } from '../../src/game/audio';

/** Test-only host: exercise real component/audio contracts without mutating a game runtime. */
function FeedbackFixture() {
  const [audio] = useState(() => new GameAudio());
  const [state, setState] = useState({ health: 100, damagePulse: 0, killPulse: 0 });
  const [diagnostics, setDiagnostics] = useState(audio.getDiagnostics());
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => () => audio.destroy(), [audio]);
  async function lowHealth() {
    await audio.unlock();
    audio.setHeartbeat(true, 20);
    setState(current => ({ ...current, health: 20 }));
    setDiagnostics(audio.getDiagnostics());
  }
  function lethalTrade() {
    audio.setHeartbeat(true, 0);
    setState(current => ({ health: 0, damagePulse: current.damagePulse + 1, killPulse: current.killPulse + 1 }));
    setDiagnostics(audio.getDiagnostics());
  }
  return <>
    <main style={{ position: 'relative', zIndex: 2, width: 'min(80%, 520px)', margin: '20vh auto', textAlign: 'center', overflowWrap: 'anywhere' }}>
      <h1>Feedback preview</h1>
      <p>Health: <output data-testid="health">{state.health}</output></p>
      <button onClick={lowHealth}>Enter low health</button>{' '}
      <button onClick={lethalTrade}>Lethal hit and credited trade kill</button>
      <p>Audio state: <output data-testid="feedback-audio">{JSON.stringify(diagnostics)}</output></p>
      <p>The central playfield remains clear.</p>
    </main>
    <CombatFeedback {...state} reducedMotion={reducedMotion} />
  </>;
}

createRoot(document.getElementById('root')!).render(<FeedbackFixture />);
