import type { HudState, PlayerState, WeaponState } from './types';
import { getReloadProgress } from './reload';
import { WEAPONS } from './weapons';

export function getCombatHud(player:PlayerState,stats:Partial<Pick<HudState,'shotsFired'|'hits'|'kills'|'targetHealth'>>={}):HudState{
  const weaponHud=(weapon:WeaponState)=>({weaponId:weapon.weaponId,ammo:weapon.ammo,magazineSize:WEAPONS[weapon.weaponId].magazineSize,
    reserve:weapon.reserve,reloadProgress:getReloadProgress(weapon.reloadTicks,WEAPONS[weapon.weaponId].reloadTicks)});
  return {health:player.health,fuel:player.fuel,...weaponHud(player.weapon),offhand:player.offhand?weaponHud(player.offhand):null,
    shotsFired:stats.shotsFired??0,hits:stats.hits??0,kills:stats.kills??0,targetHealth:stats.targetHealth??0};
}
function sameOffhand(a:HudState['offhand'],b:HudState['offhand']):boolean{
  if(!a||!b)return a==null && b==null;
  return a.weaponId===b.weaponId && a.ammo===b.ammo && a.magazineSize===b.magazineSize && a.reserve===b.reserve
    && Math.round(a.reloadProgress*100)===Math.round(b.reloadProgress*100) && (a.reloadProgress>=0)===(b.reloadProgress>=0);
}

/** Avoid React commits when none of the displayed values has changed. */
export function retainHud(previous: HudState, next: HudState): HudState {
  if (previous.health === next.health && Math.ceil(previous.fuel) === Math.ceil(next.fuel)
    && Math.ceil(previous.fuel * .12) === Math.ceil(next.fuel * .12)
    && (previous.fuel < 20) === (next.fuel < 20) && (previous.fuel <= 0) === (next.fuel <= 0)
    && previous.ammo === next.ammo && Math.round(previous.reloadProgress * 100) === Math.round(next.reloadProgress * 100)
    && (previous.reloadProgress >= 0) === (next.reloadProgress >= 0)
    && previous.shotsFired === next.shotsFired && previous.hits === next.hits && previous.kills === next.kills
    && previous.targetHealth === next.targetHealth && previous.weaponId===next.weaponId && previous.magazineSize===next.magazineSize
    && previous.reserve===next.reserve && sameOffhand(previous.offhand,next.offhand)
    && previous.pickupPrompt===next.pickupPrompt && previous.sniperWarning===next.sniperWarning
    && previous.damageSequence===next.damageSequence && previous.killSequence===next.killSequence) return previous;
  return next;
}
