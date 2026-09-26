import assert from 'node:assert/strict';
export async function toggleMobileStance(page){
 const b=await page.locator('#joystick').boundingBox();assert(b,'MOVE joystick must be visible');
 await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
 await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
}
export async function holdMobileJump(page){
 const b=await page.locator('#look-joystick').boundingBox();assert(b,'AIM joystick must be visible');
 const cdp=await page.context().newCDPSession(page);
 try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:71,x:b.x+b.width/2,y:b.y+b.height/2}]});await page.waitForTimeout(390);}
 finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
}
