// Servir o build local e definir MODEL_PYTHON para o ambiente com PyFMI.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn,spawnSync}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 if(!process.env.MODEL_PYTHON) throw Error('Defina MODEL_PYTHON com PyFMI.');
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 let backend;let log='';
 const start=()=>{
  backend=spawn(process.env.MODEL_PYTHON,['-B','-u','python/server.py'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,SIX_TANK_MODE:'MODELICA',SIX_TANK_WS_PORT:String(port)}});
  backend.stdout.on('data',d=>{log+=d;});backend.stderr.on('data',d=>{log+=d;});
 };
 const stop=async()=>{
  if(!backend || backend.exitCode!==null) return;
  const exited=new Promise(r=>backend.once('exit',r));
  if(process.platform==='win32') spawnSync('taskkill',['/PID',String(backend.pid),'/T','/F']);else backend.kill();
  await exited;
 };
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.sent=[];window.snapshots=[];window.connections=0;
   const Native=window.WebSocket;
   window.WebSocket=class extends Native {
    constructor(url,...args){super(url,...args);window.connections++;this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='state')window.snapshots.push(m.data);});}
    send(raw){window.sent.push(JSON.parse(raw));super.send(raw);}
   };
  });
  await page.goto((process.env.HMI_TEST_URL||'http://127.0.0.1:5183')+'/?ws='+encodeURIComponent('ws://127.0.0.1:'+port));
  await page.waitForTimeout(1900);
  assert.ok(await page.locator('#start-pause-button').isDisabled());
  assert.ok(await page.evaluate(()=>connections>=2 && connections<=4));
  start();
  await page.waitForFunction(()=>!document.querySelector('#start-pause-button').disabled,{},{timeout:45000});
  assert.equal((await page.locator('#start-pause-button').innerText()).trim(),'Iniciar');
  await page.waitForTimeout(1300);
  assert.ok(await page.evaluate(()=>snapshots.every(s=>s.mode==='MODELICA' && s.sim.running===false && s.sim.t===0)));
  await stop();
  await page.waitForFunction(()=>document.querySelector('#start-pause-button').disabled);
  start();await page.waitForFunction(()=>!document.querySelector('#start-pause-button').disabled,{},{timeout:45000});
  await page.waitForTimeout(1000);
  assert.ok(await page.evaluate(()=>sent.every(m=>m.type==='hello')));
  assert.ok(await page.evaluate(()=>snapshots.every(s=>s.sim.running===false && s.sim.t===0)));
  assert.deepEqual(errors,[]);
  console.log('PASS: navegador antes do backend, reconexao apos reinicio, MODELICA pausado t=0, somente hello no bootstrap.');
 } catch(e){console.error(log);throw e;} finally {await browser.close();await stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
