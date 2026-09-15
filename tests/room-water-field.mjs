import {build} from 'esbuild';
import assert from 'node:assert/strict';
const compiled=await build({entryPoints:['src/systems/RoomWaterField.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {RoomWaterField}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const field=new RoomWaterField();
for(let i=0;i<1800;i++){field.add(-1.2,-1.8,.12/30);field.update(1/30);}
assert.ok(Math.abs(field.receivedLitres-7.2)<1e-8);
assert.ok(Math.abs(field.volumeLitres-7.2)<1e-8);
assert.ok(field.wetArea>.1,'runoff must spread into a puddle');
const smallArea=field.wetArea;
field.add(-1.2,-1.8,1500);
for(let i=0;i<3600;i++)field.update(1/30);
assert.ok(Math.abs(field.volumeLitres-1507.2)<1e-6,'flooding preserves every litre');
assert.ok(field.wetArea>smallArea&&field.wetArea>field.width*field.depth*.99,'sustained water fills the room');
assert.ok(field.maxDepth>(field.volumeLitres/1000)/(field.width*field.depth)*.9,'1500 litres must raise the actual water height across the enlarged room');
assert.ok([...field.depths].every(h=>Number.isFinite(h)&&h>=0),'depth stays nonnegative');
const sustained=new RoomWaterField();
for(let i=0;i<1200;i++){sustained.add(-1.2,-1.8,40/30);sustained.update(1/30);}
for(let i=0;i<3600;i++)sustained.update(1/30);
assert.ok(Math.abs(sustained.volumeLitres-1600)<1e-6,'40 L/s gun has no source clipping');
assert.ok(sustained.wetArea>sustained.width*sustained.depth*.99,'continuous high flow reaches the entire room floor');
assert.ok(sustained.maxDepth>(sustained.volumeLitres/1000)/(sustained.width*sustained.depth)*.9,'sustained gun use raises actual surface height');
const shallowMax=sustained.maxDepth;
// The deep saved-volume case verifies that the floor surface has no puddle cap.
sustained.add(0,0,60000);
for(let i=0;i<1800;i++)sustained.update(1/30);
assert.ok(Math.abs(sustained.volumeLitres-61600)<1e-5,'deep room fill conserves volume');
assert.ok(Math.min(...sustained.depths)>1,'every floor cell is deeper than one metre');
assert.ok(sustained.maxDepth>shallowMax+1,'water height keeps rising beyond shallow puddles');
assert.ok([...sustained.depths].every(h=>Number.isFinite(h)&&h>=0),'high flow remains finite and nonnegative');
const beforeInvalid=sustained.volumeLitres;
sustained.add(0,0,Infinity);sustained.add(NaN,0,10);sustained.add(0,0,-1);sustained.update(NaN);
assert.equal(sustained.volumeLitres,beforeInvalid,'invalid input cannot corrupt the conservative field');
console.log(JSON.stringify({receivedLitres:field.receivedLitres,volumeLitres:field.volumeLitres,conservationError:field.receivedLitres-field.volumeLitres,wetAreaM2:field.wetArea,maxDepthMm:field.maxDepth*1000,sustainedGunLitres:1600,deepFillLitres:sustained.volumeLitres,deepMinMetres:Math.min(...sustained.depths),deepMaxMetres:sustained.maxDepth,rows:field.rows,columns:field.columns}));
