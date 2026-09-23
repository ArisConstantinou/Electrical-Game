import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Game } from '../core/Game';
import type { CurvedWallShape } from '../world/CurvedWallGeometry';
import './level-editor.css';

type WallKind = 'brick-wall' | 'concrete-wall';
type SurfaceKind = 'floor' | 'stair';
type WallRecord = {
  id: string;
  kind: WallKind;
  length: number;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  chainId?: string;
  sectionIndex?: number;
  curveRadius?: number;
  curveShape?: CurvedWallShape;
};
type SurfaceRecord = {
  id: string;
  kind: SurfaceKind;
  width: number;
  depth: number;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
};
type AssetRecord = { id: string; position: [number, number, number]; rotationY: number; scale: [number, number, number] };
type GroupRecord = { id: string; name: string; members: string[] };
type LevelDocument = { version: 1; name?: string; template?: 'mansion' | 'blank'; walls: WallRecord[]; surfaces: SurfaceRecord[]; assets?: AssetRecord[]; groups?: GroupRecord[]; playerStart: [number, number, number]; playerStartYaw: number; apprenticeStart: [number, number, number]; apprenticeStarts: [number, number, number][]; apprenticeStartYaws: number[] };
export type LevelSlot = { id: string; name: string; updatedAt: string; template: 'mansion' | 'blank' };
const LEGACY_STORAGE_KEY = 'wirehouse:level-editor:mansion:v1';
const MIGRATED_KEY = 'wirehouse:level-editor:legacy-imported:v1';
const SLOTS_KEY = 'wirehouse:level-editor:slots:v1';
const slotKey = (id: string): string => `wirehouse:level-editor:slot:${id}`;
const validSlotId = (id: string): boolean => /^[0-9a-f-]{36}$/i.test(id);
const originalSiteSystems = new Set([
  'Living room first-fix mission', 'Wet mortar, water and construction spills', 'mortar-mixing-station',
  'ready-mortar-wheelbarrow', 'Recoverable spilled wheelbarrow mortar', 'Water Pro room puddles, runoff and flood',
  'PVC workshop · 20 × 3 m', 'PVC drilled rebar fasteners', 'PVC physical working piece',
  'Apprentice cut PVC racks', 'Apprentice 1', 'Apprentice yellow directive', 'Apprentice box preview',
  'FPS hammer tool',
]);
const isGroundSceneSystem = (object: THREE.Object3D): boolean =>
  originalSiteSystems.has(object.name) || /^Apprentice [1-5](?: cutter)?$/.test(object.name);
const isDetachedViewModel = (object: THREE.Object3D): boolean =>
  /^(?:Left|Right) (?:fixed-length work arm|five-finger spring hand)$/.test(object.name);
export function listLevelSlots(): LevelSlot[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '[]') as unknown;
    const slots = Array.isArray(stored) ? stored.filter((item): item is LevelSlot => item && typeof item === 'object' &&
      validSlotId(item.id) && typeof item.name === 'string' && typeof item.updatedAt === 'string' &&
      (item.template === 'mansion' || item.template === 'blank')) : [];
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && !localStorage.getItem(MIGRATED_KEY)) {
      const id = crypto.randomUUID();
      const entry: LevelSlot = { id, name: 'Previous editor save', updatedAt: new Date().toISOString(), template: 'mansion' };
      localStorage.setItem(slotKey(id), legacy);
      slots.push(entry);
      localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
      localStorage.setItem(MIGRATED_KEY, id);
    }
    return slots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
}
export async function listAvailableLevelSlots(): Promise<LevelSlot[]> {
  const slots = listLevelSlots();
  try {
    const response = await fetch('/__wire-house-mansion-level?list=1', { cache: 'no-store' });
    if (!response.ok) return slots;
    const payload = await response.json() as { slots?: unknown };
    if (!Array.isArray(payload.slots)) return slots;
    for (const item of payload.slots) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<LevelSlot>;
      if (typeof candidate.id !== 'string' || (candidate.id !== 'legacy' && !validSlotId(candidate.id)) ||
        typeof candidate.name !== 'string' || typeof candidate.updatedAt !== 'string' ||
        (candidate.template !== 'mansion' && candidate.template !== 'blank')) continue;
      if (!slots.some(slot => slot.id === candidate.id)) slots.push(candidate as LevelSlot);
    }
  } catch { /* Published builds use browser-local slots. */ }
  return slots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
const finiteTriplet = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));
const validCurvedShape = (value: unknown): value is CurvedWallShape => {
  if (!value || typeof value !== 'object') return false;
  const shape = value as Partial<CurvedWallShape>;
  return Array.isArray(shape.center) && shape.center.length === 2 && shape.center.every(Number.isFinite) &&
    Number.isFinite(shape.radius) && shape.radius! > .12 && shape.radius! < 10000 &&
    Number.isFinite(shape.startAngle) && Number.isFinite(shape.sweep) && Math.abs(shape.sweep!) <= Math.PI &&
    Number.isFinite(shape.uvStart);
};

/** Direct editing of mansion wall assemblies. A wall's visual and collision footprint share one transform. */
export class LevelEditor {
  readonly panel = document.createElement('section');
  readonly camera = new THREE.PerspectiveCamera(55, 1, .05, 180);
  readonly topCamera = new THREE.OrthographicCamera(-8, 8, 16, -16, .05, 180);
  readonly orbit: OrbitControls;
  readonly topOrbit: OrbitControls;
  readonly gizmo: TransformControls;
  active = false;
  private selected: THREE.Group | null = null;
  private readonly selectedObjects = new Set<THREE.Group>();
  private readonly selectionPivot = new THREE.Group();
  private readonly pivotMatrix = new THREE.Matrix4();
  private selectionAnchor: THREE.Vector3 | null = null;
  private selectionAnchorLocal: THREE.Vector3 | null = null;
  private readonly groups = new Map<string, GroupRecord>();
  private multiMode = false;
  private activeGroupId: string | null = null;
  private added = new Set<string>();
  private playerStart = new THREE.Vector3();
  private playerStartYaw = 0;
  private apprenticeStart = new THREE.Vector3();
  private readonly apprenticeStarts = new Map<number, THREE.Vector3>();
  private readonly apprenticeStartYaws = new Map<number, number>();
  private apprenticeIndex = 1;
  private playerMarker = new THREE.Mesh(new THREE.ConeGeometry(.22, .6, 12), new THREE.MeshBasicMaterial({ color: 0xffcf43, depthTest: false }));
  private apprenticeMarker = new THREE.Mesh(new THREE.ConeGeometry(.22, .6, 12), new THREE.MeshBasicMaterial({ color: 0x59d7e5, depthTest: false }));
  private markerSelection: 'player' | 'apprentice' | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly highlights = new Map<THREE.Group, THREE.Group>();
  private readonly editorRaycasts = new Map<THREE.Mesh, THREE.Object3D['raycast']>();
  private readonly siteEquipment: THREE.Group[] = [];
  private cameraMode: 'orbit' | 'pan' = 'orbit';
  private readonly touchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  private touchDrag: { pointerId: number; mode: 'translate' | 'rotate' | 'scale'; x: number; y: number; position: THREE.Vector3; rotationY: number; scale: THREE.Vector3; planeHit: THREE.Vector3 | null } | null = null;
  private wallEndpointDrag: { pointerId: number; wall: THREE.Group; fixed: THREE.Vector3; end: -1 | 1 } | null = null;
  private wallPathActive = false;
  private wallPathEnd: -1 | 1 = 1;
  private readonly wallPathPoint = new THREE.Vector3();
  private readonly editorTouches = new Map<number, THREE.Vector2>();
  private pinchZoom: { startSpan: number; startDistance: number; direction: THREE.Vector3 } | null = null;
  private down: { x: number; y: number } | null = null;
  private history: LevelDocument[] = [];
  private historyLabels: string[] = [];
  private historySelections: string[][] = [];
  private historyIndex = -1;
  private copiedStructures: (WallRecord | SurfaceRecord)[] = [];
  private pasteCount = 0;
  private tab: 'select' | 'build' | 'transform' | 'starts' | 'save' = 'select';
  private viewMode: '3d' | '2d' = '3d';
  private cameraPreset: 'angle' | 'top' | 'front' | 'back' | 'left' | 'right' = 'angle';
  private readonly angleViewPosition = new THREE.Vector3(18, 17, 27);
  private readonly angleViewTarget = new THREE.Vector3(6, 1, 7);
  private floorIndex = -1;
  private template: 'mansion' | 'blank' = new URLSearchParams(location.search).get('template') === 'blank' ? 'blank' : 'mansion';
  private currentSlotId: string | null = null;
  private readonly originalVisibility = new Map<THREE.Object3D, boolean>();
  private readonly originalSystemVisibility = new Map<THREE.Object3D, boolean>();
  private readonly editorSceneVisibility = new Map<THREE.Object3D, boolean>();
  private readonly editorShadows = new Map<THREE.LightShadow, boolean>();
  private readonly playerVisibility = new Map<THREE.Object3D, boolean>();
  private editorFog: { fog: THREE.Fog; near: number; far: number } | null = null;
  private readonly topCutawayVisibility = new Map<THREE.Object3D, boolean>();
  private readonly topCutawayBounds = new THREE.Box3();
  private haloElement!: HTMLElement;
  private readonly haloBounds = new THREE.Box3();
  private readonly haloCorner = new THREE.Vector3();
  private readonly gizmoBounds = new THREE.Box3();

  constructor(private readonly game: Game) {
    const canvas = game.renderer.webgl.domElement;
    this.camera.position.set(18, 17, 27);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(6, 1, 7);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = .45;
    this.orbit.maxDistance = 90;
    this.orbit.enabled = false;
    this.orbit.update();
    this.topCamera.position.set(8, 24, 8);
    this.topCamera.up.set(0, 0, -1);
    this.topOrbit = new OrbitControls(this.topCamera, canvas);
    this.topOrbit.target.set(8, 0, 8);
    this.topOrbit.enableRotate = false;
    this.topOrbit.touches.ONE = THREE.TOUCH.PAN;
    this.topOrbit.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.topOrbit.enableDamping = true;
    this.topOrbit.minZoom = .35;
    this.topOrbit.maxZoom = 8;
    this.topOrbit.enabled = false;
    this.topOrbit.update();
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(.34);
    this.gizmo.addEventListener('dragging-changed', event => {
      if (this.nativeGizmoVisible()) this.orbit.enabled = this.active && !event.value;
    });
    this.gizmo.addEventListener('objectChange', () => { if (this.gizmo.object === this.selectionPivot) this.applyPivotDelta(); this.syncLiveEquipment(); this.invalidateEditorShadows(); this.refreshFields(); });
    this.gizmo.addEventListener('mouseUp', () => { this.snapWallEnds(); this.refreshFields(); this.recordHistory(); });
    this.gizmo.getHelper().visible = false;
    game.renderer.scene.add(this.gizmo.getHelper());
    this.selectionPivot.name = 'Editor selection centre';
    game.renderer.scene.add(this.selectionPivot);
    this.registerSiteEquipment();
    this.registerMissionBoxes();
    this.playerStart.copy(game.renderer.camera.position);
    this.playerStartYaw = game.player.yaw;
    this.apprenticeStart.copy(game.apprentice.camera.position);
    for (let index = 1; index <= 5; index++) { this.apprenticeStarts.set(index, game.apprentice.editorStart(index)); this.apprenticeStartYaws.set(index, game.apprentice.editorStartYaw(index)); }
    for (const [mesh, color, name] of [
      [this.playerMarker, 0xffcf43, 'Player start'],
      [this.apprenticeMarker, 0x59d7e5, 'Apprentice start'],
    ] as const) {
      mesh.name = name;
      mesh.material.color.setHex(color);
      const direction = new THREE.Mesh(new THREE.ConeGeometry(.11, .26, 3), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      direction.name = `${name} facing direction`;
      direction.rotation.x = -Math.PI / 2;
      direction.position.set(0, -.2, -.3);
      mesh.add(direction);
      mesh.position.y = -100;
      mesh.renderOrder = 999;
      game.renderer.scene.add(mesh);
    }
    this.panel.id = 'level-editor';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Level Editor');
    this.panel.innerHTML = `<header><div><small>WIRE THE HOUSE · LIVE SITE</small><h2>LEVEL EDITOR</h2></div><div class="level-editor__header-actions"><button id="level-settings" type="button" aria-label="Editor navigation settings">⚙</button><button id="level-close" type="button" aria-label="Close level editor">✕</button></div></header>
      <div id="level-settings-panel" hidden><label for="level-nav-mode">EDITOR NAVIGATION</label><select id="level-nav-mode"><option value="bottom">Bottom navigation</option><option value="wheel">Wheel navigation</option></select></div>
      <button id="level-view-trigger" type="button" aria-expanded="false" aria-controls="level-view-panel">▤ VIEW · ALL</button><div id="level-view-panel" hidden><div class="level-view__modes"><button type="button" data-level-view="3d">◈ ANGLE</button><button type="button" data-level-view="2d">▤ TOP</button></div><label for="level-floor">VISIBLE FLOOR</label><select id="level-floor"><option value="-1">All floors · 3D only</option><option value="6">B2 · services and stores</option><option value="5">B1 · garage and workshop</option><option value="0">G-0 · ground</option><option value="1">L1 · first</option><option value="2">L2 · second</option><option value="3">L3 · third</option><option value="4">L4 · fourth</option></select><small>Only the selected level is drawn. Drag empty space to pan in top view; pinch to zoom.</small><button id="level-view-close" type="button">⌄ CLOSE VIEW</button></div>
      <div class="level-editor__bar"><button id="level-translate" type="button">MOVE</button><button id="level-rotate" type="button">ROTATE</button><button id="level-scale" type="button">SCALE</button><label><input id="level-snap" type="checkbox" checked> SNAP</label><select id="level-grid" aria-label="Snap spacing"><option value="0.1">10 cm</option><option value="0.25" selected>25 cm</option><option value="0.5">50 cm</option><option value="1">1 m</option></select><button id="level-save" type="button">SAVE</button><button id="level-export" type="button">EXPORT</button></div>
      <aside><label for="level-search">SITE ELEMENTS</label><input id="level-search" type="search" placeholder="Search structures…"><div id="level-list"></div><div class="level-editor__add"><button id="level-add-brick" type="button">+ BRICK WALL</button><button id="level-add-concrete" type="button">+ CONCRETE WALL</button><button id="level-add-floor" type="button">+ FLOOR SLAB</button><button id="level-add-stair" type="button">+ STAIRS</button></div><div class="level-editor__starts"><button id="level-player" type="button">PLAYER START</button><select id="level-apprentice-index" aria-label="Apprentice number"><option value="1">APPRENTICE 1</option><option value="2">APPRENTICE 2</option><option value="3">APPRENTICE 3</option><option value="4">APPRENTICE 4</option><option value="5">APPRENTICE 5</option></select><button id="level-apprentice" type="button">EDIT START</button></div></aside>
      <section class="level-editor__inspector"><b id="level-name">Select an element</b><p id="level-kind">Tap a structure in the scene or list.</p><div class="level-editor__history"><button id="level-undo" type="button" title="Ctrl+Z">UNDO</button><button id="level-redo" type="button" title="Ctrl+Y / Ctrl+Shift+Z">REDO</button></div><details class="level-editor__history-log"><summary>HISTORY <span id="level-history-count"></span></summary><div id="level-history-list" aria-label="Editor history"></div></details><div class="level-editor__fields"><label>X <input data-axis="x" type="number" step="0.01"></label><label>Y <input data-axis="y" type="number" step="0.01"></label><label>Z <input data-axis="z" type="number" step="0.01"></label><label>WIDTH m <input data-size="x" type="number" min="0.2" step="0.01"></label><label>HEIGHT m <input data-size="y" type="number" min="0.2" step="0.01"></label><label>DEPTH m <input data-size="z" type="number" min="0.05" step="0.01"></label><label>YAW ° <input id="level-yaw" type="number" step="1"></label></div><div class="level-editor__object-actions"><button id="level-copy" type="button" title="Ctrl+C">COPY</button><button id="level-paste" type="button" title="Ctrl+V">PASTE</button><button id="level-delete" type="button" title="Delete / Backspace">DELETE</button></div><p id="level-status" role="status"></p></section>
      <section class="level-editor__save"><b>SAVE LEVEL</b><p>Basic stays unchanged. Save your work as a separate named level.</p><label for="level-slot-name">LEVEL NAME</label><input id="level-slot-name" type="text" maxlength="48" value="My Level"><button id="level-save-mobile" type="button">SAVE LEVEL</button><button id="level-save-as" type="button">SAVE AS NEW COPY</button><button id="level-export-mobile" type="button">EXPORT JSON</button><p id="level-save-status" role="status"></p></section>
      <div id="level-halo" hidden><button id="level-halo-handle" type="button" aria-label="Drag element with current edit tool"><span aria-hidden="true">✥</span></button></div>
      <nav class="level-editor__bottom-nav" aria-label="Level editor navigation"><button id="level-dock-toggle" type="button" aria-label="Hide editor navigation" aria-expanded="true"><span aria-hidden="true"></span></button><button data-editor-tab="select" type="button">VIEW</button><button data-editor-tab="build" type="button">BUILD</button><button data-editor-tab="transform" type="button">EDIT</button><button data-editor-tab="starts" type="button">SCENE</button><button data-editor-tab="save" type="button">SAVE</button></nav>
      <nav class="level-editor__wheel" aria-label="Level editor wheel"><div class="level-editor__wheel-ring"><button data-editor-tab="select" type="button">SELECT</button><button data-editor-tab="build" type="button">BUILD</button><button data-editor-tab="transform" type="button">EDIT</button><button data-editor-tab="starts" type="button">STARTS</button><button data-editor-tab="save" type="button">SAVE</button></div><button id="level-wheel-toggle" type="button" aria-label="Open editor wheel" aria-expanded="false">◎</button></nav>`;
    this.haloElement = this.el('#level-halo');
    this.decorateControls();
    game.hud.shell.append(this.panel);
    this.bind();
    this.setToolMode('translate');
    this.setCameraMode('orbit');
    this.setFieldsMode('position');
    let savedMode = 'bottom';
    try { savedMode = localStorage.getItem('wirehouse:level-editor-nav') ?? 'bottom'; } catch { /* Private browsing can deny storage. */ }
    this.setNavMode(savedMode === 'wheel' ? 'wheel' : 'bottom');
    this.setTab('select', false);
    this.setViewMode('3d');
    if (this.template === 'blank') {
      this.playerStart.set(8, this.game.player.eyeHeight, 5);
      this.game.renderer.camera.position.copy(this.playerStart);
    }
    this.setTemplateMode(this.template);
    this.updateStarts();
    this.recordHistory();
  }

  private el<T extends HTMLElement = HTMLElement>(selector: string): T { return this.panel.querySelector<T>(selector)!; }
  private registerSiteEquipment(): void {
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    // These are the live gameplay objects, not visual clones. MixingStation
    // derives its interaction targets and collision boxes from their matrices.
    const equipment = [...this.game.mixing.models.group.children, this.game.mixing.wheelbarrow.model.group, this.game.pvc.stock];
    for (const object of equipment) {
      if (!(object instanceof THREE.Group) || !object.name || wing.editableAssets.has(object.name)) continue;
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty() || !Number.isFinite(bounds.min.x)) continue;
      const size = bounds.getSize(new THREE.Vector3());
      object.userData.levelEditorKind = 'asset';
      object.userData.levelEditorLabel = object.name.replaceAll('-', ' ');
      if (object === this.game.pvc.stock) object.userData.levelEditorScaleLocked = true;
      object.userData.baseSize = [size.x, size.y, size.z].map((value, axis) =>
        Math.max(value / Math.max(Math.abs(object.scale.getComponent(axis)), .001), .01));
      wing.editableAssets.set(object.name, object);
      this.siteEquipment.push(object);
    }
  }
  private registerMissionBoxes(): void {
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    // Installed electrical boxes live outside Room, but remain part of the
    // visible site. Their mission/physics placement is not editor-transformable.
    for (const point of this.game.mission.points) {
      if (wing.editableAssets.has(point.name)) continue;
      const size = new THREE.Box3().setFromObject(point.boxGroup).getSize(new THREE.Vector3());
      point.userData.levelEditorKind = 'asset';
      point.userData.levelEditorLabel = `Electrical box · ${point.definition.label}`;
      point.userData.levelEditorMissionPoint = true;
      point.userData.levelEditorLocked = true;
      point.userData.levelEditorFloor = 0;
      point.userData.baseSize = [size.x, size.y, size.z].map(value => Math.max(value, .01));
      wing.editableAssets.set(point.name, point);
    }
  }
  private decorateControls(): void {
    this.el('.level-editor__header-actions').insertAdjacentHTML('afterbegin', '<button id="level-camera" type="button" aria-label="Switch to camera pan" title="Switch to camera pan"></button>');
    const paths: Record<string, string> = {
      select: '<path d="M4 3v17l5-5 3.5 6 2-1-3.5-6 7-.5z"/>',
      build: '<path d="M3 8h18M3 16h18M8 3v18M16 3v18"/><path d="M3 3h18v18H3z"/>',
      transform: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
      starts: '<path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
      save: '<path d="M4 3h13l3 3v15H4zM7 3v7h10V3M7 21v-7h10v7"/>',
      brick: '<path d="M3 5h18v14H3zM3 12h18M8 5v7M16 5v7M12 12v7"/>',
      concrete: '<path d="m12 2 9 5-9 5-9-5 9-5zM3 7v10l9 5 9-5V7M12 12v10"/>',
      floor: '<path d="m3 8 9-5 9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5"/>',
      stair: '<path d="M2 20h5v-5h5v-5h5V5h5"/>',
      rotate: '<path d="M20 11a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
      scale: '<path d="M4 20 20 4M13 4h7v7M4 13v7h7"/>',
      undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"/>',
      redo: '<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h2"/>',
      export: '<path d="M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M10 2h4l.5 2.3 2 .8 2-1.2 2.8 2.8-1.2 2 .8 2L23 11v4l-2.3.5-.8 2 1.2 2-2.8 2.8-2-1.2-2 .8L14 24h-4l-.5-2.3-2-.8-2 1.2-2.8-2.8 1.2-2-.8-2L1 15v-4l2.3-.5.8-2-1.2-2L5.7 3.7l2 1.2 2-.8z"/>',
      close: '<path d="M4 4 20 20M20 4 4 20"/>',
      pan: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
    };
    const icon = (name: string): string => `<svg class="level-editor__icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
    const controls: Record<string, string> = {
      '[data-editor-tab="select"]': 'select', '[data-editor-tab="build"]': 'build', '[data-editor-tab="transform"]': 'transform',
      '[data-editor-tab="starts"]': 'starts', '[data-editor-tab="save"]': 'save',
      '#level-add-brick': 'brick', '#level-add-concrete': 'concrete', '#level-add-floor': 'floor', '#level-add-stair': 'stair',
      '#level-translate': 'transform', '#level-rotate': 'rotate', '#level-scale': 'scale',
      '#level-player': 'starts', '#level-apprentice': 'starts', '#level-save': 'save', '#level-save-mobile': 'save',
      '#level-export': 'export', '#level-export-mobile': 'export', '#level-undo': 'undo', '#level-redo': 'redo',
      '#level-settings': 'settings', '#level-close': 'close',
      '#level-camera': 'pan',
    };
    for (const [selector, name] of Object.entries(controls)) this.panel.querySelectorAll<HTMLButtonElement>(selector).forEach(button => {
      if (selector === '#level-settings' || selector === '#level-close') button.textContent = '';
      button.classList.add('level-editor__icon-button');
      button.insertAdjacentHTML('afterbegin', icon(name));
    });
    this.panel.querySelector('header h2')?.insertAdjacentHTML('afterend', '<span class="level-editor__scene"><span></span>MANSION · CONSTRUCTION</span>');
    this.panel.querySelector('aside>label')?.insertAdjacentHTML('beforeend', '<small id="level-count"></small>');
    this.el('#level-search').insertAdjacentHTML('afterend', '<select id="level-filter" aria-label="Filter site elements"><option value="all">All structures and assets</option><option value="brick-wall">Brick walls</option><option value="concrete-wall">Concrete walls</option><option value="floor">Floor slabs</option><option value="stair">Stairs</option><option value="asset">Site assets</option></select>');
    this.el('#level-filter').insertAdjacentHTML('afterend', '<div id="level-selection-actions"><button id="level-multi-toggle" type="button" aria-pressed="false">MULTI SELECT</button><button id="level-create-group" type="button" disabled>GROUP ITEMS</button></div><div id="level-group-list" aria-label="Saved editor groups"></div>');
    this.el('aside').insertAdjacentHTML('afterbegin', '<div id="level-view-quick"><div class="level-view__modes"><button type="button" data-level-view="3d">◈ ANGLE</button><button type="button" data-level-view="2d">▤ TOP</button></div><label for="level-floor-quick">VISIBLE FLOOR</label><select id="level-floor-quick" aria-label="Visible floor"><option value="-1">All floors · 3D only</option><option value="6">B2 · services and stores</option><option value="5">B1 · garage and workshop</option><option value="0">G-0 · ground</option><option value="1">L1 · first</option><option value="2">L2 · second</option><option value="3">L3 · third</option><option value="4">L4 · fourth</option></select><button id="level-camera-mobile" type="button" aria-pressed="false">◎ ORBIT CAMERA</button></div><button id="level-browser-toggle" type="button" aria-expanded="false">BROWSE ELEMENTS <span>⌃</span></button>');
    const sidePresets = '<div class="level-view__sides" aria-label="3D side view presets"><button type="button" data-camera-preset="front">↑ FRONT</button><button type="button" data-camera-preset="back">↓ BACK</button><button type="button" data-camera-preset="left">← LEFT</button><button type="button" data-camera-preset="right">→ RIGHT</button></div>';
    this.el('#level-view-quick .level-view__modes').insertAdjacentHTML('afterend', sidePresets);
    this.el('#level-view-panel .level-view__modes').insertAdjacentHTML('afterend', sidePresets);
    this.el('.level-editor__add').insertAdjacentHTML('beforebegin', '<div class="level-editor__build-heading"><strong>▥ BUILD ASSETS</strong><span>STRUCTURE · SNAP 25 cm</span></div>');
    this.el('.level-editor__starts').insertAdjacentHTML('afterend', '<div class="level-editor__scene-actions"><button id="level-scene-settings" type="button">⚙ SETTINGS</button><button id="level-scene-exit" type="button">✕ EXIT EDITOR</button></div>');
    this.el('.level-editor__bar').insertAdjacentHTML('beforeend', '<button id="level-details-toggle" type="button" aria-expanded="false">POSITION / SIZE</button>');
    this.el('#level-details-toggle').insertAdjacentHTML('afterend', '<button id="level-wall-tools-toggle" type="button">⌁ WALL PATH</button>');
    this.el('#level-name').insertAdjacentHTML('afterend', '<button id="level-details-close" type="button" aria-label="Close editor details">✕</button>');
    this.el('#level-kind').insertAdjacentHTML('afterend', '<button id="level-focus" type="button">FOCUS IN SCENE</button>');
    this.el('#level-focus').insertAdjacentHTML('afterend', '<div id="level-group-edit" hidden><label for="level-group-name">GROUP NAME</label><input id="level-group-name" type="text" maxlength="48"><button id="level-ungroup" type="button">UNGROUP</button></div>');
    this.el('#level-group-edit').insertAdjacentHTML('afterend', `<div id="level-wall-tools" hidden>
      <div class="level-wall-tools__heading"><strong>WALL SECTION</strong><span>LIVE GEOMETRY + COLLISION</span></div>
      <div class="level-wall-tools__ends" role="group" aria-label="Wall continuation endpoint"><button id="level-wall-start" type="button">◉ START</button><button id="level-wall-end" type="button" aria-pressed="true">END ◉</button></div>
      <button id="level-wall-continue" type="button" aria-pressed="false">＋ CONTINUE · TAP POINTS</button>
      <div class="level-wall-tools__row"><label for="level-wall-material">MATERIAL</label><select id="level-wall-material"><option value="brick-wall">FIRED CLAY BRICK</option><option value="concrete-wall">CAST CONCRETE</option></select></div>
      <div class="level-wall-tools__row"><label for="level-wall-radius">CURVE RADIUS m</label><input id="level-wall-radius" type="number" min="0.5" max="50" step="0.25" value="4"></div>
      <div class="level-wall-tools__curve"><button id="level-wall-curve-left" type="button">↶ CURVE LEFT</button><button id="level-wall-curve-right" type="button">CURVE RIGHT ↷</button></div>
      <small>Drag either endpoint in the scene, or continue with taps. SNAP joins walls; turn SNAP off for free placement. Every generated section stays independently editable.</small>
    </div>`);
    this.el('#level-halo').insertAdjacentHTML('afterend', '<div id="level-wall-endpoints" hidden><button type="button" data-wall-end="-1" aria-label="Drag wall start point">S</button><button type="button" data-wall-end="1" aria-label="Drag wall end point">E</button></div>');
    this.el('.level-editor__bar').insertAdjacentHTML('beforeend', '<small id="level-touch-help"></small>');
    this.el('.level-editor__fields').insertAdjacentHTML('beforebegin', '<div id="level-fields-tabs"><button type="button" data-fields-tab="position">POSITION</button><button type="button" data-fields-tab="size">DIMENSIONS</button></div>');
    this.el<HTMLButtonElement>('#level-focus').disabled = true;
    this.el<HTMLButtonElement>('#level-delete').disabled = true;
  }
  private status(message: string): void { this.el('#level-status').textContent = message; this.el('#level-save-status').textContent = message; }
  private bind(): void {
    this.el('#level-close').addEventListener('click', () => this.close());
    this.el('#level-view-trigger').addEventListener('click', () => {
      const panel = this.el('#level-view-panel');
      panel.hidden = !panel.hidden;
      this.el('#level-view-trigger').setAttribute('aria-expanded', String(!panel.hidden));
    });
    this.el('#level-view-close').addEventListener('click', () => {
      this.el('#level-view-panel').hidden = true;
      this.el('#level-view-trigger').setAttribute('aria-expanded', 'false');
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-level-view]').forEach(button => button.addEventListener('click', () => this.setViewMode(button.dataset.levelView === '2d' ? '2d' : '3d')));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-camera-preset]').forEach(button => button.addEventListener('click', () => this.setSidePreset(button.dataset.cameraPreset as 'front' | 'back' | 'left' | 'right')));
    this.el<HTMLSelectElement>('#level-floor').addEventListener('change', event => this.setFloorIndex(Number((event.target as HTMLSelectElement).value)));
    this.el<HTMLSelectElement>('#level-floor-quick').addEventListener('change', event => this.setFloorIndex(Number((event.target as HTMLSelectElement).value)));
    this.el('#level-undo').addEventListener('click', () => this.moveHistory(-1));
    this.el('#level-redo').addEventListener('click', () => this.moveHistory(1));
    this.el('#level-settings').addEventListener('click', () => { this.el('#level-settings-panel').hidden = !this.el('#level-settings-panel').hidden; });
    this.el('#level-scene-settings').addEventListener('click', () => this.el('#level-settings').click());
    this.el('#level-scene-exit').addEventListener('click', () => this.close());
    this.el<HTMLSelectElement>('#level-nav-mode').addEventListener('change', event => this.setNavMode((event.target as HTMLSelectElement).value === 'wheel' ? 'wheel' : 'bottom'));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-editor-tab]').forEach(button => button.addEventListener('click', () => {
      const tab = button.dataset.editorTab as typeof this.tab;
      this.setTab(tab, tab !== this.tab || !this.panel.classList.contains('sheet-open'));
      this.panel.classList.remove('wheel-open');
      this.el('#level-wheel-toggle').setAttribute('aria-expanded', 'false');
    }));
    this.el('#level-dock-toggle').addEventListener('click', () => {
      const collapsed = this.panel.classList.toggle('dock-collapsed');
      if (collapsed) this.panel.classList.remove('sheet-open', 'details-open', 'browser-open');
      this.el('#level-settings-panel').hidden = true;
      const toggle = this.el('#level-dock-toggle');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Open editor navigation' : 'Hide editor navigation');
    });
    this.el('#level-wheel-toggle').addEventListener('click', () => {
      const open = this.panel.classList.toggle('wheel-open');
      this.el('#level-wheel-toggle').setAttribute('aria-expanded', String(open));
    });
    const haloHandle = this.el<HTMLButtonElement>('#level-halo-handle');
    haloHandle.addEventListener('pointerdown', event => {
      const object = this.gizmo.object;
      if (!this.active || !object) return;
      this.pointerRay(event);
      this.touchPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), object.position);
      const hit = this.raycaster.ray.intersectPlane(this.touchPlane, new THREE.Vector3());
      this.touchDrag = { pointerId: event.pointerId, mode: this.gizmo.mode as 'translate' | 'rotate' | 'scale',
        x: event.clientX, y: event.clientY, position: object.position.clone(), rotationY: object.rotation.y,
        scale: object.scale.clone(), planeHit: hit?.clone() ?? null };
      this.orbit.enabled = this.topOrbit.enabled = false;
      this.gizmo.enabled = false;
      haloHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    haloHandle.addEventListener('pointermove', event => this.updateTouchDrag(event));
    haloHandle.addEventListener('pointerup', event => { this.endTouchDrag(event); });
    haloHandle.addEventListener('pointercancel', event => { this.endTouchDrag(event); });
    this.el('#level-wall-start').addEventListener('click', () => this.setWallPathEnd(-1));
    this.el('#level-wall-end').addEventListener('click', () => this.setWallPathEnd(1));
    this.el('#level-wall-continue').addEventListener('click', () => this.setWallPathActive(!this.wallPathActive));
    this.el<HTMLSelectElement>('#level-wall-material').addEventListener('change', event => this.changeSelectedWallMaterial((event.target as HTMLSelectElement).value as WallKind));
    this.el('#level-wall-curve-left').addEventListener('click', () => this.curveSelectedWall(-1));
    this.el('#level-wall-curve-right').addEventListener('click', () => this.curveSelectedWall(1));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-wall-end]').forEach(handle => {
      handle.addEventListener('pointerdown', event => this.beginWallEndpointDrag(event, Number(handle.dataset.wallEnd) < 0 ? -1 : 1));
      handle.addEventListener('pointermove', event => this.updateWallEndpointDrag(event));
      handle.addEventListener('pointerup', event => this.endWallEndpointDrag(event));
      handle.addEventListener('pointercancel', event => this.endWallEndpointDrag(event));
    });
    this.el('#level-save-mobile').addEventListener('click', () => this.el('#level-save').click());
    this.el('#level-save-as').addEventListener('click', () => void this.save(true));
    this.el('#level-export-mobile').addEventListener('click', () => this.el('#level-export').click());
    for (const [id, mode] of [['#level-translate', 'translate'], ['#level-rotate', 'rotate'], ['#level-scale', 'scale']] as const) {
      const button = this.el(id);
      button.addEventListener('pointerdown', () => this.setToolMode(mode));
      button.addEventListener('click', () => this.setToolMode(mode));
    }
    this.el('#level-save').addEventListener('click', () => void this.save());
    this.el('#level-export').addEventListener('click', () => this.export());
    this.el('#level-search').addEventListener('input', () => this.refreshList());
    this.el('#level-filter').addEventListener('change', () => this.refreshList());
    this.el('#level-multi-toggle').addEventListener('click', () => this.setMultiMode(!this.multiMode));
    this.el('#level-create-group').addEventListener('click', () => this.createGroup());
    this.el('#level-group-name').addEventListener('change', () => this.renameGroup());
    this.el('#level-ungroup').addEventListener('click', () => this.ungroup());
    this.el('#level-focus').addEventListener('click', () => this.focusSelection());
    this.el('#level-camera').addEventListener('click', () => this.setCameraMode(this.cameraMode === 'orbit' ? 'pan' : 'orbit'));
    this.el('#level-camera-mobile').addEventListener('click', () => this.setCameraMode(this.cameraMode === 'orbit' ? 'pan' : 'orbit'));
    this.el('#level-details-toggle').addEventListener('click', () => this.setDetailsOpen(true));
    this.el('#level-wall-tools-toggle').addEventListener('click', () => {
      // Defer the dock swap until the browser finishes the touch/click
      // sequence; removing the tapped control mid-gesture can cancel taps.
      window.setTimeout(() => {
        this.setDetailsOpen(true);
        requestAnimationFrame(() => this.el('#level-wall-tools').scrollIntoView({ block: 'nearest' }));
      }, 0);
    });
    this.el('#level-details-close').addEventListener('click', () => this.setDetailsOpen(false));
    this.el('#level-browser-toggle').addEventListener('click', () => {
      const open = this.panel.classList.toggle('browser-open');
      this.el('#level-browser-toggle').setAttribute('aria-expanded', String(open));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-fields-tab]').forEach(button => button.addEventListener('click', () => this.setFieldsMode(button.dataset.fieldsTab === 'size' ? 'size' : 'position')));
    this.el('#level-add-brick').addEventListener('click', () => this.addWall('brick-wall'));
    this.el('#level-add-concrete').addEventListener('click', () => this.addWall('concrete-wall'));
    this.el('#level-add-floor').addEventListener('click', () => this.addSurface('floor'));
    this.el('#level-add-stair').addEventListener('click', () => this.addSurface('stair'));
    this.el('#level-player').addEventListener('click', () => this.selectMarker('player'));
    this.el('#level-apprentice').addEventListener('click', () => this.selectMarker('apprentice'));
    this.el<HTMLSelectElement>('#level-apprentice-index').addEventListener('change', event => {
      this.apprenticeIndex = Number((event.target as HTMLSelectElement).value);
      if (this.markerSelection === 'apprentice') this.selectMarker('apprentice');
    });
    this.el('#level-delete').addEventListener('click', () => this.deleteSelected());
    this.el('#level-copy').addEventListener('click', () => this.copySelected());
    this.el('#level-paste').addEventListener('click', () => this.pasteCopied());
    this.el('#level-snap').addEventListener('change', () => this.setSnap());
    this.el('#level-grid').addEventListener('change', () => this.setSnap());
    this.panel.querySelectorAll<HTMLInputElement>('[data-axis],[data-size],#level-yaw').forEach(input => input.addEventListener('change', () => this.applyFields()));
    const canvas = this.game.renderer.webgl.domElement;
    document.addEventListener('pointerdown', event => {
      if (!this.active || event.pointerType !== 'touch' || !(event.target instanceof Element) ||
        !event.target.closest('#game-canvas,#level-halo-handle,#level-wall-endpoints button')) return;
      this.editorTouches.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      if (this.editorTouches.size < 2) return;
      const [first, second] = [...this.editorTouches.values()];
      this.pinchZoom = {
        startSpan: Math.max(1, first.distanceTo(second)),
        startDistance: this.camera.position.distanceTo(this.orbit.target),
        direction: this.camera.position.clone().sub(this.orbit.target).normalize(),
      };
      this.touchDrag = null;
      this.wallEndpointDrag = null;
      this.down = null;
      this.orbit.enabled = false;
      this.gizmo.enabled = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener('pointermove', event => {
      if (!this.active || event.pointerType !== 'touch' || !this.editorTouches.has(event.pointerId)) return;
      this.editorTouches.get(event.pointerId)!.set(event.clientX, event.clientY);
      if (!this.pinchZoom) return;
      if (this.editorTouches.size >= 2) {
        const [first, second] = [...this.editorTouches.values()];
        const distance = THREE.MathUtils.clamp(
          this.pinchZoom.startDistance * this.pinchZoom.startSpan / Math.max(1, first.distanceTo(second)),
          this.orbit.minDistance, this.orbit.maxDistance,
        );
        this.camera.position.copy(this.orbit.target).addScaledVector(this.pinchZoom.direction, distance);
        this.orbit.update();
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    const endEditorTouch = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' || !this.editorTouches.delete(event.pointerId)) return;
      if (this.pinchZoom && this.editorTouches.size === 0) {
        this.pinchZoom = null;
        this.orbit.enabled = this.active;
        this.gizmo.enabled = this.nativeGizmoVisible();
      }
    };
    document.addEventListener('pointerup', endEditorTouch, true);
    document.addEventListener('pointercancel', endEditorTouch, true);
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' && !event.isPrimary && this.touchDrag) {
        // The first touch may land on a selected wall. Hand control to OrbitControls
        // when a second finger arrives, so pinch remains possible over that wall.
        this.touchDrag = null;
        this.gizmo.enabled = this.nativeGizmoVisible();
        this.orbit.enabled = this.active;
        this.topOrbit.enabled = false;
        return;
      }
      this.beginTouchDrag(event);
    }, true);
    canvas.addEventListener('pointerdown', event => {
      if (!this.active) return;
      this.down = { x: event.clientX, y: event.clientY };
      // Keep editor selection and gestures on the canvas, but do not let the
      // underlying desktop FPS controls request Pointer Lock again.
      event.stopPropagation();
    });
    document.addEventListener('pointermove', event => {
      if (!this.touchDrag || this.touchDrag.pointerId !== event.pointerId) return;
      this.orbit.enabled = this.topOrbit.enabled = false;
      this.updateTouchDrag(event);
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener('pointerup', event => this.endTouchDrag(event), true);
    document.addEventListener('pointercancel', event => this.endTouchDrag(event), true);
    canvas.addEventListener('pointercancel', event => this.endTouchDrag(event));
    canvas.addEventListener('pointerup', event => {
      if (this.endTouchDrag(event)) return;
      if (!this.active || !this.down || Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 6) return;
      this.down = null;
      if (this.gizmo.dragging) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const wing = this.game.room.mansionWing;
      if (!wing) return;
      const hits = this.raycaster.intersectObjects(this.editables().filter(object => this.isSelectableVisible(object)), true);
      // This thin contact-dust decal is drawn over the masonry with polygon
      // offset, while its raycast geometry sits just behind the brick face.
      // Give it the same small visual precedence only at its actual triangles.
      const frontDistance = hits.find(hit => !(hit.object instanceof THREE.Points) &&
        !hit.object.userData.levelEditorPickThrough && this.isHitVisible(hit.object))?.distance ?? Infinity;
      const contactDust = hits.find(hit => hit.object.userData.studioEntityId === 'world:contact-patina' &&
        hit.distance - frontDistance <= .025);
      // The dust's flat decal also crosses the foot of a structural column.
      // A direct tap on that solid column must take precedence at the overlap.
      const contactColumn = contactDust && hits.find(hit =>
        typeof hit.object.userData.studioEntityId === 'string' &&
        hit.object.userData.studioEntityId.startsWith('world:column:') &&
        Math.abs(hit.distance - contactDust.distance) <= .025);
      // A recessed box's real back face sits behind spray marks and the
      // masonry opening. Prefer its actual raycast triangles at that depth.
      const recessedBox = hits.find(hit => {
        if (hit.distance - frontDistance > .06) return false;
        for (let parent: THREE.Object3D | null = hit.object; parent; parent = parent.parent)
          if (parent.userData.levelEditorMissionPoint) return true;
        return false;
      });
      const priorityHit = contactColumn ?? recessedBox ?? contactDust;
      for (const hit of priorityHit ? [priorityHit, ...hits] : hits) {
        // Particle effects and hidden children can raycast despite drawing nothing.
        if (hit.object instanceof THREE.Points || hit.object.userData.levelEditorPickThrough || !this.isHitVisible(hit.object)) continue;
        let object: THREE.Object3D | null = hit.object;
        while (object && object !== wing &&
          wing.editableWalls.get(object.name) !== object &&
          wing.editableSurfaces.get(object.name) !== object &&
          wing.editableAssets.get(object.name) !== object) object = object.parent;
        if (!(object instanceof THREE.Group) ||
          (wing.editableWalls.get(object.name) !== object && wing.editableSurfaces.get(object.name) !== object && wing.editableAssets.get(object.name) !== object)) continue;
        if (this.wallPathActive && object.userData.levelEditorGround) continue;
        if (this.wallPathActive && object === this.selected) break;
        if (this.wallPathActive) this.setWallPathActive(false);
        // Ground fills most top-down pixels. Tap away to clear an existing
        // selection; tap the same surface again to select and edit it.
        if ((object.userData.levelEditorGround || object.userData.levelEditorKind === 'floor') &&
          !this.multiMode && this.selectedObjects.size && !this.selectedObjects.has(object)) {
          this.setSelection([]);
          this.status('Selection cleared. Tap the floor or terrain again to edit it.');
          return;
        }
        this.selectWall(object, event.ctrlKey || event.shiftKey, hit.point);
        return;
      }
      if (this.wallPathActive) this.extendWallAtPointer(event);
      else this.setSelection([]);
    });
    addEventListener('keydown', event => {
      if (!this.active) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
      if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable="true"]')) {
        event.stopImmediatePropagation();
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === 'z') { this.moveHistory(event.shiftKey ? 1 : -1); }
      else if (command && key === 'y') { this.moveHistory(1); }
      else if (command && key === 'c') { this.copySelected(); }
      else if (command && key === 'v') { this.pasteCopied(); }
      else if (!command && (event.key === 'Delete' || event.key === 'Backspace')) { this.deleteSelected(); }
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    addEventListener('resize', () => this.resize());
  }

  private setTab(tab: typeof this.tab, open = true): void {
    this.tab = tab;
    this.panel.dataset.tab = tab;
    this.panel.classList.toggle('sheet-open', open);
    if (tab !== 'select') {
      this.panel.classList.remove('browser-open');
      this.el('#level-browser-toggle').setAttribute('aria-expanded', 'false');
    }
    if (tab !== 'transform') this.setDetailsOpen(false);
    this.panel.querySelectorAll<HTMLButtonElement>('[data-editor-tab]').forEach(button => button.setAttribute('aria-current', String(button.dataset.editorTab === tab)));
  }
  private setDetailsOpen(open: boolean): void {
    this.panel.classList.toggle('details-open', open);
    this.el('#level-details-toggle').setAttribute('aria-expanded', String(open));
  }
  private setToolMode(mode: 'translate' | 'rotate' | 'scale'): void {
    if (mode === 'scale' && [...this.selectedObjects].some(item => item.userData.levelEditorScaleLocked)) return;
    this.gizmo.setMode(mode);
    this.el('#level-halo-handle').setAttribute('aria-label', `Drag element to ${mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : 'resize'}`);
    for (const [id, value] of [['#level-translate', 'translate'], ['#level-rotate', 'rotate'], ['#level-scale', 'scale']] as const)
      this.el<HTMLButtonElement>(id).setAttribute('aria-pressed', String(value === mode));
    this.el('#level-touch-help').textContent = mode === 'translate'
      ? 'Drag element · empty space orbits · pinch zooms'
      : mode === 'rotate' ? 'Drag element left or right to rotate'
        : 'Drag element up or down to resize';
  }
  private setCameraMode(mode: 'orbit' | 'pan'): void {
    this.cameraMode = mode;
    const pan = this.viewMode === '2d' || mode === 'pan';
    this.orbit.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.orbit.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    const button = this.el<HTMLButtonElement>('#level-camera');
    button.disabled = this.viewMode === '2d';
    button.setAttribute('aria-pressed', String(mode === 'pan'));
    button.setAttribute('aria-label', mode === 'pan' ? 'Camera pan active; switch to orbit' : 'Camera orbit active; switch to pan');
    button.title = this.viewMode === '2d' ? 'TOP pans · choose ANGLE for camera orbit' : mode === 'pan' ? 'PAN camera · tap for ORBIT' : 'ORBIT camera · tap for PAN';
    const mobileButton = this.el<HTMLButtonElement>('#level-camera-mobile');
    mobileButton.disabled = this.viewMode === '2d';
    mobileButton.setAttribute('aria-pressed', String(mode === 'pan'));
    mobileButton.textContent = this.viewMode === '2d' ? '✥ TOP · PAN' : mode === 'pan' ? '✥ PAN CAMERA' : '◎ ORBIT CAMERA';
  }
  private setFieldsMode(mode: 'position' | 'size'): void {
    this.panel.dataset.fieldsMode = mode;
    this.panel.querySelectorAll<HTMLButtonElement>('[data-fields-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.fieldsTab === mode)));
  }
  private pointerRay(event: PointerEvent): void {
    const rect = this.game.renderer.webgl.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  private beginTouchDrag(event: PointerEvent): boolean {
    if (event.pointerType !== 'touch' || !event.isPrimary || !this.active || this.tab !== 'transform') return false;
    if ([...this.selectedObjects].some(item => item.userData.levelEditorLocked)) return false;
    const object = this.gizmo.object === this.selectionPivot ? this.selectionPivot : this.selected ?? (this.markerSelection === 'player' ? this.playerMarker : this.markerSelection === 'apprentice' ? this.apprenticeMarker : null);
    if (!object) return false;
    this.pointerRay(event);
    const targets = this.selectedObjects.size ? [...this.selectedObjects] : [object];
    if (!this.raycaster.intersectObjects(targets, true).length) return false;
    this.touchPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), object.position);
    const hit = this.raycaster.ray.intersectPlane(this.touchPlane, new THREE.Vector3());
    this.touchDrag = { pointerId: event.pointerId, mode: this.gizmo.mode as 'translate' | 'rotate' | 'scale',
      x: event.clientX, y: event.clientY, position: object.position.clone(), rotationY: object.rotation.y,
      scale: object.scale.clone(), planeHit: hit?.clone() ?? null };
    this.gizmo.enabled = false;
    this.down = null;
    event.preventDefault();
    return true;
  }
  private updateTouchDrag(event: PointerEvent): void {
    const drag = this.touchDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if ([...this.selectedObjects].some(item => item.userData.levelEditorLocked)) return;
    const object = this.gizmo.object === this.selectionPivot ? this.selectionPivot : this.selected ?? (this.markerSelection === 'player' ? this.playerMarker : this.apprenticeMarker);
    if (!object) return;
    if (drag.mode === 'translate') {
      this.pointerRay(event);
      const hit = this.raycaster.ray.intersectPlane(this.touchPlane, new THREE.Vector3());
      if (hit && drag.planeHit) {
        object.position.x = drag.position.x + hit.x - drag.planeHit.x;
        object.position.z = drag.position.z + hit.z - drag.planeHit.z;
      } else {
        // A screen-space halo can sit above the horizon, where its ray never meets the floor.
        // Preserve a predictable horizontal drag in that case instead of leaving MOVE inert.
        const camera = this.camera;
        const distance = Math.max(1, camera.position.distanceTo(object.position));
        const metresPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, this.panel.clientHeight);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const dx = (event.clientX - drag.x) * metresPerPixel;
        const dz = -(event.clientY - drag.y) * metresPerPixel;
        object.position.x = drag.position.x + right.x * dx + forward.x * dz;
        object.position.z = drag.position.z + right.z * dx + forward.z * dz;
      }
    } else if (drag.mode === 'rotate') {
      const angle = drag.rotationY + (event.clientX - drag.x) * .012;
      object.rotation.y = this.el<HTMLInputElement>('#level-snap').checked ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle;
    } else if (drag.mode === 'scale') {
      const factor = THREE.MathUtils.clamp(Math.exp((drag.y - event.clientY) / 170), .25, 4);
      object.scale.copy(drag.scale).multiplyScalar(factor);
    }
    if (object === this.selectionPivot) this.applyPivotDelta();
    this.syncLiveEquipment();
    this.invalidateEditorShadows();
    this.refreshFields();
    event.preventDefault();
  }
  private endTouchDrag(event: PointerEvent): boolean {
    if (!this.touchDrag || this.touchDrag.pointerId !== event.pointerId) return false;
    const drag = this.touchDrag;
    this.touchDrag = null;
    this.orbit.enabled = this.active;
    this.topOrbit.enabled = false;
    this.gizmo.enabled = this.nativeGizmoVisible();
    if (drag.mode === 'translate') {
      const object = this.gizmo.object === this.selectionPivot ? this.selectionPivot : this.selected ?? (this.markerSelection === 'player' ? this.playerMarker : this.apprenticeMarker);
      if (object && this.el<HTMLInputElement>('#level-snap').checked) {
        const step = Number(this.el<HTMLSelectElement>('#level-grid').value);
        object.position.x = Math.round(object.position.x / step) * step;
        object.position.z = Math.round(object.position.z / step) * step;
      }
      if (object === this.selectionPivot) this.applyPivotDelta();
      else this.snapWallEnds();
    }
    this.refreshFields();
    this.recordHistory();
    return true;
  }
  private wallEndpoints(wall: THREE.Group): [THREE.Vector3, THREE.Vector3] {
    const half = (wall.userData.length as number) / 2;
    const alongX = wall.userData.alongX as boolean;
    wall.updateWorldMatrix(true, false);
    const start = new THREE.Vector3(alongX ? -half : 0, 0, alongX ? 0 : -half);
    const end = new THREE.Vector3(alongX ? half : 0, 0, alongX ? 0 : half);
    return [wall.localToWorld(start), wall.localToWorld(end)];
  }
  private setWallPathEnd(end: -1 | 1): void {
    this.wallPathEnd = end;
    this.el('#level-wall-start').setAttribute('aria-pressed', String(end === -1));
    this.el('#level-wall-end').setAttribute('aria-pressed', String(end === 1));
  }
  private setWallPathActive(active: boolean): void {
    this.wallPathActive = active && Boolean(this.selected && this.game.room.mansionWing?.editableWalls.has(this.selected.name));
    if (this.wallPathActive) this.setDetailsOpen(false);
    const button = this.el<HTMLButtonElement>('#level-wall-continue');
    button.setAttribute('aria-pressed', String(this.wallPathActive));
    button.textContent = this.wallPathActive ? '✓ TAP NEXT POINT · DONE' : '＋ CONTINUE · TAP POINTS';
    this.panel.classList.toggle('wall-path-active', this.wallPathActive);
    if (this.wallPathActive) this.status('Tap the next wall point. Drag the scene to orbit; SNAP joins the nearest wall.');
  }
  private snapWallPoint(point: THREE.Vector3, excluded: THREE.Group | null): THREE.Vector3 {
    const result = point.clone();
    if (!this.el<HTMLInputElement>('#level-snap').checked) return result;
    const step = Number(this.el<HTMLSelectElement>('#level-grid').value);
    result.x = Math.round(result.x / step) * step;
    result.z = Math.round(result.z / step) * step;
    let bestDistance = Math.max(.34, step * .8);
    for (const wall of this.game.room.mansionWing?.editableWalls.values() ?? []) {
      if (wall === excluded || !wall.visible) continue;
      const [a, b] = this.wallEndpoints(wall);
      if (Math.abs(a.y - point.y) > .35) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const denominator = dx * dx + dz * dz;
      const t = denominator < 1e-6 ? 0 : THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / denominator, 0, 1);
      const candidate = new THREE.Vector3(a.x + dx * t, point.y, a.z + dz * t);
      const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
      if (distance < bestDistance) { bestDistance = distance; result.copy(candidate); }
    }
    return result;
  }
  private setWallEndpoints(wall: THREE.Group, startWorld: THREE.Vector3, endWorld: THREE.Vector3): boolean {
    const inverse = wall.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
    const start = startWorld.clone().applyMatrix4(inverse);
    const end = endWorld.clone().applyMatrix4(inverse);
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < .2) return false;
    wall.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
    const alongX = wall.userData.alongX as boolean;
    wall.rotation.y = alongX ? Math.atan2(-dz, dx) : Math.atan2(dx, dz);
    const base = wall.userData.length as number;
    if (alongX) wall.scale.x = length / base; else wall.scale.z = length / base;
    wall.updateMatrixWorld(true);
    this.game.room.mansionWing?.obstaclesAt(wall.position.y);
    this.invalidateEditorShadows();
    return true;
  }
  private beginWallEndpointDrag(event: PointerEvent, end: -1 | 1): void {
    const wall = this.selected;
    if (!wall || !this.game.room.mansionWing?.editableWalls.has(wall.name)) return;
    const endpoints = this.wallEndpoints(wall);
    this.wallEndpointDrag = { pointerId: event.pointerId, wall, fixed: endpoints[end === -1 ? 1 : 0].clone(), end };
    this.touchPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), endpoints[0]);
    this.orbit.enabled = false;
    this.gizmo.enabled = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  private updateWallEndpointDrag(event: PointerEvent): void {
    const drag = this.wallEndpointDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.pointerRay(event);
    const hit = this.raycaster.ray.intersectPlane(this.touchPlane, this.wallPathPoint);
    if (!hit) return;
    const moving = this.snapWallPoint(hit, drag.wall);
    if (drag.end === -1) this.setWallEndpoints(drag.wall, moving, drag.fixed); else this.setWallEndpoints(drag.wall, drag.fixed, moving);
    this.refreshFields();
    event.preventDefault();
  }
  private endWallEndpointDrag(event: PointerEvent): void {
    if (!this.wallEndpointDrag || this.wallEndpointDrag.pointerId !== event.pointerId) return;
    this.wallEndpointDrag = null;
    this.orbit.enabled = this.active;
    this.gizmo.enabled = this.nativeGizmoVisible();
    this.snapWallEnds();
    this.refreshFields();
    this.recordHistory();
  }
  private createWallSection(start: THREE.Vector3, end: THREE.Vector3, kind: WallKind, chainId: string, sectionIndex: number): THREE.Group | null {
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (length < .2) return null;
    const wall = this.game.room.mansionWing!.addEditorWall(crypto.randomUUID(), kind, length);
    wall.userData.wallChainId = chainId;
    wall.userData.wallSectionIndex = sectionIndex;
    wall.position.set((start.x + end.x) / 2, start.y, (start.z + end.z) / 2);
    wall.rotation.y = Math.atan2(-(end.z - start.z), end.x - start.x);
    this.added.add(wall.name);
    this.game.room.mansionWing!.obstaclesAt(start.y);
    return wall;
  }
  private extendWallAtPointer(event: PointerEvent): boolean {
    const wall = this.selected;
    if (!wall || !this.game.room.mansionWing?.editableWalls.has(wall.name)) return false;
    const anchor = this.wallEndpoints(wall)[this.wallPathEnd === -1 ? 0 : 1];
    this.touchPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), anchor);
    this.pointerRay(event);
    const hit = this.raycaster.ray.intersectPlane(this.touchPlane, this.wallPathPoint);
    if (!hit) return false;
    const target = this.snapWallPoint(hit, wall);
    const chainId = wall.userData.wallChainId as string | undefined ?? crypto.randomUUID();
    const sectionIndex = Number(wall.userData.wallSectionIndex ?? 0) + 1;
    const next = this.createWallSection(anchor, target, wall.userData.levelEditorKind as WallKind, chainId, sectionIndex);
    if (!next) { this.status('Next point is too close. Move at least 20 cm.'); return true; }
    wall.userData.wallChainId = chainId;
    this.setWallPathEnd(1);
    this.selectWall(next);
    this.setWallPathActive(true);
    this.status(`Wall section ${sectionIndex + 1} added. Tap again to continue, or press DONE.`);
    this.recordHistory();
    return true;
  }
  private changeSelectedWallMaterial(kind: WallKind): void {
    const wall = this.selected;
    const wing = this.game.room.mansionWing;
    if (!wall || !wing?.editableWalls.has(wall.name) || wall.userData.levelEditorKind === kind) return;
    const match = /^Editor (brick-wall|concrete-wall) ([0-9a-f-]{36})$/i.exec(wall.name);
    if (!match || !this.added.has(wall.name)) {
      this.el<HTMLSelectElement>('#level-wall-material').value = wall.userData.levelEditorKind as WallKind;
      this.status('Material replacement is available on added and continued wall sections; authored mansion walls remain protected in this slice.');
      return;
    }
    const oldName = wall.name;
    const position = wall.position.clone(), quaternion = wall.quaternion.clone(), scale = wall.scale.clone();
    const metadata = { chainId: wall.userData.wallChainId, sectionIndex: wall.userData.wallSectionIndex,
      curveRadius: wall.userData.curveRadius, curveShape: wall.userData.curveShape as CurvedWallShape | undefined };
    const length = wall.userData.length as number;
    wing.removeEditorWall(wall);
    this.added.delete(oldName);
    const replacement = wing.addEditorWall(match[2], kind, length);
    replacement.position.copy(position); replacement.quaternion.copy(quaternion); replacement.scale.copy(scale);
    replacement.userData.wallChainId = metadata.chainId; replacement.userData.wallSectionIndex = metadata.sectionIndex; replacement.userData.curveRadius = metadata.curveRadius;
    if (metadata.curveShape) { replacement.userData.curveShape = metadata.curveShape;
      if (kind === 'concrete-wall') wing.applyEditorConcreteCurve(replacement, metadata.curveShape); }
    this.added.add(replacement.name);
    for (const group of this.groups.values()) group.members = group.members.map(name => name === oldName ? replacement.name : name);
    this.selectWall(replacement);
    this.status(kind === 'brick-wall' ? 'Section changed to fired-clay brick.' : 'Section changed to cast concrete.');
    this.recordHistory();
  }
  private curveSelectedWall(side: -1 | 1): void {
    const wall = this.selected;
    const wing = this.game.room.mansionWing;
    if (!wall || !wing?.editableWalls.has(wall.name)) return;
    if (!this.added.has(wall.name)) { this.status('Curve conversion currently applies to added or continued sections; extend this wall first.'); return; }
    const [start, end] = this.wallEndpoints(wall);
    const chord = Math.hypot(end.x - start.x, end.z - start.z);
    const requested = Number(this.el<HTMLInputElement>('#level-wall-radius').value);
    const radius = Math.max(chord / 2 + .01, Number.isFinite(requested) ? requested : chord);
    this.el<HTMLInputElement>('#level-wall-radius').value = radius.toFixed(2);
    const mid = start.clone().add(end).multiplyScalar(.5);
    const dx = end.x - start.x, dz = end.z - start.z;
    const normal = new THREE.Vector3(-dz / chord * side, 0, dx / chord * side);
    const height = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
    const centre = mid.clone().addScaledVector(normal, height);
    const angle0 = Math.atan2(start.z - centre.z, start.x - centre.x);
    const angle1 = Math.atan2(end.z - centre.z, end.x - centre.x);
    let sweep = angle1 - angle0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    if (Math.sign(sweep) !== Math.sign(side)) sweep += side * Math.PI * 2;
    if (Math.abs(sweep) > Math.PI) sweep -= Math.sign(sweep) * Math.PI * 2;
    const count = THREE.MathUtils.clamp(Math.ceil(Math.abs(sweep * radius) / .45), 4, 32);
    const kind = wall.userData.levelEditorKind as WallKind;
    const chainId = wall.userData.wallChainId as string | undefined ?? crypto.randomUUID();
    const baseIndex = Number(wall.userData.wallSectionIndex ?? 0);
    const scaleY = wall.scale.y, scaleZ = wall.scale.z;
    const oldName = wall.name;
    wing.removeEditorWall(wall); this.added.delete(oldName);
    const sections: THREE.Group[] = [];
    let from = start;
    for (let index = 1; index <= count; index++) {
      const angle = angle0 + sweep * index / count;
      const to = new THREE.Vector3(centre.x + Math.cos(angle) * radius, start.y, centre.z + Math.sin(angle) * radius);
      const section = this.createWallSection(from, to, kind, chainId, baseIndex + index - 1);
      if (section) {
        section.scale.y = scaleY; section.scale.z *= scaleZ; section.userData.curveRadius = radius * side;
        const localCenter = section.worldToLocal(centre.clone());
        const localStart = section.worldToLocal(from.clone());
        const shape: CurvedWallShape = { center: [localCenter.x, localCenter.z], radius,
          startAngle: Math.atan2(localStart.z - localCenter.z, localStart.x - localCenter.x),
          sweep: sweep / count, uvStart: Math.abs(sweep) * radius * (index - 1) / count,
          capStart: index === 1, capEnd: index === count };
        section.userData.curveShape = shape;
        if (kind === 'concrete-wall') wing.applyEditorConcreteCurve(section, shape);
        sections.push(section);
      }
      from = to;
    }
    for (const group of this.groups.values()) group.members = group.members.flatMap(name => name === oldName ? sections.map(section => section.name) : [name]);
    this.setSelection(sections, null, false);
    this.status(`Curved wall created as ${sections.length} independently editable sections · radius ${radius.toFixed(2)} m.`);
    this.recordHistory();
  }
  private recordHistory(label?: string): void {
    this.syncLiveEquipment();
    const document = this.document();
    if (this.historyIndex >= 0 && JSON.stringify(this.history[this.historyIndex]) === JSON.stringify(document)) return;
    const previous = this.history[this.historyIndex];
    if (!label && previous) {
      const before = new Set([...previous.walls, ...previous.surfaces].map(item => item.id));
      const after = new Set([...document.walls, ...document.surfaces].map(item => item.id));
      label = [...after].some(id => !before.has(id)) ? 'Add element'
        : [...before].some(id => !after.has(id)) ? 'Delete element' : 'Edit scene';
    }
    this.invalidateEditorShadows();
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.historyLabels = this.historyLabels.slice(0, this.historyIndex + 1);
    this.historySelections = this.historySelections.slice(0, this.historyIndex + 1);
    this.history.push(document);
    this.historyLabels.push(label ?? 'Initial state');
    this.historySelections.push([...this.selectedObjects].map(item => item.name));
    if (this.history.length > 100) { this.history.shift(); this.historyLabels.shift(); this.historySelections.shift(); }
    this.historyIndex = this.history.length - 1;
    this.updateHistoryButtons();
  }
  private syncLiveEquipment(): void {
    if (this.selectedObjects.has(this.game.mixing.wheelbarrow.model.group)) this.game.mixing.wheelbarrow.syncEditorPlacement();
    if (this.selectedObjects.has(this.game.mixing.models.mixer)) this.game.mixing.syncEditorRestPositions();
  }
  private moveHistory(direction: -1 | 1): void {
    const next = this.historyIndex + direction;
    this.moveHistoryTo(next);
  }
  private moveHistoryTo(next: number): void {
    if (next < 0 || next >= this.history.length) return;
    const detailsOpen = this.panel.classList.contains('details-open');
    this.historyIndex = next;
    this.applyDocument(this.history[next]);
    this.applyFloorVisibility();
    const wing = this.game.room.mansionWing;
    const selection = (this.historySelections[next] ?? []).map(name => wing?.editableWalls.get(name) ?? wing?.editableSurfaces.get(name) ?? wing?.editableAssets.get(name))
      .filter((item): item is THREE.Group => item instanceof THREE.Group && this.isSelectableVisible(item));
    this.setSelection(selection);
    if (detailsOpen) this.setDetailsOpen(true);
    this.updateHistoryButtons();
    this.status('Unsaved editor change. SAVE to keep this version.');
  }
  private updateHistoryButtons(): void {
    this.el<HTMLButtonElement>('#level-undo').disabled = this.historyIndex <= 0;
    this.el<HTMLButtonElement>('#level-redo').disabled = this.historyIndex >= this.history.length - 1;
    this.el('#level-history-count').textContent = `${this.historyIndex + 1}/${this.history.length}`;
    const list = this.el('#level-history-list');
    list.replaceChildren();
    this.historyLabels.forEach((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${index + 1}. ${label}`;
      button.setAttribute('aria-current', String(index === this.historyIndex));
      button.addEventListener('click', () => this.moveHistoryTo(index));
      list.append(button);
    });
  }
  private setNavMode(mode: 'bottom' | 'wheel'): void {
    this.panel.dataset.navMode = mode;
    this.el<HTMLSelectElement>('#level-nav-mode').value = mode;
    this.panel.classList.remove('wheel-open');
    try { localStorage.setItem('wirehouse:level-editor-nav', mode); } catch { /* Navigation remains usable in memory. */ }
  }

  private floorElevation(index: number): number {
    return index === 5 ? -3.4 : index === 6 ? -6.8 : index * 3.3;
  }

  private setViewMode(mode: '3d' | '2d'): void {
    const previous = this.viewMode;
    if (previous === '3d' && mode === '2d' && this.cameraPreset === 'angle') {
      this.angleViewPosition.copy(this.camera.position);
      this.angleViewTarget.copy(this.orbit.target);
    }
    this.viewMode = mode;
    this.setCameraMode(this.cameraMode);
    if (mode === '2d' && this.floorIndex < 0) this.setFloorIndex(0);
    this.panel.dataset.view = mode;
    // A straight-down camera needs a horizontal up axis. With world Y as up,
    // OrbitControls starts at its polar limit and one drag direction cannot tilt.
    this.camera.up.set(0, mode === '2d' ? 0 : 1, mode === '2d' ? -1 : 0);
    // Three r185 caches this conversion when OrbitControls is constructed.
    // Keep its orbit basis aligned when the same live camera changes preset.
    const orbitBasis = this.orbit as OrbitControls & { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
    orbitBasis._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
    orbitBasis._quatInverse.copy(orbitBasis._quat).invert();
    this.orbit.enabled = this.active;
    this.topOrbit.enabled = false;
    this.gizmo.camera = this.camera;
    if (this.active) this.game.renderer.viewCamera = this.camera;
    this.resize();
    if (mode === '2d') this.frameTopFloor();
    else {
      const floorOffset = this.floorIndex >= 0 ? this.floorElevation(this.floorIndex) - this.angleViewTarget.y + 1.5 : 0;
      this.camera.position.copy(this.angleViewPosition).add(new THREE.Vector3(0, floorOffset, 0));
      this.orbit.target.copy(this.angleViewTarget).add(new THREE.Vector3(0, floorOffset, 0));
      this.orbit.update();
    }
    this.cameraPreset = mode === '2d' ? 'top' : 'angle';
    if (this.active) this.applyFloorVisibility();
    this.syncPresetButtons();
    this.updateViewLabel();
  }

  private setSidePreset(preset: 'front' | 'back' | 'left' | 'right'): void {
    this.setViewMode('3d');
    const bounds = new THREE.Box3();
    const part = new THREE.Box3();
    const wing = this.game.room.mansionWing;
    if (wing) for (const object of wing.children) {
      if (!object.visible || object === wing.surroundings) continue;
      part.setFromObject(object);
      if (!part.isEmpty()) bounds.union(part);
    }
    const centre = bounds.isEmpty() ? this.orbit.target.clone() : bounds.getCenter(new THREE.Vector3());
    const targetY = this.floorIndex < 0 ? centre.y : this.floorElevation(this.floorIndex) + 1.5;
    const distance = THREE.MathUtils.clamp(Math.max(20, this.camera.position.distanceTo(this.orbit.target)), 20, 88);
    this.orbit.target.set(centre.x, targetY, centre.z);
    const direction = preset === 'front' ? new THREE.Vector3(0, 0, 1)
      : preset === 'back' ? new THREE.Vector3(0, 0, -1)
        : preset === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
    this.camera.position.copy(this.orbit.target).addScaledVector(direction, distance);
    this.orbit.update();
    this.cameraPreset = preset;
    this.syncPresetButtons();
    this.updateViewLabel();
  }

  private syncPresetButtons(): void {
    this.panel.querySelectorAll<HTMLButtonElement>('[data-level-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.levelView === (this.cameraPreset === 'top' ? '2d' : '3d') && (this.cameraPreset === 'top' || this.cameraPreset === 'angle'))));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-camera-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cameraPreset === this.cameraPreset)));
  }

  private setFloorIndex(index: number): void {
    if (!Number.isInteger(index) || index < -1 || index > 6) return;
    if (this.viewMode === '2d' && index === -1) index = 0;
    const oldY = this.orbit.target.y;
    this.floorIndex = index;
    if (index >= 0) {
      const base = this.floorElevation(index);
      this.camera.position.y += base + 1.5 - oldY;
      this.orbit.target.y = base + 1.5;
      this.orbit.update();
    }
    if (this.active) this.applyFloorVisibility();
    if (this.viewMode === '2d') this.frameTopFloor();
    this.el<HTMLSelectElement>('#level-floor').value = String(index);
    this.el<HTMLSelectElement>('#level-floor-quick').value = String(index);
    this.updateViewLabel();
    if (this.selectedObjects.size && [...this.selectedObjects].some(object => !this.isSelectableVisible(object))) this.setSelection([]);
    this.refreshList();
  }

  private updateViewLabel(): void {
    const label = this.floorIndex < 0 ? 'ALL' : this.floorIndex === 0 ? 'G-0'
      : this.floorIndex >= 5 ? `B${this.floorIndex - 4}` : `L${this.floorIndex}`;
    this.el('#level-view-trigger').textContent = `▤ ${this.cameraPreset.toUpperCase()} · ${label}`;
  }

  private applyFloorVisibility(): void {
    const room = this.game.room;
    const wing = room.mansionWing;
    if (!wing) return;
    // Floor filtering belongs to the open editor. Its constructor chooses a
    // default top-view floor while hidden; applying that cutaway to gameplay
    // removes the garage and upper ceilings before the player enters them.
    if (!this.active) { this.applyTemplateVisibility(); return; }
    this.restoreTopCutaway();
    for (const object of [...room.children, ...wing.children]) {
      if (!this.originalVisibility.has(object)) this.originalVisibility.set(object, object.visible);
      object.visible = this.originalVisibility.get(object)!;
    }
    for (const object of this.siteEquipment) {
      if (!this.originalVisibility.has(object)) this.originalVisibility.set(object, object.visible);
      object.visible = this.originalVisibility.get(object)! && this.floorIndex <= 0;
    }
    for (const object of this.game.renderer.scene.children) {
      if (!isGroundSceneSystem(object)) continue;
      const atOpen = this.editorSceneVisibility.get(object) ?? this.originalSystemVisibility.get(object) ?? object.visible;
      object.visible = atOpen && this.template !== 'blank' && this.floorIndex <= 0;
    }
    this.invalidateEditorShadows();
    if (this.floorIndex < 0) { this.applyTemplateVisibility(); this.updateStartMarkerVisibility(); return; }
    for (const object of room.children) {
      if (object !== wing && object !== room.exterior) object.visible = false;
    }
    if (this.floorIndex === 0) for (const object of room.children) object.visible = this.originalVisibility.get(object) ?? object.visible;
    const bounds = new THREE.Box3();
    room.exterior.visible = this.floorIndex < 5 && (this.originalVisibility.get(room.exterior) ?? true);
    wing.surroundings.visible = this.floorIndex < 5;
    for (const object of wing.children) {
      if (object === wing.surroundings) continue;
      if (object === wing.courtyard) { object.visible = this.floorIndex === 0; continue; }
      bounds.setFromObject(object);
      if (bounds.isEmpty()) continue;
      const level = object.userData.levelEditorFloor === 5 || object.name.startsWith('B1 ') ? 5
        : object.userData.levelEditorFloor === 6 || object.name.startsWith('B2 ') ? 6
          : bounds.min.y < -5 ? 6 : bounds.min.y < -1 ? 5
            : Math.floor((bounds.min.y + .3) / 3.3);
      object.visible = (this.originalVisibility.get(object) ?? true) && level === this.floorIndex;
    }
    this.applyTemplateVisibility();
    this.applyTopCutaway();
    this.updateStartMarkerVisibility();
  }

  private applyTopCutaway(): void {
    if (this.viewMode !== '2d' || this.floorIndex < 0) return;
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    const cutHeight = this.floorElevation(this.floorIndex) + 2.35;
    wing.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      this.topCutawayBounds.setFromObject(object);
      if (this.topCutawayBounds.isEmpty() || this.topCutawayBounds.min.y < cutHeight) return;
      this.topCutawayVisibility.set(object, object.visible);
      object.visible = false;
    });
  }

  private restoreTopCutaway(): void {
    for (const [object, visible] of this.topCutawayVisibility) object.visible = visible;
    this.topCutawayVisibility.clear();
  }

  private setTemplateMode(template: 'mansion' | 'blank'): void {
    this.template = template;
    this.game.room.mansionWing?.setEmptyTemplate(template === 'blank');
    this.game.player.setEmptySite(template === 'blank');
    for (const object of this.game.renderer.scene.children) {
      if (!isGroundSceneSystem(object)) continue;
      if (!this.originalSystemVisibility.has(object)) this.originalSystemVisibility.set(object, object.visible);
      object.visible = template === 'blank' ? false : this.originalSystemVisibility.get(object)!;
    }
    if (this.active) this.applyFloorVisibility();
    else this.applyTemplateVisibility();
  }

  private applyTemplateVisibility(): void {
    if (this.template !== 'blank') return;
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    for (const object of this.game.room.children) if (object !== wing) object.visible = false;
    for (const object of wing.children) if (object !== wing.surroundings && !this.added.has(object.name)) object.visible = false;
  }

  /** Keep the chosen floor in the usable viewport when switching levels. Pan and pinch can still adjust it. */
  private frameTopFloor(): void {
    const wing = this.game.room.mansionWing;
    if (!wing || this.floorIndex < 0) return;
    const bounds = new THREE.Box3();
    const part = new THREE.Box3();
    for (const object of wing.children) {
      if (!object.visible || object === wing.surroundings) continue;
      part.setFromObject(object);
      if (!part.isEmpty() && Number.isFinite(part.min.x) && Number.isFinite(part.max.z)) bounds.union(part);
    }
    if (bounds.isEmpty()) {
      if (this.template !== 'blank') return;
      bounds.set(new THREE.Vector3(-3.5, 0, -6), new THREE.Vector3(26.5, 0, 22));
    }
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const canvas = this.game.renderer.webgl.domElement;
    const aspect = Math.max(.1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const distance = THREE.MathUtils.clamp(Math.max(
      size.x / (2 * Math.tan(halfFov) * aspect * .82),
      size.z / (2 * Math.tan(halfFov) * .72),
      8,
    ), 8, 88);
    this.orbit.target.set(centre.x, this.floorElevation(this.floorIndex), centre.z);
    // TOP is a straight-down preset for the same live perspective camera.
    // OrbitControls stays enabled so a drag can tilt this view immediately.
    this.camera.position.set(centre.x, this.floorElevation(this.floorIndex) + distance, centre.z);
    this.orbit.update();
  }

  private restoreVisibility(): void {
    this.restoreTopCutaway();
    for (const [object, visible] of this.originalVisibility) object.visible = visible;
    this.originalVisibility.clear();
    for (const object of this.game.renderer.scene.children) {
      if (!isGroundSceneSystem(object)) continue;
      const atOpen = this.editorSceneVisibility.get(object) ?? this.originalSystemVisibility.get(object) ?? object.visible;
      object.visible = this.template !== 'blank' && atOpen;
    }
    this.editorSceneVisibility.clear();
    this.applyTemplateVisibility();
  }

  async open(): Promise<void> {
    if (this.active || !this.game.room.mansionWing) return;
    await this.game.renderer.waitForFrame();
    this.registerMissionBoxes();
    this.editorSceneVisibility.clear();
    for (const object of this.game.renderer.scene.children) {
      if (!isGroundSceneSystem(object)) continue;
      this.editorSceneVisibility.set(object, this.template === 'blank'
        ? this.originalSystemVisibility.get(object) ?? object.visible : object.visible);
    }
    this.game.room.mansionWing.restoreGameplayVisibility();
    if (document.pointerLockElement) await document.exitPointerLock();
    this.game.input.resetTransientInput();
    this.game.mortar.cancel();
    this.active = true;
    this.panel.hidden = false;
    this.game.hud.shell.classList.add('level-editor-open');
    this.game.renderer.viewCamera = this.camera;
    // The editor uses its own camera and start markers. Keeping the first-person
    // player rig in the scene wastes skinned draws even when the roof hides it.
    for (const object of [this.game.workerBody, this.game.fpsRig,
      ...this.game.renderer.scene.children.filter(isDetachedViewModel)]) {
      this.playerVisibility.set(object, object.visible);
      object.visible = false;
    }
    const fog = this.game.renderer.scene.fog;
    this.editorFog = fog instanceof THREE.Fog ? { fog, near: fog.near, far: fog.far } : null;
    this.orbit.enabled = true;
    this.topOrbit.enabled = false;
    this.applyFloorVisibility();
    this.enableEditorShadowCache();
    this.enableEditorRaycasts();
    this.gizmo.getHelper().visible = this.nativeGizmoVisible();
    this.gizmo.enabled = this.nativeGizmoVisible();
    this.syncHighlights(this.selectedObjects);
    this.updateStartMarkerVisibility();
    this.resize();
    this.refreshList();
    this.status('Edit structures live. SAVE writes browser and local project; EXPORT downloads JSON.');
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.editorTouches.clear();
    this.pinchZoom = null;
    this.panel.hidden = true;
    this.orbit.enabled = false;
    this.topOrbit.enabled = false;
    this.restoreVisibility();
    this.restoreEditorShadowCache();
    for (const [object, visible] of this.playerVisibility) object.visible = visible;
    this.playerVisibility.clear();
    if (this.editorFog) {
      this.editorFog.fog.near = this.editorFog.near;
      this.editorFog.fog.far = this.editorFog.far;
      this.editorFog = null;
    }
    this.restoreEditorRaycasts();
    this.touchDrag = null;
    this.gizmo.enabled = true;
    this.gizmo.detach();
    this.syncHighlights([]);
    this.gizmo.getHelper().visible = false;
    this.haloElement.hidden = true;
    this.el('#level-wall-endpoints').hidden = true;
    this.setWallPathActive(false);
    this.playerMarker.visible = this.apprenticeMarker.visible = this.active;
    this.game.renderer.viewCamera = null;
    this.game.hud.shell.classList.remove('level-editor-open');
    this.game.input.resetTransientInput();
    if (!this.game.started) this.game.hud.shell.querySelector('#start-screen')?.classList.remove('hidden');
  }

  private nativeGizmoVisible(): boolean { return this.active && Boolean(this.gizmo.object) && !matchMedia('(max-width: 1100px)').matches; }
  private enableEditorShadowCache(): void {
    this.game.renderer.scene.traverse(object => {
      if (!(object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) ||
        !object.castShadow || this.editorShadows.has(object.shadow)) return;
      const shadow = object.shadow;
      this.editorShadows.set(shadow, shadow.autoUpdate);
      // The editor's geometry is static between edits. Keep the rendered map,
      // then refresh it on every scene change instead of redrawing it per frame.
      shadow.autoUpdate = false;
      shadow.needsUpdate = true;
    });
  }
  private invalidateEditorShadows(): void {
    for (const shadow of this.editorShadows.keys()) shadow.needsUpdate = true;
  }
  private restoreEditorShadowCache(): void {
    for (const [shadow, autoUpdate] of this.editorShadows) {
      shadow.autoUpdate = autoUpdate;
      shadow.needsUpdate = true;
    }
    this.editorShadows.clear();
  }
  private enableEditorRaycasts(): void {
    for (const asset of this.game.room.mansionWing?.editableAssets.values() ?? []) asset.traverse(node => {
      if (!(node instanceof THREE.Mesh) || this.editorRaycasts.has(node)) return;
      if (node.userData.levelEditorPickThrough) return;
      if (!(node.geometry instanceof THREE.BufferGeometry)) {
        this.editorRaycasts.set(node, node.raycast);
        node.raycast = () => undefined;
        return;
      }
      if (!Object.hasOwn(node, 'raycast')) return;
      this.editorRaycasts.set(node, node.raycast);
      node.raycast = node instanceof THREE.InstancedMesh ? THREE.InstancedMesh.prototype.raycast : THREE.Mesh.prototype.raycast;
    });
  }
  private restoreEditorRaycasts(): void {
    for (const [node, raycast] of this.editorRaycasts) node.raycast = raycast;
    this.editorRaycasts.clear();
  }
  private updateHalo(): void {
    if (!matchMedia('(max-width: 1100px)').matches || this.panel.classList.contains('dock-collapsed') || !this.gizmo.object) { this.haloElement.hidden = true; return; }
    this.haloBounds.makeEmpty();
    if (this.selectionAnchor && this.selectedObjects.size === 1) this.haloBounds.setFromCenterAndSize(this.selectionAnchor, new THREE.Vector3(.7, .7, .7));
    else if (this.selectedObjects.size > 1) for (const item of this.selectedObjects) this.haloBounds.expandByObject(item);
    else this.haloBounds.setFromObject(this.gizmo.object);
    if (this.haloBounds.isEmpty()) { this.haloElement.hidden = true; return; }
    const camera = this.camera;
    camera.updateMatrixWorld();
    const canvas = this.game.renderer.webgl.domElement.getBoundingClientRect();
    const panel = this.panel.getBoundingClientRect();
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, visible = false;
    for (const x of [this.haloBounds.min.x, this.haloBounds.max.x])
      for (const y of [this.haloBounds.min.y, this.haloBounds.max.y])
        for (const z of [this.haloBounds.min.z, this.haloBounds.max.z]) {
          const projected = this.haloCorner.set(x, y, z).project(camera);
          if (projected.z < -1 || projected.z > 1) continue;
          const sx = canvas.left - panel.left + (projected.x + 1) * canvas.width / 2;
          const sy = canvas.top - panel.top + (1 - projected.y) * canvas.height / 2;
          left = Math.min(left, sx); right = Math.max(right, sx);
          top = Math.min(top, sy); bottom = Math.max(bottom, sy);
          visible = true;
        }
    if (!visible || right < 0 || left > panel.width || bottom < 0 || top > panel.height) { this.haloElement.hidden = true; return; }
    const sheetHeight = this.panel.classList.contains('sheet-open') ? Math.min(panel.height * .46, 390) + 78 : 80;
    const maxY = Math.max(90, panel.height - sheetHeight - 52);
    const x = right + 58 < panel.width ? right + 8 : left - 56;
    const y = bottom + 58 < panel.height - sheetHeight ? bottom + 8 : top - 56;
    const haloX = THREE.MathUtils.clamp(x, 8, Math.max(8, panel.width - 52));
    this.haloElement.style.left = `${haloX}px`;
    this.haloElement.classList.toggle('halo-right', haloX > panel.width - 180);
    this.haloElement.style.top = `${THREE.MathUtils.clamp(y, 90, maxY)}px`;
    this.haloElement.hidden = false;
  }
  private updateWallEndpointHandles(): void {
    const container = this.el('#level-wall-endpoints');
    const wall = this.selected;
    if (!this.wallPathActive || !wall || this.gizmo.mode !== 'translate' || this.selectedObjects.size !== 1 || !this.game.room.mansionWing?.editableWalls.has(wall.name)) { container.hidden = true; return; }
    const canvas = this.game.renderer.webgl.domElement.getBoundingClientRect();
    const panel = this.panel.getBoundingClientRect();
    const endpoints = this.wallEndpoints(wall);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-wall-end]')];
    const blockedBottom = this.panel.classList.contains('details-open') ? Math.min(panel.height * .58, 500) + 82
      : this.panel.classList.contains('sheet-open') ? 162 : 78;
    const usableBottom = panel.height - blockedBottom;
    let visible = false;
    for (let index = 0; index < 2; index++) {
      const projected = endpoints[index].clone().project(this.camera);
      const button = buttons[index];
      if (projected.z < -1 || projected.z > 1) { button.hidden = true; continue; }
      const x = canvas.left - panel.left + (projected.x + 1) * canvas.width / 2;
      const y = canvas.top - panel.top + (1 - projected.y) * canvas.height / 2;
      button.hidden = x < -20 || x > panel.width + 20 || y < -20 || y > usableBottom;
      if (button.hidden) continue;
      button.style.left = `${x}px`; button.style.top = `${y}px`;
      button.setAttribute('aria-pressed', String((index === 0 ? -1 : 1) === this.wallPathEnd));
      visible = true;
    }
    container.hidden = !visible;
  }
  update(): void {
    if (!this.active) return;
    this.orbit.update();
    if (this.editorFog) {
      // A portrait overview needs a long camera distance to fit the full floor.
      // Gameplay fog ending at 88 m otherwise erases almost every surface.
      const distance = this.camera.position.distanceTo(this.orbit.target);
      this.editorFog.fog.near = Math.max(this.editorFog.near, distance - 14);
      this.editorFog.fog.far = Math.max(this.editorFog.far, distance + 95);
    }
    if (this.viewMode === '2d') {
      const height = this.floorElevation(this.floorIndex);
      const drift = this.orbit.target.y - height;
      if (Math.abs(drift) > 1e-5) {
        this.orbit.target.y = height;
        this.camera.position.y -= drift;
        this.camera.lookAt(this.orbit.target);
        this.camera.updateMatrixWorld();
      }
    }
    this.updateGizmoSize();
    this.updateSelectionMarker();
    this.updateHalo();
    this.updateWallEndpointHandles();
  }
  private updateGizmoSize(): void {
    const object = this.selectedObjects.size > 1 ? this.selectionPivot : this.selected;
    if (!object || !this.nativeGizmoVisible()) return;
    this.gizmoBounds.setFromObject(object);
    if (this.gizmoBounds.isEmpty()) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [this.gizmoBounds.min.x, this.gizmoBounds.max.x])
      for (const y of [this.gizmoBounds.min.y, this.gizmoBounds.max.y])
        for (const z of [this.gizmoBounds.min.z, this.gizmoBounds.max.z]) {
          const point = this.haloCorner.set(x, y, z).project(this.camera);
          if (point.z < -1 || point.z > 1) continue;
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
    if (!Number.isFinite(minX)) return;
    const canvas = this.game.renderer.webgl.domElement;
    const span = Math.max((maxX - minX) * canvas.clientWidth / 2, (maxY - minY) * canvas.clientHeight / 2);
    this.gizmo.setSize(THREE.MathUtils.clamp(span / 420, .12, .34));
  }
  private updateSelectionMarker(): void {
    if (!this.selectionAnchor || !this.selected) return;
    const marker = this.highlights.get(this.selected)?.getObjectByName('Large-surface selection outline');
    if (!(marker instanceof THREE.Mesh)) return;
    const distance = this.camera.position.distanceTo(this.selectionAnchor);
    const radius = 52 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) /
      Math.max(1, this.game.renderer.webgl.domElement.clientHeight);
    marker.scale.setScalar(THREE.MathUtils.clamp(radius, .08, .75));
  }
  private resize(): void {
    const canvas = this.game.renderer.webgl.domElement;
    this.camera.aspect = Math.max(.1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.camera.updateProjectionMatrix();
    const aspect = Math.max(.1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.topCamera.left = -16 * aspect;
    this.topCamera.right = 16 * aspect;
    this.topCamera.top = 16;
    this.topCamera.bottom = -16;
    this.topCamera.updateProjectionMatrix();
    this.gizmo.setSize(canvas.clientWidth <= 700 ? 1.25 : canvas.clientWidth <= 1100 ? 1.05 : .8);
  }
  private setSnap(): void {
    const step = this.el<HTMLInputElement>('#level-snap').checked ? Number(this.el<HTMLSelectElement>('#level-grid').value) : null;
    this.gizmo.setTranslationSnap(step);
    this.gizmo.setRotationSnap(step === null ? null : Math.PI / 12);
    this.gizmo.setScaleSnap(step);
  }
  private snapWallEnds(): void {
    if (!this.selected || !this.game.room.mansionWing?.editableWalls.has(this.selected.name) ||
      !this.el<HTMLInputElement>('#level-snap').checked || this.gizmo.mode !== 'translate') return;
    const endpoints = (wall: THREE.Group): THREE.Vector3[] => {
      const distance = (wall.userData.length as number) / 2;
      const alongX = wall.userData.alongX as boolean;
      wall.updateWorldMatrix(true, false);
      return [-1, 1].map(sign => wall.localToWorld(new THREE.Vector3(alongX ? sign * distance : 0, 0, alongX ? 0 : sign * distance)));
    };
    const source = endpoints(this.selected);
    let best = .38, offset: THREE.Vector3 | null = null;
    for (const wall of this.game.room.mansionWing.editableWalls.values()) {
      if (wall === this.selected) continue;
      for (const from of source) for (const to of endpoints(wall)) {
        if (Math.abs(from.y - to.y) > .3) continue;
        const distance = Math.hypot(from.x - to.x, from.z - to.z);
        if (distance < best) { best = distance; offset = to.clone().sub(from); }
      }
    }
    if (offset) {
      this.selected.position.x += offset.x;
      this.selected.position.z += offset.z;
      this.status('Wall endpoint snapped to neighboring wall.');
    }
  }
  private editables(): THREE.Group[] {
    const wing = this.game.room.mansionWing;
    return wing ? [...wing.editableWalls.values(), ...wing.editableSurfaces.values(), ...wing.editableAssets.values()] : [];
  }
  private usesSurfaceAnchor(size: number[]): boolean {
    return Math.max(...size) > 25 || (size[1] < 1 && Math.max(size[0], size[2]) > 6);
  }
  private isSelectableVisible(object: THREE.Object3D): boolean {
    const wing = this.game.room.mansionWing;
    for (let current: THREE.Object3D | null = object; current && current !== wing; current = current.parent)
      if (!current.visible) return false;
    // Floor isolation and the top cut can hide every child while leaving its
    // edit pivot visible. Such a list item has nothing the user can tap.
    let hasVisibleGeometry = false;
    object.traverseVisible(node => {
      if (node instanceof THREE.Mesh && !node.userData.levelEditorHighlight && !node.userData.levelEditorPickProxy)
        hasVisibleGeometry = true;
    });
    return hasVisibleGeometry;
  }
  private isHitVisible(object: THREE.Object3D): boolean {
    for (let current: THREE.Object3D | null = object; current; current = current.parent)
      if (!current.visible) return false;
    return true;
  }
  private syncHighlights(targets: Iterable<THREE.Group>): void {
    const wanted = new Set(targets);
    for (const [object, overlay] of this.highlights) if (!wanted.has(object)) {
      overlay.removeFromParent();
      overlay.traverse(node => {
        if (node instanceof THREE.Sprite) {
          const material = node.material as THREE.SpriteMaterial;
          material.map?.dispose();
          material.dispose();
        } else if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments || node instanceof THREE.Points) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
      this.highlights.delete(object);
    }
    for (const object of wanted) {
      if (this.highlights.has(object)) continue;
      const kind = object.userData.levelEditorKind as WallKind | SurfaceKind | 'asset';
      const length = object.userData.length as number;
      const depth = kind === 'floor' || kind === 'stair' ? object.userData.depth as number : .27;
      const size = kind === 'asset' ? new THREE.Vector3().fromArray(object.userData.baseSize as number[])
        : kind === 'floor' ? new THREE.Vector3(length, .2, depth)
        : kind === 'stair' ? new THREE.Vector3(length, 1.7, depth)
          : new THREE.Vector3(object.userData.alongX ? length : .27, 3.03, object.userData.alongX ? .27 : length);
      const overlay = new THREE.Group();
      overlay.name = 'Selected element highlight';
      overlay.userData.levelEditorHighlight = true;
      overlay.position.y = kind === 'asset' ? 0 : kind === 'floor' ? -.09 : kind === 'stair' ? .825 : 1.5;
      const bounds = new THREE.BoxGeometry(size.x, size.y, size.z);
      const edgeShape = new THREE.EdgesGeometry(bounds);
      const edges = new THREE.LineSegments(edgeShape,
        new THREE.LineBasicMaterial({ color: 0x63efff, depthTest: false, depthWrite: false }));
      const corners: number[] = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
        corners.push(x * size.x / 2, y * size.y / 2, z * size.z / 2);
      const pointGeometry = new THREE.BufferGeometry();
      pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
      const cornerPoints = new THREE.Points(pointGeometry,
        new THREE.PointsMaterial({ color: 0x8cfcff, size: 7, sizeAttenuation: false, depthTest: false, depthWrite: false }));
      bounds.dispose();
      edges.renderOrder = cornerPoints.renderOrder = 950;
      edges.raycast = cornerPoints.raycast = () => undefined;
      if (kind === 'asset' && this.usesSurfaceAnchor([size.x, size.y, size.z]) && this.selectionAnchor) {
        const marker = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 48),
          new THREE.MeshBasicMaterial({ color: 0x63efff, side: THREE.DoubleSide, transparent: true, opacity: .9, depthTest: false, depthWrite: false }));
        marker.name = 'Large-surface selection outline';
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(object.worldToLocal(this.selectionAnchor.clone())).sub(overlay.position);
        marker.position.y += .02;
        marker.scale.setScalar(.2);
        marker.renderOrder = 951;
        marker.raycast = () => undefined;
        overlay.add(marker);
      }
      overlay.add(edges, cornerPoints);
      object.add(overlay);
      this.highlights.set(object, overlay);
    }
  }
  private displayName(object: THREE.Group): string {
    if (object.userData.levelEditorKind === 'asset') return object.userData.levelEditorLabel as string;
    const match = /^Editor (brick-wall|concrete-wall|floor|stair) ([0-9a-f-]{36})$/i.exec(object.name);
    if (!match) return object.name;
    const label: Record<string, string> = { 'brick-wall': 'Brick wall', 'concrete-wall': 'Concrete wall', floor: 'Floor slab', stair: 'Stairs' };
    return `${label[match[1]]} · ${match[2].slice(0, 4).toUpperCase()}`;
  }
  private refreshList(): void {
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    const search = this.el<HTMLInputElement>('#level-search').value.toLowerCase();
    const filter = this.el<HTMLSelectElement>('#level-filter').value;
    const list = this.el('#level-list');
    list.replaceChildren();
    let shown = 0;
    for (const wall of this.editables()) {
      if (!this.isSelectableVisible(wall)) continue;
      const label = this.displayName(wall);
      if (!label.toLowerCase().includes(search) && !wall.name.toLowerCase().includes(search)) continue;
      if (filter !== 'all' && wall.userData.levelEditorKind !== filter) continue;
      shown += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.classList.toggle('selected', this.selectedObjects.has(wall));
      button.addEventListener('click', event => this.selectWall(wall, event.ctrlKey || event.shiftKey));
      list.append(button);
    }
    this.el('#level-count').textContent = `${shown} elements`;
    this.el<HTMLButtonElement>('#level-create-group').disabled = this.selectedObjects.size < 2;
  }
  private setMultiMode(enabled: boolean): void {
    this.multiMode = enabled;
    const button = this.el<HTMLButtonElement>('#level-multi-toggle');
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? `SELECTING · ${this.selectedObjects.size}` : 'MULTI SELECT';
    if (enabled) this.setTab('select');
    else if (this.selectedObjects.size) this.setTab('transform');
    this.refreshList();
  }
  private membersOf(group: GroupRecord): THREE.Group[] {
    const wing = this.game.room.mansionWing;
    return group.members.map(id => wing?.editableWalls.get(id) ?? wing?.editableSurfaces.get(id) ?? wing?.editableAssets.get(id)).filter((item): item is THREE.Group => item instanceof THREE.Group && this.isSelectableVisible(item));
  }
  private refreshGroupsList(): void {
    const list = this.el('#level-group-list');
    list.replaceChildren();
    for (const group of this.groups.values()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${group.name} · ${group.members.length}`;
      button.classList.toggle('selected', this.activeGroupId === group.id);
      button.addEventListener('click', () => this.setSelection(this.membersOf(group), group.id, false));
      list.append(button);
    }
  }
  private setSelection(objects: Iterable<THREE.Group>, groupId: string | null = null, stayOnSelect = false, hitPoint?: THREE.Vector3): void {
    this.setDetailsOpen(false);
    const valid = new Set(this.editables().filter(object => this.isSelectableVisible(object)));
    this.selectedObjects.clear();
    for (const object of objects) if (valid.has(object)) this.selectedObjects.add(object);
    this.activeGroupId = groupId && this.groups.has(groupId) ? groupId : null;
    this.markerSelection = null;
    this.panel.classList.remove('marker-selected');
    const members = [...this.selectedObjects];
    if (this.gizmo.mode === 'scale' && members.some(object => object.userData.levelEditorScaleLocked)) this.setToolMode('translate');
    this.selected = members.length === 1 ? members[0] : null;
    const size = this.selected?.userData.baseSize as number[] | undefined;
    this.selectionAnchor = this.selected && hitPoint && size && this.usesSurfaceAnchor(size) ? hitPoint.clone() : null;
    this.selectionAnchorLocal = this.selectionAnchor && this.selected ? this.selected.worldToLocal(this.selectionAnchor.clone()) : null;
    this.panel.classList.toggle('multi-selected', members.length > 1);
    const locked = members.some(object => object.userData.levelEditorLocked);
    if (locked) this.gizmo.detach();
    else if (members.length === 1 && !this.selectionAnchor) this.gizmo.attach(members[0]);
    else if (members.length > 1 || this.selectionAnchor) {
      const centre = new THREE.Vector3();
      for (const item of members) centre.add(item.getWorldPosition(new THREE.Vector3()));
      this.selectionPivot.position.copy(this.selectionAnchor ?? centre.divideScalar(members.length));
      this.selectionPivot.rotation.set(0, 0, 0);
      this.selectionPivot.scale.set(1, 1, 1);
      this.selectionPivot.updateMatrixWorld(true);
      this.pivotMatrix.copy(this.selectionPivot.matrixWorld);
      this.gizmo.attach(this.selectionPivot);
    } else this.gizmo.detach();
    this.gizmo.getHelper().visible = this.nativeGizmoVisible();
    this.gizmo.enabled = this.nativeGizmoVisible();
    if (this.selectionAnchor) this.syncHighlights([]);
    this.syncHighlights(members);
    this.setFieldsMode('position');
    this.setSnap();
    this.refreshFields();
    this.refreshList();
    this.refreshGroupsList();
    this.setMultiMode(this.multiMode);
    if (!stayOnSelect && !this.multiMode && members.length) this.setTab('transform');
  }
  private applyPivotDelta(): void {
    if (this.selectedObjects.size < 1) return;
    if ([...this.selectedObjects].some(item => item.userData.levelEditorLocked)) return;
    this.selectionPivot.updateMatrixWorld(true);
    const delta = this.selectionPivot.matrixWorld.clone().multiply(this.pivotMatrix.clone().invert());
    for (const object of this.selectedObjects) {
      object.updateWorldMatrix(true, false);
      const parentInverse = object.parent!.matrixWorld.clone().invert();
      parentInverse.multiply(delta).multiply(object.matrixWorld).decompose(object.position, object.quaternion, object.scale);
    }
    this.pivotMatrix.copy(this.selectionPivot.matrixWorld);
    if (this.selectionAnchor) this.selectionAnchor.copy(this.selectionPivot.position);
  }
  private createGroup(): void {
    if (this.selectedObjects.size < 2) return;
    const members = [...this.selectedObjects].map(item => item.name);
    for (const [id, group] of this.groups) {
      group.members = group.members.filter(member => !members.includes(member));
      if (group.members.length < 2) this.groups.delete(id);
    }
    const group: GroupRecord = { id: crypto.randomUUID(), name: `Group ${this.groups.size + 1}`, members };
    this.groups.set(group.id, group);
    this.multiMode = false;
    this.setSelection(this.membersOf(group), group.id);
    this.status(`${group.name} contains ${group.members.length} elements. Move, rotate or scale them together.`);
    this.recordHistory();
  }
  private renameGroup(): void {
    const group = this.activeGroupId ? this.groups.get(this.activeGroupId) : null;
    if (!group) return;
    const name = this.el<HTMLInputElement>('#level-group-name').value.trim();
    if (!name) return;
    group.name = name;
    this.refreshGroupsList();
    this.refreshFields();
    this.recordHistory();
  }
  private ungroup(): void {
    if (!this.activeGroupId || !this.groups.delete(this.activeGroupId)) return;
    this.activeGroupId = null;
    this.refreshGroupsList();
    this.refreshFields();
    this.recordHistory();
  }
  private focusSelection(): void {
    const object = this.selectedObjects.size > 1 ? this.selectionPivot : this.selected ?? (this.markerSelection === 'player' ? this.playerMarker : this.markerSelection === 'apprentice' ? this.apprenticeMarker : null);
    if (!object) return;
    const target = new THREE.Vector3();
    const members = [...this.selectedObjects];
    if (members.length) {
      for (const member of members) {
        const centre = this.selectionAnchor && members.length === 1 ? this.selectionAnchor.clone() : member.getWorldPosition(new THREE.Vector3());
        const kind = member.userData.levelEditorKind as WallKind | SurfaceKind;
        if (!this.selectionAnchor) centre.y += (kind === 'floor' ? .1 : kind === 'stair' ? .8 : 1.5) * member.scale.y;
        target.add(centre);
      }
      target.divideScalar(members.length);
    } else target.copy(object.getWorldPosition(new THREE.Vector3()));
    if (this.cameraPreset === 'top') {
      const bounds = new THREE.Box3();
      for (const member of members.length ? members : [object]) bounds.expandByObject(member);
      const size = bounds.getSize(new THREE.Vector3());
      const canvas = this.game.renderer.webgl.domElement;
      const aspect = Math.max(.1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
      const distance = THREE.MathUtils.clamp(Math.max(
        size.x / (2 * Math.tan(halfFov) * aspect * .68),
        size.z / (2 * Math.tan(halfFov) * .58),
        6,
      ), 6, 48);
      this.orbit.target.copy(target);
      this.camera.position.set(target.x, target.y + distance, target.z);
      this.orbit.update();
      return;
    }
    const direction = this.camera.position.clone().sub(this.orbit.target).setY(0).normalize();
    if (direction.lengthSq() < .001) direction.set(1, 0, 1).normalize();
    const spread = members.reduce((largest, member) => Math.max(largest, member.getWorldPosition(new THREE.Vector3()).distanceTo(target)), 0);
    const distance = THREE.MathUtils.clamp(14 + spread * 2, 14, 28);
    const selectedNames = new Set(members.map(member => member.name));
    const obstacles = this.game.room.mansionWing?.obstaclesAt(target.y).filter(obstacle => !selectedNames.has(obstacle.id)) ?? [];
    const crosses = (eye: THREE.Vector3, obstacle: typeof obstacles[number]): boolean => {
      let enter = 0, leave = 1;
      for (const [axis, min, max] of [['x', obstacle.minX - .12, obstacle.maxX + .12], ['z', obstacle.minZ - .12, obstacle.maxZ + .12]] as const) {
        const step = eye[axis] - target[axis];
        if (Math.abs(step) < 1e-6) { if (target[axis] < min || target[axis] > max) return false; }
        else {
          const a = (min - target[axis]) / step, b = (max - target[axis]) / step;
          enter = Math.max(enter, Math.min(a, b));
          leave = Math.min(leave, Math.max(a, b));
          if (enter > leave) return false;
        }
      }
      return leave > .06 && enter < .98;
    };
    let best = target.clone().addScaledVector(direction, distance).add(new THREE.Vector3(0, 1.2, 0));
    let bestScore = Infinity;
    for (const angle of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI]) {
      const candidate = target.clone().addScaledVector(direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle), distance).add(new THREE.Vector3(0, 1.2, 0));
      const score = obstacles.reduce((count, obstacle) => count + (crosses(candidate, obstacle) ? 1 : 0), 0) * 100 + Math.abs(angle);
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    this.camera.position.copy(best);
    this.orbit.target.copy(target);
    this.orbit.update();
  }
  private selectWall(wall: THREE.Group, additive = false, hitPoint?: THREE.Vector3): void {
    if (this.multiMode || additive) {
      const next = new Set(this.selectedObjects);
      if (next.has(wall)) next.delete(wall); else next.add(wall);
      this.setSelection(next, null, this.multiMode);
      return;
    }
    const group = [...this.groups.values()].find(entry => entry.members.includes(wall.name));
    this.setSelection(group ? this.membersOf(group) : [wall], group?.id ?? null, false, hitPoint);
  }
  private selectMarker(which: 'player' | 'apprentice'): void {
    this.selected = null;
    this.selectedObjects.clear();
    this.activeGroupId = null;
    this.multiMode = false;
    this.panel.classList.remove('multi-selected');
    this.markerSelection = which;
    this.panel.classList.add('marker-selected');
    this.syncHighlights([]);
    if (which === 'apprentice') {
      this.apprenticeMarker.position.copy(this.apprenticeStarts.get(this.apprenticeIndex)!).add(new THREE.Vector3(0, -.3, 0));
      this.apprenticeMarker.rotation.y = this.apprenticeStartYaws.get(this.apprenticeIndex)!;
    }
    this.gizmo.attach(which === 'player' ? this.playerMarker : this.apprenticeMarker);
    this.gizmo.getHelper().visible = this.nativeGizmoVisible();
    this.gizmo.enabled = this.nativeGizmoVisible();
    this.setToolMode('translate');
    this.setFieldsMode('position');
    this.setSnap();
    this.refreshFields();
    this.refreshList();
    this.refreshGroupsList();
    this.setTab('transform');
  }
  private refreshFields(): void {
    this.syncSelectionAnchorFromObject();
    const object = this.selectedObjects.size > 1 ? this.selectionPivot : this.selected ?? (this.markerSelection === 'player' ? this.playerMarker : this.markerSelection === 'apprentice' ? this.apprenticeMarker : null);
    const locked = [...this.selectedObjects].some(item => item.userData.levelEditorLocked);
    const scaleLocked = [...this.selectedObjects].some(item => item.userData.levelEditorScaleLocked);
    this.panel.querySelectorAll<HTMLInputElement>('[data-axis],[data-size],#level-yaw').forEach(field => {
      field.disabled = locked || !object || scaleLocked && field.hasAttribute('data-size');
      if (!object) field.value = '';
    });
    for (const id of ['#level-translate', '#level-rotate', '#level-scale']) this.el<HTMLButtonElement>(id).disabled = locked || !object;
    this.el<HTMLButtonElement>('#level-scale').disabled ||= scaleLocked;
    const wallSelected = Boolean(this.selected && this.selectedObjects.size === 1 && this.game.room.mansionWing?.editableWalls.has(this.selected.name));
    this.panel.classList.toggle('wall-selected', wallSelected);
    this.el('#level-wall-tools').hidden = !wallSelected;
    if (wallSelected) this.el<HTMLSelectElement>('#level-wall-material').value = this.selected!.userData.levelEditorKind as WallKind;
    else if (this.wallPathActive) this.setWallPathActive(false);
    this.el<HTMLButtonElement>('#level-focus').disabled = !object;
    this.el<HTMLButtonElement>('#level-copy').disabled = ![...this.selectedObjects].some(item =>
      this.game.room.mansionWing?.editableWalls.has(item.name) || this.game.room.mansionWing?.editableSurfaces.has(item.name));
    this.el<HTMLButtonElement>('#level-paste').disabled = this.copiedStructures.length === 0;
    this.el<HTMLButtonElement>('#level-delete').disabled = ![...this.selectedObjects].some(item => this.added.has(item.name));
    this.el<HTMLButtonElement>('[data-fields-tab="size"]').disabled = Boolean(this.markerSelection) || this.selectedObjects.size > 1 || scaleLocked;
    const group = this.activeGroupId ? this.groups.get(this.activeGroupId) : null;
    this.el('#level-group-edit').hidden = !group;
    if (group && document.activeElement !== this.el('#level-group-name')) this.el<HTMLInputElement>('#level-group-name').value = group.name;
    if (!object) { this.el('#level-name').textContent = 'Select an element'; this.el('#level-kind').textContent = 'Tap a structure in the scene or list.'; this.el<HTMLButtonElement>('#level-delete').disabled = true; this.haloElement.hidden = true; return; }
    this.el('#level-name').textContent = group ? group.name : this.selectedObjects.size > 1 ? `${this.selectedObjects.size} elements selected` : this.markerSelection === 'apprentice' ? `Apprentice ${this.apprenticeIndex} start` : this.selected ? this.displayName(this.selected) : object.name;
    this.el('#level-kind').textContent = locked ? 'RUNTIME-LINKED · Selection only until gameplay collision is connected' : scaleLocked ? 'PVC STOCK · move or rotate · physical 3 m pipe length fixed' : this.selectedObjects.size > 1 ? group ? `${this.selectedObjects.size} grouped elements · move, rotate or scale together` : 'Move, rotate or scale together · GROUP ITEMS to save selection' : this.markerSelection ? 'Spawn position · metres' : `${this.selected!.userData.levelEditorKind === 'asset' ? 'SITE ASSET' : this.selected!.userData.levelEditorKind === 'stair' ? 'STAIRS' : this.selected!.userData.levelEditorKind === 'floor' ? 'FLOOR SLAB' : this.selected!.userData.levelEditorKind === 'brick-wall' ? 'BRICK WALL' : 'CONCRETE WALL'} · live geometry`;
    const base = this.baseSize();
    for (const axis of ['x', 'y', 'z'] as const) {
      this.el<HTMLInputElement>(`[data-axis="${axis}"]`).value = object.position[axis].toFixed(2);
      this.el<HTMLInputElement>(`[data-size="${axis}"]`).value = this.selectedObjects.size > 1 ? '' : (Math.abs(object.scale[axis]) * base[['x', 'y', 'z'].indexOf(axis)]).toFixed(2);
    }
    this.el<HTMLInputElement>('#level-yaw').value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(0);
    if (this.markerSelection) {
      if (this.markerSelection === 'player') {
        this.playerStart.copy(object.position).add(new THREE.Vector3(0, .3, 0));
        this.playerStartYaw = object.rotation.y;
        this.game.renderer.camera.position.copy(this.playerStart);
        this.game.player.yaw = this.playerStartYaw;
        this.game.renderer.camera.rotation.y = this.playerStartYaw;
      } else {
        const start = object.position.clone().add(new THREE.Vector3(0, .3, 0));
        this.apprenticeStarts.set(this.apprenticeIndex, start);
        this.apprenticeStartYaws.set(this.apprenticeIndex, object.rotation.y);
        this.game.apprentice.setEditorStart(this.apprenticeIndex, start, object.rotation.y);
        if (this.apprenticeIndex === 1) this.apprenticeStart.copy(start);
      }
    }
  }
  private applyFields(): void {
    if ([...this.selectedObjects].some(item => item.userData.levelEditorLocked)) return;
    const scaleLocked = [...this.selectedObjects].some(item => item.userData.levelEditorScaleLocked);
    const object = this.selectedObjects.size > 1 ? this.selectionPivot : this.selected ?? (this.markerSelection === 'player' ? this.playerMarker : this.markerSelection === 'apprentice' ? this.apprenticeMarker : null);
    if (!object) return;
    const base = this.baseSize();
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = Number(this.el<HTMLInputElement>(`[data-axis="${axis}"]`).value);
      const size = Number(this.el<HTMLInputElement>(`[data-size="${axis}"]`).value);
      if (Number.isFinite(value)) object.position[axis] = value;
      if (this.selected && !scaleLocked && Number.isFinite(size) && size > 0)
        object.scale[axis] = Math.sign(object.scale[axis] || 1) * size / base[['x', 'y', 'z'].indexOf(axis)];
    }
    const yaw = Number(this.el<HTMLInputElement>('#level-yaw').value);
    if (Number.isFinite(yaw)) object.rotation.y = THREE.MathUtils.degToRad(yaw);
    if (object === this.selectionPivot) this.applyPivotDelta();
    this.syncLiveEquipment();
    this.refreshFields();
    this.recordHistory();
  }
  private syncSelectionAnchorFromObject(): void {
    if (!this.selectionAnchorLocal || !this.selected || this.gizmo.object !== this.selectionPivot) return;
    this.selectionPivot.position.copy(this.selected.localToWorld(this.selectionAnchorLocal.clone()));
    this.selectionAnchor?.copy(this.selectionPivot.position);
    this.selectionPivot.updateMatrixWorld(true);
    this.pivotMatrix.copy(this.selectionPivot.matrixWorld);
  }
  private baseSize(): [number, number, number] {
    if (!this.selected) return [1, 1, 1];
    const kind = this.selected.userData.levelEditorKind;
    if (kind === 'asset') return this.selected.userData.baseSize as [number, number, number];
    return [this.selected.userData.length as number, kind === 'floor' ? .18 : kind === 'stair' ? 1.65 : 3,
      kind === 'floor' || kind === 'stair' ? this.selected.userData.depth as number : .24];
  }
  private addWall(kind: WallKind): void {
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    const id = crypto.randomUUID();
    const wall = wing.addEditorWall(id, kind);
    wall.position.set(Math.round(this.orbit.target.x * 4) / 4, this.floorIndex < 0 ? 0 : this.floorElevation(this.floorIndex), Math.round(this.orbit.target.z * 4) / 4);
    this.added.add(wall.name);
    this.multiMode = false;
    this.selectWall(wall);
    this.status('Wall added. Position, dimensions and collision update live; SAVE to keep it.');
    this.recordHistory();
  }
  private addSurface(kind: SurfaceKind): void {
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    const id = crypto.randomUUID();
    const surface = wing.addEditorSurface(id, kind);
    surface.position.set(Math.round(this.orbit.target.x * 4) / 4, this.floorIndex < 0 ? 0 : this.floorElevation(this.floorIndex), Math.round(this.orbit.target.z * 4) / 4);
    this.added.add(surface.name);
    this.multiMode = false;
    this.selectWall(surface);
    this.status(`${kind === 'floor' ? 'Floor slab' : 'Stairs'} added. Traverse height updates live; SAVE to keep it.`);
    this.recordHistory();
  }
  private copySelected(): void {
    const snapshot = this.document();
    const selected = new Set([...this.selectedObjects].map(item => item.name));
    this.copiedStructures = [...snapshot.walls, ...snapshot.surfaces]
      .filter(item => selected.has(item.id)).map(item => structuredClone(item));
    this.pasteCount = 0;
    this.el<HTMLButtonElement>('#level-paste').disabled = this.copiedStructures.length === 0;
    this.status(this.copiedStructures.length
      ? `${this.copiedStructures.length} structure${this.copiedStructures.length === 1 ? '' : 's'} copied. Ctrl+V places a new editable copy.`
      : 'Select a wall, floor or stair to copy.');
  }
  private pasteCopied(): void {
    const wing = this.game.room.mansionWing;
    if (!wing || !this.copiedStructures.length) return;
    const offset = ++this.pasteCount * .5;
    const copies: THREE.Group[] = [];
    for (const record of this.copiedStructures) {
      const id = crypto.randomUUID();
      let copy: THREE.Group;
      if (record.kind === 'brick-wall' || record.kind === 'concrete-wall')
        copy = wing.addEditorWall(id, record.kind, record.length);
      else {
        const surface = record as SurfaceRecord;
        copy = wing.addEditorSurface(id, surface.kind, surface.width, surface.depth);
      }
      copy.position.fromArray(record.position).add(new THREE.Vector3(offset, 0, offset));
      copy.rotation.y = record.rotationY;
      copy.scale.fromArray(record.scale);
      if ('curveShape' in record && validCurvedShape(record.curveShape)) {
        const shape = structuredClone(record.curveShape);
        copy.userData.curveShape = shape;
        if (record.kind === 'concrete-wall') wing.applyEditorConcreteCurve(copy, shape);
      }
      this.added.add(copy.name);
      copies.push(copy);
    }
    this.setSelection(copies);
    this.recordHistory(`Duplicate ${copies.length} structure${copies.length === 1 ? '' : 's'}`);
    this.status(`${copies.length} editable cop${copies.length === 1 ? 'y' : 'ies'} placed. SAVE to keep them.`);
  }
  private deleteSelected(): void {
    const wing = this.game.room.mansionWing;
    if (!wing) return;
    const removable = [...this.selectedObjects].filter(item => this.added.has(item.name));
    if (!removable.length) return;
    const names = new Set(removable.map(item => item.name));
    for (const item of removable) {
      if (wing.editableWalls.has(item.name)) wing.removeEditorWall(item);
      else if (wing.editableSurfaces.has(item.name)) wing.removeEditorSurface(item);
      this.added.delete(item.name);
    }
    for (const [id, group] of this.groups) { group.members = group.members.filter(name => !names.has(name)); if (group.members.length < 2) this.groups.delete(id); }
    this.setSelection([]);
    this.recordHistory(`Delete ${removable.length} structure${removable.length === 1 ? '' : 's'}`);
  }
  private updateStarts(): void {
    this.playerMarker.position.copy(this.playerStart).add(new THREE.Vector3(0, -.3, 0));
    this.playerMarker.rotation.y = this.playerStartYaw;
    this.apprenticeMarker.position.copy(this.apprenticeStarts.get(this.apprenticeIndex)!).add(new THREE.Vector3(0, -.3, 0));
    this.apprenticeMarker.rotation.y = this.apprenticeStartYaws.get(this.apprenticeIndex)!;
    this.updateStartMarkerVisibility();
  }
  private updateStartMarkerVisibility(): void {
    const visibleOnFloor = (marker: THREE.Object3D): boolean => this.active &&
      (this.floorIndex < 0 || Math.abs(marker.position.y - this.floorElevation(this.floorIndex) - this.game.player.eyeHeight + .3) < .7);
    this.playerMarker.visible = visibleOnFloor(this.playerMarker);
    this.apprenticeMarker.visible = visibleOnFloor(this.apprenticeMarker);
  }
  private document(): LevelDocument {
    const walls: WallRecord[] = [];
    for (const wall of this.game.room.mansionWing?.editableWalls.values() ?? []) walls.push({
      id: wall.name, kind: wall.userData.levelEditorKind as WallKind,
      length: wall.userData.length as number,
      position: wall.position.toArray() as [number, number, number],
      rotationY: wall.rotation.y,
      scale: wall.scale.toArray() as [number, number, number],
      chainId: typeof wall.userData.wallChainId === 'string' ? wall.userData.wallChainId : undefined,
      sectionIndex: Number.isFinite(wall.userData.wallSectionIndex) ? Number(wall.userData.wallSectionIndex) : undefined,
      curveRadius: Number.isFinite(wall.userData.curveRadius) ? Number(wall.userData.curveRadius) : undefined,
      curveShape: validCurvedShape(wall.userData.curveShape) ? wall.userData.curveShape : undefined,
    });
    const surfaces: SurfaceRecord[] = [];
    for (const surface of this.game.room.mansionWing?.editableSurfaces.values() ?? []) surfaces.push({
      id: surface.name, kind: surface.userData.levelEditorKind as SurfaceKind,
      width: surface.userData.length as number, depth: surface.userData.depth as number,
      position: surface.position.toArray() as [number, number, number],
      rotationY: surface.rotation.y,
      scale: surface.scale.toArray() as [number, number, number],
    });
    const assets: AssetRecord[] = [];
    for (const asset of this.game.room.mansionWing?.editableAssets.values() ?? []) {
      if (asset.userData.levelEditorMissionPoint) continue;
      assets.push({ id: asset.name, position: asset.position.toArray() as [number, number, number],
        rotationY: asset.rotation.y, scale: asset.scale.toArray() as [number, number, number] });
    }
    return { version: 1, template: this.template, walls, surfaces, assets, groups: [...this.groups.values()].map(group => ({ ...group, members: [...group.members] })), playerStart: this.playerStart.toArray() as [number, number, number], playerStartYaw: this.playerStartYaw, apprenticeStart: this.apprenticeStart.toArray() as [number, number, number],
      apprenticeStarts: Array.from({ length: 5 }, (_, offset) => this.apprenticeStarts.get(offset + 1)!.toArray() as [number, number, number]),
      apprenticeStartYaws: Array.from({ length: 5 }, (_, offset) => this.apprenticeStartYaws.get(offset + 1)!) };
  }
  private async save(asCopy = false): Promise<void> {
    const document: LevelDocument = { ...this.document(), name: this.el<HTMLInputElement>('#level-slot-name').value.trim().slice(0, 48) || 'My Level' };
    const name = document.name!;
    const id = asCopy || !this.currentSlotId ? crypto.randomUUID() : this.currentSlotId;
    const slot: LevelSlot = { id, name, updatedAt: new Date().toISOString(), template: this.template };
    try {
      const slots = listLevelSlots().filter(item => item.id !== id);
      localStorage.setItem(slotKey(id), JSON.stringify(document));
      localStorage.setItem(SLOTS_KEY, JSON.stringify([slot, ...slots]));
      this.currentSlotId = id;
      const url = new URL(location.href);
      url.searchParams.set('level', id);
      url.searchParams.delete('template');
      history.replaceState(null, '', url);
      const current = globalThis.document.querySelector('#start-level-current');
      if (current) current.textContent = `SAVED · ${name}`;
      window.dispatchEvent(new Event('wirehouse:level-saved'));
    } catch (error) { this.status(`Save failed: ${String(error)}`); return; }
    try {
      const response = await fetch(`/__wire-house-mansion-level?slot=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.status(`${name} saved separately. Basic stays unchanged.`);
    } catch {
      this.status(`${name} saved in this browser. EXPORT downloads portable JSON; project-file save requires the local preview.`);
    }
  }
  private export(): void {
    const file = new Blob([`${JSON.stringify(this.document(), null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wire-the-house-mansion-level.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status('Level JSON exported.');
  }
  async restoreSelected(): Promise<boolean> {
    const id = new URLSearchParams(location.search).get('level');
    if (!id || (id !== 'legacy' && !validSlotId(id))) return false;
    try {
      let raw = id === 'legacy' ? null : localStorage.getItem(slotKey(id));
      if (!raw) {
        const response = await fetch(id === 'legacy' ? '/__wire-house-mansion-level' : `/__wire-house-mansion-level?slot=${id}`, { cache: 'no-store' });
        if (!response.ok || response.status === 204) return false;
        raw = await response.text();
      }
      const saved = JSON.parse(raw) as LevelDocument;
      this.applyDocument(saved);
      this.currentSlotId = id === 'legacy' ? null : id;
      const slot = listLevelSlots().find(item => item.id === id);
      this.el<HTMLInputElement>('#level-slot-name').value = slot?.name ?? saved.name ?? (id === 'legacy' ? 'Previous project save' : 'Saved Level');
      this.updateStarts();
      this.history = [this.document()];
      this.historyLabels = ['Loaded level'];
      this.historySelections = [[]];
      this.historyIndex = 0;
      this.updateHistoryButtons();
      return true;
    } catch (error) { console.warn('Saved level could not be restored', error); return false; }
  }
  private applyDocument(parsed: unknown): void {
      if (!parsed || typeof parsed !== 'object') return;
      const data = parsed as Partial<LevelDocument>;
      if (data.version !== 1 || !Array.isArray(data.walls)) return;
      this.setTemplateMode(data.template === 'blank' ? 'blank' : 'mansion');
      const wing = this.game.room.mansionWing;
      if (!wing) return;
      const names = new Set([...data.walls.map(wall => wall?.id), ...(data.surfaces ?? []).map(surface => surface?.id)]);
      for (const name of this.added) if (!names.has(name)) {
        const wall = wing.editableWalls.get(name);
        const surface = wing.editableSurfaces.get(name);
        if (wall) wing.removeEditorWall(wall);
        if (surface) wing.removeEditorSurface(surface);
        this.added.delete(name);
      }
      for (const record of data.surfaces ?? []) {
        if (typeof record?.id !== 'string' || !finiteTriplet(record.position) || !finiteTriplet(record.scale) ||
          !Number.isFinite(record.rotationY) || !Number.isFinite(record.width) || !Number.isFinite(record.depth) ||
          record.width < .2 || record.depth < .2 || !['floor', 'stair'].includes(record.kind)) continue;
        let surface = wing.editableSurfaces.get(record.id);
        if (!surface && record.id.startsWith(`Editor ${record.kind} `)) {
          const id = record.id.slice(`Editor ${record.kind} `.length);
          if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
          surface = wing.addEditorSurface(id, record.kind, record.width, record.depth);
          this.added.add(surface.name);
        }
        if (!surface) continue;
        surface.position.fromArray(record.position);
        surface.rotation.y = record.rotationY;
        surface.scale.fromArray(record.scale);
      }
      for (const record of data.assets ?? []) {
        if (typeof record?.id !== 'string' || !finiteTriplet(record.position) || !finiteTriplet(record.scale) ||
          !Number.isFinite(record.rotationY) || record.scale.some(value => Math.abs(value) < .001)) continue;
        const asset = wing.editableAssets.get(record.id);
        if (!asset || asset.userData.levelEditorMissionPoint) continue;
        asset.position.fromArray(record.position);
        asset.rotation.y = record.rotationY;
        if (!asset.userData.levelEditorScaleLocked) asset.scale.fromArray(record.scale);
      }
      this.game.mixing.wheelbarrow.syncEditorPlacement();
      this.game.mixing.syncEditorRestPositions();
      for (const record of data.walls) {
        if (typeof record?.id !== 'string' || !finiteTriplet(record.position) || !finiteTriplet(record.scale) ||
          !Number.isFinite(record.rotationY) || !Number.isFinite(record.length) || record.length < .2 ||
          !['brick-wall', 'concrete-wall'].includes(record.kind)) continue;
        let wall = wing.editableWalls.get(record.id);
        if (!wall && record.id.startsWith('Editor ')) {
          const id = record.id.slice(`Editor ${record.kind} `.length);
          if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
          wall = wing.addEditorWall(id, record.kind, record.length);
          this.added.add(wall.name);
        }
        if (!wall) continue;
        wall.position.fromArray(record.position);
        wall.rotation.y = record.rotationY;
        wall.scale.fromArray(record.scale);
        wall.userData.wallChainId = typeof record.chainId === 'string' ? record.chainId : undefined;
        wall.userData.wallSectionIndex = Number.isFinite(record.sectionIndex) ? record.sectionIndex : undefined;
        wall.userData.curveRadius = Number.isFinite(record.curveRadius) ? record.curveRadius : undefined;
        if (validCurvedShape(record.curveShape)) {
          wall.userData.curveShape = record.curveShape;
          if (record.kind === 'concrete-wall') wing.applyEditorConcreteCurve(wall, record.curveShape);
        }
      }
      this.groups.clear();
      if (Array.isArray(data.groups)) for (const group of data.groups) {
        if (typeof group?.id !== 'string' || typeof group.name !== 'string' || !Array.isArray(group.members)) continue;
        const members = [...new Set(group.members.filter(id => typeof id === 'string' && (wing.editableWalls.has(id) || wing.editableSurfaces.has(id) || wing.editableAssets.has(id))))];
        if (members.length >= 2) this.groups.set(group.id, { id: group.id, name: group.name.slice(0, 48), members });
      }
      if (this.activeGroupId && !this.groups.has(this.activeGroupId)) this.activeGroupId = null;
      if (this.active) this.setSelection([...this.selectedObjects].filter(item => this.editables().includes(item)), this.activeGroupId, this.multiMode);
      else { this.refreshList(); this.refreshGroupsList(); }
      if (finiteTriplet(data.playerStart)) { this.playerStart.fromArray(data.playerStart); this.game.renderer.camera.position.copy(this.playerStart); }
      if (typeof data.playerStartYaw === 'number' && Number.isFinite(data.playerStartYaw)) {
        this.playerStartYaw = data.playerStartYaw;
        this.game.player.yaw = data.playerStartYaw;
        this.game.renderer.camera.rotation.y = data.playerStartYaw;
      }
      if (Array.isArray(data.apprenticeStarts)) {
        for (let offset = 0; offset < Math.min(5, data.apprenticeStarts.length); offset++) {
          const value = data.apprenticeStarts[offset];
          if (!finiteTriplet(value)) continue;
          const start = new THREE.Vector3().fromArray(value);
          this.apprenticeStarts.set(offset + 1, start);
          const yaw = typeof data.apprenticeStartYaws?.[offset] === 'number' && Number.isFinite(data.apprenticeStartYaws[offset]) ? data.apprenticeStartYaws[offset] : 0;
          this.apprenticeStartYaws.set(offset + 1, yaw);
          this.game.apprentice.setEditorStart(offset + 1, start, yaw);
        }
        this.apprenticeStart.copy(this.apprenticeStarts.get(1)!);
      } else if (finiteTriplet(data.apprenticeStart)) {
        this.apprenticeStart.fromArray(data.apprenticeStart);
        this.apprenticeStarts.set(1, this.apprenticeStart.clone());
        this.game.apprentice.setEditorStart(1, this.apprenticeStart);
      }
      this.updateStarts();
      this.applyFloorVisibility();
  }
}
