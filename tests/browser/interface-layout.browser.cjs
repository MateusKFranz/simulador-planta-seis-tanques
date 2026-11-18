// Execute com Vite ativo; PLAYWRIGHT_MODULE e BROWSER_PATH são opcionais.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
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
                levelSensors: { LI1: { heightCm: 12, status: 'available' }, LI3:{heightCm:13,status:'available'}, LI4:{heightCm:14,status:'available'} },
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
        await page.goto(process.env.HMI_TEST_URL || 'http://127.0.0.1:5182');
        await page.waitForTimeout(500);
        assert.ok(await page.locator('#start-pause-button').isDisabled());
        assert.ok(await page.locator('#reset-button').isDisabled());
        const immediate = await page.evaluate(() => {
            window.holdSnapshot = false; window.socket.push();
            return { disabled: document.querySelector('#start-pause-button').disabled,
                label: document.querySelector('#start-pause-button').textContent };
        });
        assert.equal(immediate.disabled, false);
        assert.equal(immediate.label.trim(), 'Iniciar');
        await page.locator('#reset-button').click();
        assert.deepEqual(await page.evaluate(() => sent.at(-1)), {type:'sim', reset:true});
        await page.evaluate(() => socket.push());
        assert.equal((await page.locator('#start-pause-button').innerText()).trim(), 'Iniciar');
        await page.locator('#start-pause-button').click();
        assert.deepEqual(await page.evaluate(() => sent.at(-1)), {type:'sim', running:true});
        await page.evaluate(() => { snapshot.sim.running=true; socket.push(); });
        assert.equal((await page.locator('#start-pause-button').innerText()).trim(), 'Pausar');
        await page.locator('#start-pause-button').click();
        assert.deepEqual(await page.evaluate(() => sent.at(-1)), {type:'sim', running:false});
        await page.evaluate(() => { snapshot.sim.running=false; socket.push(); window.holdVisualPoll=false; });
        assert.equal((await page.locator('#start-pause-button').innerText()).trim(), 'Iniciar');
        assert.equal(await page.locator('.sidebar .op-actuators').count(), 0);
        assert.equal(await page.locator('.sidebar .op-times').count(), 0);
        assert.equal(await page.locator('.sidebar #sidebar-scenario').count(), 1);
        assert.equal(await page.locator('.sidebar .op-requirements').count(),0);
        assert.equal(await page.locator('.code-panel, .code-open, #controller-source').count(),0);
        assert.equal(await page.getByText('Ativar automático',{exact:true}).count(),0);
        assert.equal(await page.locator('.op-state').count(),0);
        assert.equal(await page.getByRole('button',{name:'Modo de operação',exact:true}).count(),0);
 assert.ok(await page.locator('.sidebar .component-controls-panel').isVisible());
        for(const title of ['Bombas','Válvulas 3 vias','Válvulas atuadas','Válvulas manuais']) {
            const toggle=page.locator('.component-controls-panel section:not([hidden])').getByRole('button',{name:title,exact:true});
            assert.equal(await toggle.getAttribute('aria-expanded'),'false');
            await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
        }
        assert.equal(await page.locator('.actuator-shortcuts [aria-expanded="true"]').count(),4);
        assert.equal(await page.locator('.actuator-shortcut').count(),18);
        assert.equal(await page.locator('.actuator-shortcuts input[type="range"]').count(),16);
        for(const id of ['JIC1','JIC3','JIC4','LV1','LV2','LV3','LV4']) {
            const slider=page.locator(`.actuator-card[data-id="${id}"] input[type="range"]`);
            assert.equal(await slider.getAttribute('min'),'0');
            assert.equal(await slider.getAttribute('max'),id.startsWith('JIC')?'255':'100');
            assert.equal(await slider.getAttribute('step'),'1');
        }
        assert.equal(await page.locator('.actuator-card[data-id^="OY"] input[type="range"]').count(),0);
        await page.locator('#sidebar-scenario').selectOption('vazao');
        assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'scenario',id:'vazao'});
        assert.equal(await page.locator('#sidebar-scenario').inputValue(),'nivel');
        await page.evaluate(()=>{snapshot.scenario='vazao';socket.push();});
        assert.equal(await page.locator('#sidebar-scenario').inputValue(),'vazao');
        assert.equal(await page.locator('#control-scenario').inputValue(),'vazao');
        await page.getByRole('button',{name:'Cenários',exact:true}).click();
        assert.ok(await page.locator('.automation-panel .op-requirements').isVisible());
        await page.locator('.automation-panel button[data-loop="LIC1"]').click();
        assert.ok(await page.locator('.automation-panel .loop-faceplate').isVisible());
        await page.locator('.loop-faceplate summary').click();
        assert.ok(await page.locator('.automation-panel [data-field="td"]').isEnabled());
        assert.equal(await page.locator('[data-field="type"]').count(),0);
        await page.evaluate(()=>{
            for(const [tag,mv] of [['LIC3','LV1'],['LIC4','LV2']])
                snapshot.loops[tag]={...snapshot.loops.LIC1,tag,sp:10,mvTarget:{id:mv}};
            socket.push();
        });
        for(const tag of ['LIC3','LIC4']) {
            await page.locator(`.automation-panel button[data-loop="${tag}"]`).click();
            await page.locator('.loop-faceplate [data-field="sp"]').fill('11');
            await page.getByRole('button',{name:'Aplicar alterações',exact:true}).click();
            assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'loop',id:tag,sp:11});
        }
        await page.locator('#control-scenario').selectOption('nivel');
        assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'scenario',id:'nivel'});
        await page.evaluate(()=>{snapshot.scenario='nivel';socket.push();});
        assert.equal(await page.locator('#sidebar-scenario').inputValue(),'nivel');
        assert.equal(await page.evaluate(()=>snapshot.operation.mode),'MANUAL');
        for(const width of [800,920,1366,1920]) {
            await page.setViewportSize({width,height:900});
            const bounds=await page.locator('.automation-panel').boundingBox();
            assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
        }
        await page.setViewportSize({width:1600,height:1000});
        if(process.env.HMI_SCREENSHOT) await page.screenshot({path:process.env.HMI_SCREENSHOT.replace('.png','-scenarios.png')});
        await page.getByRole('button',{name:'Fechar Cenários'}).click();
        const manual=page.locator('.op-buttons [data-mode="MANUAL"]');
        const automatic=page.locator('.op-buttons [data-mode="AUTO"]');

        assert.equal(await manual.getAttribute('aria-pressed'),'true');
        assert.equal(await automatic.getAttribute('aria-pressed'),'false');
        await automatic.click();
        assert.equal(await manual.getAttribute('aria-pressed'),'true');
        await page.evaluate(()=>{snapshot.operation.mode='AUTO';socket.push();});
        assert.equal(await automatic.getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('.op-buttons .is-active').count(),1);
        await page.evaluate(()=>{snapshot.operation.mode='MANUAL';socket.push();});
        assert.equal(await manual.getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('.sidebar #simulation-speed').count(),0);
        assert.equal(await page.locator('.sidebar #initial-level-section').count(),0);
        assert.equal(await page.locator('.sidebar #capacity-section').count(),0);
        assert.equal(await page.locator('.component-controls-panel [data-id^="HV"]').count(),9);
        await page.getByRole('button',{name:'Configurações da interface'}).click();
        const settings=page.locator('.settings-panel');
        assert.equal(await settings.locator('#simulation-speed').count(),1);
        for(const title of ['Níveis iniciais dos tanques','Capacidade dos tanques']) {
            const toggle=settings.getByRole('button',{name:title,exact:true});
            assert.equal(await toggle.getAttribute('aria-expanded'),'false');
            await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
        }

        assert.match(await settings.locator('#initial-level-section').innerText(),/Níveis iniciais dos tanques/);
        assert.equal(await settings.locator('#capacity-controls input').count(),6);
        assert.equal(await settings.locator('#capacity-controls input').first().inputValue(),'1.825');
        assert.ok(await settings.locator('#capacity-controls input').first().isDisabled());
        await settings.locator('#simulation-speed').selectOption('2');
        assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'sim',speed:2});
        await page.evaluate(()=>{snapshot.sim.speed=2;socket.push();});
        const initial=settings.locator('#initial-level-controls input[type="range"]').first();
        await initial.evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});
        assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'sim',levels:{TQ1:10}});
        await page.evaluate(()=>{snapshot.sim.initialLevels.TQ1=10;socket.push();});
        assert.equal(await initial.inputValue(),'40');
        for(const width of [800,1600]) {
            await page.setViewportSize({width,height:900});
            const box=await settings.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width);
        }
        await settings.locator('#sidebar-font-increase').click();
        await settings.locator('#sidebar-font-increase').click();
        await page.getByRole('button',{name:'Fechar Configurações'}).click();
        await page.setViewportSize({width:1600,height:1000});
        const faceplate = page.locator('.actuator-faceplate');
        const active = faceplate.locator('.op-actuators > details:not([hidden])');
        const beforeSliders=await page.evaluate(()=>sent.length);
        const side=page.locator('.actuator-card[data-id="JIC1"]');
        const sideSlider=side.locator('input[type="range"]');
        await sideSlider.fill('150');
        assert.match(await side.locator('.sidebar-desired').innerText(),/58,8/);
        assert.equal(await page.evaluate(()=>sent.length),beforeSliders);
        await page.getByRole('button',{name:'Abrir JIC1',exact:true}).click();
        assert.equal(await active.locator('.value').inputValue(),'150');
        assert.equal(await active.locator('input[type="range"]').inputValue(),'150');
        await active.locator('.value').fill('180');
        assert.equal(await sideSlider.inputValue(),'180');
        assert.equal(await active.locator('input[type="range"]').inputValue(),'180');
        await page.evaluate(()=>{snapshot.pumps.JIC1.command=.2;socket.push();});
        assert.equal(await sideSlider.inputValue(),'180');
        assert.match(await active.locator('.confirmed').innerText(),/51/);
        await active.getByRole('button',{name:'Descartar',exact:true}).click();
        assert.equal(await sideSlider.inputValue(),'51');
        assert.equal(await active.locator('.value').inputValue(),'51');
        await active.locator('input[type="range"]').fill('150');
        assert.equal(await sideSlider.inputValue(),'150');
        assert.equal(await page.evaluate(()=>sent.length),beforeSliders);
        await faceplate.getByRole('button',{name:'Fechar equipamento'}).click();
        await side.getByRole('button',{name:'Aplicar',exact:true}).click();
        assert.equal(await page.evaluate(()=>sent.length),beforeSliders+1);
        assert.equal(await page.evaluate(()=>sent.at(-1).command),150/255);
        await page.evaluate(()=>{snapshot.pumps.JIC1.command=150/255;socket.push();});
        for(const width of [800,920,1366,1920]) {
            await page.setViewportSize({width,height:1000});
            const box=await sideSlider.boundingBox(), card=await side.boundingBox();
            assert.ok(box.x>=card.x && box.x+box.width<=card.x+card.width+1);
        }
        await page.setViewportSize({width:1600,height:1000});
        const oySide=page.locator('.actuator-card[data-id="OY1"]');
        await oySide.getByRole('button',{name:'A OFF / B ON',exact:true}).click();
        await page.getByRole('button',{name:'Abrir OY1',exact:true}).click();
        assert.equal(await active.locator('[data-state="B"]').getAttribute('aria-pressed'),'true');
        assert.equal(await active.locator('input[type="range"]').count(),0);
        await active.getByRole('button',{name:'Descartar',exact:true}).click();
        assert.equal(await oySide.locator('[data-state="A"]').getAttribute('aria-pressed'),'true');
        await faceplate.getByRole('button',{name:'Fechar equipamento'}).click();
        const count = await page.evaluate(() => sent.length);
        for(const id of ['JIC1','JIC3','JIC4','OY1','OY2','LV1','LV2','LV3','LV4']) {
            await page.getByRole('button',{name:`Abrir ${id}`,exact:true}).click();
            assert.match(await faceplate.locator('.actuator-title').innerText(),new RegExp(id));
            await faceplate.getByRole('button',{name:'Fechar equipamento'}).click();
        }
        await page.getByRole('button',{name:'Abrir JIC1',exact:true}).click();
        await active.locator('.value').fill('111');
        await faceplate.getByRole('button',{name:'Fechar equipamento'}).click();
        await page.locator('[data-type="app.Pump"]').filter({hasText:'JIC1'}).click();
        assert.equal(await active.locator('.value').inputValue(),'111');
        await page.evaluate(()=>{snapshot.operation.mode='AUTO';snapshot.operation.fixed={pumps:{JIC1:.4}};socket.push();});
        assert.ok(await active.getByRole('button',{name:'Aplicar',exact:true}).isDisabled());
        assert.ok(await sideSlider.isDisabled());
        assert.ok(await active.locator('input[type="range"]').isDisabled());
        assert.match(await page.locator('[data-actuator="JIC1"] small').innerText(),/AUTO/);
        await page.evaluate(()=>{snapshot.operation.mode='MANUAL';snapshot.operation.fixed={};socket.push();});
        await faceplate.getByRole('button',{name:'Fechar equipamento'}).click();

        for (const [type, id] of [['Pump','JIC1'], ['Pump','JIC3'], ['Pump','JIC4'], ['ActuatedValve','LV1'], ['ActuatedValve','LV2'], ['ActuatedValve','LV3'], ['ActuatedValve','LV4'], ['ThreeWayValve','OY1'], ['ThreeWayValve','OY2'],['ManualValve','HV1'],['ManualValve','HV7'],['MainValve','HV9']]) {
            await page.locator(`[data-type="app.${type}"]`).filter({ hasText: id }).click();
            assert.match(await faceplate.locator('.actuator-title').innerText(), new RegExp(id));
            const component=await page.locator(`[data-type="app.${type}"]`).filter({hasText:id}).boundingBox();
            const editor=await faceplate.boundingBox();
            assert.ok(editor.x>=8 && editor.x+editor.width<=1600 && editor.y>=8 && editor.y+editor.height<=1000);
            assert.ok(editor.x>=component.x+component.width || editor.x+editor.width<=component.x, `${id}: editor ao lado do componente`);
            assert.equal(await active.locator('input[type="range"]').count(),id.startsWith('OY')?0:1);
            assert.match(await active.locator('.confirmed').innerText(), /atual/);
            if (id.startsWith('OY')) {
                await active.getByRole('button', { name: 'A OFF / B ON', exact: true }).click();
                assert.match(await active.locator('.requested').innerText(), /Estado desejado: A OFF \/ B ON/);
                assert.match(await active.locator('.confirmed').innerText(), /A ON \/ B OFF/);
            } else { await active.locator('.value').fill('60'); }
            await page.waitForTimeout(120);
            assert.equal(await page.evaluate(() => sent.length), count);
            await faceplate.getByRole('button', { name: 'Fechar equipamento' }).click();
        }
        await page.locator('[data-type="app.Pump"]').filter({ hasText: 'JIC1' }).click();
        await active.locator('.value').fill('150');
        if (process.env.HMI_SCREENSHOT) await page.screenshot({ path: process.env.HMI_SCREENSHOT });
        await active.getByRole('button', { name: 'Aplicar', exact: true }).click();
        assert.equal(await page.evaluate(() => sent.length), count + 1);
        await faceplate.getByRole('button', { name: 'Fechar equipamento' }).click();
        // Dimensoes antigas nao persistem; controles continuam acessiveis em tela pequena.
        await page.setViewportSize({width:320,height:300});
        await faceplate.evaluate(el=>{el.style.width='900px';el.style.height='900px';});
        for(const id of ['JIC1','LV1','OY1','HV1']) {
            await page.evaluate(id=>document.dispatchEvent(new CustomEvent('operation-actuator',{detail:{id,anchor:{left:295,right:315,top:275,height:20}}})),id);
            const rect=await faceplate.boundingBox();
            assert.ok(rect.x>=8 && rect.y>=8 && rect.x+rect.width<=312 && rect.y+rect.height<=292);
            assert.equal(await faceplate.evaluate(el=>el.style.width),'');
            assert.equal(await faceplate.evaluate(el=>el.style.height),'');
            assert.equal(await faceplate.evaluate(el=>getComputedStyle(el).resize),'none');
            assert.ok(await faceplate.evaluate(el=>el.scrollWidth<=el.clientWidth));
            await active.getByRole('button',{name:'Descartar',exact:true}).scrollIntoViewIfNeeded();
            await active.getByRole('button',{name:'Descartar',exact:true}).click();
            await faceplate.getByRole('button',{name:'Fechar equipamento'}).click();
        }
        assert.equal(await page.locator('.floating-editor-resize,.component-editor-resize').count(),0);
        await page.setViewportSize({width:1600,height:1000});
        await page.getByRole('button', { name: 'Configurações da interface' }).click();
        assert.ok(await page.locator('.settings-panel').isVisible());
        assert.ok(await page.locator('.settings-panel #sidebar-font-increase').isVisible());
        await page.getByRole('button', { name: 'Fechar Configurações' }).click();

        await page.getByRole('button', { name: 'Cenários', exact:true }).click();
        assert.ok(await page.locator('.automation-panel #control-scenario').isVisible());
        assert.ok(await page.locator('.automation-panel .op-times').isVisible());
        await page.getByRole('button', { name: 'Fechar Cenários' }).click();
        await page.locator('.sidebar-toggle').evaluate(el=>el.click());
        assert.ok(await page.locator('.sidebar').isHidden());
        await page.locator('.sidebar-toggle').evaluate(el=>el.click());
        assert.ok(await page.locator('.sidebar').isVisible());
        const levelLabels=await page.locator('[data-type="app.LevelSensor"]').allTextContents();
        for(const id of ['LI3','LI4']) assert.ok(levelLabels.some(text=>text.includes(id)));
        assert.ok(levelLabels.every(text=>!text.includes('LIC3')&&!text.includes('LIC4')));
        const width = await page.locator('#paper').evaluate(el => el.clientWidth);
        await page.locator('[data-type="app.LevelSensor"]').filter({ hasText: 'LI3' }).click();
        await page.waitForTimeout(150);
        const smaller = await page.locator('#paper').evaluate(el => el.clientWidth);
        assert.ok(smaller < width);
        const popupPromise = page.waitForEvent('popup');
        await page.getByRole('button', { name: 'Destacar sensores' }).click();
        const popup = await popupPromise;
        popup.on('pageerror', e => errors.push(e.message));
        await popup.waitForSelector('.sensor-drawer-primary');
        assert.match(await popup.locator('.sensor-drawer-primary').innerText(), /13,0 cm/);
        assert.equal(await popup.locator('script').count(), 0);
        assert.equal(await popup.locator('.operation-controls').count(), 0);
        await page.getByRole('button', { name: 'Fechar sensores' }).click();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('#paper').evaluate(el => el.clientWidth), width);
        await page.evaluate(() => { snapshot.levelSensors.LI3.heightCm = 14; socket.push(); });
        await page.waitForTimeout(150);
        assert.match(await popup.locator('.sensor-drawer-primary').innerText(), /14,0 cm/);
        await popup.close();
        await page.locator('[data-type="app.FlowSensor"]').filter({ hasText: 'FI1' }).click();
        assert.match(await page.locator('.sensor-drawer-title').innerText(), /VAZÕES/);
        const secondPromise = page.waitForEvent('popup');
        await page.getByRole('button', { name: 'Destacar sensores' }).click();
        const second = await secondPromise;
        await page.reload(); await page.waitForTimeout(200);
        assert.ok(second.isClosed());
        assert.deepEqual(errors, []);
        console.log('PASS: faceplates, drafts, configurações, automação, popup, atualização e auto-fit');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
