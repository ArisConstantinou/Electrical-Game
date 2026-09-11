import type { Input } from '../core/Input';
import type { PlayerController } from './PlayerController';

export class MobileControls {
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;

  constructor(private readonly surface: HTMLElement, private readonly input: Input, private readonly player: PlayerController) {
    surface.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    surface.addEventListener('pointermove', this.onPointerMove, { passive: false });
    surface.addEventListener('pointerup', this.onPointerUp, { passive: false });
    surface.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    document.querySelector<HTMLButtonElement>('#mobile-action')?.addEventListener('pointerdown', event => { event.preventDefault(); input.actionRequested = true; });
    document.querySelector<HTMLButtonElement>('#tool-spring')?.addEventListener('pointerdown', event => { event.preventDefault(); window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'spring' })); });
    document.querySelector<HTMLButtonElement>('#tool-cutter')?.addEventListener('pointerdown', event => { event.preventDefault(); window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: 'cutter' })); });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    try { this.surface.setPointerCapture(event.pointerId); } catch { /* Synthetic QA events do not own an active pointer. */ }
    const joystick = document.querySelector<HTMLElement>('#joystick');
    if (joystick?.contains(event.target as Node) && this.joystickPointer === null) {
      this.joystickPointer = event.pointerId;
      this.updateJoystick(event, joystick);
    } else if (this.lookPointer === null) {
      this.lookPointer = event.pointerId;
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
      this.joystickPointer = null;
      this.input.mobileMove = { x: 0, y: 0 };
      const thumb = document.querySelector<HTMLElement>('#joystick-thumb');
      if (thumb) thumb.style.transform = 'translate(-50%, -50%)';
    }
    if (event.pointerId === this.lookPointer) { event.preventDefault(); this.lookPointer = null; }
  };

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
