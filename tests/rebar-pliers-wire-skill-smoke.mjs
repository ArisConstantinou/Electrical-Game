import {homedir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

// Run the actual installed skill client. Supply the isolated build and owned
// browser's pointer-lock guard without editing the skill or opening a server.
const client=join(homedir(),'.codex/skills/develop-web-game/scripts/web_game_playwright_client.js');
const require=createRequire(pathToFileURL(client)),{chromium}=require('playwright'),connect=chromium.connect.bind(chromium);
chromium.connect=async(...args)=>{
 const browser=await connect(...args);
 browser.newPage=async(options)=>{
  const context=await browser.newContext(options);await blockPointerLock(context);await serveTaskBuild(context,'http://127.0.0.1:5365/Electrical-Game/');
  const page=await context.newPage(),goto=page.goto.bind(page);
  page.goto=async(...args)=>{const result=await goto(...args);await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');return result;};
  return page;
 };
 return browser;
};
process.argv=[process.argv[0],client,'--url','http://127.0.0.1:5365/Electrical-Game/','--click-selector','#start-button','--iterations','1','--pause-ms','250','--screenshot-dir','output/rebar-pliers-wire/skill-client','--actions-json',JSON.stringify({steps:[{buttons:['a'],frames:20},{buttons:[],frames:10}]})];
await import(pathToFileURL(client));
