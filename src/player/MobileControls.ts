import type { Input } from '../core/Input';
import type { PlayerController } from './PlayerController';

export class MobileControls {
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookActionPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lastLookTapAt = Number.NEGATIVE_INFINITY;
  private lastLookTapX = 0;
  private lastLookTapY = 0;

  constructor(private readonly surface: HTMLElement, private readonly input: Input, private readonly player: PlayerController) {
    surface.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    surface.addEventListener('pointermove', this.onPointerMove, { passive: false });
    surface.addEventListener('pointerup', this.onPointerUp, { passive: false });
    surface.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    surface.addEventListener('lostpointercapture', this.onLostCapture);
    surface.addEventListener('selectstart', event => event.preventDefault());
    surface.addEventListener('dragstart', event => event.preventDefault());
    addEventListener('pointerup', this.onPointerUp, { passive: false });
    addEventListener('pointercancel', this.onPointerUp, { passive: false });
    const action = document.querySelector<HTMLButtonElement>('#mobile-action');
    action?.addEventListener('pointerdown', event => {
      event.preventDefault();
      input.actionHeld = true;
      input.actionRequested = true;
      try { action.setPointerCapture(event.pointerId); } catch { /* Browser may reject synthetic capture. */ }
    });
    const releaseAction = (event: PointerEvent): void => { event.preventDefault(); input.actionHeld = false; };
    action?.addEventListener('pointerup', releaseAction, { passive: false });
    action?.addEventListener('pointercancel', releaseAction, { passive: false });
    action?.addEventListener('lostpointercapture', () => { input.actionHeld = false; });
    document.querySelector<HTMLButtonElement>('#tool-prev')?.addEventListener('pointerdown', event => { event.preventDefault(); window.dispatchEvent(new CustomEvent('wirehouse:cycle-tool', { detail: -1 })); });
    document.querySelector<HTMLButtonElement>('#tool-next')?.addEventListener('pointerdown', event => { event.preventDefault(); window.dispatchEvent(new CustomEvent('wirehouse:cycle-tool', { detail: 1 })); });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const joystick = document.querySelector<HTMLElement>('#joystick');
    if (joystick?.contains(event.target as Node) && this.joystickPointer === null) {
      this.joystickPointer = event.pointerId;
      try { joystick.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own an active pointer. */ }
      this.updateJoystick(event, joystick);
    } else if (this.lookPointer === null) {
      this.lookPointer = event.pointerId;
      try { this.surface.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own an active pointer. */ }
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      const now = performance.now();
      const surfaceRect = this.surface.getBoundingClientRect();
      const isRightLookZone = event.clientX >= surfaceRect.left + surfaceRect.width * 0.48;
      const isNearbyTap = Math.hypot(event.clientX - this.lastLookTapX, event.clientY - this.lastLookTapY) <= 56;
      if (isRightLookZone && now - this.lastLookTapAt <= 340 && isNearbyTap) {
        this.lookActionPointer = event.pointerId;
        this.input.actionHeld = true;
        this.input.actionRequested = true;
      }
      this.lastLookTapAt = now;
      this.lastLookTapX = event.clientX;
      this.lastLookTapY = event.clientY;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) {
      event.preventDefault();
      const joystick = document.querySelector<HTMLElement>('#joystick');
      if (joystick) this.updateJoystick(event, joystick);
    } else if (event.pointerId === this.lookPointer) {
      event.preventDefault();
      const dx = event.clientX - this.lookX;
      const dy = event.clientY - this.lookY;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      this.player.look(dx, dy, 0.0042);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) {
      event.preventDefault();
      this.releaseJoystick();
    }
    if (event.pointerId === this.lookPointer) {
      event.preventDefault();
      this.lookPointer = null;
      if (event.pointerId === this.lookActionPointer) {
        this.lookActionPointer = null;
        this.input.actionHeld = false;
      }
    }
  };

  private onLostCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) this.releaseJoystick();
    if (event.pointerId === this.lookPointer) this.lookPointer = null;
    if (event.pointerId === this.lookActionPointer) {
      this.lookActionPointer = null;
      this.input.actionHeld = false;
    }
  };

  private releaseJoystick(): void {
    this.joystickPointer = null;
    this.input.resetMobileMove();
    const thumb = document.querySelector<HTMLElement>('#joystick-thumb');
    if (thumb) thumb.style.transform = 'translate(-50%, -50%)';
  }

  private updateJoystick(event: PointerEvent, joystick: HTMLElement): void {
    const rect = joystick.getBoundingClientRect();
    const radius = rect.width * 0.34;
    let x = event.clientX - (rect.left + rect.width / 2);
    let y = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(x, y);
    if (length > radius) { x = x / length * radius; y = y / length * radius; }
    this.input.mobileMove = { x: x / radius, y: y / radius };
    const thumb = document.querySelector<HTMLElement>('#joystick-thumb');
    if (thumb) thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
}
