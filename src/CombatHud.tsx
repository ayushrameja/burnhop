import type { HudState } from './game/types';
import './CombatHud.css';

const MAGAZINE_CAPACITY = 30;
const percentage = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function FuelGauge({ fuel }: { fuel: number }) {
  const segments = 12;
  const point = (angle: number) => ({ x: 40 + Math.cos(angle) * 31, y: 40 + Math.sin(angle) * 31 });
  return <svg className="pilot-fuel-gauge" aria-hidden="true" viewBox="0 0 80 80" fill="none">
    {Array.from({ length: segments }, (_, index) => {
      const from = point((138 + index * 22) * Math.PI / 180);
      const to = point((155 + index * 22) * Math.PI / 180);
      return <path key={index} className="pilot-fuel-segment" data-filled={fuel > index * 100 / segments}
        d={`M${from.x} ${from.y} A31 31 0 0 1 ${to.x} ${to.y}`} />;
    })}
    <path className="pilot-jetpack" d="M29 26h8v23h-8zm14 0h8v23h-8zM37 30h6v15h-6zM31 21h4v5h-4zm14 0h4v5h-4z" />
    <path d="m30 53 3 8 3-8m8 0 3 8 3-8" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
  </svg>;
}

function RifleIcon() {
  return <svg className="ammo-weapon-icon" aria-hidden="true" viewBox="0 0 100 34" fill="currentColor">
    <path d="M3 13h17l6-5h37v4h20v3h14v4H80v3H58l-5 9H42l3-12h-8l-6 9h-8l4-10H17l-5 5H3V13Z" />
    <path d="M35 3h18v4H35zM65 9h5v5h-5z" />
    <path d="M33 12h22v2H33zM61 16h16v2H61z" fill="#151b1f" />
  </svg>;
}

/** Two edge clusters keep fuel, health and magazine state out of the aiming area. */
export default function CombatHud({ hud }: { hud: HudState }) {
  // Reserve 0% for an empty tank; a usable fraction must not look depleted.
  const fuel = Math.max(0, Math.min(100, Math.ceil(hud.fuel)));
  const health = percentage(hud.health);
  const ammo = Math.max(0, Math.min(MAGAZINE_CAPACITY, Math.round(hud.ammo)));
  const fuelWarning = hud.fuel <= 0 ? 'FUEL EMPTY' : hud.fuel < 20 ? 'LOW FUEL' : '';
  const reloading = hud.reloadProgress >= 0;
  const reloadProgress = Math.max(0, Math.min(1, hud.reloadProgress));
  const ammoWarning = ammo === 0 ? 'RELOAD REQUIRED' : ammo <= 5 ? 'LOW AMMO' : '';

  return <>
    <section className="pilot-hud" aria-label="Jet fuel and health" data-fuel-warning={Boolean(fuelWarning)}>
      <div className="pilot-fuel" role="meter" aria-label="Jet fuel" aria-valuenow={fuel} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${fuel}%${fuelWarning ? ` · ${fuelWarning.toLowerCase()}` : ''}`}>
        <FuelGauge fuel={hud.fuel} />
        <div className="pilot-fuel-copy">
          <span className="combat-hud-label">JET FUEL</span>
          <div className="pilot-fuel-amount"><b data-testid="hud-fuel">{fuel}</b><span>%</span></div>
          <span className="pilot-fuel-warning">{fuelWarning}</span>
        </div>
      </div>
      <div className="pilot-health" role="meter" aria-label="Health" aria-valuenow={health} aria-valuemin={0} aria-valuemax={100}>
        <div className="pilot-health-copy">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5.5 1.5h5v4h4v5h-4v4h-5v-4h-4v-5h4z" fill="currentColor" /></svg>
          <span>HEALTH</span><b data-testid="hud-health">{health}</b>
        </div>
        <div className="pilot-health-track" aria-hidden="true"><div style={{ width: `${health}%` }} /></div>
      </div>
    </section>

    <section className="combat-hud burnhop-ammo-hud" aria-label="Ammunition" data-ammo-warning={Boolean(ammoWarning) && !reloading} data-reloading={reloading}>
      <div className="ammo-heading"><span className="combat-hud-label">AMMO</span><RifleIcon /></div>
      <div className="ammo-magazine" role="group" aria-label={`${ammo} rounds remaining, ${MAGAZINE_CAPACITY} round magazine capacity`}>
        <b className="ammo-rounds" data-testid="hud-ammo">{ammo.toString().padStart(2, '0')}</b>
        <span className="ammo-divider" aria-hidden="true">/</span>
        <div className="ammo-capacity"><span>{MAGAZINE_CAPACITY}</span><small>MAG SIZE</small></div>
      </div>
      <div className="ammo-footer"><span className="ammo-weapon-name">AR–01</span><span className="ammo-state" role="status">{reloading ? 'RELOADING' : ammoWarning}</span></div>
      <div className="ammo-progress" role={reloading ? 'progressbar' : undefined} aria-label={reloading ? 'Reloading' : undefined}
        aria-valuenow={reloading ? Math.round(reloadProgress * 100) : undefined} aria-valuemin={reloading ? 0 : undefined} aria-valuemax={reloading ? 100 : undefined}>
        <div style={{ width: `${reloading ? reloadProgress * 100 : ammo / MAGAZINE_CAPACITY * 100}%` }} />
      </div>
    </section>
  </>;
}
