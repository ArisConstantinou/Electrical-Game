export class Input {
  readonly keys = new Set<string>();
  mobileMove = { x: 0, y: 0 };
  mobileLook = { x: 0, y: 0 };
  actionRequested = false;
  actionHeld = false;

  constructor() {
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', () => this.resetTransientInput());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetTransientInput(); });
  }

  pressed(code: string): boolean { return this.keys.has(code); }
  consumeAction(): boolean {
    const requested = this.actionRequested;
    this.actionRequested = false;
    return requested;
  }
  resetMobileMove(): void { this.mobileMove = { x: 0, y: 0 }; }
  resetMobileLook(): void { this.mobileLook = { x: 0, y: 0 }; }
  resetTransientInput(): void {
    this.keys.clear();
    this.actionHeld = false;
    this.resetMobileMove();
    this.resetMobileLook();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'KeyE') {
      this.actionHeld = true;
      if (!event.repeat) this.actionRequested = true;
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'KeyE') this.actionHeld = false;
  };
}
