import * as THREE from 'three';

export const MORTAR_RINGS=30,MORTAR_SEGMENTS=96;
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
 return new THREE.MeshStandardMaterial({color:0xffffff,map,bumpMap,bumpScale:.0017,roughness:.91,metalness:0});
}
