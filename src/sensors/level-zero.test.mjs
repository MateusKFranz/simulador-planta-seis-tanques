import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const load = async path => import(`data:text/javascript;base64,${Buffer.from(readFileSync(new URL(path, import.meta.url))).toString('base64')}`);
const { canCalibrateZero, createLevelZeroControls, parseMeasuredHeight } = await load('./level-zero-controls.js');
const { requestLevelZero, receiveLevelZero } = await load('./level-zero-client.js');
class Node {
    children = []; events = {}; textContent = ''; attributes = {};
    replaceChildren(...nodes) { this.children = nodes; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, v) { this.events[k] = v; }
    click() { if (!this.disabled) return this.events.click?.(); }
}
const sensor = () => ({ id: 'LI2', heightCm: 8.4, status: 'available', diagnostics: { rawMean50: 170.4, rawMeanCount: 10, valid: true, stale: false, zeroIsField: true } });
const runtime = () => ({ backendMode: 'HARDWARE', connected: true, hardware: { serial: { connected: true } } });
test('botão HARDWARE exige leitura fresca e média finita; MODELICA não calibra', () => {
    const s = sensor(), r = runtime();
    assert.ok(canCalibrateZero(s, r));
    for (let count=0;count<10;count++) assert.ok(!canCalibrateZero({...s, diagnostics:{...s.diagnostics,rawMeanCount:count}},r));
    for (const raw of [-1, 1024, null, undefined, NaN, Infinity, '170.4']) assert.ok(!canCalibrateZero({ ...s, diagnostics: { ...s.diagnostics, rawMean50: raw } }, r));
    for (const status of ['stale', 'invalid', 'unavailable']) assert.ok(!canCalibrateZero({ ...s, status }, r));
    assert.ok(!canCalibrateZero(s, { ...r, backendMode: 'MODELICA' }));
    assert.ok(!canCalibrateZero(s, { ...r, connected: false }));
    const ui = createLevelZeroControls({ createElement: () => new Node() }, () => assert.fail());
    ui.update(s, { ...r, backendMode: 'MODELICA' }); assert.ok(ui.element.hidden);
    ui.update(s, r); assert.ok(!ui.element.children[0].hidden);
    s.diagnostics.rawMean50 = null; ui.update(s, r); assert.ok(ui.element.children[0].disabled);
});
test('confirmar é obrigatório, envia média exibida e espera resultado sem otimismo', async () => {
    const calls = []; let resolve;
    const ui = createLevelZeroControls({ createElement: () => new Node() }, (...args) => { calls.push(args); return new Promise(r => resolve = r); });
    const s = sensor(), r = runtime(); ui.update(s, r);
    const [calibrate, restore, dialog, status] = ui.element.children;
    const [explanation, cancel, confirm] = dialog.children;
    calibrate.click(); assert.equal(calls.length, 0); assert.ok(!dialog.hidden);
    assert.equal(explanation.textContent, 'Registrar ponto de LI2?\nAltura física informada: 0 cm\nRAW capturado: 170,4');
    cancel.click(); assert.ok(dialog.hidden); assert.equal(calls.length, 0);
    calibrate.click(); const done = confirm.click();
    assert.deepEqual(calls, [['add', 'LI2', 170.4, {heightCm:0}]]);
    assert.match(status.textContent, /Aguardando/); assert.equal(s.heightCm, 8.4);
    resolve({ message: 'Zero de LI2 calibrado.' }); await done;
    assert.match(status.textContent, /calibrado/);
    restore.click(); assert.match(explanation.textContent, /Restaurar/);
    cancel.click(); assert.equal(calls.length, 1);
});
test('mudança da leitura não altera o RAW capturado; falha não aparece como sucesso', async () => {
    const calls = [];
    const ui = createLevelZeroControls({ createElement: () => new Node() }, (...args) => {
        calls.push(args);
        return calls.length === 1 ? Promise.resolve({ message: 'calibrado' }) : Promise.reject(new Error('falha ao salvar'));
    });
    const s = sensor(), r = runtime(); ui.update(s, r);
    const [calibrate, , dialog, status] = ui.element.children;
    calibrate.click();
    s.diagnostics.rawMean50 = 175;
    ui.update(s, r);
    assert.equal(dialog.children[2].disabled, false);
    await dialog.children[2].click();
    assert.deepEqual(calls[0], ['add', 'LI2', 170.4, {heightCm:0}]);
    calibrate.click();
    await dialog.children[2].click();
    assert.match(status.textContent, /Não confirmado: falha ao salvar/);
});
test('resposta só confirma após ID e sensor corretos; erro de persistência rejeita', async () => {
    let sent;
    const promise = requestLevelZero(m => sent = m, 'calibrate', 'LI1', 100);
    assert.equal(sent.type, 'level_zero'); assert.equal(sent.rawMean50, 100);
    receiveLevelZero({ ...sent, requestId: 'errado', success: true });
    receiveLevelZero({ ...sent, id: 'LI2', success: true });
    receiveLevelZero({ ...sent, success: false, message: 'disco indisponível' });
    await assert.rejects(promise, /disco indisponível/);
    const next = requestLevelZero(m => sent = m, 'restore', 'LI1');
    assert.equal(sent.rawMean50, undefined);
    receiveLevelZero({ ...sent, success: true, message: 'Restaurado' });
    assert.equal((await next).message, 'Restaurado');
});

test('altura decimal livre, captura fixa, cinco pontos e ações confirmadas por sensor', async () => {
    for (const value of ['5,7','5.7']) assert.equal(parseMeasuredHeight(value),5.7);
    for (const value of ['','-1','NaN','Infinity','1,2,3','5cm']) assert.equal(parseMeasuredHeight(value),null);
    const calls=[];
    const ui=createLevelZeroControls({createElement:()=>new Node()},async(...args)=>{calls.push(args);return {message:'Registrado'};});
    const s=sensor(),r=runtime();s.diagnostics.calibrationPoints=[{heightCm:0,raw:100}];
    ui.update(s,r);
    const [zero,,dialog,,label,add,count,table]=ui.element.children;
    const height=label.children[0];height.value='5,7';height.events.input();
    add.click();s.diagnostics.rawMean50=180;ui.update(s,r);
    await dialog.children[2].click();
    assert.deepEqual(calls[0],['add','LI2',170.4,{heightCm:5.7}]);
    zero.click();assert.match(dialog.children[0].textContent,/Substituir/);
    await dialog.children[2].click();
    assert.deepEqual(calls[1],['replace','LI2',180,{heightCm:0,point:{heightCm:0,raw:100}}]);
    s.diagnostics.calibrationPoints = [{heightCm:0,raw:100}, {heightCm:10,raw:160}];
    height.value = '10';
    ui.update(s,r);
    table.children[2].children[2].children[0].click();
    await dialog.children[2].click();
    assert.deepEqual(calls[2], ['replace','LI2',180,{heightCm:10,point:{heightCm:10,raw:160}}]);
    s.diagnostics.rawMean50 = 60;
    ui.update(s,r);
    table.children[2].children[2].children[0].click();
    assert.equal(dialog.hidden, true);
    assert.match(ui.element.children[3].textContent, /RAW deve aumentar/);
    s.diagnostics.calibrationPoints=Array.from({length:5},(_,i)=>({heightCm:i*5,raw:100+i*20}));
    ui.update(s,r);assert.ok(add.disabled);assert.match(count.textContent,/5\/5/);
    r.hardware.serial.connected=false;ui.update(s,r);
    assert.equal(table.children.length,6);assert.ok(add.disabled);assert.ok(zero.disabled);
    table.children[2].children[2].children[1].click();
    await dialog.children[2].click();assert.equal(calls.at(-1)[0],'delete');
    assert.deepEqual(calls.at(-1)[3],{point:{heightCm:5,raw:120}});
});
