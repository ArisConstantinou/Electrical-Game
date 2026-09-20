import * as THREE from 'three';

export const MORTAR_RINGS=64,MORTAR_SEGMENTS=256;
// Equal arc length avoids the wide gaps that |sin(angle)|^.6 produces along
// the centre axes. Those gaps erase small clods and resemble cut strips.
export const MORTAR_DIRECTIONS=(()=>{
 const points:{x:number;z:number;length:number}[]=[],count=4096;let length=0;
 for(let i=0;i<=count;i++){
  const a=i/count*Math.PI*2,s=Math.sin(a),c=Math.cos(a),z=Math.sign(c)*Math.pow(Math.abs(c),.6),x=Math.sign(s)*Math.pow(Math.abs(s),.6)*(1-.09*z),previous=points.at(-1);
  if(previous)length+=Math.hypot((x-previous.x)*.335,(z-previous.z)*.462);
  points.push({x,z,length});
 }
 let at=1;return Array.from({length:MORTAR_SEGMENTS},(_,i)=>{
  const target=i/MORTAR_SEGMENTS*length;while(points[at].length<target)at++;
  const a=points[at-1],b=points[at],t=(target-a.length)/(b.length-a.length);
  return{x:THREE.MathUtils.lerp(a.x,b.x,t),z:THREE.MathUtils.lerp(a.z,b.z,t)};
 });
})();
const hash=(x:number,y:number)=>{let n=Math.imul(x,374761393)^Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;};
const reliefSize=257,reliefSpan=1.6,relief=new Float32Array(reliefSize*reliefSize);
// Millimetres-to-centimetres of actual paste geometry, not a shading illusion.
// Irregular joined clods have steep torn seams and differently flattened tops.
// Bake once; transport samples the field in moving material coordinates.
for(let j=0;j<reliefSize;j++)for(let i=0;i<reliefSize;i++){
 const x=(i/(reliefSize-1)-.5)*reliefSpan,z=(j/(reliefSize-1)-.5)*reliefSpan;
 const u=x/.032+.5*Math.sin(z*43)+.19*Math.sin(x*79+z*27),v=z/.029+.48*Math.sin(x*37)+.17*Math.sin(z*91-x*31),ix=Math.floor(u),iz=Math.floor(v);
 let first=Infinity,second=Infinity,id=0;
 for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
  const cx=ix+dx,cz=iz+dz,px=cx+.15+.7*hash(cx,cz),pz=cz+.15+.7*hash(cx+81,cz-17),d=Math.hypot(u-px,v-pz);
  if(d<first){second=first;first=d;id=hash(cx+39,cz+91);}else second=Math.min(second,d);
 }
 const seam=second-first,top=Math.max(0,1-first*first*1.7);
 relief[j*reliefSize+i]=(.005+id*.008)*top-.005*Math.exp(-seam*seam/ .006)+.003*(hash(i,j)-.5);
}
export function mortarReliefAt(x:number,z:number):number{
 const u=THREE.MathUtils.clamp((x/reliefSpan+.5)*(reliefSize-1),0,reliefSize-1.001),v=THREE.MathUtils.clamp((z/reliefSpan+.5)*(reliefSize-1),0,reliefSize-1.001),i=Math.floor(u),j=Math.floor(v),fx=u-i,fz=v-j,n=j*reliefSize+i;
 return THREE.MathUtils.lerp(THREE.MathUtils.lerp(relief[n],relief[n+1],fx),THREE.MathUtils.lerp(relief[n+reliefSize],relief[n+reliefSize+1],fx),fz);
}
export function mortarSurfaceGeometry():THREE.BufferGeometry{
 const uv:number[]=[.5,.5],indices:number[]=[],geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array((1+MORTAR_RINGS*MORTAR_SEGMENTS)*3),3));
 for(let j=1;j<=MORTAR_RINGS;j++)for(let i=0;i<MORTAR_SEGMENTS;i++){
  const a=i/MORTAR_SEGMENTS*Math.PI*2,next=(i+1)%MORTAR_SEGMENTS,n=1+(j-1)*MORTAR_SEGMENTS+i,nNext=1+(j-1)*MORTAR_SEGMENTS+next;
  uv.push(.5+Math.sin(a)*j/(2*MORTAR_RINGS),.5+Math.cos(a)*j/(2*MORTAR_RINGS));
  if(j===1)indices.push(0,n,nNext);
  if(j<MORTAR_RINGS){const outer=n+MORTAR_SEGMENTS,outerNext=nNext+MORTAR_SEGMENTS;indices.push(n,outer,nNext,nNext,outer,outerNext);}
 }
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.userData.rimVertices=MORTAR_SEGMENTS;return geometry;
}

/** Sand-scale variation over a cohesive cement paste, authored without photos. */
export function mortarMaterial():THREE.MeshStandardMaterial{
 const size=512,colour=new Uint8Array(size*size*4),height=new Uint8Array(size*size*4);
 const hash=(x:number,y:number)=>{let n=Math.imul(x,374761393)^Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;};
 const noise=(x:number,y:number,scale:number)=>{const ix=Math.floor(x/scale),iy=Math.floor(y/scale),fx=x/scale-ix,fy=y/scale-iy;return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),fx),THREE.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),fx),fy);};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4,fine=hash(x,y),grain=noise(x,y,3),paste=noise(x,y,19),pore=fine<.07?-23:0;
  const c=132+(grain-.5)*24+(paste-.5)*18+(fine-.5)*10+pore,b=128+(grain-.5)*110+(fine-.5)*45+pore;
  colour.set([c+3,c+1,c-4,255],i);height.set([b,b,b,255],i);
 }
 const map=new THREE.DataTexture(colour,size,size),bumpMap=new THREE.DataTexture(height,size,size);
 for(const texture of [map,bumpMap]){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,2);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;}
 map.colorSpace=THREE.SRGBColorSpace;
 return new THREE.MeshStandardMaterial({color:0xffffff,map,bumpMap,bumpScale:.0007,roughness:.94,metalness:0});
}
