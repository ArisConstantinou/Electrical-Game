export class MobileHUD {
  readonly active = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  constructor() { document.documentElement.classList.toggle('touch-device', this.active); }
}
