import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { RigTool } from '../player/FPSRig';
import { WATER_GUN_MODES, type WaterGunSetting } from '../systems/WaterGun';

export interface MortarThrowFeedback {
  holding: boolean;
  phase: number;
  quality: 'ready' | 'early' | 'perfect' | 'late';
  swingDegrees: number;
  strength: number;
  splash: number;
  lastRelease: number;
}

const stageLabel: Record<string, string> = {
  inspect: 'CHOOSE A CAVITY · MARKS OPTIONAL', marked: 'CHASE MASONRY', chasing: 'CHASE MASONRY', chased: 'FIT BOXES', fitted: 'APPLY MORTAR',
  mortared: 'LEVEL GROUP', leveling: 'LEVEL + FLUSH', leveled: 'MEASURE PVC ROUTE', conduit: 'INSTALL 20 mm PVC', complete: 'POINT PASSED',
};

const compactStage:Record<string,string>={inspect:'CHOOSE CAVITY',marked:'CHASE',chasing:'CHASE',chased:'FIT BOXES',fitted:'MORTAR',mortared:'LEVEL',leveling:'LEVEL',leveled:'PVC ROUTE',conduit:'INSTALL PVC',complete:'PASSED'};

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
  private readonly chiselOrientation: HTMLElement;
  private chiselOrientationKey = '';
  private chiselFlat = true;
  private messageUntil = 0;
  private selectedTool: RigTool = 'spray';
  private readonly displayKeys = new Map<string, string>();

  private displayChanged(name:string,key:string):boolean {
    if(this.displayKeys.get(name)===key)return false;
    this.displayKeys.set(name,key);return true;
  }

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <main class="page-shell">
        <section id="game-shell" aria-label="WIRE THE HOUSE game area">
          <div id="game-stage"></div>
          <div id="top-hud" class="hud-card">
            <div class="mission-kicker">LIVING ROOM · FIRST FIX</div>
            <div id="objective">Approach Point A</div><div id="objective-compact">Approach Point A</div>
            <div class="progress-track"><span id="mission-progress"></span></div>
          </div>
          <div id="tool-status" class="hud-card"></div>
          <aside id="chisel-orientation" class="hud-card" aria-label="Chisel orientation" hidden>
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <circle class="chisel-dial-ring" cx="24" cy="24" r="19"/>
              <path class="chisel-dial-axes" d="M24 2v8M24 38v8M2 24h8M38 24h8"/>
              <g id="chisel-edge-blade" transform="rotate(0 24 24)"><rect id="chisel-edge-shape" x="9" y="20" width="30" height="8" rx="1"/><path id="chisel-edge-bevel" d="M9 21h30"/></g>
              <circle id="chisel-point-marker" cx="24" cy="24" r="5" fill="#d8e0df" stroke="#f8be79" stroke-width="2" style="display:none"/>
              <circle class="chisel-dial-pivot" cx="24" cy="24" r="2"/>
            </svg>
            <div class="chisel-orientation-values"><div><strong><span id="chisel-edge-label">EDGE</span> <output id="chisel-edge-degrees">0°</output></strong><span id="chisel-live-width">50 mm</span></div><div class="chisel-aim-values"><span id="chisel-live-tilt">TILT 15° ↓</span><span id="chisel-requested-tilt" hidden></span><span id="chisel-live-side">SIDE 15° →</span></div><div class="hammer-view-buttons" role="group" aria-label="Hammer screen side"><button id="hammer-view-left" type="button" aria-label="Hold hammer on the left" aria-pressed="false">TOOL LEFT</button><button id="hammer-view-right" type="button" aria-label="Hold hammer on the right" aria-pressed="true">TOOL RIGHT</button></div></div>
          </aside>
          <button id="settings-toggle" type="button" aria-label="Open settings" aria-expanded="false" aria-controls="settings-panel">
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13.2 3.5h5.6l.8 3.1 2.3 1.3 3-.9 2.8 4.8-2.2 2.2v2.7l2.2 2.2-2.8 4.8-3-.9-2.3 1.3-.8 3.1h-5.6l-.8-3.1-2.3-1.3-3 .9-2.8-4.8 2.2-2.2V14l-2.2-2.2L7.1 7l3 .9 2.3-1.3z"/><circle cx="16" cy="15.4" r="4.2"/></svg>
          </button>
          <div id="settings-scrim" aria-hidden="true"></div>
          <section id="settings-panel" class="hud-card" aria-label="Game settings" aria-hidden="true">
            <header><div><span>GAME</span><strong>SETTINGS</strong></div><button id="settings-close" type="button" aria-label="Close settings">×</button></header>
            <div id="spray-controls" aria-label="Spray settings">
              <button id="spray-color" type="button" aria-label="Change spray color"><span>SPRAY COLOR</span><span class="setting-value"><i></i><b>BLUE</b></span></button>
            </div>
            <div id="chisel-settings" aria-label="Demolition chisel settings">
              <button id="chisel-type" type="button"><span>CHISEL · T</span><b>FLAT</b></button>
              <label class="hammer-speed-setting" for="chisel-width"><span>BLADE WIDTH · , / .</span><output id="chisel-width-value">5.0 cm</output><input id="chisel-width" type="range" min="10" max="50" step="5" value="50" aria-label="Flat chisel width in millimetres"><small id="chisel-width-hint">1–5 cm · wider blade, broader chips</small></label>
              <button id="chisel-tilt" type="button"><span>HAMMER TILT · [ / ]</span><b>15 deg DOWN</b></button>
              <button id="hammer-view-toggle" type="button"><span>HAMMER SIDE · Q</span><b>RIGHT</b></button>
              <button id="chisel-side" type="button"><span>TOOL SIDE / J LEFT · K RIGHT</span><b>15 deg RIGHT</b></button>
              <button id="chisel-angle" type="button"><span>EDGE ANGLE · R</span><b>0°</b></button>
              <label class="hammer-speed-setting" for="hammer-speed"><span>CHISEL SPEED · − / +</span><output id="hammer-speed-value">250%</output><input id="hammer-speed" type="range" min="0" max="800" step="25" value="250" aria-label="Chisel destruction speed"><small>0% stop · 100% precise · 250% normal · 400–800% fast. Hold use + A / D to cut along the wall.</small></label>
            </div>
            <label class="hammer-speed-setting" for="water-gun-mode"><span>WATER GUN | FLOW</span><select id="water-gun-mode" aria-label="Water gun flow mode">${WATER_GUN_MODES.map(mode=>`<option value="${mode.id}" ${mode.id==='flood'?'selected':''}>${mode.label} | ${mode.flowLitresPerSecond} L/s</option>`).join('')}</select><small>FLOOD fills the room with boosted game flow. Choose MIST for gentle chase wetting.</small></label>
            <details id="mortar-settings"><summary>TROWEL / WATER</summary>
              <p>Hold the aim pad or mouse button, then release in the green zone. Adjust the loft or pack nearby mortar here.</p>
            <div class="mortar-buttons"><button type="button" id="mortar-angle-down" aria-label="Lower trowel throw angle">− ANGLE</button><button type="button" id="mortar-swing">HOLD · RELEASE</button><button type="button" id="mortar-angle-up" aria-label="Raise trowel throw angle">+ ANGLE</button></div>
            <button type="button" id="work-height">CROUCH · LOW WORK</button><button type="button" id="mortar-pack">P · PRESS / PACK NEARBY</button><small id="mortar-hint"></small>
            </details>
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
            <div><kbd>1–8</kbd><span>SELECT TOOL</span><kbd>[ / ]</kbd><span>HAMMER TILT</span><kbd>C</kbd><span>COLOR</span></div>
            <div><kbd>Q</kbd><span>TOOL SIDE</span><kbd>T / R</kbd><span>CHISEL / ANGLE</span><kbd>F</kbd><span>FULLSCREEN</span><kbd>ESC</kbd><span>RELEASE MOUSE</span></div>
          </aside>
          <div id="mortar-panel" class="hud-card" hidden>
            <strong id="mortar-readout"></strong><div id="water-gun-readout" hidden></div>
            <div id="mortar-flow" data-quality="ready" data-holding="false">
              <div class="throw-flow-heading"><span>RELEASE TIMING</span><b id="throw-quality">HOLD TO SWING</b></div>
              <div id="throw-timing-track" role="meter" aria-label="Mortar release timing; perfect from 42 to 58 percent" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span class="throw-perfect-zone"></span><span class="throw-flow-sheen"></span><i id="throw-timing-cursor"></i>
              </div>
              <div class="throw-zone-labels"><span>WEAK BOND</span><b>PERFECT</b><span>SPLASH BACK</span></div>
            </div>
            <div id="mortar-wet-track" class="progress-track"><span id="swing-power"></span></div>

          <aside id="trowel-swing-gauge" class="hud-card" aria-label="Live trowel swing and strength" hidden>
            <div class="swing-gauge-title">TROWEL SWING</div>
            <svg class="swing-gauge-dial" viewBox="0 0 160 94" aria-hidden="true">
              <path class="swing-gauge-rail" d="M 24 77 A 60 60 0 1 1 136 77"/>
              <path class="swing-gauge-sweet" d="M 69 18 A 60 60 0 0 1 91 18"/>
              <g id="trowel-swing-needle" transform="rotate(-70 80 73)"><path d="M 80 73 L 80 22"/><path class="swing-needle-tip" d="M 76 26 L 80 17 L 84 26 Z"/></g>
              <circle class="swing-gauge-pivot" cx="80" cy="73" r="5"/>
            </svg>
            <output id="trowel-swing-degrees">−50°</output>
            <div class="swing-strength-label"><span>POWER</span><b id="trowel-swing-strength">0%</b></div>
            <div class="swing-strength-track"><span id="trowel-strength-fill"></span></div>
          </aside>
          </div>
          <div id="mortar-face-splash" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
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
              <button type="button" data-tool="trowel" aria-label="Mortar trowel"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m3 27 5-17 14 9zM15 15l5-7 8-4"/></svg><span>TROWEL</span></button>
              <button type="button" data-tool="hose" aria-label="Water hose"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m5 9 14 4-4 7-8-4zM10 18v8c0 5 14 4 15 0M22 10l6-3M23 15h6M21 20l6 3"/></svg><span>HOSE</span></button>
            </nav>
          </div>
          <section id="start-screen" class="screen-panel">
            <div class="eyebrow">CYPRUS · RESIDENTIAL FIRST FIX</div>
            <h1>WIRE<br><span>THE HOUSE</span></h1>
            <p>Choose where to work; spray marks are optional. Chase real masonry, pack the recess and set each box level and flush. Finish the PVC routes before plastering.</p>
            <div class="brief-grid"><span>3 installation points</span><span>No cable pulling</span><span>Desktop + mobile</span></div>
            <button id="start-button">ENTER THE SITE</button>
            <small>WASD · MOUSE LOOK · LEFT CLICK / E USE TOOL · WHEEL / 1–8 TOOLS · V SPRAY · C COLOR · X CHASE / DEMOLISH</small>
          </section>
          <section id="result-panel" class="screen-panel result-panel">
            <div class="eyebrow">LIVING ROOM · INSPECTION PASSED</div>
            <h2>FIRST FIX<br>COMPLETE</h2>
            <ul><li><span>Box alignment</span><b>PASS</b></li><li><span>Correct heights</span><b>PASS</b></li><li><span>Conduit completion</span><b>PASS</b></li><li><span>First-fix inspection</span><b>PASS</b></li></ul>
            <p>Cable pulling happens only after the builders plaster and the electrician returns.</p>
          </section>
        </section>
      </main>`;
    root.querySelector('#chisel-type')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:cycle-chisel')));
    root.querySelector('#chisel-side')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:side-chisel')));
    root.querySelector('#hammer-view-left')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:hammer-view-side',{detail:1})));
    root.querySelector('#hammer-view-right')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:hammer-view-side',{detail:-1})));
    root.querySelector('#hammer-view-toggle')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:hammer-view-side',{detail:0})));
    root.querySelector('#chisel-tilt')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:tilt-chisel')));
    root.querySelector('#chisel-angle')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wirehouse:rotate-chisel')));
    root.querySelector<HTMLInputElement>('#chisel-width')!.addEventListener('input',event=>dispatchEvent(new CustomEvent('wirehouse:chisel-width',{detail:Number((event.target as HTMLInputElement).value)/1000})));
    root.querySelector<HTMLInputElement>('#hammer-speed')!.addEventListener('input',event=>dispatchEvent(new CustomEvent('wirehouse:hammer-speed',{detail:Number((event.target as HTMLInputElement).value)/100})));
    root.querySelector('#work-height')!.addEventListener('click',()=>dispatchEvent(new CustomEvent('wirehouse:work-height')));
    root.querySelector('#mortar-pack')!.addEventListener('click',()=>dispatchEvent(new CustomEvent('wirehouse:mortar-pack')));
    root.querySelector('#mortar-angle-down')!.addEventListener('click',()=>dispatchEvent(new CustomEvent('wirehouse:mortar-angle',{detail:-5})));
    root.querySelector('#mortar-angle-up')!.addEventListener('click',()=>dispatchEvent(new CustomEvent('wirehouse:mortar-angle',{detail:5})));
    this.shell = root.querySelector('#game-shell')!;
    this.objective = root.querySelector('#objective')!;
    this.prompt = root.querySelector('#interaction-prompt')!;
    this.progress = root.querySelector('#mission-progress')!;
    this.tool = root.querySelector('#tool-status')!;
    this.reticle = root.querySelector('#reticle')!;
    this.levelPanel = root.querySelector('#level-panel')!;
    this.levelReadout = root.querySelector('#level-readout')!;
    this.result = root.querySelector('#result-panel')!;
    this.chiselOrientation = root.querySelector('#chisel-orientation')!;
    // Native click completes before confirm/cancel hides the panel, and also
    // supports keyboard activation without a pointer-down UI race.
    root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button => button.addEventListener('click', event => {
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
      if (kind === 'hose') window.dispatchEvent(new CustomEvent('wirehouse:cycle-water-mode'));
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

  updateWorkReticle(point: { x: number; y: number; z: number } | null): void {
    if(!this.displayChanged('reticle',point?`${point.x}:${point.y}:${point.z}`:'center'))return;
    this.reticle.style.left = point ? `${(point.x + 1) * 50}%` : '50%';
    this.reticle.style.top = point ? `${(1 - point.y) * 50}%` : '50%';
    this.reticle.hidden = !!point && (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1);
  }

  onStart(callback: () => void): void {
    document.querySelector('#start-button')?.addEventListener('click', () => {
      document.querySelector('#start-screen')?.classList.add('hidden');
      callback();
    });
  }

  update(point: InstallationPoint | null, targeted: boolean, missionProgress: number, selectedTool: RigTool): void {
    if (this.messageUntil > 0 && performance.now() > this.messageUntil) {
      this.prompt.textContent = '';this.prompt.classList.remove('visible', 'warning');this.messageUntil=0;
    }
    const placement=point?.boxGroup.userData.placement;
    const loose=placement&&!placement.secured;
    const floor=loose&&placement.state==='floor';
    const key=[selectedTool,targeted,missionProgress,point?.definition.id,point?.definition.label,point?.stage,!!loose,!!floor,point?.stage==='leveling'?point.boxGroup.tiltDegrees:'',point?.stage==='leveling'?point.boxGroup.depthError:''].join(':');
    if(!this.displayChanged('objective',key))return;
    const toolChanged=this.displayChanged('tool',selectedTool);
    this.selectedTool = selectedTool;
    this.chiselOrientation.hidden = selectedTool !== 'hammer';
    this.shell.dataset.activeTool=selectedTool;
    this.shell.classList.toggle('mortar-tool',selectedTool==='trowel'||selectedTool==='hose');
    this.progress.style.width = `${missionProgress}%`;
    this.reticle.classList.toggle('active', targeted);
    if(toolChanged)this.tool.innerHTML = `<span>SELECTED TOOL</span><b class="selected">${selectedTool.toUpperCase()}</b><em>${selectedTool==='trowel'?'HOLD · RELEASE':selectedTool==='hose'?'HOLD TO SPRAY':'LEFT CLICK TO USE'}</em>`;
    if (!point) {
      this.objective.textContent = 'Site ready for inspection';
      this.shell.querySelector('#objective-compact')!.textContent = 'SITE / INSPECTION';
      return;
    }
    this.objective.textContent = `${point.definition.label} · ${floor?'RETRIEVE BOX WITH BOX TOOL':loose?'TRIAL FIT · CHECK DEPTH AND SUPPORT':stageLabel[point.stage]}`;
    this.shell.querySelector('#objective-compact')!.textContent = `${point.definition.label.split(' · ')[0]} · ${floor?'RETRIEVE BOX':loose?'TRIAL FIT':compactStage[point.stage]??'WORK'}`;
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
    this.shell.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach(button => {
      const selected = button.dataset.tool === selectedTool;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      if(selected&&toolChanged){const nav=button.parentElement!;nav.scrollLeft=button.offsetLeft-(nav.clientWidth-button.offsetWidth)/2;}
    });
    const modeToggle = this.shell.querySelector<HTMLButtonElement>('#tool-mode-toggle');
    const hasContextMode = selectedTool === 'spray' || selectedTool === 'hammer' || selectedTool === 'hose';
    modeToggle?.classList.toggle('visible', hasContextMode);
    if (modeToggle) modeToggle.dataset.modeKind = hasContextMode ? selectedTool : '';
    this.shell.dataset.aimed = targeted ? 'true' : 'false';
  }

  updateWaterGun(setting:WaterGunSetting,floorLitres:number,depthMm:number):void {
    const key=[this.selectedTool,setting.id,this.selectedTool==='hose'?Math.round(floorLitres):'',this.selectedTool==='hose'?(depthMm/10).toFixed(1):''].join(':');
    if(!this.displayChanged('water',key))return;
    const select=this.shell.querySelector<HTMLSelectElement>('#water-gun-mode')!;select.value=setting.id;
    const readout=this.shell.querySelector<HTMLElement>('#water-gun-readout')!;readout.hidden=this.selectedTool!=='hose';
    if(this.selectedTool==='hose')this.shell.querySelector<HTMLElement>('#mortar-readout')!.textContent=setting.id==='flood'?'FLOOD | HOLD TO FILL ROOM':`${setting.label} | ${setting.speedMps} m/s`;
    readout.textContent=`LEVEL ${(depthMm/10).toFixed(1)} cm | ${Math.round(floorLitres).toLocaleString('en')} L | ${setting.flowLitresPerSecond} L/s`;
    if(this.selectedTool==='hose')this.shell.querySelector<HTMLElement>('#tool-mode-toggle span')!.textContent=setting.label;
  }

  updateHammerSpeed(speed:number):void {
    this.shell.querySelector<HTMLInputElement>('#hammer-speed')!.value=String(speed*100);
    this.shell.querySelector<HTMLOutputElement>('#hammer-speed-value')!.textContent=speed===0?'STOPPED':`${Math.round(speed*100)}%`;
  }
  updateChiselWidth(widthM:number,flat:boolean):void {
    this.chiselFlat=flat;
    const slider=this.shell.querySelector<HTMLInputElement>('#chisel-width')!;
    slider.value=String(Math.round(widthM*1000));slider.disabled=!flat;
    this.shell.querySelector<HTMLOutputElement>('#chisel-width-value')!.textContent=`${(widthM*100).toFixed(1)} cm`;
    this.shell.querySelector<HTMLElement>('#chisel-width-hint')!.textContent=flat?'1–5 cm · wider blade, broader chips':'Select FLAT to adjust blade width';
  }
  updateHammerSide(requestedSideDegrees:number):void {
    const side=requestedSideDegrees>0?'left':requestedSideDegrees<0?'right':'center';
    if(!this.displayChanged('hammer-side',side))return;
    this.shell.querySelector('#hammer-view-left')!.setAttribute('aria-pressed',String(side==='left'));
    this.shell.querySelector('#hammer-view-right')!.setAttribute('aria-pressed',String(side==='right'));
    this.shell.querySelector('#hammer-view-toggle b')!.textContent=side.toUpperCase();
  }
  updateChiselOrientation(edgeDegrees:number,tiltDegrees:number,sideDegrees:number,widthM:number,requestedTiltDegrees=tiltDegrees):void {
    const edge=((edgeDegrees%360)+360)%360;
    const width=Math.round(widthM*1000),tilt=Math.round(tiltDegrees),side=Math.round(sideDegrees);
    const requested=Math.round(requestedTiltDegrees),adapted=Math.abs(requestedTiltDegrees-tiltDegrees)>1;
    const key=`${edge.toFixed(2)}:${tilt}:${side}:${width}:${requested}:${adapted}:${this.chiselFlat}`;
    if(key===this.chiselOrientationKey)return;
    this.chiselOrientationKey=key;
    // The real blade rotates around local +Z. SVG Y points down, so its
    // screen rotation must have the opposite sign to the tool geometry.
    const blade=this.chiselOrientation.querySelector<SVGElement>('#chisel-edge-blade')!;
    blade.setAttribute('transform',`rotate(${-edge} 24 24)`);blade.style.display=this.chiselFlat?'':'none';
    this.chiselOrientation.querySelector<SVGElement>('#chisel-point-marker')!.style.display=this.chiselFlat?'none':'';
    const bladeWidth=Math.max(8,Math.min(30,width/50*30)),left=24-bladeWidth/2;
    const shape=this.chiselOrientation.querySelector('#chisel-edge-shape')!;
    shape.setAttribute('x',String(left));shape.setAttribute('width',String(bladeWidth));
    this.chiselOrientation.querySelector('#chisel-edge-bevel')!.setAttribute('d',`M${left} 21h${bladeWidth}`);
    const edgeOutput=this.chiselOrientation.querySelector<HTMLOutputElement>('#chisel-edge-degrees')!;
    edgeOutput.textContent=`${Math.round(edge)}°`;edgeOutput.hidden=!this.chiselFlat;
    this.chiselOrientation.querySelector('#chisel-edge-label')!.textContent=this.chiselFlat?'EDGE':'CHISEL';
    this.chiselOrientation.querySelector('#chisel-live-width')!.textContent=this.chiselFlat?`${width} mm`:'POINT';
    this.chiselOrientation.querySelector('#chisel-live-tilt')!.textContent=`TILT ${Math.abs(tilt)}°${tilt<0?' ↑':tilt>0?' ↓':''}`;
    const target=this.chiselOrientation.querySelector<HTMLElement>('#chisel-requested-tilt')!;
    target.hidden=!adapted;target.textContent=adapted?`SET ${Math.abs(requested)}°${requested<0?' ↑':requested>0?' ↓':''}`:'';
    this.chiselOrientation.querySelector('#chisel-live-side')!.textContent=`SIDE ${Math.abs(side)}°${side>0?' ←':side<0?' →':''}`;
    this.chiselOrientation.setAttribute('aria-label',`${this.chiselFlat?`Flat chisel edge ${Math.round(edge)} degrees, blade ${width} millimetres`:'Pointed chisel'}, tilt ${tilt} degrees${adapted?`, selected tilt ${requested} degrees`:''}, side ${side} degrees`);
  }
  updateMortar(tool:RigTool,power:number,angle:number,wet:{pore:number;film:number},coverage:number,recovery:number,outcome:string,floorLitres=0,feedback?:MortarThrowFeedback):void {
    const key=tool==='trowel'||tool==='hose'
      ? JSON.stringify([tool,power,angle,Math.round(wet.pore*100),wet.film>.3,wet.pore>.3,Math.round(coverage*100),recovery>0,outcome,floorLitres.toFixed(1),feedback])
      : `${tool}:${feedback?.splash??0}`;
    if(!this.displayChanged('mortar',key))return;
    const panel=this.shell.querySelector<HTMLElement>('#mortar-panel')!;panel.hidden=tool!=='trowel'&&tool!=='hose';
    // Water mode owns this shared readout while the hose is selected.
    if(tool!=='hose')this.shell.querySelector<HTMLElement>('#mortar-readout')!.textContent=`LOFT ${angle}° · BED ${Math.round(coverage*100)}%`;
    this.shell.querySelector<HTMLElement>('#swing-power')!.style.width=`${tool==='hose'?wet.pore*100:power*100}%`;
    this.shell.querySelector<HTMLElement>('#mortar-hint')!.textContent=tool==='hose'?`Soak exposed chase surfaces. Excess water washes fresh mortar away. Floor water: ${floorLitres.toFixed(1)} L.`:recovery>0?'Recovering / loading next trowelful…':outcome;
    this.shell.querySelector<HTMLElement>('#mortar-swing')!.textContent=tool==='hose'?'HOLD · MIST':'HOLD · RELEASE';
    this.shell.querySelector<HTMLElement>('#mortar-pack')!.hidden=tool==='hose';
    for(const id of ['#mortar-angle-up','#mortar-angle-down'])this.shell.querySelector<HTMLElement>(id)!.hidden=tool==='hose';
    const active=tool==='trowel';
    panel.dataset.activeTool=tool;
    const flow=this.shell.querySelector<HTMLElement>('#mortar-flow')!;
    const gauge=this.shell.querySelector<HTMLElement>('#trowel-swing-gauge')!;
    flow.hidden=!active;gauge.hidden=!active;
    this.shell.querySelector<HTMLElement>('#mortar-wet-track')!.hidden=tool!=='hose';
    const state=feedback??{holding:false,phase:power,quality:'ready',swingDegrees:-50+power*140,strength:power,splash:0,lastRelease:0};
    const phase=Math.max(0,Math.min(1,state.phase));
    const strength=Math.max(0,Math.min(1,state.strength));
    panel.dataset.holding=String(state.holding);
    flow.dataset.quality=state.quality;flow.dataset.holding=String(state.holding);gauge.dataset.quality=state.quality;
    this.shell.querySelector<HTMLElement>('#throw-timing-cursor')!.style.left=`${phase*100}%`;
    this.shell.querySelector<HTMLElement>('#throw-timing-track')!.setAttribute('aria-valuenow',String(Math.round(phase*100)));
    const qualityText=state.quality==='perfect'?'RELEASE NOW':state.quality==='early'?'BUILD THE SWING':state.quality==='late'?'LATE · SPLASH RISK':'HOLD TO SWING';
    this.shell.querySelector<HTMLElement>('#throw-quality')!.textContent=state.holding?qualityText:recovery>0?(state.quality==='perfect'?'PERFECT RELEASE':state.quality==='early'?'EARLY RELEASE':state.quality==='late'?'LATE RELEASE':'RELOADING'):'HOLD TO SWING';
    this.shell.querySelector<HTMLElement>('#trowel-swing-degrees')!.textContent=`${Math.round(state.swingDegrees)}°`;
    this.shell.querySelector<SVGElement>('#trowel-swing-needle')!.setAttribute('transform',`rotate(${Math.max(-70,Math.min(70,state.swingDegrees-20))} 80 73)`);
    this.shell.querySelector<HTMLElement>('#trowel-swing-strength')!.textContent=`${Math.round(strength*100)}%`;
    this.shell.querySelector<HTMLElement>('#trowel-strength-fill')!.style.width=`${strength*100}%`;
    if(active&&state.holding)this.shell.querySelector<HTMLElement>('#mortar-swing')!.textContent=state.quality==='perfect'?'RELEASE NOW':'SWINGING…';
    if(active&&state.holding)this.shell.querySelector<HTMLElement>('#mortar-hint')!.textContent=state.quality==='perfect'?'Release now for a clean throw into the chase.':state.quality==='late'?'The swing is late: more power sends more mortar back toward you.':'Keep holding toward the green centre; an early throw can slip and fall.';
    if(active&&state.quality==='ready'&&!recovery)this.shell.querySelector<HTMLElement>('#mortar-hint')!.textContent='Hold, then release in the green centre. Early throws can fall; late throws splash back.';
    const splash=this.shell.querySelector<HTMLElement>('#mortar-face-splash')!;
    const splashAmount=Math.max(0,Math.min(1,state.splash));
    splash.style.opacity=String(splashAmount*.84);
    splash.style.setProperty('--splash-scale',String(.7+splashAmount*.3));
  }
  notify(message: string, good = true, duration = 700): void {
    this.prompt.textContent = message;
    this.prompt.classList.toggle('warning', !good);
    this.prompt.classList.add('visible');
    this.messageUntil = performance.now() + duration;
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

  updateHammerControls(mode: string, visible: boolean, trimming = false): void {
    const modeText = this.shell.querySelector<HTMLElement>('#tool-mode-toggle span');
    if (visible && modeText) modeText.textContent = mode.toUpperCase();
    if (visible) this.tool.querySelector('em')!.textContent = trimming ? 'UP · EDGE CLEANUP' : 'LEFT CLICK TO USE';
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
    const dragAction = this.selectedTool === 'spray' ? 'AIM + SPRAY' : this.selectedTool === 'hammer' ? 'AIM + HAMMER' : this.selectedTool === 'hose' ? 'AIM + WATER' : this.selectedTool === 'trowel' ? 'HOLD · RELEASE' : 'RELEASE TO USE';
    if (hint) hint.textContent = mode === 'drag' ? (autoUse ? `DRAG · ${dragAction}` : 'DRAG · AIM') : (autoUse ? 'AIM · AUTO TOOL' : 'AIM · 2× HOLD');
  }
}
