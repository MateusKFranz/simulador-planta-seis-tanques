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
            window.snapshot = {
                mode: 'MODELICA', operation: { mode: 'MANUAL', fixed: {}, autoBlocked: [] },
                pumps: Object.fromEntries(['JIC1','JIC3','JIC4'].map(id => [id, { command: .4, power: true }])),
                actuatedValves: Object.fromEntries(['LV1','LV2','LV3','LV4'].map(id => [id, { opening: .4 }])),
                threeWayValves: Object.fromEntries(['OY1','OY2'].map(id => [id, { branches: { A: { state: true }, B: { state: false } } }])),
                levelSensors: { LI1: { heightCm: 12, status: 'available' } },
                flowSensors: { FI1: { flow: 1.4, status: 'available' } },
                scenarios: [{ id: 'nivel', nome: 'Nível' }], scenario: 'nivel',
                sim: { t: 0, running: false, speed: 1 }, xv: { OY1: { tA: 3, tB: 2 }, OY2: { tA: 2, tB: 3 } }, loops: {}
            };
            window.WebSocket = class {
                static OPEN = 1; static CONNECTING = 0;
                constructor() { this.readyState = 0; this.events = {}; setTimeout(() => { this.readyState = 1; this.events.open?.(); this.push(); }, 50); window.socket = this; }
                addEventListener(name, callback) { this.events[name] = callback; }
                push() { this.events.message?.({ data: JSON.stringify({ type: 'state', data: window.snapshot }) }); }
                send(raw) { window.sent.push(JSON.parse(raw)); }
            };
        });
        await page.goto(process.env.HMI_TEST_URL || 'http://127.0.0.1:5182');
        await page.waitForTimeout(400);
        await page.evaluate(() => { for(let t=0;t<=1000;t+=2) { snapshot.sim.t=t;socket.push(); } });
        const open=page.getByRole('button',{name:'Tendências e dados',exact:true});
        await open.click();await page.waitForTimeout(150);
        const panel=page.locator('.trends-view'), handle=page.locator('.tv-resize-handle');
        const state=async view=>view.locator('.trends-view').evaluate(el=>({duration:Number(el.dataset.duration),start:Number(el.dataset.start),end:Number(el.dataset.end),follow:el.dataset.follow==='true'}));
        const near=(a,b,tolerance=.1)=>assert.ok(Math.abs(a-b)<tolerance, a+' != '+b);
        const paperHeight=()=>page.locator('#paper').evaluate(el=>el.clientHeight);
        const initialPaper=await paperHeight(), initialPanel=(await panel.boundingBox()).height;
        let r=await handle.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+3);await page.mouse.down();await page.mouse.move(r.x+r.width/2,r.y-80,{steps:6});await page.mouse.up();await page.waitForTimeout(150);
        assert.ok((await panel.boundingBox()).height>initialPanel);assert.ok(await paperHeight()<initialPaper);
        r=await handle.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+3);await page.mouse.down();await page.mouse.move(r.x+r.width/2,r.y+60,{steps:6});await page.mouse.up();await page.waitForTimeout(150);
        assert.ok(await paperHeight()>initialPaper-80);
        assert.ok(Number(await page.evaluate(()=>localStorage.getItem('trends-panel-height')))>0);
        assert.equal(await page.locator('.tv-select option[value="3600"]').count(),0);
        await page.locator('.tv-select').selectOption('15');
        near((await state(page)).duration,15);
        const zoomBox=await page.locator('.tv-canvas').first().boundingBox();
        await page.mouse.move(zoomBox.x+100,zoomBox.y+50);
        for(let i=0;i<15;i++) { await page.mouse.wheel(0,1000);await page.waitForTimeout(35); }
        near((await state(page)).duration,3600);
        await page.locator('.tv-select').selectOption('120');
        const geometry=async view=>{const b=await view.locator('.tv-canvas').first().boundingBox();return {x:b.x+50,width:b.width-98,y:b.y+45};};
        let g=await geometry(page);await page.mouse.move(g.x+g.width*.4,g.y);
        await page.mouse.wheel(0,-30);await page.waitForTimeout(120);
        let v=await state(page);assert.ok(v.follow && v.duration<120 && v.duration>100);near(v.end,1000);
        const d=v.duration;const pageScale=await page.evaluate(()=>window.innerWidth);
        await page.keyboard.down('Control');await page.mouse.wheel(0,120);await page.keyboard.up('Control');await page.waitForTimeout(120);
        v=await state(page);near(v.duration,d);assert.ok(!v.follow && v.end<1000);assert.equal(await page.evaluate(()=>window.innerWidth),pageScale);
        // O evento sob o cursor fica no mesmo ponto durante zoom no histórico.
        const anchor=v.start+v.duration*.4;
        await page.mouse.wheel(0,-10);await page.waitForTimeout(120);v=await state(page);near(v.start+v.duration*.4,anchor,1);
        const before=v;await page.mouse.down();await page.mouse.move(g.x+g.width*.4+80,g.y,{steps:8});await page.mouse.up();await page.waitForTimeout(120);
        v=await state(page);near(v.end,before.end-80*before.duration/g.width,.2);near(v.duration,before.duration);
        // Captura mantém o gesto fora do canvas e encerra após soltar.
        await page.mouse.down();await page.mouse.move(g.x+g.width*.4+110,20,{steps:5});await page.mouse.up();await page.waitForTimeout(100);
        const stopped=await state(page);await page.mouse.move(g.x,g.y);await page.waitForTimeout(100);near((await state(page)).end,stopped.end);
        assert.equal(await page.locator('.tv-sub.dragging').count(),0);
        await page.evaluate(()=>{snapshot.sim.t=1010;socket.push();});await page.waitForTimeout(100);near((await state(page)).end,stopped.end);
        await page.getByRole('button',{name:'Voltar ao mais recente',exact:true}).click();v=await state(page);near(v.end,1010);near(v.duration,stopped.duration);assert.ok(v.follow);
        await page.mouse.move(g.x+g.width*.4,g.y);await page.mouse.wheel(0,-10);await page.waitForTimeout(100);v=await state(page);assert.ok(v.follow);near(v.end,1010);
        g=await geometry(page);await page.mouse.move(g.x+g.width*.4,g.y);
        await page.keyboard.down('Control');await page.mouse.wheel(0,80);await page.keyboard.up('Control');await page.waitForTimeout(100);
        assert.equal((await state(page)).follow,false);
        await page.locator('.tv-name').fill('ensaio preservado');await page.locator('.tv-rec').click();
        await page.locator('.tv-legend-row input').first().uncheck();
        await page.evaluate(()=>{snapshot.sim.t=1012;socket.push();});await page.waitForTimeout(120);
        const saved=await state(page), count=await page.locator('.tv-count').innerText();
        const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Destacar tendências'}).click();const popup=await popupPromise;
        popup.on('pageerror',e=>errors.push(e.message));await popup.waitForSelector('.tv-canvas');await page.waitForTimeout(120);
        assert.deepEqual(await state(popup),saved);assert.equal(await popup.locator('.tv-name').inputValue(),'ensaio preservado');assert.equal(await popup.locator('.tv-count').innerText(),count);assert.ok(!(await popup.locator('.tv-legend-row input').first().isChecked()));
        assert.ok(await paperHeight()>initialPaper);assert.equal(await popup.locator('script').count(),0);
        await page.evaluate(()=>{snapshot.sim.t=1014;socket.push();});await popup.waitForTimeout(120);
        assert.match(await popup.locator('.tv-count').innerText(),/2 linhas gravando/);
        assert.deepEqual(await state(popup),saved);
        await popup.setViewportSize({width:1000,height:700});await popup.waitForTimeout(150);
        assert.ok((await popup.locator('.tv-canvas').first().boundingBox()).width>100);
        assert.deepEqual(await state(popup),saved);
        g=await geometry(popup);await popup.mouse.move(g.x+g.width*.5,g.y);await popup.mouse.wheel(0,-20);await popup.waitForTimeout(100);
        const zoomed=await state(popup);assert.ok(zoomed.duration<saved.duration);
        await popup.mouse.down();await popup.mouse.move(g.x+g.width*.5+50,g.y,{steps:4});await popup.mouse.up();await popup.waitForTimeout(100);
        const moved=await state(popup);near(moved.end,zoomed.end-50*zoomed.duration/g.width,.2);
        const pages=page.context().pages().length;await open.click();assert.equal(page.context().pages().length,pages);
        await page.getByRole('button',{name:'Reacoplar tendências',exact:true}).click();await page.waitForTimeout(150);
        assert.ok(popup.isClosed());assert.deepEqual(await state(page),moved);assert.equal(await page.locator('.tv-name').inputValue(),'ensaio preservado');assert.ok(await page.locator('.tv-rec').evaluate(el=>el.classList.contains('recording')));
        const nextPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Destacar tendências'}).click();const next=await nextPromise;await next.waitForSelector('.tv-canvas');await next.close();await page.waitForTimeout(100);await open.click();await page.waitForTimeout(100);assert.deepEqual(await state(page),moved);
        // Reacoplar também pela própria popup.
        const thirdPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Destacar tendências'}).click();const third=await thirdPromise;await third.getByRole('button',{name:'Reacoplar tendências',exact:true}).click();await page.waitForTimeout(100);assert.deepEqual(await state(page),moved);
        if(process.env.HMI_SCREENSHOT) await page.screenshot({path:process.env.HMI_SCREENSHOT});
        const exportPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Destacar tendências'}).click();const exporting=await exportPromise;
        await exporting.locator('.tv-rec').click();
        const downloadPromise=exporting.waitForEvent('download');await exporting.locator('.tv-csv').click();const download=await downloadPromise;
        assert.match(download.suggestedFilename(),/ensaio_preservado.*\.csv$/);
        const stream=await download.createReadStream();const parts=[];for await(const part of stream)parts.push(part);
        const csv=Buffer.concat(parts).toString('utf8');assert.ok(csv.includes('1012') && csv.includes('1014'));
        assert.ok(csv.includes('LI3') && csv.includes('LI4'));
        assert.ok(!csv.includes('LIC3') && !csv.includes('LIC4'));
        await exporting.getByRole('button',{name:'Reacoplar tendências',exact:true}).click();
        const closingPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Destacar tendências'}).click();const closing=await closingPromise;
        await closing.waitForSelector('.tv-canvas');await page.reload();await page.waitForTimeout(250);assert.ok(closing.isClosed());
        assert.deepEqual(errors,[]);
        console.log('PASS: resize, auto-fit, wheel, âncora, drag, Ctrl, follow, registro, popup, focus e reacoplar');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
