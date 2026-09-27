// Waypoints use the existing player controller, stairs and collisions.
// No teleport, altered geometry, speed override, or changed graphics settings.
export function createRoute() {
 const route=[], walk=(x,z,floor,label)=>route.push({x,z,floor,label,kind:'walk'});
 const view=(label,floor,yaw=0)=>route.push({kind:'view',label,floor,yaw,seconds:5});
 walk(0,2,0,'Αρχικό δωμάτιο');view('Αρχικό δωμάτιο',0);
 walk(0,9,0,'Φουαγιέ');walk(3.8,9,0,'Φουαγιέ / σκάλα');view('Φουαγιέ / σκάλα',0,-1.5);
 walk(3.8,14.4,0,'Προς αυλή');walk(12,14.4,0,'Αυλή');view('Αυλή',0,1.8);
 walk(3.8,14.4,0,'Επιστροφή από αυλή');walk(3.8,7.4,0,'Προς έξοδο');walk(7.5,7.4,0,'Διάδρομος');
 walk(7.5,5.25,0,'Πέρασμα γκαράζ');walk(13.5,5.25,0,'Γκαράζ');walk(13.5,-6,0,'Εξωτερικός χώρος');view('Εξωτερικός χώρος',0,2.5);
 walk(13.5,5.25,0,'Επιστροφή');walk(7.5,5.25,0,'Επιστροφή');walk(7.5,7.4,0,'Προς σκάλα');walk(5.5,7.4,0,'Βάση σκάλας');
 const climb=(base,top)=>{
  walk(5.5,11.65,(base+top)/2,'Σκάλα · άνοδος');view(top<=0?'Πλατύσκαλο · υπόγεια':`Πλατύσκαλο · L${Math.round(top/3.3)}`, (base+top)/2,0);
  walk(7.5,11.65,(base+top)/2,'Πλατύσκαλο');walk(7.5,7.4,top,'Σκάλα · άνοδος');
 };
 for(let level=1;level<=4;level++){
  const floor=level*3.3;climb(floor-3.3,floor);
  walk(7.5,2.75,floor,`L${level}`);view(`L${level}`,floor,-1);
  walk(10.3,2.75,floor,`L${level} · άνοιγμα`);view(`L${level} · άνοιγμα`,floor,-1.5);
  walk(7.5,2.75,floor,'Επιστροφή στη σκάλα');walk(7.5,7.4,floor,'Επιστροφή στη σκάλα');
  if(level<4)walk(5.5,7.4,floor,'Προς επόμενο όροφο');
 }
 const descend=(top,base)=>{
  walk(7.5,11.65,(top+base)/2,'Σκάλα · κάθοδος');walk(5.5,11.65,(top+base)/2,'Πλατύσκαλο');walk(5.5,7.4,base,'Σκάλα · κάθοδος');walk(7.5,7.4,base,'Κάτω όροφος');
 };
 for(let level=4;level>0;level--)descend(level*3.3,(level-1)*3.3);
 for(let level=1;level<=2;level++){
  descend(-(level-1)*3.4,-level*3.4);
  walk(7.5,2.2,-level*3.4,`B${level}`);view(`B${level}`,-level*3.4,-1);
  walk(10.3,2.2,-level*3.4,`B${level} · χώρος`);view(`B${level} · χώρος`,-level*3.4,-1.5);
  walk(7.5,2.2,-level*3.4,'Επιστροφή στη σκάλα');walk(7.5,7.4,-level*3.4,'Επιστροφή στη σκάλα');
 }
 for(let level=2;level>0;level--){
  walk(5.5,7.4,-level*3.4,'Επιστροφή στο ισόγειο');climb(-level*3.4,-(level-1)*3.4);
 }
 walk(3.8,7.4,0,'Φουαγιέ');walk(3.8,8.6,0,'Φουαγιέ');walk(0,8.6,0,'Επιστροφή');walk(0,4.4,0,'Τέλος διαδρομής');
 return route;
}
export function createTour(game, onCheckpoint, onEnd, onFailure) {
 const route=createRoute();let index=0,elapsed=0,best=Infinity,stuck=0,heading=null;
 const clear=()=>{game.input.resetTransientInput();};
 function update(dt) {
  if(!game.started||game.lifecyclePaused||!Number.isFinite(dt)||dt<=0)return;
  const node=route[index];if(!node)return;
  clear();const p=game.player,pos=p.camera.position;elapsed+=dt;
  if(node.kind==='view'){
   if(heading===null)heading=node.yaw;
   const wanted=heading+Math.sin(elapsed/node.seconds*Math.PI*2)*1.5;
   const delta=Math.atan2(Math.sin(wanted-p.yaw),Math.cos(wanted-p.yaw));
   p.yaw+=Math.max(-dt*2.5,Math.min(dt*2.5,delta));
   p.pitch=-.2+Math.sin(elapsed/node.seconds*Math.PI*4)*.4;
   if(elapsed>=node.seconds)next(node);
  }else{
   const dx=node.x-pos.x,dz=node.z-pos.z,distance=Math.hypot(dx,dz);
   if(distance<.12&&Math.abs(pos.y-p.eyeHeight-node.floor)<.3){next(node);return;}
   if(distance<best-.04){best=distance;stuck=0;}else stuck+=dt;
   if(stuck>12||elapsed>60){clear();onFailure({index,node,position:pos.toArray(),contacts:p.collisionContacts,reason:'Η διαδρομή εμποδίστηκε. Δεν παρακάμφθηκαν οι συγκρούσεις.'});return;}
   if(distance<.06)return;
   const wanted=Math.atan2(-dx,-dz),delta=Math.atan2(Math.sin(wanted-p.yaw),Math.cos(wanted-p.yaw));
   p.yaw+=Math.max(-dt*2.5,Math.min(dt*2.5,delta));p.pitch=-.15;
   const scale=Math.min(.8,distance/.3),vx=dx/distance*scale,vz=dz/distance*scale;
   game.input.mobileMove.x=vx*Math.cos(p.yaw)-vz*Math.sin(p.yaw);
   game.input.mobileMove.y=vx*Math.sin(p.yaw)+vz*Math.cos(p.yaw);
  }
 }
 function next(node){clear();onCheckpoint({index,...node,position:game.player.camera.position.toArray()});index++;elapsed=0;best=Infinity;stuck=0;heading=null;if(index===route.length)onEnd();}
 return {update,stop:clear,get index(){return index;},get total(){return route.length;},get current(){return route[index];}};
}
