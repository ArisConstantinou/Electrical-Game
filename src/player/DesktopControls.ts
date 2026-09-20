import type { PlayerController } from './PlayerController';
import type { Input } from '../core/Input';

export class DesktopControls {
  private ignoreNextLockedMove = false;
  private wheelTime = Number.NEGATIVE_INFINITY;
  private wheelDirection = 0;
  private wheelDistance = 0;
  private wheelSelected = false;

  constructor(surface: HTMLElement, private readonly lockTarget: HTMLElement, player: PlayerController, input: Input) {
    let primaryDown = false;
    surface.addEventListener('pointerdown', event => {
      if ((event.pointerType && event.pointerType !== 'mouse') || (event.target as Element).closest('button,input,select,textarea,label,a,summary,#settings-panel')) return;
      if (event.button === 2) {
        event.preventDefault();
        input.actionHeld = false;
        input.actionRequested = false;
        if(surface.dataset.boxAssembly==='true')window.dispatchEvent(new CustomEvent('wirehouse:box-place-assembly'));
        else window.dispatchEvent(new CustomEvent('wirehouse:exit-leveling'));
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
      // A movement finger lifting must not release a different finger's tool.
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (event.button === 0) {
        primaryDown = false;
        input.actionHeld = false;
      }
    };
    addEventListener('pointerup', releasePrimaryAction);
    addEventListener('pointercancel', event => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
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
      // Settings scroll, sideways touchpad motion and pinch zoom are not tool
      // selections. In particular deltaY=0 must never become a +1 cycle.
      if (surface.classList.contains('settings-open') || event.ctrlKey || event.shiftKey ||
          (event.target instanceof Element && event.target.closest('button,input,select,textarea,label,a,summary,#settings-panel')) ||
          !Number.isFinite(event.deltaY) || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const direction = Math.sign(event.deltaY);
      if (event.timeStamp - this.wheelTime > 180 || direction !== this.wheelDirection) {
        this.wheelDistance = 0;
        this.wheelSelected = false;
      }
      this.wheelTime = event.timeStamp;
      this.wheelDirection = direction;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? surface.clientHeight : 1;
      this.wheelDistance += Math.abs(event.deltaY) * unit;
      // A sustained touchpad gesture includes many momentum samples. Select
      // once, then wait for a new gesture or a deliberate direction reversal.
      if (this.wheelSelected || this.wheelDistance < 40) return;
      this.wheelSelected = true;
      window.dispatchEvent(new CustomEvent(surface.dataset.boxAssembly==='true'?'wirehouse:box-cycle-candidate':'wirehouse:cycle-tool', { detail: direction }));
    }, { passive: false });
    addEventListener('keydown', event => {
      if(document.querySelector('#model-inspector:not([hidden]):not([data-live="true"])')||event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(event.code==='Escape'&&surface.dataset.boxAssembly==='true'&&!surface.classList.contains('settings-open')){
        if(!event.repeat){
          primaryDown=false;input.resetTransientInput();
          this.wheelSelected=false;this.wheelDistance=0;this.wheelTime=Number.NEGATIVE_INFINITY;
          window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));
        }
        return;
      }
      const directTools: Partial<Record<string, string>> = { Digit1: 'spring', Digit2: 'cutter', Digit3: 'spray', Digit4: 'hammer', Digit5: 'fitting', Digit6: 'level', Digit7: 'trowel', Digit8: 'hose', Digit9: 'measure', Digit0:'drill',KeyB:'driver',KeyL:'laser' };
      if(surface.dataset.boxAssembly==='true'&&['Digit1','Digit2','Digit3','Digit4'].includes(event.code)){
        event.preventDefault();if(!event.repeat)window.dispatchEvent(new CustomEvent('wirehouse:box-attach',{detail:Number(event.code.at(-1))}));return;
      }
      if(surface.dataset.boxAssembly==='true'&&event.code==='KeyR'){
        event.preventDefault();if(!event.repeat)window.dispatchEvent(new CustomEvent('wirehouse:box-rotate-candidate'));return;
      }
      if(event.code==='KeyM'&&!event.repeat&&!(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]')))window.dispatchEvent(new CustomEvent('wirehouse:measure-mark'));
      if (directTools[event.code]) window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: directTools[event.code] }));
      if (event.code === 'KeyV' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-mode'));
      if (event.code === 'KeyC' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:front-body-view'));
      if (event.code === 'BracketLeft') window.dispatchEvent(new CustomEvent('wirehouse:tilt-chisel',{detail:-5}));
      if (event.code === 'BracketRight') window.dispatchEvent(new CustomEvent('wirehouse:tilt-chisel',{detail:5}));
      if (event.code === 'KeyQ' && !event.repeat && !(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]'))) window.dispatchEvent(new CustomEvent('wirehouse:hammer-view-side',{detail:0}));
      if (event.code === 'KeyJ') window.dispatchEvent(new CustomEvent('wirehouse:side-chisel',{detail:5}));
      if (event.code === 'KeyK') window.dispatchEvent(new CustomEvent('wirehouse:side-chisel',{detail:-5}));
      if (event.code === 'KeyT' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:cycle-chisel'));
      if (event.code === 'KeyR' && !event.repeat) window.dispatchEvent(new CustomEvent('wirehouse:rotate-chisel'));
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
