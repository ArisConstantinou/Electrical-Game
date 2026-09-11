import * as THREE from 'three';
import type { Game } from '../core/Game';

const FORMAT = 'web-game-studio-runtime-message' as const;
const PROTOCOL = 'web-game-studio-adapter' as const;
const VERSION = 1 as const;
const GAME_ID = 'wire-the-house-electrical-game';
const ENTRYPOINT_ID = 'living-room-first-fix';
const CAPABILITIES = ['scene-hierarchy', 'object-transforms', 'materials', 'cameras-lights', 'animations', 'physics-bodies', 'physics-colliders', 'physics-joints', 'gameplay-state', 'save-overrides'] as const;
const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5347', 'http://localhost:5347']);
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/%\[\]-]{0,199}$/;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = Record<string, unknown>;
type StudioWindow = Window & { __wireTheHouse?: Game };
type Session = { id: string; token: string; origin: string; source: Window; revision: number };
type PatchOperation = { op: 'replace'; target: { kind: string; id?: string }; path: string; value: Json };
type Context = { objects: THREE.Object3D[]; nodes: Map<string, THREE.Object3D>; materials: Map<string, THREE.Material>; cameras: Map<string, THREE.Camera>; lights: Map<string, THREE.Light> };
let activeSession: Session | null = null;
let outgoing = 0;
let restored = false;
let persistedOperations: PatchOperation[] = [];

const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? value as RecordValue : null;
const hash = (value: string): string => { let output = 2166136261; for (let index = 0; index < value.length; index += 1) output = Math.imul(output ^ value.charCodeAt(index), 16777619); return (output >>> 0).toString(36); };
const hierarchyPath = (object: THREE.Object3D): string => {
  const segments: string[] = [];
  let cursor: THREE.Object3D | null = object;
  while (cursor?.parent) {
    const label = cursor.name.trim() || cursor.type;
    let occurrence = 0;
    for (const sibling of cursor.parent.children) { if (sibling === cursor) break; if ((sibling.name.trim() || sibling.type) === label) occurrence += 1; }
    segments.unshift(`${label}:${occurrence}`);
    cursor = cursor.parent;
  }
  return `/scene/${segments.join('/')}`;
};
const nodeId = (object: THREE.Object3D): string => {
  if ((object as THREE.Scene).isScene) return 'node:scene';
  const authored = object.userData.studioEntityId;
  return `node:${hash(typeof authored === 'string' && authored.trim() ? `authored:${authored.trim()}` : hierarchyPath(object))}`;
};
const property = (path: string, el: string, en: string, kind: string, value: Json, editable = true, group = 'object', extra: RecordValue = {}): RecordValue => ({ path, label: { el, en }, kind, value, editable, group, ...extra });
const buildContext = (game: Game): Context => {
  const objects: THREE.Object3D[] = [];
  game.renderer.scene.traverse(object => objects.push(object));
  const nodes = new Map<string, THREE.Object3D>(), materials = new Map<string, THREE.Material>(), cameras = new Map<string, THREE.Camera>(), lights = new Map<string, THREE.Light>();
  for (const object of objects) {
    const id = nodeId(object);
    if (nodes.has(id)) throw new Error(`Stable node ID collision: ${id}`);
    nodes.set(id, object);
    const raw = (object as THREE.Mesh).material;
    for (const [slot, material] of (raw ? (Array.isArray(raw) ? raw : [raw]) : []).entries()) if (![...materials.values()].includes(material)) materials.set(`material:${hash(`${id}:${slot}:${material.type}:${material.name}`)}`, material);
    if ((object as THREE.Camera).isCamera) cameras.set(`camera:${hash(id)}`, object as THREE.Camera);
    if ((object as THREE.Light).isLight) lights.set(`light:${hash(id)}`, object as THREE.Light);
  }
  return { objects, nodes, materials, cameras, lights };
};
const idFor = <T>(map: Map<string, T>, value: T): string | null => [...map].find(([, item]) => item === value)?.[0] ?? null;
const send = (session: Session, payload: RecordValue): void => session.source.postMessage({ format: FORMAT, protocol: PROTOCOL, version: VERSION, sessionId: session.id, sessionToken: session.token, messageId: `wire-house-${++outgoing}`, ...payload }, session.origin);
const awaitGame = async (): Promise<Game> => { const started = performance.now(); while (!(window as StudioWindow).__wireTheHouse) { if (performance.now() - started > 20_000) throw new Error('WIRE THE HOUSE runtime did not become ready'); await new Promise(resolve => setTimeout(resolve, 50)); } return (window as StudioWindow).__wireTheHouse!; };

const materialProperties = (material: THREE.Material): RecordValue[] => {
  const standard = material as THREE.MeshStandardMaterial;
  return [...(standard.color ? [property('/color', 'Χρώμα', 'Color', 'color', `#${standard.color.getHexString()}`, true, 'material')] : []), property('/opacity', 'Αδιαφάνεια', 'Opacity', 'number', material.opacity, true, 'material', { min: 0, max: 1, step: 0.01 }), property('/visible', 'Ορατό', 'Visible', 'boolean', material.visible, true, 'material'), ...('roughness' in standard ? [property('/roughness', 'Τραχύτητα', 'Roughness', 'number', standard.roughness, true, 'material', { min: 0, max: 1, step: 0.01 })] : []), ...('metalness' in standard ? [property('/metalness', 'Μεταλλικότητα', 'Metalness', 'number', standard.metalness, true, 'material', { min: 0, max: 1, step: 0.01 })] : [])];
};

const snapshot = (game: Game, revision: number): RecordValue => {
  const context = buildContext(game);
  const animations: RecordValue[] = [{ id: 'animation:fps-rig-procedural', name: 'FPS hand and tool procedural motion', nodeId: nodeId(game.fpsRig), durationSeconds: 0, playing: game.started, timeSeconds: 0, properties: [property('/mapping', 'Αντιστοίχιση', 'Mapping', 'string', 'Runtime-driven camera bob and tool strike', false, 'animation')] }];
  const nodes = context.objects.map(object => {
    const raw = (object as THREE.Mesh).material;
    const materialIds = raw ? (Array.isArray(raw) ? raw : [raw]).map(item => idFor(context.materials, item)).filter((item): item is string => Boolean(item)) : [];
    return { id: nodeId(object), parentId: object.parent ? nodeId(object.parent) : null, name: object.name.trim() || object.type, kind: object.type, visible: object.visible, transform: { position: object.position.toArray(), rotation: object.quaternion.toArray(), scale: object.scale.toArray() }, materialIds, cameraId: (object as THREE.Camera).isCamera ? idFor(context.cameras, object as THREE.Camera) : null, lightId: (object as THREE.Light).isLight ? idFor(context.lights, object as THREE.Light) : null, animationIds: object === game.fpsRig ? ['animation:fps-rig-procedural'] : [], properties: [property('/visible', 'Ορατό', 'Visible', 'boolean', object.visible), property('/transform/position', 'Θέση', 'Position', 'vec3', object.position.toArray() as [number, number, number], true, 'transform'), property('/transform/rotation', 'Περιστροφή', 'Rotation', 'quaternion', object.quaternion.toArray() as [number, number, number, number], true, 'transform'), property('/transform/scale', 'Κλίμακα', 'Scale', 'vec3', object.scale.toArray() as [number, number, number], true, 'transform')] };
  });
  const materials = [...context.materials].map(([id, material]) => ({ id, name: material.name.trim() || material.type, properties: materialProperties(material) }));
  const cameras = [...context.cameras].map(([id, camera]) => { const perspective = camera as THREE.PerspectiveCamera; return { id, name: camera.name.trim() || camera.type, properties: [property('/near', 'Κοντινό επίπεδο', 'Near', 'number', perspective.near, true, 'camera', { min: 0.001, step: 0.001 }), property('/far', 'Μακρινό επίπεδο', 'Far', 'number', perspective.far, true, 'camera', { min: 1, step: 1 }), ...(perspective.isPerspectiveCamera ? [property('/fov', 'Οπτικό πεδίο', 'Field of view', 'number', perspective.fov, true, 'camera', { min: 25, max: 120, step: 1 })] : [])] }; });
  const lights = [...context.lights].map(([id, light]) => ({ id, name: light.name.trim() || light.type, properties: [property('/color', 'Χρώμα', 'Color', 'color', `#${light.color.getHexString()}`, true, 'light'), property('/intensity', 'Ένταση', 'Intensity', 'number', light.intensity, true, 'light', { min: 0, step: 0.05 })] }));
  return { schemaVersion: 1, gameId: GAME_ID, entrypointId: ENTRYPOINT_ID, revision, capturedAt: new Date().toISOString(), coverage: { sceneHierarchy: 'complete', objectProperties: { transforms: 'complete', materials: 'partial', cameras: 'partial', lights: 'partial', animations: 'partial' }, physics: { bodies: 'complete', colliders: 'complete', joints: 'complete' }, gameplay: 'complete', persistence: 'complete' }, scene: { rootIds: nodes.filter(node => node.parentId === null).map(node => node.id), nodes, materials, cameras, lights, animations }, physics: { backend: 'wire-house-kinematic', world: [property('/gravity', 'Βαρύτητα', 'Gravity', 'vec3', [0, 0, 0], false, 'physics')], bodies: [{ id: 'physics-body:player', name: 'Kinematic first-person player', nodeId: nodeId(game.renderer.camera), bodyType: 'kinematic-position', properties: [property('/translation', 'Θέση', 'Translation', 'vec3', game.renderer.camera.position.toArray() as [number, number, number], false, 'state'), property('/speed', 'Ταχύτητα', 'Speed', 'number', 2.2, false, 'physics', { unit: 'm/s' })] }, { id: 'physics-body:room', name: 'Fixed living-room boundary', nodeId: nodeId(game.room), bodyType: 'fixed', properties: [property('/width', 'Πλάτος', 'Width', 'number', 6, false, 'physics', { unit: 'm' }), property('/depth', 'Βάθος', 'Depth', 'number', 5, false, 'physics', { unit: 'm' })] }], colliders: [{ id: 'physics-collider:player', name: 'Player capsule boundary', bodyId: 'physics-body:player', shape: 'capsule', sensor: false, properties: [property('/radius', 'Ακτίνα', 'Radius', 'number', 0.28, false, 'physics', { unit: 'm' })] }, { id: 'physics-collider:room', name: 'Room wall and floor bounds', bodyId: 'physics-body:room', shape: 'custom-room-bounds', sensor: false, properties: [property('/wallCollision', 'Σύγκρουση τοίχων', 'Wall collision', 'boolean', true, false, 'physics')] }], joints: [] }, gameplay: [property('/mission/progress', 'Πρόοδος αποστολής', 'Mission progress', 'number', game.mission.progress, false, 'mission', { min: 0, max: 100, unit: '%' }), property('/mission/activePoint', 'Ενεργό σημείο', 'Active point', 'string', game.mission.activePoint?.definition.id ?? 'complete', false, 'mission'), property('/mission/stage', 'Στάδιο', 'Stage', 'string', game.mission.activePoint?.stage ?? 'complete', false, 'mission')] };
};

const values = (value: Json, length: 3 | 4): number[] => { if (!Array.isArray(value) || value.length !== length || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`Expected ${length} finite numbers`); return value as number[]; };
const applyOperation = (game: Game, operation: PatchOperation): (() => void) => {
  if (operation.op !== 'replace') throw new Error('Only replace operations are supported');
  const context = buildContext(game), id = operation.target.id;
  if (operation.target.kind === 'node' && id) {
    const object = context.nodes.get(id); if (!object) throw new Error('Unknown scene node');
    if (operation.path === '/visible' && typeof operation.value === 'boolean') { const previous = object.visible; object.visible = operation.value; return () => { object.visible = previous; }; }
    if (operation.path === '/transform/position') { const previous = object.position.clone(); object.position.fromArray(values(operation.value, 3)); return () => { object.position.copy(previous); }; }
    if (operation.path === '/transform/rotation') { const previous = object.quaternion.clone(); object.quaternion.fromArray(values(operation.value, 4) as [number, number, number, number]).normalize(); return () => { object.quaternion.copy(previous); }; }
    if (operation.path === '/transform/scale') { const next = values(operation.value, 3); if (next.some(value => value === 0)) throw new Error('Scale cannot contain zero'); const previous = object.scale.clone(); object.scale.fromArray(next); return () => { object.scale.copy(previous); }; }
  }
  if (operation.target.kind === 'material' && id) {
    const material = context.materials.get(id) as THREE.MeshStandardMaterial | undefined; if (!material) throw new Error('Unknown material');
    if (operation.path === '/color' && material.color && typeof operation.value === 'string') { const previous = material.color.clone(); material.color.set(operation.value); return () => { material.color.copy(previous); }; }
    if (operation.path === '/visible' && typeof operation.value === 'boolean') { const previous = material.visible; material.visible = operation.value; return () => { material.visible = previous; }; }
    const key = operation.path.slice(1) as 'opacity' | 'roughness' | 'metalness';
    if (['opacity', 'roughness', 'metalness'].includes(key) && typeof operation.value === 'number' && Number.isFinite(operation.value) && key in material) { const previous = material[key]; material[key] = operation.value; material.needsUpdate = true; return () => { material[key] = previous; material.needsUpdate = true; }; }
  }
  if (operation.target.kind === 'camera' && id) {
    const camera = context.cameras.get(id) as THREE.PerspectiveCamera | undefined; if (!camera) throw new Error('Unknown camera'); const key = operation.path.slice(1) as 'near' | 'far' | 'fov';
    if (['near', 'far', 'fov'].includes(key) && typeof operation.value === 'number' && Number.isFinite(operation.value) && key in camera) { const previous = camera[key]; camera[key] = operation.value; camera.updateProjectionMatrix(); return () => { camera[key] = previous; camera.updateProjectionMatrix(); }; }
  }
  if (operation.target.kind === 'light' && id) {
    const light = context.lights.get(id); if (!light) throw new Error('Unknown light');
    if (operation.path === '/color' && typeof operation.value === 'string') { const previous = light.color.clone(); light.color.set(operation.value); return () => { light.color.copy(previous); }; }
    if (operation.path === '/intensity' && typeof operation.value === 'number' && Number.isFinite(operation.value)) { const previous = light.intensity; light.intensity = operation.value; return () => { light.intensity = previous; }; }
  }
  throw new Error(`Unsupported patch: ${operation.target.kind} ${operation.path}`);
};

const restoreOverrides = async (game: Game): Promise<void> => {
  if (restored) return; restored = true;
  try { const response = await fetch('/__wire-house-studio-overrides', { cache: 'no-store' }); if (!response.ok) return; const payload = record(await response.json()); if (!payload || payload.version !== 1 || !Array.isArray(payload.operations)) return; for (const raw of payload.operations) { const item = record(raw); if (item) applyOperation(game, item as unknown as PatchOperation); } persistedOperations = payload.operations.filter(item => record(item)) as PatchOperation[]; } catch { /* A missing sidecar is the clean initial state. */ }
};

const handleMessage = async (event: MessageEvent<unknown>): Promise<void> => {
  if (event.source !== window.parent || !ALLOWED_ORIGINS.has(event.origin)) return;
  const message = record(event.data);
  if (!message || message.format !== FORMAT || message.protocol !== PROTOCOL || message.version !== VERSION || typeof message.sessionId !== 'string' || !ID.test(message.sessionId) || typeof message.sessionToken !== 'string' || !TOKEN.test(message.sessionToken) || typeof message.messageId !== 'string' || !ID.test(message.messageId)) return;
  if (message.type === 'studio/hello') { if (message.gameId !== GAME_ID || message.entrypointId !== ENTRYPOINT_ID) return; activeSession = { id: message.sessionId, token: message.sessionToken, origin: event.origin, source: event.source as Window, revision: 0 }; send(activeSession, { type: 'adapter/hello', replyTo: message.messageId, gameId: GAME_ID, entrypointId: ENTRYPOINT_ID, capabilities: [...CAPABILITIES] }); return; }
  const session = activeSession;
  if (!session || session.id !== message.sessionId || session.token !== message.sessionToken || session.origin !== event.origin || session.source !== event.source) return;
  if (message.type === 'studio/dispose') { activeSession = null; return; }
  const game = await awaitGame(); await restoreOverrides(game);
  if (message.type === 'studio/snapshot-request') { send(session, { type: 'adapter/snapshot', replyTo: message.messageId, snapshot: snapshot(game, session.revision) }); return; }
  if (message.type === 'studio/patch') {
    const baseRevision = typeof message.baseRevision === 'number' ? message.baseRevision : -1, rawOperations = Array.isArray(message.operations) ? message.operations : [];
    if (baseRevision !== session.revision || rawOperations.length < 1 || rawOperations.length > 256) { send(session, { type: 'adapter/patch-reject', replyTo: message.messageId, baseRevision: Math.max(0, baseRevision), currentRevision: session.revision, code: 'REVISION_CONFLICT', message: { el: 'Η έκδοση του snapshot είναι παλιά.', en: 'The snapshot revision is stale.' } }); return; }
    const undo: (() => void)[] = [];
    try { const operations = rawOperations.map(raw => { const item = record(raw); if (!item) throw new Error('Invalid operation'); return item as unknown as PatchOperation; }); for (const operation of operations) undo.push(applyOperation(game, operation)); persistedOperations.push(...operations); session.revision += 1; send(session, { type: 'adapter/patch-ack', replyTo: message.messageId, baseRevision, revision: session.revision, applied: operations.map(operation => ({ target: operation.target, path: operation.path })) }); }
    catch (error) { for (const restore of undo.reverse()) restore(); send(session, { type: 'adapter/patch-reject', replyTo: message.messageId, baseRevision, currentRevision: session.revision, code: 'INVALID_PATCH', message: { el: `Η αλλαγή απορρίφθηκε: ${error instanceof Error ? error.message : String(error)}`, en: `Patch rejected: ${error instanceof Error ? error.message : String(error)}` } }); }
    return;
  }
  if (message.type === 'studio/save') {
    const baseRevision = typeof message.baseRevision === 'number' ? message.baseRevision : -1;
    if (baseRevision !== session.revision) { send(session, { type: 'adapter/save-reject', replyTo: message.messageId, baseRevision: Math.max(0, baseRevision), currentRevision: session.revision, code: 'REVISION_CONFLICT', message: { el: 'Η έκδοση άλλαξε πριν την αποθήκευση.', en: 'The revision changed before save.' } }); return; }
    try { const response = await fetch('/__wire-house-studio-overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, revision: session.revision, operations: persistedOperations }) }); const result = record(await response.json()); if (!response.ok || !result || typeof result.savedAt !== 'string' || typeof result.contentHash !== 'string') throw new Error('Sidecar endpoint rejected the save'); send(session, { type: 'adapter/save-ack', replyTo: message.messageId, revision: session.revision, savedAt: result.savedAt, contentHash: result.contentHash }); }
    catch (error) { send(session, { type: 'adapter/save-reject', replyTo: message.messageId, baseRevision, currentRevision: session.revision, code: 'PERSISTENCE_FAILED', message: { el: `Η αποθήκευση απέτυχε: ${error instanceof Error ? error.message : String(error)}`, en: `Save failed: ${error instanceof Error ? error.message : String(error)}` } }); }
  }
};

if (new URLSearchParams(location.search).get('studio') === '1' && window.parent !== window) window.addEventListener('message', event => { void handleMessage(event); });
