import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Quaternion,Vector3} from 'three';
import assert from 'node:assert/strict';
const path='output/ceiling-grips/capture-report.json',report=JSON.parse(await readFile(path,'utf8'));
assert.deepEqual(report.errors,[]);assert.equal(report.poses.length,19);
for(const [file,hash] of Object.entries(report.sourceHashes))assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash);
for(const p of report.poses)for(const a of p.arms)for(const j of a.joints){
 const q=new Quaternion().fromArray(a.grip.quaternion),restored=new Quaternion().copy(q).multiply(new Quaternion().fromArray(j.quaternionInGrip));
 // angleTo requires unit quaternions. Preserve raw captured values; normalize
 // only the comparison operands to avoid interpreting scale roundoff as rotation.
 j.reconstructionAngleErrorRadians=restored.normalize().angleTo(new Quaternion().fromArray(j.worldQuaternion).normalize());
 j.reconstructionPositionErrorM=new Vector3().fromArray(j.positionInGrip).applyQuaternion(q).add(new Vector3().fromArray(a.grip.center)).distanceTo(new Vector3().fromArray(j.worldPosition));
 assert(j.reconstructionAngleErrorRadians<1e-5);assert(j.reconstructionPositionErrorM<1e-8);assert(j.localQuaternion.every(Number.isFinite));
}
report.captureVerified=true;
await writeFile(path,JSON.stringify(report,null,2));await writeFile('assets/poses/ceiling-grips.reference.json',JSON.stringify(report,null,2));
const rows=report.poses.flatMap(p=>p.arms.map(a=>`| ${p.id} | ${a.side} | ${a.wristBendDegrees.toFixed(1)}° |`));
await writeFile('output/ceiling-grips/README.md',`# Captured ceiling poses\n\nCamera pitch: 1 radian (57.3 degrees upward), yaw: 0. Standing, idle. No working animation captured.\n\nSource: assets/poses/ceiling-grips.reference.json\n\nThese are exact captured poses, not corrected anatomy. Local bone values are unchanged. Grip-space reconstruction checks passed. Runtime sources and character asset hashes unchanged. No runtime playback enabled.\n\n| Tool | Hand | Wrist bend |\n|---|---|---|\n${rows.join('\n')}\n`);
console.log(rows.join('\n'));
