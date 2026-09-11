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
          <div id="reticle" aria-hidden="true"><span></span><span></span></div>
          <div id="interaction-prompt" role="status"></div>
          <div id="level-panel" class="hud-card" aria-label="Leveling controls">
            <div class="level-title">SPIRIT LEVEL · FULL GROUP</div>
            <div id="level-readout"></div>
            <div class="level-buttons">
              <button data-level="left">LEFT</button><button data-level="right">RIGHT</button>
              <button data-level="in">IN</button><button data-level="out">OUT</button>
              <button data-level="confirm" class="confirm">CONFIRM</button>
            </div>
          </div>
          <div id="mobile-controls" aria-label="Mobile controls">
            <div id="joystick" aria-label="Movement joystick"><div class="joystick-ring"></div><div id="joystick-thumb"></div></div>
            <div class="mobile-actions">
              <button id="mobile-action">ACTION</button>
              <div><button id="tool-prev" aria-label="Previous tool">◀ TOOL</button><button id="tool-next" aria-label="Next tool">TOOL ▶</button></div>
            </div>
          </div>
          <section id="start-screen" class="screen-panel">
            <div class="eyebrow">CYPRUS · RESIDENTIAL FIRST FIX</div>
            <h1>WIRE<br><span>THE HOUSE</span></h1>
            <p>Mark the clay brick. Chase real masonry. Set every recessed box level and flush. Finish the rigid PVC routes before the builders plaster.</p>
            <div class="brief-grid"><span>3 installation points</span><span>No cable pulling</span><span>Desktop + mobile</span></div>
            <button id="start-button">ENTER THE SITE</button>
            <small>WASD · MOUSE LOOK · E ACTION · WHEEL CYCLES TOOLS · 1/2 SPRING/CUTTER</small>
          </section>
          <section id="result-panel" class="screen-panel result-panel">
            <div class="eyebrow">LIVING ROOM · INSPECTION PASSED</div>
            <h2>FIRST FIX<br>COMPLETE</h2>
            <ul><li><span>Box alignment</span><b>PASS</b></li><li><span>Correct heights</span><b>PASS</b></li><li><span>Conduit completion</span><b>PASS</b></li><li><span>First-fix inspection</span><b>PASS</b></li></ul>
            <p>Cable pulling happens only after the builders plaster and the electrician returns.</p>
          </section>
        </section>
        <footer class="page-footer"><b>WIRE THE HOUSE</b><span>A focused first-fix vertical slice based on Cyprus field practice.</span></footer>
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
    }
    this.tool.innerHTML = `<span>SELECTED TOOL</span><b class="selected">${selectedTool.toUpperCase()}</b>`;
    this.shell.dataset.aimed = targeted ? 'true' : 'false';
  }

  notify(message: string, good = true): void {
    this.prompt.textContent = message;
    this.prompt.classList.toggle('warning', !good);
    this.prompt.classList.add('visible');
    this.messageUntil = performance.now() + 700;
  }

  showResult(): void { this.result.classList.add('visible'); }
}
