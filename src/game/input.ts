import { ACTIONS, behaviorFor, defaultControls, normalizeControls, type ActionId, type Binding, type ControlsSettings } from './controls';
import type { GameEvent, InputCommand, PlayerState } from './types';

/** Browser-independent action state. Physical keys, toggle intent and tick pulses are separate. */
export class ActionInput {
  private controls: ControlsSettings;
  private held = new Set<Binding>();
  private toggled = new Set<ActionId>();
  private direction: -1 | 0 | 1 = 0;
  private jumpPressed = false;
  private jetPressed = false;
  private reloadPressed = false;

  constructor(controls = defaultControls()) { this.controls = normalizeControls(controls); }
  configure(controls: ControlsSettings): void { this.controls = normalizeControls(controls); this.clear(); }
  clear(): void {
    this.held.clear(); this.toggled.clear(); this.direction = 0;
    this.jumpPressed = false; this.jetPressed = false; this.reloadPressed = false;
  }
  actionsFor(binding: Binding): ActionId[] {
    if (binding === 'Escape') return ['pause'];
    return ACTIONS.filter(({ id }) => !(id === 'jetpack' && this.controls.jetpackSource === 'combined') && this.controls.bindings[id].includes(binding)).map(({ id }) => id);
  }
  isBound(binding: Binding): boolean { return this.actionsFor(binding).length > 0; }
  physicalHeld(action: ActionId): boolean { return this.controls.bindings[action].some(binding => binding !== null && this.held.has(binding)); }
  active(action: ActionId): boolean {
    const behavior = behaviorFor(action);
    if (behavior && this.controls.behavior[behavior] === 'toggle') {
      if (action === 'moveLeft') return this.direction === -1;
      if (action === 'moveRight') return this.direction === 1;
      return this.toggled.has(action);
    }
    return this.physicalHeld(action === 'jetpack' && this.controls.jetpackSource === 'combined' ? 'jump' : action);
  }
  get aimMode() {
    return this.active('aimSwitch') ? this.controls.defaultAimMode === 'radial' ? 'pointer' : 'radial' : this.controls.defaultAimMode;
  }
  press(binding: Binding): ActionId[] {
    if (this.held.has(binding)) return [];
    this.held.add(binding);
    const actions = this.actionsFor(binding);
    for (const action of actions) {
      if (action === 'jump') {
        if (this.controls.jetpackSource === 'combined') {
          const on = this.activateJet();
          if (on) this.jumpPressed = true;
        } else this.jumpPressed = true;
      } else if (action === 'jetpack') this.activateJet();
      else if (action === 'reload') this.reloadPressed = true;
      else {
        const behavior = behaviorFor(action);
        if (behavior && this.controls.behavior[behavior] === 'toggle') {
          if (action === 'moveLeft' || action === 'moveRight') {
            const next = action === 'moveLeft' ? -1 : 1;
            this.direction = this.direction === next ? 0 : next;
          } else if (this.toggled.has(action)) this.toggled.delete(action);
          else this.toggled.add(action);
        }
      }
    }
    return actions;
  }
  private activateJet(): boolean {
    if (this.controls.behavior.jetpack === 'toggle') {
      if (this.toggled.has('jetpack')) {
        this.toggled.delete('jetpack'); this.jetPressed = false; return false;
      }
      this.toggled.add('jetpack');
    }
    this.jetPressed = true;
    return true;
  }
  release(binding: Binding): void { this.held.delete(binding); }
  snapshot(): Pick<InputCommand, 'moveX' | 'jumpPressed' | 'jumpHeld' | 'crouchHeld' | 'fireHeld' | 'reloadPressed' | 'jetpack'> {
    return {
      moveX: (Number(this.active('moveRight')) - Number(this.active('moveLeft'))) as -1 | 0 | 1,
      jumpPressed: this.jumpPressed, jumpHeld: this.physicalHeld('jump'),
      crouchHeld: this.active('crouch'), fireHeld: this.active('fire'), reloadPressed: this.reloadPressed,
      jetpack: { source: this.controls.jetpackSource, pressed: this.jetPressed, held: this.active('jetpack') },
    };
  }
  consumeTick(): ReturnType<ActionInput['snapshot']> {
    const command = this.snapshot();
    this.jumpPressed = false; this.jetPressed = false; this.reloadPressed = false;
    return command;
  }
  reconcile(player: PlayerState, events: GameEvent[]): void {
    if (this.controls.behavior.jetpack !== 'toggle') return;
    const combined = this.controls.jetpackSource === 'combined';
    if (player.fuel <= 0 || events.some(event => event.type === 'land' || (combined && event.type === 'jump'))
      || (!player.thrustLatched && !(combined && player.jumpBufferTicks > 0))) this.toggled.delete('jetpack');
  }
}
