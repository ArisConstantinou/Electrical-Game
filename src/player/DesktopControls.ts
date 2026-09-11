import type { Input } from '../core/Input';
import type { PlayerController } from './PlayerController';

export class DesktopControls {
  constructor(surface: HTMLElement, player: PlayerController, input: Input) {
    surface.addEventListener('click', () => {
      if (!this.isTouchDevice && document.pointerLockElement !== surface) void surface.requestPointerLock();
    });
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === surface) player.look(event.movementX, event.movementY);
    });
    surface.addEventListener('wheel', event => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('wirehouse:cycle-tool', { detail: Math.sign(event.deltaY) }));
    }, { passive: false });
    addEventListener('keydown', event => {
      if (event.code === 'Digit1') window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'spring' }));
      if (event.code === 'Digit2') window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'cutter' }));
      if (event.code === 'KeyF' && !event.repeat) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void surface.requestFullscreen();
      }
      if (event.code === 'KeyE' && document.pointerLockElement === surface) input.actionRequested = true;
    });
  }

  get isTouchDevice(): boolean { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; }
}
