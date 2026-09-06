import type { AimMode } from './aim';

export const ACTIONS = [
  { id: 'moveLeft', label: 'Move left' }, { id: 'moveRight', label: 'Move right' },
  { id: 'crouch', label: 'Crouch' }, { id: 'jump', label: 'Jump' },
  { id: 'jetpack', label: 'Jetpack' }, { id: 'fire', label: 'Fire' },
  { id: 'aimSwitch', label: 'Switch aim style' }, { id: 'reload', label: 'Reload' },
  { id: 'zoom', label: 'Cycle view range' }, { id: 'pickup', label: 'Equip weapon alone' },
  { id: 'pair', label: 'Pair weapon' }, { id: 'punch', label: 'Punch' }, { id: 'pause', label: 'Pause' },
] as const;
export type ActionId = typeof ACTIONS[number]['id'];
export type Binding = string;
export type BindingSlot = 0 | 1;
export type ActionBehavior = 'hold' | 'toggle';
export type BehaviorId = 'movement' | 'crouch' | 'jetpack' | 'fire' | 'aimSwitch';
export interface ControlsSettings {
  bindings: Record<ActionId, [Binding | null, Binding | null]>;
  behavior: Record<BehaviorId, ActionBehavior>;
  jetpackSource: 'combined' | 'separate';
  defaultAimMode: AimMode;
}
export interface BindingChange { action: ActionId; slot: BindingSlot; from: Binding | null; to: Binding | null }
export interface BindingProposal { controls: ControlsSettings; changes: BindingChange[]; conflict: boolean }

export function defaultControls(): ControlsSettings {
  return {
    bindings: {
      moveLeft: ['KeyA', null], moveRight: ['KeyD', null], crouch: ['KeyC', 'ArrowDown'],
      jump: ['Space', null], jetpack: ['ShiftLeft', 'ShiftRight'], fire: ['Mouse0', null],
      aimSwitch: ['Mouse2', null], reload: ['KeyR', null], zoom: ['Tab', null],
      pickup: ['KeyF', null], pair: ['KeyQ', null], punch: ['KeyE', null], pause: [null, null],
    },
    behavior: { movement: 'hold', crouch: 'hold', jetpack: 'hold', fire: 'hold', aimSwitch: 'hold' },
    jetpackSource: 'separate', defaultAimMode: 'pointer',
  };
}

/** Physical key codes keep movement positions consistent across keyboard layouts. */
export function isBinding(value: unknown): value is Binding {
  return typeof value === 'string' && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|F([124-9]|1[0-2])|Mouse[0-4])$/.test(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeControls(value: unknown): ControlsSettings {
  const next = defaultControls(), source = record(value), bindings = record(source.bindings), behavior = record(source.behavior);
  for (const { id } of ACTIONS) {
    const pair = bindings[id];
    if (Array.isArray(pair)) {
      for (const slot of [0, 1] as const) {
        if (pair[slot] === null || isBinding(pair[slot])) next.bindings[id][slot] = pair[slot];
      }
    }
  }
  // A malformed save must never give one press several unrelated actions. Explicit valid
  // assignments win over fallback defaults, so a remapped primary survives partial saves.
  const used = new Set<string>();
  const slots = ACTIONS.flatMap(({ id }) => ([0, 1] as const).map(slot => ({ id, slot,
    explicit: Array.isArray(bindings[id]) && isBinding((bindings[id] as unknown[])[slot]),
  }))).sort((a, b) => Number(b.explicit) - Number(a.explicit));
  for (const { id, slot } of slots) {
    const binding = next.bindings[id][slot];
    if (binding && used.has(binding)) next.bindings[id][slot] = null;
    else if (binding) used.add(binding);
  }
  for (const id of Object.keys(next.behavior) as BehaviorId[]) {
    if (behavior[id] === 'hold' || behavior[id] === 'toggle') next.behavior[id] = behavior[id];
  }
  if (source.jetpackSource === 'separate' || source.jetpackSource === 'combined') next.jetpackSource = source.jetpackSource;
  if (source.defaultAimMode === 'pointer' || source.defaultAimMode === 'radial') next.defaultAimMode = source.defaultAimMode;
  return next;
}

export function bindingLabel(binding: Binding | null): string {
  if (!binding) return 'Unbound';
  const names: Record<string, string> = { Mouse0: 'Left mouse', Mouse1: 'Middle mouse', Mouse2: 'Right mouse', Mouse3: 'Mouse back', Mouse4: 'Mouse forward',
    Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
  return names[binding] ?? binding.replace(/^Key|^Digit/, '').replace(/(Left|Right)$/, ' $1').replace(/^Numpad/, 'Num ');
}

export function actionBindings(controls: ControlsSettings, action: ActionId): Binding[] {
  if (action === 'jetpack' && controls.jetpackSource === 'combined') action = 'jump';
  const bindings = controls.bindings[action].filter((binding): binding is Binding => binding !== null);
  return action === 'pause' ? ['Escape', ...bindings] : bindings;
}

export function behaviorFor(action: ActionId): BehaviorId | null {
  if (action === 'moveLeft' || action === 'moveRight') return 'movement';
  return action === 'crouch' || action === 'jetpack' || action === 'fire' || action === 'aimSwitch' ? action : null;
}

function changesBetween(before: ControlsSettings, after: ControlsSettings): BindingChange[] {
  return ACTIONS.flatMap(({ id }) => ([0, 1] as const).flatMap(slot => before.bindings[id][slot] === after.bindings[id][slot] ? [] :
    [{ action: id, slot, from: before.bindings[id][slot], to: after.bindings[id][slot] }]));
}

export function proposeBinding(controls: ControlsSettings, action: ActionId, slot: BindingSlot, binding: Binding | null): BindingProposal {
  const next = normalizeControls(controls);
  if (binding !== null && !isBinding(binding)) return { controls: next, changes: [], conflict: false };
  const previous = next.bindings[action][slot];
  if (previous === binding) return { controls: next, changes: [], conflict: false };
  let conflict = false;
  if (binding) for (const { id } of ACTIONS) for (const otherSlot of [0, 1] as const) {
    if (next.bindings[id][otherSlot] === binding) {
      next.bindings[id][otherSlot] = previous;
      conflict = id !== action;
    }
  }
  next.bindings[action][slot] = binding;
  return { controls: next, changes: changesBetween(controls, next), conflict };
}

export function resetActionControls(controls: ControlsSettings, action: ActionId): BindingProposal {
  // In combined mode the visible bindings belong to Jump. Reset only the jet
  // behavior, leaving both Jump and the inactive separate binding untouched.
  if (action === 'jetpack' && controls.jetpackSource === 'combined') {
    const next = normalizeControls(controls);
    next.behavior.jetpack = 'hold';
    return { controls: next, changes: [], conflict: false };
  }
  const defaults = defaultControls();
  let next = controls, conflict = false;
  for (const slot of [0, 1] as const) {
    const result = proposeBinding(next, action, slot, defaults.bindings[action][slot]);
    next = result.controls;
    conflict ||= result.conflict;
  }
  const behavior = behaviorFor(action);
  if (behavior) next.behavior[behavior] = 'hold';
  return { controls: next, changes: changesBetween(controls, next), conflict };
}

export function controlHelp(controls: ControlsSettings): { action: ActionId; keys: string[]; description: string }[] {
  const verb = (id: BehaviorId) => controls.behavior[id] === 'hold' ? 'Hold' : 'Toggle';
  const alternate = controls.defaultAimMode === 'radial' ? 'crosshair' : 'aim line';
  return [
    { action: 'moveLeft', keys: [...actionBindings(controls, 'moveLeft'), ...actionBindings(controls, 'moveRight')].map(bindingLabel), description: `${verb('movement')} to move` },
    { action: 'crouch', keys: actionBindings(controls, 'crouch').map(bindingLabel), description: `${verb('crouch')} to crouch / walk low` },
    { action: 'jump', keys: actionBindings(controls, 'jump').map(bindingLabel), description: 'Jump / early hop' },
    { action: 'jetpack', keys: actionBindings(controls, 'jetpack').map(bindingLabel), description: controls.jetpackSource === 'combined'
      ? `Release, then ${controls.behavior.jetpack === 'hold' ? 'hold' : 'tap'} again for boot thrusters` : `${verb('jetpack')} boot thrusters / direct takeoff` },
    { action: 'fire', keys: actionBindings(controls, 'fire').map(bindingLabel), description: `${verb('fire')} to fire` },
    { action: 'aimSwitch', keys: actionBindings(controls, 'aimSwitch').map(bindingLabel), description: `${verb('aimSwitch')} for ${alternate}` },
    { action: 'reload', keys: actionBindings(controls, 'reload').map(bindingLabel), description: 'Reload' },
    { action: 'zoom', keys: actionBindings(controls, 'zoom').map(bindingLabel), description: 'Cycle view range · higher values show more arena' },
    { action: 'pickup', keys: actionBindings(controls, 'pickup').map(bindingLabel), description: 'Equip nearby weapon alone' },
    { action: 'pair', keys: actionBindings(controls, 'pair').map(bindingLabel), description: 'Pair a nearby handgun or SMG' },
    { action: 'punch', keys: actionBindings(controls, 'punch').map(bindingLabel), description: 'Punch · damage and knockback' },
    { action: 'pause', keys: actionBindings(controls, 'pause').map(bindingLabel), description: 'Pause / release mouse' },
  ];
}
