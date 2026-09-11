import type { PlayerController } from './PlayerController';
import type { Input } from '../core/Input';

export class DesktopControls {
  constructor(surface: HTMLElement, player: PlayerController, input: Input) {
    surface.addEventListener('click', () => {
      if (!this.isTouchDevice && document.pointerLockElement !== surface) void surface.requestPointerLock();
    });
    surface.addEventListener('pointerdown', event => {
      if (this.isTouchDevice || event.button !== 0 || (event.target as Element).closest('button')) return;
      event.preventDefault();
      input.actionHeld = true;
      input.actionRequested = true;
    });
    const releasePrimaryAction = (event: PointerEvent): void => {
      if (event.button === 0) input.actionHeld = false;
    };
    addEventListener('pointerup', releasePrimaryAction);
    addEventListener('pointercancel', () => { input.actionHeld = false; });
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
      if (event.code === 'KeyF' && !event.repeat) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void surface.requestFullscreen();
      }
    });
  }

  get isTouchDevice(): boolean { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; }
}
