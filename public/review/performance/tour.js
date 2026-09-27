// Authored door centres match MansionGroundWing.ts and CourtyardWings.ts.
// Walk with the normal player controller, stair profiles and collisions.
export function createRoute({passes=2}={}) {
 const route=[];
 for(let pass=1;pass<=passes;pass++){
  const walk=(x,z,floor,label)=>route.push({x,z,floor,label,kind:'walk',pass,phase:'performance'});
  const view=(roomId,label,x,z,floor,yaw=0,room=true)=>{
   walk(x,z,floor,label);route.push({kind:'view',roomId,label,x,z,floor,yaw,seconds:4,room,pass,phase:'performance'});
  };
  view('G-work','Αρχικό δωμάτιο',0,2,0);
  walk(0,9,0,'Φουαγιέ');view('G-foyer','Φουαγιέ',3.8,9,0,-1.5);
  walk(3.8,14.4,0,'Προς αυλή');view('G-court','Αυλή',12,14.4,0,1.8,false);
  walk(3.8,14.4,0,'Επιστροφή από αυλή');walk(3.8,7.4,0,'Προς γκαράζ');walk(7.5,7.4,0,'Διάδρομος');walk(7.5,5.25,0,'Πέρασμα γκαράζ');
  view('G-garage','Γκαράζ',13.5,3.5,0);view('G-outside','Εξωτερικός χώρος',13.5,-6,0,2.5,false);
  walk(13.5,5.25,0,'Επιστροφή');walk(7.5,5.25,0,'Επιστροφή');walk(7.5,7.4,0,'Προς σκάλα');walk(5.5,7.4,0,'Βάση σκάλας');
  const climb=(base,top)=>{
   walk(5.5,11.65,(base+top)/2,'Σκάλα · άνοδος');route.push({kind:'view',label:'Πλατύσκαλο',floor:(base+top)/2,yaw:0,seconds:3,pass,phase:'performance'});
   walk(7.5,11.65,(base+top)/2,'Πλατύσκαλο');walk(7.5,7.4,top,'Σκάλα · άνοδος');
  };
  for(let level=1;level<=4;level++){
   const f=level*3.3,L=`L${level}`;climb(f-3.3,f);
   walk(5.5,7.4,f,'Προς δυτική πτέρυγα');walk(3.8,7.4,f,'Δυτική βεράντα');walk(3.8,10.4,f,'Δυτικό άνοιγμα');
   view(`${L}-west`,`${L} · δυτικό δωμάτιο`,level===4?2:1.4,10.4,f);
   walk(3.8,10.4,f,'Επιστροφή από δυτικό δωμάτιο');walk(3.8,7.4,f,'Δυτική βεράντα');walk(5.5,7.4,f,'Προς κύριο δωμάτιο');walk(7.5,7.4,f,'Διάδρομος');
   walk(7.5,2.75,f,'Κύριο άνοιγμα');view(`${L}-main`,`${L} · κύριο δωμάτιο`,level<3?9.5:8.7,2.75,f,-1);
   if(level<3)walk(10.8,3.5,f,'Προς ανατολικό άνοιγμα');
   walk(level<3?13.5:level===3?12:10.6,level<3?3.5:2.75,f,'Ανατολικό άνοιγμα');walk(level<3?15.6:level===3?14.9:12.8,level<3?3.5:2.75,f,'Προς μπροστινή πτέρυγα');
   view(`${L}-front`,`${L} · μπροστινό δωμάτιο`,level<3?15.6:level===3?14.9:12.8,level<3?0:0.6,f);
   walk(level<3?15.6:level===3?14.9:12.8,level<3?3.5:2.75,f,'Επιστροφή από μπροστινό δωμάτιο');
   if(level<=2){
    view(`${L}-veranda`,`${L} · ανατολική βεράντα`,17.1,4.6,f,0,false);
    walk(17.1,8,f,'Ανατολική πτέρυγα');view(`${L}-east-south`,`${L} · ανατολικό δωμάτιο`,19.5,8,f);walk(17.1,8,f,'Επιστροφή στη βεράντα');
    if(level===1){walk(17.1,13.2,f,'Βόρειο άνοιγμα');view('L1-east-north','L1 · βόρειο υπνοδωμάτιο',19.5,13.2,f);walk(17.1,13.2,f,'Επιστροφή');}
    walk(17.1,4.6,f,'Επιστροφή από ανατολική πτέρυγα');walk(13.5,3.5,f,'Βεράντα');
   }else view(`${L}-terrace`,`${L} · ανοιχτή βεράντα`,level===3?17.3:15.9,3.6,f,0,false);
   walk(level<3?13.5:level===3?12:10.6,level<3?3.5:2.75,f,'Προς κύριο δωμάτιο');if(level<3)walk(10.8,3.5,f,'Μέσα από ανατολικό άνοιγμα');walk(7.5,2.75,f,'Επιστροφή');walk(7.5,7.4,f,'Επιστροφή στη σκάλα');if(level<4)walk(5.5,7.4,f,'Προς επόμενο όροφο');
  }
  const descend=(top,base)=>{
   walk(7.5,11.65,(top+base)/2,'Σκάλα · κάθοδος');walk(5.5,11.65,(top+base)/2,'Πλατύσκαλο');walk(5.5,7.4,base,'Σκάλα · κάθοδος');walk(7.5,7.4,base,'Κάτω όροφος');
  };
  for(let level=4;level>0;level--)descend(level*3.3,(level-1)*3.3);
  for(let level=1;level<=2;level++){
   const f=-level*3.4,B=`B${level}`;descend(-(level-1)*3.4,f);view(`${B}-corridor`,`${B} · διάδρομος`,7.5,2.2,f);view(`${B}-garage`,`${B} · γκαράζ`,level===1?12:10.5,2.2,f);
   walk(level===1?14.4:11.8,.35,f,'Προς εργαστήριο / αποθήκη');view(`${B}-service`,level===1?'B1 · εργαστήριο':'B2 · ηλεκτρολογική αποθήκη',level===1?16.5:15,.35,f);
   walk(level===1?14.4:11.8,.35,f,'Επιστροφή');walk(10.5,2.2,f,'Γκαράζ');walk(7.5,2.2,f,'Διάδρομος');walk(7.5,7.4,f,'Επιστροφή στη σκάλα');
  }
  for(let level=2;level>0;level--){walk(5.5,7.4,-level*3.4,'Επιστροφή στο ισόγειο');climb(-level*3.4,-(level-1)*3.4);}
  walk(3.8,7.4,0,'Φουαγιέ');walk(3.8,8.6,0,'Φουαγιέ');walk(0,8.6,0,'Επιστροφή');walk(0,2,0,'Τέλος περάσματος');
 }
 return route;
}
export const inspectionManifest=()=>createRoute({passes:1}).filter(n=>n.roomId).map(({roomId,label,x,z,floor,room})=>({roomId,label,x,z,floor,room}));
export function createTour(game,onCheckpoint,onEnd,onFailure,options={}) {
 const route=createRoute(options);let index=0,elapsed=0,best=Infinity,stuck=0,heading=null,aligned=false,ended=false;
 const clear=()=>game.input.resetTransientInput();
 function update(dt){
  if(ended||!game.started||game.lifecyclePaused||!Number.isFinite(dt)||dt<=0)return;
  const node=route[index];if(!node)return;
  clear();const p=game.player,pos=p.camera.position;elapsed+=dt;
  if(node.kind==='view'){
   if(heading===null)heading=node.yaw;
   if(!aligned){const delta=Math.atan2(Math.sin(heading-p.yaw),Math.cos(heading-p.yaw));p.yaw+=Math.max(-dt*2.5,Math.min(dt*2.5,delta));p.pitch=-.2;if(Math.abs(delta)<.03){aligned=true;elapsed=0;}return;}
   p.yaw=heading+elapsed/node.seconds*Math.PI*2;p.pitch=-.2+Math.sin(elapsed/node.seconds*Math.PI*4)*.4;if(elapsed>=node.seconds)next(node);
  }else{
   const dx=node.x-pos.x,dz=node.z-pos.z,distance=Math.hypot(dx,dz);
   if(distance<.12&&Math.abs(pos.y-p.eyeHeight-node.floor)<.3){next(node);return;}
   if(distance<best-.04){best=distance;stuck=0;}else stuck+=dt;
   if(stuck>12||elapsed>60){ended=true;clear();onFailure({index,node,position:pos.toArray(),contacts:p.collisionContacts,reason:'Η διαδρομή εμποδίστηκε. Δεν παρακάμφθηκαν οι συγκρούσεις.'});return;}
   if(distance<.06)return;
   const wanted=Math.atan2(-dx,-dz),delta=Math.atan2(Math.sin(wanted-p.yaw),Math.cos(wanted-p.yaw));p.yaw+=Math.max(-dt*2.5,Math.min(dt*2.5,delta));p.pitch=-.15;
   const scale=Math.min(.8,distance/.3),vx=dx/distance*scale,vz=dz/distance*scale;game.input.mobileMove.x=vx*Math.cos(p.yaw)-vz*Math.sin(p.yaw);game.input.mobileMove.y=vx*Math.sin(p.yaw)+vz*Math.cos(p.yaw);
  }
 }
 function next(node){clear();onCheckpoint({index,...node,position:game.player.camera.position.toArray(),verified:!node.roomId||(Math.hypot(game.player.camera.position.x-node.x,game.player.camera.position.z-node.z)<.3&&Math.abs(game.player.camera.position.y-game.player.eyeHeight-node.floor)<.3)});index++;elapsed=0;best=Infinity;stuck=0;heading=null;aligned=false;if(index===route.length){ended=true;onEnd();}}
 return {update,stop(){ended=true;clear();},get index(){return index;},get total(){return route.length;},get current(){return route[index];},get inspecting(){return aligned&&route[index]?.kind==='view';}};
}
