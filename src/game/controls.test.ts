import { describe, expect, it } from 'vitest';
import { actionBindings, bindingLabel, controlHelp, defaultControls, isBinding, normalizeControls, proposeBinding, resetActionControls } from './controls';

describe('control settings and binding proposals', () => {
  it('returns independent defaults and normalizes malformed settings without losing valid values', () => {
    expect(defaultControls()).toMatchObject({ bindings: { crouch: ['KeyC', 'ArrowDown'], punch: ['KeyE', null], pickup: ['KeyF', null], jetpack: ['ShiftLeft', 'ShiftRight'] }, defaultAimMode: 'pointer', jetpackSource: 'separate' });
    expect(normalizeControls({ defaultAimMode: 'radial', jetpackSource: 'combined' })).toMatchObject({ defaultAimMode: 'radial', jetpackSource: 'combined' });
    const first = defaultControls();
    first.bindings.jump[0] = 'KeyJ';
    first.behavior.fire = 'toggle';
    expect(defaultControls().bindings.jump[0]).toBe('Space');
    expect(defaultControls().behavior.fire).toBe('hold');
    const normalized = normalizeControls({
      bindings: { jump: ['KeyJ', 'not-a-key'], crouch: [null, 'Mouse4'] },
      behavior: { fire: 'toggle', crouch: 'invalid' }, jetpackSource: 'separate', defaultAimMode: 'pointer',
    });
    expect(normalized.bindings.jump).toEqual(['KeyJ', null]);
    expect(normalized.bindings.crouch).toEqual([null, 'Mouse4']);
    expect(normalized.behavior.fire).toBe('toggle');
    expect(normalized.behavior.crouch).toBe('hold');
    expect(normalized.jetpackSource).toBe('separate');
    expect(normalized.defaultAimMode).toBe('pointer');
    expect(normalizeControls(null)).toEqual(defaultControls());
  });

  it('lets explicit remaps win over fallback defaults and removes duplicate bindings', () => {
    const controls = normalizeControls({ bindings: { jump: ['KeyA', 'KeyA'], fire: ['KeyA', 'Mouse1'] } });
    expect(controls.bindings.jump).toEqual(['KeyA', null]);
    expect(controls.bindings.moveLeft[0]).toBeNull();
    expect(controls.bindings.fire).toEqual([null, 'Mouse1']);
    const all = Object.values(controls.bindings).flat().filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });

  it('proposes an exact cross-action swap without mutating the saved controls', () => {
    const controls = defaultControls();
    const proposal = proposeBinding(controls, 'jump', 0, 'Mouse0');
    expect(controls).toEqual(defaultControls());
    expect(proposal.conflict).toBe(true);
    expect(proposal.controls.bindings.jump).toEqual(['Mouse0', null]);
    expect(proposal.controls.bindings.fire).toEqual(['Space', null]);
    expect(proposal.changes).toEqual([
      { action: 'jump', slot: 0, from: 'Space', to: 'Mouse0' },
      { action: 'fire', slot: 0, from: 'Mouse0', to: 'Space' },
    ]);
  });

  it('clears the displaced action when assigning a conflict into an empty slot', () => {
    const proposal = proposeBinding(defaultControls(), 'jump', 1, 'KeyR');
    expect(proposal.conflict).toBe(true);
    expect(proposal.controls.bindings.jump).toEqual(['Space', 'KeyR']);
    expect(proposal.controls.bindings.reload).toEqual([null, null]);
    expect(proposal.changes).toHaveLength(2);
  });

  it('swaps slots within one action without flagging a cross-action conflict', () => {
    const proposal = proposeBinding(defaultControls(), 'crouch', 0, 'ArrowDown');
    expect(proposal.conflict).toBe(false);
    expect(proposal.controls.bindings.crouch).toEqual(['ArrowDown', 'KeyC']);
    expect(proposal.changes).toHaveLength(2);
  });

  it('supports unbinding and no-op assignments and refuses reserved or invalid inputs', () => {
    const controls = defaultControls();
    expect(proposeBinding(controls, 'jump', 0, null).controls.bindings.jump).toEqual([null, null]);
    expect(proposeBinding(controls, 'jump', 0, 'Space').changes).toEqual([]);
    for (const binding of ['Escape', 'F3', 'MetaLeft', 'Mouse5', 'a', 'KeyAA']) {
      expect(isBinding(binding)).toBe(false);
      expect(proposeBinding(controls, 'jump', 0, binding).changes).toEqual([]);
    }
    for (const binding of ['Tab', 'KeyZ', 'Mouse0', 'Mouse4', 'ArrowLeft', 'F12', 'NumpadEnter']) expect(isBinding(binding)).toBe(true);
  });

  it('restores both action bindings and Hold behavior through reviewable conflict changes', () => {
    let controls = proposeBinding(defaultControls(), 'crouch', 0, 'Mouse0').controls;
    controls = proposeBinding(controls, 'crouch', 1, 'KeyR').controls;
    controls.behavior.crouch = 'toggle';
    const before = structuredClone(controls);
    const proposal = resetActionControls(controls, 'crouch');
    expect(controls).toEqual(before);
    expect(proposal.controls.bindings.crouch).toEqual(['KeyC', 'ArrowDown']);
    expect(proposal.controls.bindings.fire[0]).toBe('Mouse0');
    expect(proposal.controls.bindings.reload[0]).toBe('KeyR');
    expect(proposal.controls.behavior.crouch).toBe('hold');
    expect(proposal.conflict).toBe(true);
    expect(proposal.changes).toHaveLength(4);
  });

  it('derives help from current bindings, behavior, aim default, and combined versus split jetpack', () => {
    const controls = defaultControls();
    controls.jetpackSource = 'combined';
    controls.bindings.jump = ['KeyJ', 'Mouse1'];
    controls.bindings.pause = ['KeyP', null];
    controls.behavior.jetpack = 'toggle';
    controls.behavior.aimSwitch = 'toggle';
    controls.defaultAimMode = 'pointer';
    expect(actionBindings(controls, 'jetpack')).toEqual(['KeyJ', 'Mouse1']);
    expect(actionBindings(controls, 'pause')).toEqual(['Escape', 'KeyP']);
    const help = controlHelp(controls);
    expect(help.find(row => row.action === 'jetpack')).toMatchObject({ keys: ['J', 'Middle mouse'], description: 'Release, then tap again for boot thrusters' });
    expect(help.find(row => row.action === 'aimSwitch')?.description).toBe('Toggle for aim line');
    controls.jetpackSource = 'separate';
    expect(actionBindings(controls, 'jetpack')).toEqual(['ShiftLeft', 'ShiftRight']);
    expect(controlHelp(controls).find(row => row.action === 'jetpack')?.description).toBe('Toggle boot thrusters / direct takeoff');
    expect(bindingLabel(null)).toBe('Unbound');
    expect(bindingLabel('Mouse4')).toBe('Mouse forward');
  });
});
