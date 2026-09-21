import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try{
 const {apprenticePath}=await server.ssrLoadModule('/src/systems/ApprenticeNavigation.ts');
 const start={x:0,z:1},end={x:0,z:-1.6};
 const obstacle={id:'mixer',minX:-.4,maxX:.4,minZ:-.4,maxZ:.4};
 const path=apprenticePath(start,end,[obstacle]);assert.ok(path?.length);
 for(const p of path)assert.ok(!(p.x>-.69&&p.x<.69&&p.z>-.69&&p.z<.69),'path must clear equipment by the body radius');
 assert.equal(apprenticePath(start,end,[{id:'wall',minX:-4,maxX:4,minZ:-.4,maxZ:.4}]),null);
 assert.equal(apprenticePath(start,{x:10,z:0},[]),null);
 assert.ok(apprenticePath(start,end,[])?.length);
 console.log('PASS: obstacle detour, clearance, blocked route, bounds, open route');
}finally{await server.close();}
