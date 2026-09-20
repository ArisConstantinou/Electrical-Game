// Rasterise the approved brand vector for a portable glTF texture.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const svg=await readFile('assets/source/milwaukee-wordmark.svg','utf8');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {const page=await browser.newPage();
 for(const clear of [false,true]){
 const data=await page.evaluate(async({svg,clear})=>{const i=new Image();i.src='data:image/svg+xml;base64,'+btoa(svg);await i.decode();const c=document.createElement('canvas');c.width=512;c.height=256;const x=c.getContext('2d');if(!clear){x.fillStyle='#ad001b';x.fillRect(0,0,512,256);}x.drawImage(i,30,25,452,202);return c.toDataURL().split(',')[1];},{svg,clear});
 await writeFile(`assets/source/milwaukee-${clear?'print':'label'}.png`,Buffer.from(data,'base64'));
 }
}finally{await browser.close();}
