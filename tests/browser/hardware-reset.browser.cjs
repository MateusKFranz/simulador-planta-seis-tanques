const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH}: {})});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.sent=[];
   const valves=Array.from({length:4},(_,i)=>[i+1,1,53,47,-1,1,0,0,10,80,10,80,-1,36+i]);
   window.snapshot={mode:'HARDWARE',operation:{mode:'MANUAL',autoBlocked:[],fixed:{}},
    hardware:{serial:{connected:true},control:{supported:true,compatible:true,ready:true,armed:true,busy:false,
     pumpChannels:{JIC3:1,JIC1:2,JIC4:3},confirmed:{armed:true,fault:'NONE',pumps:[[150,1],[80,1],[40,1]],valves,oy:[1,2]}}},
    sim:{},loops:{},scenarios:[],levelSensors:{},flowSensors:{}};
   window.WebSocket=class {
    static OPEN=1;static CONNECTING=0;
    readyState=0;events={};
    constructor(){window.socket=this;setTimeout(()=>{this.readyState=1;this.events.open?.();this.push();},20);}
    addEventListener(name,fn){this.events[name]=fn;}
    send(raw){sent.push(JSON.parse(raw));}
    push(){this.events.message?.({data:JSON.stringify({type:'state',data:snapshot})});}
   };
   window.telemetryEnabled=true;
   setInterval(()=>{if(window.telemetryEnabled && window.socket?.readyState===1)socket.push();},100);
  });
  await page.goto(process.env.HMI_TEST_URL || 'http://127.0.0.1:5183');
  await page.selectOption('#operating-mode','real');
  await page.evaluate(()=>socket.push());
  await page.getByRole('button',{name:'Configurações da interface'}).click();
  assert.ok(await page.locator('.settings-simulation').isHidden());
  assert.ok(await page.locator('#simulation-speed').isDisabled());
  await page.getByRole('button',{name:'Fechar Configurações'}).click();
 assert.ok(await page.locator('.sidebar .component-controls-panel').isVisible());
  const face=page.locator('.actuator-faceplate');
  const row=face.locator('.op-actuators > details:not([hidden])');
  const open=async id=>{await page.evaluate(id=>document.dispatchEvent(new CustomEvent('operation-actuator',{detail:id})),id);};
  await page.locator('.actuator-shortcuts').filter({hasText:'Bombas'}).getByRole('button',{name:'Bombas',exact:true}).click();
  const panel=page.locator('.component-controls-panel');
  assert.ok(await page.locator('[data-mode="MANUAL"]').isVisible());
  await page.evaluate(()=>telemetryEnabled=false);
  await page.waitForTimeout(2200);
  assert.ok(await panel.locator('[data-id="JIC3"] input[type="range"]').isDisabled());
  await page.evaluate(()=>{telemetryEnabled=true;socket.push();});
  assert.ok(await panel.locator('[data-id="JIC3"] input[type="range"]').isEnabled());
  const initial=await page.evaluate(()=>sent.filter(m=>m.action!=='lease').length);
  await panel.locator('[data-id="JIC3"] input[type="range"]').fill('200');
  assert.ok(await panel.locator('.apply-all').isDisabled());
  assert.match(await panel.locator('.batch-validation').innerText(),/Lote HARDWARE indisponível/);
  const popupPromise=page.waitForEvent('popup');await panel.locator('.detach').click();
  const popup=await popupPromise;
  const moved=popup.locator('.component-controls-panel');
  assert.equal(await moved.locator('[data-id="JIC3"] input[type="range"]').inputValue(),'200');
  await moved.locator('.discard-all').click();
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.action!=='lease').length),initial);
  assert.equal(await moved.locator('[data-id="JIC3"] input[type="range"]').inputValue(),'150');
  await page.evaluate(()=>socket.push());
  await moved.locator('[data-id="JIC3"] input[type="range"]').fill('200');
  await moved.locator('[data-id="JIC3"] .apply').click();
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.action!=='lease').at(-1).action),'pump');
  assert.match(await moved.locator('[data-actuator="JIC3"] small').innerText(),/150/);
  await page.evaluate(()=>{
    const c=snapshot.hardware.control;c.confirmed.pumps[0][0]=200;
    c.lastConfirmation={at:1,command:'PWM',requestId:'1'};socket.push();
  });
  assert.match(await moved.locator('[data-actuator="JIC3"] small').innerText(),/200/);
  assert.match(await moved.locator('.draft-count').innerText(),/0 alterações/);
  await moved.locator('.dock').click();
  await page.getByRole('button',{name:'Abrir JIC3',exact:true}).click();
  await page.evaluate(()=>{snapshot.hardware.control.armed=false;socket.push();});
  assert.ok(await row.getByRole('button',{name:'Aplicar',exact:true}).isDisabled());
  assert.ok(await row.locator('input[type="range"]').isDisabled());
  await page.evaluate(()=>{snapshot.hardware.control.armed=true;snapshot.hardware.control.ready=false;snapshot.hardware.control.confirmed.fault='ESTOP';socket.push();});
  assert.ok(await row.getByRole('button',{name:'Aplicar',exact:true}).isDisabled());
  assert.ok(await row.locator('input[type="range"]').isDisabled());
  await page.evaluate(()=>{snapshot.hardware.control.ready=true;snapshot.hardware.control.confirmed.fault='NONE';socket.push();});
  for (const condition of ['busy','pumpConfig']) {
   await page.evaluate(condition=>{
    const c=snapshot.hardware.control;
    if(condition==='busy') c.busy=true; else c.confirmed.pumps[0][1]=0;
    socket.push();
   },condition);
   assert.ok(await row.locator('input[type="range"]').isDisabled());
   assert.ok(await page.locator('.actuator-card[data-id="JIC3"] input[type="range"]').isDisabled());
   assert.ok(await row.getByRole('button',{name:'Aplicar',exact:true}).isDisabled());
   await page.evaluate(()=>{const c=snapshot.hardware.control;c.busy=false;c.confirmed.pumps[0][1]=1;socket.push();});
  }
  await face.getByRole('button',{name:'Fechar equipamento'}).click();
  await open('LV2');
  const lvSide=page.locator('.actuator-card[data-id="LV2"] input[type="range"]');
  await row.locator('.unit').selectOption('angle');
  await page.evaluate(()=>{snapshot.hardware.control.confirmed.valves[1][10]=12;snapshot.hardware.control.confirmed.valves[1][11]=78;socket.push();});
  assert.equal(await row.locator('input[type="range"]').getAttribute('min'),'12');
  assert.equal(await row.locator('input[type="range"]').getAttribute('max'),'78');
  const beforeRange=await page.evaluate(()=>sent.filter(m=>m.action!=='lease').length);
  await row.locator('input[type="range"]').fill('52');
  assert.equal(await row.locator('.value').inputValue(),'52');
  assert.equal(await lvSide.inputValue(),'60');
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.action!=='lease').length),beforeRange);
  await page.evaluate(()=>{snapshot.hardware.control.confirmed.valves[1][5]=0;socket.push();});
  assert.ok(await lvSide.isDisabled());
  assert.ok(await row.locator('input[type="range"]').isDisabled());
  assert.ok(await row.getByRole('button',{name:'Aplicar',exact:true}).isDisabled());
  await page.evaluate(()=>{snapshot.hardware.control.confirmed.valves[1][5]=1;socket.push();});
  await row.locator('.unit').selectOption('percent');
  await row.locator('.value').fill('80');await face.getByRole('button',{name:'Fechar equipamento'}).click();
  await open('JIC3');await row.locator('.value').fill('200');
  await page.getByRole('button',{name:'Resetar comandos',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>sent.filter(m=>m.action!=='lease').at(-1)),{type:'hardware',action:'plant_reset'});
  assert.equal(await row.locator('.value').inputValue(),'200');
  assert.doesNotMatch(await page.locator('.hw-reset-result').innerText(),/zerados/);
  await page.evaluate(()=>{
   const c=snapshot.hardware.control;
   c.armed=false;c.confirmed.armed=false;c.confirmed.pumps.forEach(p=>p[0]=0);c.confirmed.oy=[0,0];
   c.plantReset={id:'reset-1',status:'confirmed',message:'Comandos da planta zerados.'};
   c.lastConfirmation={at:1,command:'DISARM',requestId:'99'};socket.push();
  });
  assert.equal(await row.locator('.value').inputValue(),'0');
  assert.match(await page.locator('.hw-reset-result').innerText(),/Comandos da planta zerados/);
  assert.ok(await page.getByRole('button',{name:'Resetar comandos',exact:true}).isEnabled());
  await face.getByRole('button',{name:'Fechar equipamento'}).click();await open('LV2');
  assert.equal(await row.locator('.value').inputValue(),'53');
  assert.match(await row.locator('.confirmed').innerText(),/47/);
  await face.getByRole('button',{name:'Fechar equipamento'}).click();await open('OY1');
  assert.match(await row.locator('.requested').innerText(),/RELEASE/);
  await page.getByRole('button',{name:'Resetar comandos',exact:true}).click();
  await page.evaluate(()=>{snapshot.hardware.serial.connected=false;socket.push();});
  assert.match(await page.locator('.hw-reset-result').innerText(),/não pôde ser confirmado/);
  await open('HV1');
  assert.ok(await row.locator('.value').isEnabled());
  assert.ok(await row.getByRole('button',{name:'Aplicar',exact:true}).isEnabled());
  assert.match(await row.locator('.reason').innerText(),/Anotação de operação/);
  // Snapshots parciais não inventam confirmação nem liberam controles.
  for (const confirmed of [null, {}, {pumps:[],valves:[],oy:[]}, {pumps:null,valves:[null],oy:null}]) {
    await page.evaluate(confirmed=>{
      snapshot.hardware.control.confirmed=confirmed;
      snapshot.hardware.control.armed=true;snapshot.hardware.control.ready=true;
      snapshot.hardware.serial.connected=true;socket.push();
    },confirmed);
    for (const id of ['JIC3','LV2','OY1']) {
      await open(id);
      assert.ok(await row.getByRole('button',{name:'Aplicar',exact:true}).isDisabled());
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: reset sem otimismo, drafts, LV preservada, RELEASE, desarmado e desconexão');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
