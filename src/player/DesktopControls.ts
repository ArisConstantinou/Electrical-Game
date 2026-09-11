import type { PlayerController } from './PlayerController';
import type { Input } from '../core/Input';

export class DesktopControls {
  constructor(surface: HTMLElement, player: PlayerController, input: Input) {
    surface.addEventListener('click', event => {
      if ((event.target as Element).closest('button')) return;
      if (!this.isTouchDevice && document.pointerLockElement !== surface) void surface.requestPointerLock();
    });
    surface.addEventListener('pointerdown', event => {
      if (this.isTouchDevice || (event.target as Element).closest('button')) return;
      if (event.button === 2) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('wirehouse:exit-leveling'));
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      input.actionHeld = true;
      input.actionRequested = true;
    });
    surface.addEventListener('contextmenu', event => event.preventDefault());
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
      if (event.code === 'KeyV' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-mode'));
      if (event.code === 'KeyC' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-color'));
      if (event.code === 'KeyF' && !event.repeat) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void surface.requestFullscreen();
      }
    });
  }

  get isTouchDevice(): boolean { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; }
}
