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
assert.ok(field.maxDepth>.05,'1500 litres must raise the actual water height');
assert.ok([...field.depths].every(h=>Number.isFinite(h)&&h>=0),'depth stays nonnegative');
console.log(JSON.stringify({receivedLitres:field.receivedLitres,volumeLitres:field.volumeLitres,conservationError:field.receivedLitres-field.volumeLitres,wetAreaM2:field.wetArea,maxDepthMm:field.maxDepth*1000,rows:field.rows,columns:field.columns}));
