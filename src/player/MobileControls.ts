import type { Input } from '../core/Input';
import type { MobileAimProfile, PlayerController } from './PlayerController';

/** Old saved settings remain readable; every mode requires explicit USE. */
export type AimControlMode = 'manual' | 'auto-use' | 'double-tap';
export type AimInputMode = 'drag' | 'stick';

export class MobileControls {
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookActionPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private actionX = 0;
  private actionY = 0;
  private moveX = 0;
  private moveY = 0;
  private aimProfile: MobileAimProfile = 'normal';
  private aimInputMode: AimInputMode = 'stick';
  private readonly captures = new Map<number, HTMLElement>();

  constructor(private readonly surface: HTMLElement, private readonly input: Input, private readonly player: PlayerController, _selectedToolIsContinuous: () => boolean) {
    surface.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    surface.addEventListener('pointermove', this.onPointerMove, { passive: false });
    addEventListener('pointerup', this.onPointerUp, { passive: false });
    addEventListener('pointercancel', this.onPointerUp, { passive: false });
    surface.addEventListener('lostpointercapture', this.onLostCapture);
    surface.addEventListener('selectstart', event => event.preventDefault());
    surface.addEventListener('dragstart', event => event.preventDefault());
    addEventListener('blur', () => this.cancelActiveGestures());
    addEventListener('resize', () => this.cancelActiveGestures());
    addEventListener('orientationchange', () => this.cancelActiveGestures());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelActiveGestures(); });
    let settingsOpen = surface.classList.contains('settings-open');
    new MutationObserver(() => {
      const open = surface.classList.contains('settings-open');
      if (open && !settingsOpen) {
        const hadAction = this.lookActionPointer !== null;
        this.cancelActiveGestures();
        // Button-up may already have committed the short casting animation.
        // Opening settings cancels that pending cast too, before it emits.
        if (!hadAction) window.dispatchEvent(new CustomEvent('wirehouse:cancel-mobile-action'));
      }
      settingsOpen = open;
    }).observe(surface, { attributes: true, attributeFilter: ['class'] });
    surface.querySelectorAll<HTMLElement>('#joystick, #look-joystick, #mobile-move-zone').forEach(pad => {
      for (const type of ['touchstart', 'touchmove'] as const) {
        pad.addEventListener(type, event => { if (event.cancelable) event.preventDefault(); }, { passive: false });
      }
    });
    document.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach(button => {
      const touches = new Map<number, { x: number; y: number; travel: number }>();
      let suppressTouchClick = false;
      const select = (): void => {
        this.cancelActiveGestures();
        window.dispatchEvent(new CustomEvent('wirehouse:select-tool', { detail: button.dataset.tool }));
      };
      button.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') { suppressTouchClick = false; return; }
        suppressTouchClick = true;
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY, travel: 0 });
        // Let the browser pan the belt. Selection waits for a deliberate tap.
      });
      button.addEventListener('pointermove', event => {
        const touch = touches.get(event.pointerId);
        if (touch) touch.travel = Math.max(touch.travel, Math.hypot(event.clientX - touch.x, event.clientY - touch.y));
      });
      button.addEventListener('pointercancel', event => touches.delete(event.pointerId));
      button.addEventListener('pointerup', event => {
        const touch = touches.get(event.pointerId); touches.delete(event.pointerId);
        if (!touch) return;
        const rect = button.getBoundingClientRect();
        const travel = Math.max(touch.travel, Math.hypot(event.clientX - touch.x, event.clientY - touch.y));
        if (travel <= 10 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) select();
      });
      button.addEventListener('keydown', event => {
        if (event.code === 'Enter' || event.code === 'Space') suppressTouchClick = false;
      });
      button.addEventListener('click', event => {
        if (suppressTouchClick) { event.preventDefault(); return; }
        select();
      });
    });
    const action = surface.querySelector<HTMLElement>('#look-joystick');
    action?.addEventListener('keydown', event => {
      if (!surface.classList.contains('settings-open') && (event.code === 'Space' || event.code === 'Enter') && !event.repeat && this.lookActionPointer === null) {
        event.preventDefault(); this.lookActionPointer = -1; this.beginAction();
      }
    });
    action?.addEventListener('keyup', event => {
      if ((event.code === 'Space' || event.code === 'Enter') && this.lookActionPointer === -1) {
        event.preventDefault(); this.releaseAction(false);
      }
    });
    action?.addEventListener('blur', () => { if (this.lookActionPointer === -1) this.releaseAction(true); });
  }

  setAimControlMode(_mode: AimControlMode): void { this.cancelActiveGestures(); }
  setAimProfile(profile: MobileAimProfile): void { this.aimProfile = profile; this.player.setMobileAimProfile(profile); }
  setAimInputMode(mode: AimInputMode): void { this.cancelActiveGestures(); this.aimInputMode = mode; }

  /** Cancellation discards a pending cast; ordinary USE release still casts. */
  cancelActiveGestures(): void {
    this.releaseAction(true);
    this.releaseLook();
    this.releaseJoystick();
  }

  private capture(element: HTMLElement, pointer: number): void {
    this.captures.set(pointer, element);
    try { element.setPointerCapture(pointer); } catch { /* Synthetic events may not own a native pointer. */ }
  }
  private releaseCapture(pointer: number | null): void {
    if (pointer === null) return;
    const element = this.captures.get(pointer); this.captures.delete(pointer);
    if (element?.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
  }
  private isUI(target: Element): boolean {
    return Boolean(target.closest('button,input,select,textarea,label,a,summary,#settings-panel,#top-hud,#mortar-panel,#chisel-orientation,#level-panel,#tool-hud,#aim-quick-controls'));
  }
  private inMoveZone(event: PointerEvent): boolean {
    const zone = this.surface.querySelector<HTMLElement>('#mobile-move-zone');
    const r = (zone ?? this.surface).getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= (zone ? r.right : r.left + r.width * .5) &&
      event.clientY >= (zone ? r.top : r.top + r.height * .35) && event.clientY <= r.bottom;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' || this.surface.classList.contains('settings-open')) return;
    const target = event.target as Element;
    const action = this.surface.querySelector<HTMLElement>('#look-joystick');
    // The explicit action surface can be a button, so recognize it first.
    if (action?.contains(target)) {
      if (this.lookActionPointer !== null) return;
      event.preventDefault(); this.lookActionPointer = event.pointerId;
      this.actionX = event.clientX; this.actionY = event.clientY;
      this.capture(action, event.pointerId); this.beginAction();
      if (this.aimInputMode === 'stick') this.updateLookJoystick(event, action);
      return;
    }
    if (this.isUI(target)) return;
    event.preventDefault();
    if (this.inMoveZone(event)) {
      if (this.joystickPointer !== null) return;
      this.joystickPointer = event.pointerId; this.moveX = event.clientX; this.moveY = event.clientY;
      const joystick = this.surface.querySelector<HTMLElement>('#joystick');
      if (joystick) {
        joystick.style.left = `${this.moveX}px`; joystick.style.top = `${this.moveY}px`;
        joystick.style.right = 'auto'; joystick.style.bottom = 'auto'; joystick.style.transform = 'translate(-50%, -50%)';
        joystick.classList.add('active');
      }
      this.capture(joystick ?? this.surface, event.pointerId); this.input.resetMobileMove();
    } else if (this.lookPointer === null) {
      this.lookPointer = event.pointerId; this.lookX = event.clientX; this.lookY = event.clientY;
      this.capture(this.surface, event.pointerId);
    }
  };

  private beginAction(): void {
    this.input.actionHeld = true; this.input.actionRequested = true;
    const action = this.surface.querySelector<HTMLElement>('#look-joystick');
    action?.classList.add('active'); action?.setAttribute('aria-pressed', 'true');
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    if (event.pointerId === this.joystickPointer) {
      event.preventDefault();
      const joystick = this.surface.querySelector<HTMLElement>('#joystick');
      const radius = Math.max(1, (joystick?.getBoundingClientRect().width ?? 112) * .34);
      let x = event.clientX - this.moveX, y = event.clientY - this.moveY;
      const length = Math.hypot(x, y); if (length > radius) { x *= radius / length; y *= radius / length; }
      this.input.mobileMove = { x: x / radius, y: y / radius };
      const thumb = this.surface.querySelector<HTMLElement>('#joystick-thumb');
      if (thumb) thumb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    } else if (event.pointerId === this.lookActionPointer) {
      event.preventDefault();
      const action = this.surface.querySelector<HTMLElement>('#look-joystick');
      if (this.aimInputMode === 'stick' && action) this.updateLookJoystick(event, action);
      else {
        this.player.lookMobileDrag(event.clientX - this.actionX, event.clientY - this.actionY);
        this.actionX = event.clientX; this.actionY = event.clientY;
      }
    } else if (event.pointerId === this.lookPointer) {
      event.preventDefault();
      const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      for (const sample of coalesced.length ? coalesced : [event]) {
        this.player.lookMobileDrag(sample.clientX - this.lookX, sample.clientY - this.lookY);
        this.lookX = sample.clientX; this.lookY = sample.clientY;
      }
    }
  };
  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    if (event.pointerId === this.joystickPointer) { event.preventDefault(); this.releaseJoystick(); }
    if (event.pointerId === this.lookPointer) { event.preventDefault(); this.releaseLook(); }
    if (event.pointerId === this.lookActionPointer) { event.preventDefault(); this.releaseAction(event.type === 'pointercancel'); }
  };
  private onLostCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointer) this.releaseJoystick();
    if (event.pointerId === this.lookPointer) this.releaseLook();
    if (event.pointerId === this.lookActionPointer) this.releaseAction(true);
  };
  private releaseJoystick(): void {
    const pointer = this.joystickPointer; this.joystickPointer = null; this.input.resetMobileMove();
    const joystick = this.surface.querySelector<HTMLElement>('#joystick');
    if (joystick) { for (const property of ['left', 'top', 'right', 'bottom', 'transform']) joystick.style.removeProperty(property); joystick.classList.remove('active'); }
    const thumb = this.surface.querySelector<HTMLElement>('#joystick-thumb'); if (thumb) thumb.style.transform = 'translate(-50%, -50%)';
    this.releaseCapture(pointer);
  }
  private releaseLook(): void {
    const pointer = this.lookPointer; this.lookPointer = null; this.releaseCapture(pointer);
  }
  private releaseAction(cancel: boolean): void {
    if (this.lookActionPointer === null) return;
    const pointer = this.lookActionPointer; this.lookActionPointer = null;
    this.input.actionHeld = false; if (cancel) this.input.actionRequested = false;
    this.input.resetMobileLook();
    const action = this.surface.querySelector<HTMLElement>('#look-joystick');
    action?.classList.remove('active'); action?.setAttribute('aria-pressed', 'false');
    const thumb = this.surface.querySelector<HTMLElement>('#look-joystick-thumb'); if (thumb) thumb.style.transform = 'translate(-50%, -50%)';
    if (cancel) window.dispatchEvent(new CustomEvent('wirehouse:cancel-mobile-action'));
    this.releaseCapture(pointer);
  }
  private updateLookJoystick(event: PointerEvent, joystick: HTMLElement): void {
    const rect = joystick.getBoundingClientRect(), radius = Math.max(1, rect.width / 2);
    // USE starts neutral wherever the thumb lands. Only deliberate travel
    // from that press steers the camera while charging or using a tool.
    const rawX = (event.clientX - this.actionX) / radius;
    const rawY = (event.clientY - this.actionY) / radius;
    const length = Math.hypot(rawX, rawY);
    // PlayerController already reduces angular speed near masonry. Keep one
    // predictable pad curve, rather than adding two more proximity slowdowns.
    const response = { precise: { deadZone: .1, exponent: 1.7 }, normal: { deadZone: .08, exponent: 1.4 }, fast: { deadZone: .06, exponent: 1.1 } }[this.aimProfile];
    const normalized = length <= response.deadZone ? 0 : Math.min(1, (length - response.deadZone) / (1 - response.deadZone));
    const magnitude = normalized ** response.exponent;
    const x = length > 0 ? rawX / length * magnitude : 0, y = length > 0 ? rawY / length * magnitude : 0;
    this.input.mobileLook = { x, y };
    const thumb = this.surface.querySelector<HTMLElement>('#look-joystick-thumb');
    if (thumb) thumb.style.transform = `translate(calc(-50% + ${x * radius * .52}px), calc(-50% + ${y * radius * .52}px))`;
  }
}
