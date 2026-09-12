import type { PlayerController } from './PlayerController';
import type { Input } from '../core/Input';

export class DesktopControls {
  constructor(surface: HTMLElement, player: PlayerController, input: Input) {
    let primaryDown = false;
    surface.addEventListener('pointerdown', event => {
      if (this.isTouchDevice || (event.target as Element).closest('button')) return;
      if (event.button === 2) {
        event.preventDefault();
        input.actionHeld = false;
        input.actionRequested = false;
        window.dispatchEvent(new CustomEvent('wirehouse:exit-leveling'));
        if (document.pointerLockElement !== surface) void surface.requestPointerLock();
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      const relocking = document.pointerLockElement !== surface;
      if (primaryDown) return;
      primaryDown = true;
      if (relocking) {
        // Standard FPS return-to-play behavior: the first primary press both
        // restores centred mouse look and uses the selected tool. Right mouse
        // remains a relock/cancel-only input and can never queue an action.
        input.actionHeld = true;
        input.actionRequested = true;
        void surface.requestPointerLock();
        return;
      }
      input.actionHeld = true;
      input.actionRequested = true;
    });
    surface.addEventListener('contextmenu', event => event.preventDefault());
    const releasePrimaryAction = (event: PointerEvent): void => {
      if (event.button === 0) {
        primaryDown = false;
        input.actionHeld = false;
      }
    };
    addEventListener('pointerup', releasePrimaryAction);
    addEventListener('pointercancel', () => {
      primaryDown = false;
      input.actionHeld = false;
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== surface) {
        input.actionHeld = false;
        input.actionRequested = false;
      }
    });
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === surface) player.look(event.movementX, event.movementY);
    });
    surface.addEventListener('wheel', event => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('wirehouse:cycle-tool', { detail: Math.sign(event.deltaY) }));
    }, { passive: false });
    addEventListener('keydown', event => {
      const directTools: Partial<Record<string, string>> = { Digit1: 'spring', Digit2: 'cutter', Digit3: 'spray', Digit4: 'hammer', Digit5: 'fitting', Digit6: 'level' };
      if (directTools[event.code]) window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: directTools[event.code] }));
      if (event.code === 'KeyV' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-mode'));
      if (event.code === 'KeyC' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-color'));
      if (event.code === 'KeyX' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-hammer-mode'));
      if (event.code === 'KeyF' && !event.repeat) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void surface.requestFullscreen();
      }
    });
  }

  get isTouchDevice(): boolean { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; }
}
