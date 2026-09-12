import type { Input } from '../core/Input';
import type { PlayerController } from './PlayerController';

export class MobileControls {
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookActionPointer: number | null = null;
  private lookJoystickActive = false;
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
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('pointerdown', event => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: button.dataset.tool }));
    }));
  }

  private onPointerDown = (event: PointerEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const joystick = document.querySelector<HTMLElement>('#joystick');
    const lookJoystick = document.querySelector<HTMLElement>('#look-joystick');
    if (joystick?.contains(event.target as Node) && this.joystickPointer === null) {
      this.joystickPointer = event.pointerId;
      try { joystick.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own an active pointer. */ }
      this.updateJoystick(event, joystick);
    } else if (lookJoystick?.contains(event.target as Node) && this.lookPointer === null) {
      this.lookPointer = event.pointerId;
      this.lookJoystickActive = true;
      try { lookJoystick.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own an active pointer. */ }
      this.updateLookJoystick(event, lookJoystick);
      const now = performance.now();
      const rect = lookJoystick.getBoundingClientRect();
      const centerDistance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      const isCenterTap = centerDistance <= rect.width * 0.24;
      const isNearbyTap = Math.hypot(event.clientX - this.lastLookTapX, event.clientY - this.lastLookTapY) <= 42;
      if (isCenterTap && now - this.lastLookTapAt <= 340 && isNearbyTap) {
        this.lookActionPointer = event.pointerId;
        this.input.actionHeld = true;
        this.input.actionRequested = true;
        this.lastLookTapAt = Number.NEGATIVE_INFINITY;
      } else {
        this.lastLookTapAt = now;
        this.lastLookTapX = event.clientX;
        this.lastLookTapY = event.clientY;
      }
    } else if (this.lookPointer === null) {
      this.lookPointer = event.pointerId;
      try { this.surface.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own an active pointer. */ }
      this.lookX = event.clientX;
      this.lookY = event.clientY;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) {
      event.preventDefault();
      const joystick = document.querySelector<HTMLElement>('#joystick');
      if (joystick) this.updateJoystick(event, joystick);
    } else if (event.pointerId === this.lookPointer) {
      event.preventDefault();
      if (this.lookJoystickActive) {
        const lookJoystick = document.querySelector<HTMLElement>('#look-joystick');
        if (lookJoystick) this.updateLookJoystick(event, lookJoystick);
        return;
      }
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
      this.releaseLook(event.pointerId);
    }
  };

  private onLostCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) this.releaseJoystick();
    if (event.pointerId === this.lookPointer || event.pointerId === this.lookActionPointer) this.releaseLook(event.pointerId);
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

  private updateLookJoystick(event: PointerEvent, joystick: HTMLElement): void {
    const rect = joystick.getBoundingClientRect();
    const radius = Math.max(1, rect.width / 2);
    const rawX = (event.clientX - (rect.left + radius)) / radius;
    const rawY = (event.clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(rawX, rawY);
    const deadZone = 0.12;
    const magnitude = length <= deadZone ? 0 : Math.min(1, (length - deadZone) / (1 - deadZone));
    const x = length > 0 ? rawX / length * magnitude : 0;
    const y = length > 0 ? rawY / length * magnitude : 0;
    this.input.mobileLook = { x, y };
    const travel = radius * 0.52;
    const thumb = document.querySelector<HTMLElement>('#look-joystick-thumb');
    if (thumb) thumb.style.transform = `translate(calc(-50% + ${x * travel}px), calc(-50% + ${y * travel}px))`;
  }

  private releaseLook(pointerId: number): void {
    if (pointerId !== this.lookPointer && pointerId !== this.lookActionPointer) return;
    this.lookPointer = null;
    this.lookJoystickActive = false;
    this.input.resetMobileLook();
    const thumb = document.querySelector<HTMLElement>('#look-joystick-thumb');
    if (thumb) thumb.style.transform = 'translate(-50%, -50%)';
    if (pointerId === this.lookActionPointer) {
      this.lookActionPointer = null;
      this.input.actionHeld = false;
    }
  }
}
