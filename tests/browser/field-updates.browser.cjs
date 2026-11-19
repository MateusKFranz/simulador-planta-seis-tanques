const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.sent=[];
   const levels=Object.fromEntries(Array.from({length:6},(_,i)=>[`LI${i+1}`,{heightCm:2.85,raw:150,status:'available',diagnostics:{valid:true,stale:false,outOfRange:false,rawMean50:150,rawMeanCount:10,rawMeanWindow:10,calibrationPoints:[{heightCm:0,raw:100}],calibrationMode:'offset',calibrationWarning:'Um ponto: offset com ganho provisório'}}]));
   window.snapshot={mode:'HARDWARE',sim:{},operation:{mode:'MANUAL',autoBlocked:['Bloqueado'],fixed:{}},loops:{},scenarios:[],levelSensors:levels,flowSensors:{},
    manualValves:Object.fromEntries(Array.from({length:6},(_,i)=>[`HV${i+1}`,{opening:null,status:'unavailable',positionSource:'operator'}])),recycleValves:{HV7:{opening:null},HV8:{opening:null}},mainValve:{opening:null},
    hardware:{serial:{connected:true},telemetry:{status:'receiving'},control:{supported:true,compatible:true,ready:true,armed:false,busy:false,pumpChannels:{JIC3:1,JIC1:2,JIC4:3},confirmed:{pumps:[[10,1],[20,1],[30,1]],valves:[],oy:[0,0]}}}};
   window.WebSocket=class {
    static OPEN=1;static CONNECTING=0;readyState=0;events={};
    constructor(){window.socket=this;setTimeout(()=>{this.readyState=1;this.events.open?.();this.push();},20);}
    addEventListener(k,f){this.events[k]=f;}send(raw){sent.push(JSON.parse(raw));}
    message(m){this.events.message?.({data:JSON.stringify(m)});}
    push(){this.message({type:'state',data:snapshot});}
    close(){this.readyState=3;this.events.close?.();}
   };
   setInterval(()=>{if(window.socket?.readyState===1)socket.push();},100);
  });
  await page.goto(process.env.HMI_TEST_URL||'http://127.0.0.1:5185');await page.selectOption('#operating-mode','real');
  await page.waitForFunction(()=>window.socket?.readyState===1 && sent.some(m=>m.type==='hello'));
  const face=page.locator('.actuator-faceplate'),row=face.locator('.op-actuators>details:not([hidden])');
  const open=async id=>{await page.evaluate(id=>document.dispatchEvent(new CustomEvent('operation-actuator',{detail:id})),id);};
  for(const [id,channel,pwm] of [['JIC3',1,10],['JIC1',2,20],['JIC4',3,30]]){
   await open(id);assert.match(await face.locator('.actuator-title').innerText(),new RegExp(`Pump${channel}`));
   assert.match(await row.locator('.confirmed').innerText(),new RegExp(`PWM atual: ${pwm} / 255`));
   assert.ok(await row.locator('.apply').isDisabled());
  }
  for(const mode of ['CTRL','RO']) {
   if(mode==='RO')await page.evaluate(()=>{snapshot.hardware.control={supported:false};socket.push();});
   await open('HV1');assert.ok(await row.locator('.apply').isEnabled());
   const sidebar=page.locator('.actuator-card[data-id="HV1"]');
   await page.locator('.actuator-shortcuts').filter({hasText:'Válvulas manuais'}).getByRole('button',{name:'Válvulas manuais',exact:true}).click();
   await row.locator('.value').fill('50');assert.equal(await sidebar.locator('input[type="range"]').inputValue(),'50');
   const before=await page.evaluate(()=>sent.length);await row.locator('.discard').click();assert.equal(await page.evaluate(()=>sent.length),before);
   for(const value of [0,29,50,100]) {
    await row.locator('.value').fill(String(value));await row.locator('.apply').click();
    assert.match(await row.locator('.draft-status').innerText(),/Aguardando/);
    const m=await page.evaluate(()=>sent.at(-1));assert.equal(m.type,'manual_position');assert.equal(m.percent,value);
    await page.evaluate(()=>{const m=sent.at(-1);snapshot.manualValves.HV1={opening:m.percent/100,status:'available',positionSource:'operator'};socket.message({...m,type:'manual_position_result',success:true,message:'Posição informada registrada'});socket.push();});
    await page.waitForFunction(()=>!document.querySelector('.op-actuators>details:not([hidden]) .apply').disabled);
    assert.match(await row.locator('.confirmed').innerText(),/Posição informada/);
    assert.equal(await row.locator('.value').inputValue(),String(value));
   }
   assert.ok(await page.locator('.component-controls-panel .apply-all').isDisabled());
   await face.getByRole('button',{name:'Fechar equipamento'}).click();
  }
  await page.locator('[data-type="app.LevelSensor"]').filter({hasText:'LI1'}).click();
  const drawer=page.locator('.sensor-drawer'),cal=drawer.locator('.level-zero-controls');
  await cal.getByLabel('Altura medida (cm)').fill('5,7');await cal.getByRole('button',{name:'Adicionar ponto',exact:true}).click();
  assert.match(await cal.getByRole('dialog').innerText(),/5,7 cm/);assert.match(await cal.getByRole('dialog').innerText(),/150/);
  await page.evaluate(()=>{snapshot.levelSensors.LI1.diagnostics.rawMean50=180;socket.push();});
  await cal.getByRole('button',{name:'Confirmar ponto',exact:true}).click();
  const point=await page.evaluate(()=>sent.at(-1));assert.equal(point.type,'level_zero');assert.equal(point.heightCm,5.7);assert.equal(point.rawMean50,150);
  assert.match(await cal.getByRole('status').innerText(),/Aguardando/);
  await page.evaluate(()=>{const m=sent.at(-1);snapshot.levelSensors.LI1.diagnostics.calibrationPoints.push({heightCm:m.heightCm,raw:m.rawMean50});socket.message({...m,type:'level_zero_result',success:true,message:'Ponto registrado'});socket.push();});
  await page.waitForFunction(()=>document.querySelector('.calibration-points').textContent.includes('5,7'));
  await cal.getByRole('button',{name:'Calibrar 0 cm',exact:true}).click();assert.match(await cal.getByRole('dialog').innerText(),/Substituir/);await cal.getByRole('button',{name:'Cancelar',exact:true}).click();
  const popupPromise=page.waitForEvent('popup');await drawer.getByRole('button',{name:'Destacar sensores'}).click();const popup=await popupPromise;
  await popup.waitForSelector('.calibration-points');assert.match(await popup.locator('.calibration-points').innerText(),/5,7/);
  if(process.env.HMI_SCREENSHOT) await popup.screenshot({path:process.env.HMI_SCREENSHOT});
  await page.evaluate(()=>{snapshot.hardware.serial.connected=false;socket.push();});
  await page.waitForTimeout(200);
  assert.ok(await popup.getByRole('button',{name:'Adicionar ponto',exact:true}).isDisabled());
  assert.match(await popup.locator('.calibration-points').innerText(),/5,7/);
  await popup.locator('.calibration-points tr').nth(2).getByRole('button',{name:'Excluir',exact:true}).click();
  assert.match(await popup.getByRole('dialog').innerText(),/5,7/);await popup.getByRole('button',{name:'Cancelar',exact:true}).click();
  await popup.close();await drawer.getByRole('button',{name:'Fechar sensores'}).click();
  // Tendências/CSV recebem a altura confirmada; não recalculam a reta no frontend.
  await page.evaluate(()=>{snapshot.hardware.serial.connected=true;socket.push();});
  await page.getByRole('button',{name:'Tendências e dados',exact:true}).click();
  await page.locator('.tv-rec').click();await page.waitForTimeout(300);
  await page.evaluate(()=>{snapshot.levelSensors.LI1.heightCm=null;snapshot.levelSensors.LI1.status='outside_calibration';socket.push();});
  await page.waitForTimeout(300);await page.locator('.tv-rec').click();
  const trendsPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Destacar tendências',exact:true}).click();const trendsPopup=await trendsPopupPromise;
  const [download]=await Promise.all([trendsPopup.waitForEvent('download'),trendsPopup.locator('.tv-csv').click()]);
  const stream=await download.createReadStream();const parts=[];for await(const p of stream)parts.push(p);const csv=Buffer.concat(parts).toString('utf8');
  assert.match(csv,/2,85/);assert.match(csv,/outside_calibration/);
  assert.ok(await page.evaluate(()=>sent.every(m=>['hello','manual_position','level_zero'].includes(m.type))));
  assert.deepEqual(errors,[]);console.log('PASS: canais JIC, HV RO/CTRL desarmado, rascunhos, ACK, multiponto drawer/popout, offline e CSV sem comandos físicos');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
