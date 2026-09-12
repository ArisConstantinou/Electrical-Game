import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { RigTool } from '../player/FPSRig';

const stageLabel: Record<string, string> = {
  inspect: 'INSPECT & MARK', marked: 'CHASE MASONRY', chasing: 'CHASE MASONRY', chased: 'FIT BOXES', fitted: 'APPLY MORTAR',
  mortared: 'LEVEL GROUP', leveling: 'LEVEL + FLUSH', leveled: 'MEASURE PVC ROUTE', conduit: 'INSTALL 20 mm PVC', complete: 'POINT PASSED',
};

export class HUD {
  readonly shell: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly tool: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly levelPanel: HTMLElement;
  private readonly levelReadout: HTMLElement;
  private readonly result: HTMLElement;
  private messageUntil = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <main class="page-shell">
        <section id="game-shell" aria-label="WIRE THE HOUSE game area">
          <div id="game-stage"></div>
          <div id="top-hud" class="hud-card">
            <div class="mission-kicker">LIVING ROOM · FIRST FIX</div>
            <div id="objective">Approach Point A</div>
            <div class="progress-track"><span id="mission-progress"></span></div>
          </div>
          <div id="tool-status" class="hud-card"></div>
          <button id="settings-toggle" type="button" aria-label="Open settings" aria-expanded="false" aria-controls="settings-panel">
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13.2 3.5h5.6l.8 3.1 2.3 1.3 3-.9 2.8 4.8-2.2 2.2v2.7l2.2 2.2-2.8 4.8-3-.9-2.3 1.3-.8 3.1h-5.6l-.8-3.1-2.3-1.3-3 .9-2.8-4.8 2.2-2.2V14l-2.2-2.2L7.1 7l3 .9 2.3-1.3z"/><circle cx="16" cy="15.4" r="4.2"/></svg>
          </button>
          <div id="settings-scrim" aria-hidden="true"></div>
          <section id="settings-panel" class="hud-card" aria-label="Game settings" aria-hidden="true">
            <header><div><span>GAME</span><strong>SETTINGS</strong></div><button id="settings-close" type="button" aria-label="Close settings">×</button></header>
            <div id="spray-controls" aria-label="Spray settings">
              <button id="spray-color" type="button" aria-label="Change spray color"><span>SPRAY COLOR</span><span class="setting-value"><i></i><b>BLUE</b></span></button>
            </div>
            <div id="mobile-control-settings" aria-label="Mobile aim settings">
              <button id="aim-input-mode" type="button" aria-label="Change aim input style"><span>AIM INPUT</span><b>DRAG</b></button>
              <button id="aim-control-mode" type="button" aria-label="Change aim action mode"><span>AIM ACTION</span><b>AUTO USE</b></button>
              <button id="aim-speed" type="button" aria-label="Change aim sensitivity"><span>AIM SPEED</span><b>NORMAL</b></button>
              <button id="wall-assist" type="button" aria-label="Toggle automatic wall precision"><span>WALL ASSIST</span><b>AUTO</b></button>
              <small>DRAG follows your finger directly. AUTO USE sprays or hammers while you aim. WALL ASSIST adds precision near the wall.</small>
            </div>
          </section>
          <aside id="desktop-key-guide" class="hud-card" aria-label="Keyboard and mouse controls">
            <div><kbd>WASD</kbd><span>MOVE</span><kbd>MOUSE</kbd><span>LOOK</span><kbd>SHIFT</kbd><span>FAST</span></div>
            <div><kbd>LMB</kbd><span>USE / HOLD</span><kbd>E</kbd><span>INTERACT</span><kbd>WHEEL</kbd><span>SWITCH TOOL</span></div>
            <div><kbd>1–6</kbd><span>SELECT TOOL</span><kbd>V</kbd><span>SPRAY METHOD</span><kbd>C</kbd><span>COLOR</span></div>
            <div><kbd>X</kbd><span>HAMMER MODE</span><kbd>F</kbd><span>FULLSCREEN</span><kbd>ESC</kbd><span>RELEASE MOUSE</span></div>
          </aside>
          <div id="reticle" aria-hidden="true"><span></span><span></span></div>
          <div id="interaction-prompt" role="status"></div>
          <div id="level-panel" class="hud-card" aria-label="Leveling controls">
            <div class="level-title">SPIRIT LEVEL · FULL GROUP</div>
            <div class="spirit-visual" aria-label="Live spirit level bubble">
              <div class="spirit-vial"><span class="spirit-centre"></span><i id="spirit-bubble"></i></div>
              <div class="depth-visual"><span>WALL</span><i id="depth-marker"></i><span>FLUSH</span></div>
            </div>
            <div id="level-readout"></div>
            <div class="level-buttons">
              <button data-level="left">LEFT</button><button data-level="right">RIGHT</button>
              <button data-level="in">IN</button><button data-level="out">OUT</button>
              <button data-level="confirm" class="confirm">CONFIRM</button>
              <button data-level="cancel" class="cancel">EXIT LEVEL<span class="desktop-only"> · RMB</span></button>
            </div>
          </div>
          <div id="mobile-controls" aria-label="Mobile controls">
            <div id="joystick" aria-label="Movement joystick"><div class="joystick-ring"></div><div id="joystick-thumb"></div></div>
            <div id="look-joystick" aria-label="Drag aim pad; drag to aim and use spray or hammer"><div class="look-joystick-ring"></div><div id="look-joystick-thumb"><span id="mobile-action" aria-hidden="true">USE</span></div><div id="drag-aim-cue" aria-hidden="true"><span>＋</span><b>DRAG AIM</b></div><small id="aim-control-label">DRAG · AIM + SPRAY</small></div>
            <button id="tool-mode-toggle" type="button" aria-label="Change selected tool mode">
              <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 10h15l-3-3m3 3-3 3M25 22H10l3 3m-3-3 3-3"/></svg><span>LIVE</span>
            </button>
            <nav id="mobile-tool-slider" aria-label="Select tool">
              <button type="button" data-tool="spray" aria-label="Spray"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 9h11l3 5v14H7V14zM12 4h8v5h-8z"/><path d="M24 11h5M26 7l4-2M26 15l4 2"/></svg><span>SPRAY</span></button>
              <button type="button" data-tool="hammer" aria-label="Demolition hammer"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 8h17l5 5-5 5H5zM16 18v11"/></svg><span>HAMMER</span></button>
              <button type="button" data-tool="fitting" aria-label="Fitting box"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="6" width="22" height="21" rx="2"/><circle cx="16" cy="16.5" r="5"/><path d="M8 10h3M21 10h3"/></svg><span>BOX</span></button>
              <button type="button" data-tool="level" aria-label="Spirit level"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="9" width="26" height="14" rx="2"/><circle cx="16" cy="16" r="4"/><path d="M6 16h5M21 16h5"/></svg><span>LEVEL</span></button>
              <button type="button" data-tool="spring" aria-label="Bending spring"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 24c2-16 5-16 7 0 2-16 5-16 7 0 2-16 5-16 7 0M3 27h25"/></svg><span>SPRING</span></button>
              <button type="button" data-tool="cutter" aria-label="Pipe cutter"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="23" r="5"/><circle cx="23" cy="23" r="5"/><path d="M14 19 25 5M20 19 8 5M8 5h17"/></svg><span>CUTTER</span></button>
            </nav>
          </div>
          <section id="start-screen" class="screen-panel">
            <div class="eyebrow">CYPRUS · RESIDENTIAL FIRST FIX</div>
            <h1>WIRE<br><span>THE HOUSE</span></h1>
            <p>Mark the clay brick. Chase real masonry. Set every recessed box level and flush. Finish the rigid PVC routes before the builders plaster.</p>
            <div class="brief-grid"><span>3 installation points</span><span>No cable pulling</span><span>Desktop + mobile</span></div>
            <button id="start-button">ENTER THE SITE</button>
            <small>WASD · MOUSE LOOK · LEFT CLICK / E USE TOOL · WHEEL / 1–6 TOOLS · V SPRAY · C COLOR · X CHASE / DEMOLISH</small>
          </section>
          <section id="result-panel" class="screen-panel result-panel">
            <div class="eyebrow">LIVING ROOM · INSPECTION PASSED</div>
            <h2>FIRST FIX<br>COMPLETE</h2>
            <ul><li><span>Box alignment</span><b>PASS</b></li><li><span>Correct heights</span><b>PASS</b></li><li><span>Conduit completion</span><b>PASS</b></li><li><span>First-fix inspection</span><b>PASS</b></li></ul>
            <p>Cable pulling happens only after the builders plaster and the electrician returns.</p>
          </section>
        </section>
      </main>`;
    this.shell = root.querySelector('#game-shell')!;
    this.objective = root.querySelector('#objective')!;
    this.prompt = root.querySelector('#interaction-prompt')!;
    this.progress = root.querySelector('#mission-progress')!;
    this.tool = root.querySelector('#tool-status')!;
    this.reticle = root.querySelector('#reticle')!;
    this.levelPanel = root.querySelector('#level-panel')!;
    this.levelReadout = root.querySelector('#level-readout')!;
    this.result = root.querySelector('#result-panel')!;
    root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button => button.addEventListener('pointerdown', event => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('wirehouse:level', { detail: button.dataset.level }));
    }));
    root.querySelector('#spray-color')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-color')));
    root.querySelector('#aim-control-mode')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:cycle-aim-control')));
    root.querySelector('#aim-input-mode')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:cycle-aim-input')));
    root.querySelector('#aim-speed')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:cycle-aim-speed')));
    root.querySelector('#wall-assist')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:toggle-wall-assist')));
    root.querySelector('#tool-mode-toggle')?.addEventListener('click', event => {
      const kind = (event.currentTarget as HTMLButtonElement).dataset.modeKind;
      if (kind === 'spray') window.dispatchEvent(new CustomEvent('wirehouse:cycle-spray-mode'));
      if (kind === 'hammer') window.dispatchEvent(new CustomEvent('wirehouse:cycle-hammer-mode'));
    });
    const settingsToggle = root.querySelector<HTMLButtonElement>('#settings-toggle');
    const settingsPanel = root.querySelector<HTMLElement>('#settings-panel');
    const setSettingsOpen = (open: boolean): void => {
      settingsPanel?.classList.toggle('open', open);
      settingsPanel?.setAttribute('aria-hidden', String(!open));
      settingsToggle?.setAttribute('aria-expanded', String(open));
      settingsToggle?.setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
      this.shell.classList.toggle('settings-open', open);
      if (open && document.pointerLockElement) void document.exitPointerLock();
    };
    settingsToggle?.addEventListener('click', () => setSettingsOpen(settingsToggle.getAttribute('aria-expanded') !== 'true'));
    root.querySelector('#settings-close')?.addEventListener('click', () => setSettingsOpen(false));
    root.querySelector('#settings-scrim')?.addEventListener('click', () => setSettingsOpen(false));
    addEventListener('keydown', event => { if (event.key === 'Escape' && settingsToggle?.getAttribute('aria-expanded') === 'true') setSettingsOpen(false); });
  }

  onStart(callback: () => void): void {
    document.querySelector('#start-button')?.addEventListener('click', () => {
      document.querySelector('#start-screen')?.classList.add('hidden');
      callback();
    });
  }

  update(point: InstallationPoint | null, targeted: boolean, missionProgress: number, selectedTool: RigTool): void {
    this.progress.style.width = `${missionProgress}%`;
    this.reticle.classList.toggle('active', targeted);
    if (performance.now() > this.messageUntil) {
      this.prompt.textContent = '';
      this.prompt.classList.remove('visible', 'warning');
    }
    if (!point) {
      this.objective.textContent = 'Site ready for inspection';
      return;
    }
    this.objective.textContent = `${point.definition.label} · ${stageLabel[point.stage]}`;
    this.levelPanel.classList.toggle('visible', point.stage === 'leveling');
    if (point.stage === 'leveling') {
      const tilt = point.boxGroup.tiltDegrees;
      const depth = point.boxGroup.depthError * 1000;
      this.levelReadout.innerHTML = `<span class="${point.boxGroup.isLevel ? 'ok' : ''}">LEVEL ${tilt >= 0 ? '+' : ''}${tilt.toFixed(2)}°</span><span class="${point.boxGroup.isFlush ? 'ok' : ''}">DEPTH ${depth >= 0 ? '+' : ''}${depth.toFixed(1)} mm</span>`;
      const bubble = this.levelPanel.querySelector<HTMLElement>('#spirit-bubble');
      const depthMarker = this.levelPanel.querySelector<HTMLElement>('#depth-marker');
      if (bubble) bubble.style.transform = `translate(calc(-50% + ${Math.max(-76, Math.min(76, -tilt * 24))}px), -50%)`;
      if (depthMarker) depthMarker.style.left = `${50 + Math.max(-42, Math.min(42, depth * 2.5))}%`;
    }
    this.tool.innerHTML = `<span>SELECTED TOOL</span><b class="selected">${selectedTool.toUpperCase()}</b><em>LEFT CLICK TO USE</em>`;
    this.shell.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
      const selected = button.dataset.tool === selectedTool;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const modeToggle = this.shell.querySelector<HTMLButtonElement>('#tool-mode-toggle');
    const hasContextMode = selectedTool === 'spray' || selectedTool === 'hammer';
    modeToggle?.classList.toggle('visible', hasContextMode);
    if (modeToggle) modeToggle.dataset.modeKind = hasContextMode ? selectedTool : '';
    this.shell.dataset.aimed = targeted ? 'true' : 'false';
  }

  notify(message: string, good = true): void {
    this.prompt.textContent = message;
    this.prompt.classList.toggle('warning', !good);
    this.prompt.classList.add('visible');
    this.messageUntil = performance.now() + 700;
  }

  showResult(): void { this.result.classList.add('visible'); }

  updateSprayControls(mode: string, colorName: string, colorCss: string, visible: boolean): void {
    const panel = this.shell.querySelector<HTMLElement>('#spray-controls');
    if (!panel) return;
    panel.dataset.activeTool = String(visible);
    const modeText = this.shell.querySelector<HTMLElement>('#tool-mode-toggle span');
    const colorText = panel.querySelector<HTMLElement>('#spray-color b');
    const swatch = panel.querySelector<HTMLElement>('#spray-color i');
    if (visible && modeText) modeText.textContent = mode.toUpperCase();
    if (colorText) colorText.textContent = colorName;
    if (swatch) swatch.style.background = colorCss;
  }

  updateHammerControls(mode: string, visible: boolean): void {
    const modeText = this.shell.querySelector<HTMLElement>('#tool-mode-toggle span');
    if (visible && modeText) modeText.textContent = mode.toUpperCase();
  }

  updateAimControl(mode: 'auto-use' | 'double-tap'): void {
    const modeText = this.shell.querySelector<HTMLElement>('#aim-control-mode b');
    const thumbText = this.shell.querySelector<HTMLElement>('#mobile-action');
    const hint = this.shell.querySelector<HTMLElement>('#aim-control-label');
    if (modeText) modeText.textContent = mode === 'auto-use' ? 'AUTO USE' : '2× HOLD';
    if (thumbText) thumbText.textContent = mode === 'auto-use' ? 'USE' : '2×';
    if (hint) hint.textContent = mode === 'auto-use' ? 'AIM · AUTO TOOL' : 'AIM · 2× HOLD';
    const look = this.shell.querySelector<HTMLElement>('#look-joystick');
    look?.setAttribute('aria-label', mode === 'auto-use' ? 'Aim joystick; move it to use spray or hammer' : 'Aim joystick; double tap and hold center to use selected tool');
  }

  updateAimSpeed(profile: 'precise' | 'normal' | 'fast'): void {
    const profileText = this.shell.querySelector<HTMLElement>('#aim-speed b');
    if (profileText) profileText.textContent = profile.toUpperCase();
  }

  updateWallAssist(enabled: boolean): void {
    const assistText = this.shell.querySelector<HTMLElement>('#wall-assist b');
    if (assistText) assistText.textContent = enabled ? 'AUTO' : 'OFF';
  }

  updateAimInput(mode: 'drag' | 'stick'): void {
    const inputText = this.shell.querySelector<HTMLElement>('#aim-input-mode b');
    if (inputText) inputText.textContent = mode.toUpperCase();
    this.shell.classList.toggle('aim-input-drag', mode === 'drag');
    const look = this.shell.querySelector<HTMLElement>('#look-joystick');
    look?.setAttribute('aria-label', mode === 'drag' ? 'Drag aim pad; drag to aim and use spray or hammer' : 'Aim joystick; move it to use spray or hammer');
    const hint = this.shell.querySelector<HTMLElement>('#aim-control-label');
    const autoUse = this.shell.querySelector<HTMLElement>('#aim-control-mode b')?.textContent === 'AUTO USE';
    if (hint) hint.textContent = mode === 'drag' ? (autoUse ? 'DRAG · AIM + SPRAY' : 'DRAG · AIM') : (autoUse ? 'AIM · AUTO TOOL' : 'AIM · 2× HOLD');
  }
}
