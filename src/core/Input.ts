export class Input {
  readonly keys = new Set<string>();
  mobileMove = { x: 0, y: 0 };
  actionRequested = false;

  constructor() {
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', () => this.keys.clear());
  }

  pressed(code: string): boolean { return this.keys.has(code); }
  consumeAction(): boolean {
    const requested = this.actionRequested;
    this.actionRequested = false;
    return requested;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'KeyE' && !event.repeat) this.actionRequested = true;
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
}
