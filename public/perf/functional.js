// Runs after both measurement passes. Uses existing input and lifecycle methods.
// This controlled lifecycle check is not a real OS/browser background transition.
export function createFunctionalChecks(game,onEnd){
 const checks=[],nodes=['movement','jump','wall-collision','spray','release','lifecycle'];
 let index=0,time=0,before=null,peak=0,responseAt=null,waiting=false,done=false,inputAt=0;
 const label={movement:'Απόκριση κίνησης',jump:'Άλμα και προσγείωση','wall-collision':'Επαφή με τοίχο',spray:'Χρήση spray',release:'Απελευθέρωση εργαλείου',lifecycle:'Παύση και επαναφορά'};
 const stamp=()=>({position:game.player.camera.position.toArray(),jumpOffset:game.player.jumpOffset,marks:game.room.brickWall.freeMarkCount,frame:game.animationFrame});
 const start=()=>{before=stamp();responseAt=null;peak=0;time=0;inputAt=performance.now();};
 const finish=(passed,evidence)=>{checks.push({id:nodes[index],label:label[nodes[index]],status:passed?'passed':'failed',evidence});game.input.resetTransientInput();index++;before=null;if(index===nodes.length){done=true;onEnd(checks);}};
 function update(dt){
  if(done||waiting||game.lifecyclePaused)return;
  const id=nodes[index];if(!before)start();time+=dt;game.input.resetTransientInput();
  if(id==='movement'){game.player.yaw=0;game.player.pitch=0;game.input.mobileMove.y=-.5;if(time>=.6)finish(Math.abs(game.player.camera.position.z-before.position[2])>.1,{before,after:stamp(),responseMs:responseAt,method:'Normal movement input to first simulation displacement'});}
  if(id==='jump'){if(time<=dt*1.01)game.input.jumpRequested=true;peak=Math.max(peak,game.player.jumpOffset);if(time>=2.5)finish(peak>.1&&game.player.grounded,{peakHeightM:peak,grounded:game.player.grounded,responseMs:responseAt});}
  if(id==='wall-collision'){game.player.yaw=0;game.player.pitch=0;game.input.mobileMove.y=-.8;if(time>=4)finish(game.player.camera.position.z>=game.room.brickWall.volume.frontZ+.2&&game.player.camera.position.z<before.position[2]-.3,{before,after:stamp(),wallFrontZ:game.room.brickWall.volume.frontZ,contacts:[...game.player.collisionContacts],method:'Approach the existing work-room wall with normal movement'});}
  if(id==='spray'){if(time<=dt*1.01)game.selectTool('spray');game.player.yaw=0;game.player.pitch=0;game.input.actionHeld=true;if(time<=dt*1.01)game.input.actionRequested=true;if(time>=.8)finish(game.room.brickWall.freeMarkCount>before.marks,{beforeMarks:before.marks,afterMarks:game.room.brickWall.freeMarkCount,responseMs:responseAt});}
  if(id==='release'&&time>=.5)finish(!game.input.actionHeld&&game.room.brickWall.freeMarkCount===before.marks,{beforeMarks:before.marks,afterMarks:game.room.brickWall.freeMarkCount,actionHeld:game.input.actionHeld});
  if(id==='lifecycle'){
   waiting=true;const objects=[game.renderer.scene,game.roomWater.field,game.mission],pose=game.player.camera.position.toArray();
   game.input.actionHeld=true;game.input.mobileMove.y=-.5;game.suspendLifecycle();
   setTimeout(async()=>{if(done)return;try{await game.resumeLifecycle();if(done)return;const sameObjects=[game.renderer.scene,game.roomWater.field,game.mission].every((o,i)=>o===objects[i]);finish(!game.lifecyclePaused&&!game.input.actionHeld&&game.input.mobileMove.x===0&&game.input.mobileMove.y===0&&sameObjects,{paused:game.lifecyclePaused,actionHeld:game.input.actionHeld,sameObjects,positionBefore:pose,positionAfter:game.player.camera.position.toArray(),method:'Controlled game suspend/resume, not a real device lock',error:game.renderer.renderError});}catch(error){finish(false,{error:String(error)});}finally{waiting=false;}},250);
  }
 }
 function afterStep(){if(!before||responseAt!==null)return;const id=nodes[index];if((id==='movement'&&Math.hypot(game.player.camera.position.x-before.position[0],game.player.camera.position.z-before.position[2])>.01)||(id==='jump'&&game.player.jumpOffset>.01)||(id==='spray'&&game.room.brickWall.freeMarkCount>before.marks))responseAt=Math.round(performance.now()-inputAt);}
 return {update,afterStep,checks,stop(){done=true;game.input.resetTransientInput();},get current(){return {label:label[nodes[index]]??'Ολοκλήρωση',phase:'functional'};},get complete(){return index===nodes.length;}};
}
