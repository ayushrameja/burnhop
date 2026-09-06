import { useCallback, useEffect, useRef, type SyntheticEvent } from 'react';
import { MenuAudio } from './game/menuAudio';
import type { AudioSettings } from './game/audioSettings';
import { MENU_MUSIC, type MenuMusicScene } from './game/menuMusic';

/** Shell-owned audio survives practice runtime creation and teardown. */
export function useMenuAudio(muted: boolean, musicActive: boolean, volumes: AudioSettings, scene: MenuMusicScene = 'lobby') {
  const audioRef = useRef<MenuAudio | null>(null);
  const keyboardFocus = useRef(false);

  useEffect(() => {
    const audio = new MenuAudio();
    audioRef.current = audio;
    const visibility = () => audio.setVisible(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      audio.destroy();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => { audioRef.current?.setMuted(muted); }, [muted]);
  useEffect(() => { audioRef.current?.setVolumes(volumes); }, [volumes]);
  useEffect(() => { audioRef.current?.setMusicActive(musicActive); }, [musicActive]);
  useEffect(() => {
    const track = MENU_MUSIC[scene];
    if (track.file) audioRef.current?.setMusicFile(track.file);
    audioRef.current?.setDanceActive(!track.file);
  }, [scene]);
  const getDanceTime = useCallback(() => audioRef.current?.getDanceTime() ?? null, []);

  const controlFor = (event: SyntheticEvent): HTMLElement | null => {
    if (!(event.target instanceof Element)) return null;
    const control = event.target.closest<HTMLElement>('button, summary, input[type="radio"]');
    if (!control || !control.closest('[data-ui-audio="true"]') ||
      control.matches(':disabled') || control.closest('[inert], [aria-disabled="true"]')) return null;
    return control;
  };

  return {
    unlock: () => { void audioRef.current?.unlock(); },
    getDanceTime,
    handlers: {
      onPointerOverCapture: (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'touch') return;
        const control = controlFor(event);
        if (!control || (event.relatedTarget instanceof Node && control.contains(event.relatedTarget))) return;
        audioRef.current?.playHover();
      },
      onPointerDownCapture: () => { keyboardFocus.current = false; },
      onKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => {
        keyboardFocus.current = event.key === 'Tab';
      },
      onKeyUpCapture: () => { keyboardFocus.current = false; },
      onFocusCapture: (event: React.FocusEvent<HTMLDivElement>) => {
        // Only deliberate Tab navigation makes a cue; restored focus stays quiet.
        if (keyboardFocus.current && controlFor(event)) audioRef.current?.playHover();
        keyboardFocus.current = false;
      },
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !controlFor(event)) return;
        void audioRef.current?.unlock();
        audioRef.current?.playClick();
      },
    },
  };
}
