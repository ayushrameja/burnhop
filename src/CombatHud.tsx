import type { HudState, WeaponId } from './game/types';
import { WEAPONS } from './game/weapons';
import { WEAPON_SILHOUETTES } from './game/weaponArtwork';
import './CombatHud.css';

const percentage = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const FUEL_SEGMENTS = Array.from({ length: 12 }, (_, index) => {
  const point = (angle: number) => ({ x: 40 + Math.cos(angle) * 31, y: 40 + Math.sin(angle) * 31 });
  const from = point((138 + index * 22) * Math.PI / 180), to = point((155 + index * 22) * Math.PI / 180);
  return `M${from.x} ${from.y} A31 31 0 0 1 ${to.x} ${to.y}`;
});
function FuelGauge({ fuel }: { fuel: number }) {
  return <svg className="pilot-fuel-gauge" aria-hidden="true" viewBox="0 0 80 80" fill="none">
    {FUEL_SEGMENTS.map((path, index) => <path key={index} className="pilot-fuel-segment" data-filled={fuel > index * 100 / 12} d={path} />)}
    <path className="pilot-jetpack" d="M29 26h8v23h-8zm14 0h8v23h-8zM37 30h6v15h-6zM31 21h4v5h-4zm14 0h4v5h-4z" />
    <path d="m30 53 3 8 3-8m8 0 3 8 3-8" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
  </svg>;
}

function WeaponIcon({weaponId}:{weaponId:WeaponId}) {
  return <svg className="ammo-weapon-icon" aria-hidden="true" viewBox="-21 -15 68 33" fill="currentColor">
    <path d={WEAPON_SILHOUETTES[weaponId]} />
    {weaponId!=='revolver' && <path d={weaponId==='pistol'?'M3 7h4v7H2z':weaponId==='uzi'?'M3 7h5v11H3z':'M9 4h6l1 11-6 1z'}/>}
  </svg>;
}

function AmmoRow({weaponId,ammo,magazineSize,reserve,reloadProgress,offhand=false}:{weaponId:WeaponId;ammo:number;magazineSize:number;reserve:number;reloadProgress:number;offhand?:boolean}){
  ammo=Math.max(0,Math.min(magazineSize,Math.round(ammo)));
  const reloading=reloadProgress>=0,progress=Math.max(0,Math.min(1,reloadProgress));
  const warning=ammo===0?(reserve===0?'OUT OF AMMO':'RELOAD REQUIRED'):ammo<=Math.max(2,Math.floor(magazineSize*.2))?'LOW AMMO':'';
  return <div className="ammo-row" data-hand={offhand?'offhand':'main'} data-ammo-warning={Boolean(warning)&&!reloading} data-reloading={reloading}>
    <div className="ammo-heading"><span className="combat-hud-label">{offhand?'OFF HAND':'MAIN HAND'}</span><WeaponIcon weaponId={weaponId}/></div>
    <div className="ammo-magazine" role="group" aria-label={`${WEAPONS[weaponId].name}: ${ammo} rounds remaining, ${magazineSize} round magazine capacity`}>
      <b className="ammo-rounds" data-testid={offhand?'hud-offhand-ammo':'hud-ammo'}>{ammo.toString().padStart(2,'0')}</b>
      <span className="ammo-divider" aria-hidden="true">/</span>
      <div className="ammo-capacity"><span>{magazineSize}</span><small>MAG SIZE</small></div>
      <div className="ammo-reserve" aria-label={reserve<0?'Unlimited reserve':`${reserve} reserve rounds`}><b>{reserve<0?'∞':reserve}</b><small>RESERVE</small></div>
    </div>
    <div className="ammo-footer"><span className="ammo-weapon-name">{WEAPONS[weaponId].name}</span><span className="ammo-state" role="status">{reloading?'RELOADING':warning}</span></div>
    <div className="ammo-progress" role={reloading?'progressbar':undefined} aria-label={reloading?(offhand?'Offhand reloading':'Reloading'):undefined}
      aria-valuenow={reloading?Math.round(progress*100):undefined} aria-valuemin={reloading?0:undefined} aria-valuemax={reloading?100:undefined}>
      <div style={{width:`${reloading?progress*100:ammo/magazineSize*100}%`}}/>
    </div>
  </div>;
}

/** Two edge clusters keep fuel, health and magazine state out of the aiming area. */
export default function CombatHud({ hud }: { hud: HudState }) {
  // Reserve 0% for an empty tank; a usable fraction must not look depleted.
  const fuel = Math.max(0, Math.min(100, Math.ceil(hud.fuel)));
  const health = percentage(hud.health);
  const fuelWarning = hud.fuel <= 0 ? 'FUEL EMPTY' : hud.fuel < 20 ? 'LOW FUEL' : '';
  const weaponId=hud.weaponId??'pistol';

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

    <section className="combat-hud burnhop-ammo-hud" aria-label="Ammunition" data-dual={Boolean(hud.offhand)}>
      <AmmoRow weaponId={weaponId} ammo={hud.ammo} magazineSize={hud.magazineSize??WEAPONS[weaponId].magazineSize} reserve={hud.reserve??-1} reloadProgress={hud.reloadProgress}/>
      {hud.offhand && <AmmoRow {...hud.offhand} offhand/>}
    </section>
    {hud.pickupPrompt && <div className="combat-pickup-prompt" role="status">{hud.pickupPrompt}</div>}
    {hud.sniperWarning && <div className="combat-sniper-warning" role="status"><span aria-hidden="true">↓</span>{hud.sniperWarning}</div>}
  </>;
}
