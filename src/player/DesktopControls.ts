import type { PlayerController } from './PlayerController';
import type { Input } from '../core/Input';

export class DesktopControls {
  private ignoreNextLockedMove = false;

  constructor(surface: HTMLElement, private readonly lockTarget: HTMLElement, player: PlayerController, input: Input) {
    let primaryDown = false;
    surface.addEventListener('pointerdown', event => {
      if ((event.pointerType && event.pointerType !== 'mouse') || (event.target as Element).closest('button')) return;
      if (event.button === 2) {
        event.preventDefault();
        input.actionHeld = false;
        input.actionRequested = false;
        window.dispatchEvent(new CustomEvent('wirehouse:exit-leveling'));
        if (document.pointerLockElement !== this.lockTarget) this.requestLock();
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      const relocking = document.pointerLockElement !== this.lockTarget;
      if (primaryDown) return;
      primaryDown = true;
      if (relocking) {
        // Standard FPS return-to-play behavior: the first primary press both
        // restores centred mouse look and uses the selected tool. Right mouse
        // remains a relock/cancel-only input and can never queue an action.
        input.actionHeld = true;
        input.actionRequested = true;
        this.requestLock();
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
      this.ignoreNextLockedMove = document.pointerLockElement === this.lockTarget;
      if (document.pointerLockElement !== this.lockTarget) {
        input.actionHeld = false;
        input.actionRequested = false;
      }
    });
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement !== this.lockTarget) return;
      if (this.ignoreNextLockedMove) {
        this.ignoreNextLockedMove = false;
        return;
      }
      if (!this.isPlausibleMovement(event.movementX, event.movementY)) return;
      player.look(event.movementX, event.movementY);
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

  requestLock(): void {
    if (document.pointerLockElement === this.lockTarget) return;
    try {
      const request = this.lockTarget.requestPointerLock({ unadjustedMovement: true });
      if (request) void request.catch(error => {
        if (error instanceof DOMException && error.name === 'NotSupportedError') void this.lockTarget.requestPointerLock();
      });
    } catch (error) {
      if (error instanceof DOMException && error.name !== 'NotSupportedError') return;
      void this.lockTarget.requestPointerLock();
    }
  }

  private isPlausibleMovement(deltaX: number, deltaY: number): boolean {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return false;
    const maximumX = Math.max(240, this.lockTarget.clientWidth * 0.25);
    const maximumY = Math.max(180, this.lockTarget.clientHeight * 0.25);
    return Math.abs(deltaX) <= maximumX && Math.abs(deltaY) <= maximumY;
  }

}
