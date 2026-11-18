const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const engine = process.env.TEST_FIREFOX ? firefox : chromium;
 const browser = await engine.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH}: {})});
 try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(() => {
            window.sent = [];
            window.holdSnapshot = true;
            window.holdVisualPoll = true;
            const interval = window.setInterval.bind(window);
            window.setInterval = (fn, ms, ...args) => interval(() => {
                if (ms !== 100 || !window.holdVisualPoll) fn(...args);
            }, ms);
            window.snapshot = {
                mode: 'MODELICA', operation: { mode: 'MANUAL', fixed: {}, autoBlocked: [] },
                pumps: Object.fromEntries(['JIC1','JIC3','JIC4'].map(id => [id, { command: .4, power: true }])),
                actuatedValves: Object.fromEntries(['LV1','LV2','LV3','LV4'].map(id => [id, { opening: .4 }])),
                manualValves: Object.fromEntries(Array.from({length:6},(_,i)=>[`HV${i+1}`,{opening:.4}])),
                recycleValves: {HV7:{opening:.4},HV8:{opening:.4}}, mainValve:{opening:.4},
                threeWayValves: Object.fromEntries(['OY1','OY2'].map(id => [id, { branches: { A: { state: true }, B: { state: false } } }])),
                levelSensors: { LI1: { heightCm: 12, status: 'available' } },
                flowSensors: { FI1: { flow: 1.4, status: 'available' } },
                scenarios: [{ id: 'nivel', nome: 'Nível' }, {id:'vazao',nome:'Vazão'}], scenario: 'nivel',
                tanks: Object.fromEntries(['TQ1','TQ2','TQ3','TQ4','TQ5','TQ6'].map(id=>[id,{capacityL:1.825}])),
                sim: { t: 0, running: false, speed: 1, tankHeightCm:25, initialLevels:{TQ1:0} }, xv: { OY1: { tA: 3, tB: 2 }, OY2: { tA: 2, tB: 3 } }, loops: {'LIC1':{tag:'LIC1',mode:'AUTO',effectiveMode:'AUTO',pv:12,sp:15,mv:.4,unit:'cm',mvTarget:{id:'LV1'},kp:1,ti:10,td:0,b:1,c:1,n:10,ftt:1,uBias:0,uMin:0,uMax:1}}
            };
            window.WebSocket = class {
                static OPEN = 1; static CONNECTING = 0;
                constructor() { this.readyState = 0; this.events = {}; setTimeout(() => { this.readyState = 1; this.events.open?.(); this.push(); }, 50); window.socket = this; }
                addEventListener(name, callback) { this.events[name] = callback; }
                push() { if (window.holdSnapshot) return; this.events.message?.({ data: JSON.stringify({ type: 'state', data: window.snapshot }) }); }
                send(raw) { window.sent.push(JSON.parse(raw)); }
            };
        });
 await page.goto(process.env.HMI_TEST_URL || 'http://127.0.0.1:5183');
 await page.waitForTimeout(200);
 await page.evaluate(()=>{holdSnapshot=false;holdVisualPoll=false;socket.push();});
 const panel=page.locator('.component-controls-panel');
 const card=id=>panel.locator(`.actuator-card[data-id="${id}"]`);
 const edit=async(id,value)=>card(id).locator('input[type="range"]').fill(String(value));
 const count=()=>page.evaluate(()=>sent.length);
 assert.equal(await page.getByRole('button',{name:'Modo de operação',exact:true}).count(),0);
 assert.ok(await page.locator('[data-mode="MANUAL"]').isVisible());
 assert.deepEqual(await page.evaluate(()=>sent.map(m=>m.type)),['hello']);
 assert.ok(await page.locator('.sidebar .component-controls-panel').isVisible());
 assert.ok(await panel.locator('.apply-all').isDisabled());
 for(const title of ['Bombas','Válvulas atuadas','Válvulas 3 vias','Válvulas manuais']) await panel.getByRole('button',{name:title,exact:true}).click();
 let before=await count();
 assert.ok(await panel.locator('.apply-all').isVisible());
 const bulk=await panel.locator('.component-bulk').boundingBox(), bounds=await panel.boundingBox();
 assert.ok(bulk.y>=bounds.y && bulk.y+bulk.height<=bounds.y+bounds.height);
 if(process.env.HMI_SCREENSHOT) await page.screenshot({path:process.env.HMI_SCREENSHOT+'.components.png'});
 // HV compartilha rascunho com o editor e aguarda confirmação.
 for(const id of ['HV1','HV7','HV9']) await edit(id,55);
 assert.match(await panel.locator('.draft-count').innerText(),/3 alterações/);
 assert.equal(await count(),before);
 await panel.locator('[data-actuator="HV1"]').click();
 const hvFace=page.locator('.actuator-faceplate');
 assert.equal(await hvFace.locator('details:not([hidden]) .value').inputValue(),'55');
 await hvFace.locator('details:not([hidden]) .value').fill('60');
 assert.equal(await card('HV1').locator('input[type="range"]').inputValue(),'60');
 const header=await hvFace.locator('header').boundingBox();
 const original=await hvFace.boundingBox();
 await page.mouse.move(header.x+40,header.y+15);await page.mouse.down();
 await page.mouse.move(header.x-60,header.y+45);await page.mouse.up();
 const movedFace=await hvFace.boundingBox();assert.ok(Math.abs(movedFace.x-original.x)>20);
 assert.equal(await page.locator('.floating-editor-resize, .component-editor-resize').count(),0);
 assert.equal(await hvFace.evaluate(el=>getComputedStyle(el).resize),'none');
 assert.equal(movedFace.width,original.width);
 assert.equal(movedFace.height,original.height);
 // Arrastar o canto e usar setas fora dos campos nao muda as dimensoes.
 await page.mouse.move(movedFace.x+movedFace.width-3,movedFace.y+movedFace.height-3);
 await page.mouse.down();await page.mouse.move(movedFace.x+movedFace.width+50,movedFace.y+movedFace.height+50);await page.mouse.up();
 await hvFace.locator('header button').focus();await page.keyboard.press('ArrowRight');
 assert.equal((await hvFace.boundingBox()).width,original.width);
 assert.equal((await hvFace.boundingBox()).height,original.height);
 await hvFace.getByRole('button',{name:'Fechar equipamento'}).click();
 await panel.locator('.discard-all').click();
 for(const id of ['HV1','HV7','HV9']) assert.equal(await card(id).locator('input[type="range"]').inputValue(),'40');
 await edit('HV9',55);await card('HV9').locator('.apply').click();
 assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'valve',id:'HV9',opening:.55});
 await page.evaluate(()=>{snapshot.mainValve.opening=.55;socket.push();});
 assert.match(await panel.locator('.draft-count').innerText(),/0 alterações/);
 // O lote HV usa os comandos existentes e avança somente pelo snapshot.
 await edit('HV1',65);await edit('HV7',70);
 await panel.locator('.apply-all').click();
 assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'manual_valve',id:'HV1',opening:.65});
 await page.evaluate(()=>{snapshot.manualValves.HV1.opening=.65;socket.push();});
 await page.waitForFunction(()=>sent.at(-1).id==='HV7');
 assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'manual_valve',id:'HV7',opening:.7});
 await page.evaluate(()=>{snapshot.recycleValves.HV7.opening=.7;socket.push();});
 assert.match(await panel.locator('.draft-count').innerText(),/0 alterações/);
 before=await count();
 await edit('JIC1',150);await edit('JIC3',160);await edit('LV1',55);
 assert.match(await panel.locator('.draft-count').innerText(),/3 alterações/);
 await panel.locator('.discard-all').click();
 assert.equal(await count(),before);
 assert.equal(await card('JIC1').locator('input[type="range"]').inputValue(),'102');
 assert.match(await panel.locator('.draft-count').innerText(),/0 alterações/);
 // Mesmo nó no popup, rascunhos intactos e sem conexão extra.
 await edit('JIC1',150);
 await panel.evaluate(el=>el.dataset.identity='original');
 const popupPromise=page.waitForEvent('popup'); await panel.locator('.detach').click();
 const popup=await popupPromise; await popup.waitForLoadState();
 const detached=popup.locator('.component-controls-panel');
 assert.equal(await detached.getAttribute('data-identity'),'original');
 assert.equal(await page.locator('.actuator-card').count(),0);
 assert.equal(await detached.locator('[data-id="JIC1"] input[type="range"]').inputValue(),'150');
 assert.equal(await count(),before);
 await page.evaluate(()=>{snapshot.pumps.JIC4.command=.2;socket.push();});
 assert.match(await detached.locator('[data-actuator="JIC4"] small').innerText(),/51/);
 await popup.setViewportSize({width:320,height:500});
 assert.ok(await detached.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 if(process.env.HMI_SCREENSHOT) await popup.screenshot({path:process.env.HMI_SCREENSHOT+'.popup.png'});
 await detached.locator('.dock').click();
 await page.waitForTimeout(100);
 assert.equal(await panel.getAttribute('data-identity'),'original');
 assert.equal(await card('JIC1').locator('input[type="range"]').inputValue(),'150');
 const next=page.waitForEvent('popup');await panel.locator('.detach').click();const popup2=await next;
 await popup2.close();await page.waitForTimeout(100);assert.ok(await panel.isVisible());
 // Bloqueio de popups não perde o painel interno.
 await page.evaluate(()=>{window.savedOpen=window.open;window.open=()=>null;});
 await panel.locator('.detach').click();assert.match(await panel.locator('.popup-status').innerText(),/bloqueado/);
 await page.evaluate(()=>window.open=window.savedOpen);
 await panel.locator('.discard-all').click();
 await edit('JIC1',150);await edit('JIC3',160);await edit('LV1',55);
 await panel.locator('.apply-all').click();
 assert.equal(await count(),before+1);
 await page.waitForTimeout(250);assert.equal(await count(),before+1);
 assert.match(await panel.locator('.batch-status').innerText(),/JIC1: Aguardando/);
 await page.evaluate(()=>{snapshot.pumps.JIC1.command=150/255;socket.push();});
 await page.waitForTimeout(250);assert.equal(await count(),before+2);
 await page.evaluate(()=>{snapshot.pumps.JIC3.command=160/255;socket.push();});
 await page.waitForTimeout(250);assert.equal(await count(),before+3);
 await page.evaluate(()=>{snapshot.actuatedValves.LV1.opening=.55;socket.push();});
 await page.waitForTimeout(250);
 assert.match(await panel.locator('.batch-status').innerText(),/LV1: Confirmado/);
 assert.match(await panel.locator('.draft-count').innerText(),/0 alterações/);
 // Preflight não envia os outros itens quando há valor inválido.
 await edit('JIC3',180);
 await panel.locator('[data-actuator="LV1"]').click();
 const face=page.locator('.actuator-faceplate');
 await face.locator('details:not([hidden]) .value').fill('101');
 await face.getByRole('button',{name:'Fechar equipamento'}).click();
 const invalid=await count();assert.ok(await panel.locator('.apply-all').isDisabled());
 assert.equal(await count(),invalid);assert.match(await panel.locator('.batch-validation').innerText(),/LV1: Valor/);
 await panel.locator('.discard-all').click();
 await edit('LV1',60);
 await page.evaluate(()=>{snapshot.operation.mode='AUTO';socket.push();});
 assert.ok(await panel.locator('.apply-all').isDisabled());assert.equal(await count(),invalid);
 assert.match(await panel.locator('.batch-validation').innerText(),/autoridade automática/);
 await page.evaluate(()=>{snapshot.operation.mode='MANUAL';socket.push();});
 await panel.locator('.discard-all').click();
 // Confirmação parcial seguida de erro não envia o restante.
 await edit('JIC1',170);await edit('JIC3',180);await edit('LV1',60);
 await panel.locator('.apply-all').click();
 await page.evaluate(()=>{snapshot.pumps.JIC1.command=170/255;socket.push();});
 await page.waitForTimeout(200);
 const partial=await count();
 await page.evaluate(()=>{snapshot.sim.error='Falha simulada';socket.push();});
 await page.waitForTimeout(200);assert.equal(await count(),partial);
 assert.match(await panel.locator('.batch-status').innerText(),/JIC1: Confirmado/);
 assert.match(await panel.locator('.batch-status').innerText(),/LV1: Pendente/);
 assert.match(await panel.locator('.draft-count').innerText(),/2 alterações/);
 await panel.locator('.discard-all').click();assert.equal(await count(),partial);
 assert.ok(await page.locator('.sidebar .component-controls-panel').isVisible());
 await page.getByRole('button',{name:'Configurações da interface'}).click();
 for(const title of ['Níveis iniciais dos tanques','Capacidade dos tanques']) await page.locator('.settings-panel').getByRole('button',{name:title,exact:true}).click();
 assert.equal(await page.locator('#initial-level-controls input').first().evaluate(el=>getComputedStyle(el).padding),'0px');
 assert.ok(await page.locator('#capacity-controls input').first().isDisabled());
 for(const width of [400,800,1600]) {
   await page.setViewportSize({width,height:900});
   const box=await page.locator('.settings-panel').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
 }
 if(process.env.HMI_SCREENSHOT) await page.screenshot({path:process.env.HMI_SCREENSHOT});
 await page.getByRole('button',{name:'Fechar Configurações'}).click();
 assert.ok(await page.locator('.sidebar .component-controls-panel').isVisible());
 const closing=page.waitForEvent('popup');await panel.locator('.detach').click();const child=await closing;
 const closed=child.waitForEvent('close');await page.reload();await closed;
 assert.equal(await page.locator('.actuator-card').count(),18);
 assert.deepEqual(errors,[]);
 console.log('PASS: modo fixo, painel/popup, rascunhos compartilhados, lote sequencial, preflight, falha parcial e configurações compactas');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
