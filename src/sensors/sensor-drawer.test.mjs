import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('./sensor-drawer.js', import.meta.url), 'utf8');
const { createSensorDrawer } = await import(moduleUrl(new URL('./sensor-drawer.js', import.meta.url)));
class Element {
    children = []; dataset = {}; attributes = {}; events = {}; textContent = '';
    classList = { add() {}, remove() {} };
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { this.events[name] = fn; }
    click() { this.events.click?.(); }
    text() { return [this.textContent, ...this.children.map(child => child.text())].join('\n'); }
}
const viewCode = readFileSync(new URL('../plant/plant-view.js', import.meta.url), 'utf8');
function method(name, next) {
    const source = viewCode.slice(viewCode.indexOf(`    ${name}(`), viewCode.indexOf(`    ${next}(`));
    return new Function(`return class {${source.trim()}}`)().prototype[name];
}
function fixture() {
    const root = new Element();
    const drawer = createSensorDrawer(root, { createElement: () => new Element() });
    const plant = { levelSensors: [
        { id: 'LI1', tank: 'TQ1', heightCm: 12.4, status: 'available' },
        { id: 'LI2', tank: 'TQ2', heightCm: 9.8, status: 'available' },
        { id: 'LI3', tank: 'TQ3', heightCm: 15.1, status: 'available' }
    ], flowSensors: [{ id: 'FI1', flow: 1.42, status: 'available' }] };
    const runtime = { backendMode: 'MODELICA', connected: true };
    drawer.update(plant, runtime);
    const panel = root.children[0];
    const [header, list, detail] = panel.children;
    const level = {}, flow = {};
    const view = { levelSensorViews: { TQ2: level }, flowSensorViews: { FI1: flow }, currentPlant: plant,
        hideSensorPreview() {}, onSensorSelect: drawer.open,
        beginElementGesture: method('beginElementGesture', 'maybeStartElementPan'),
        getInteractiveComponent: method('getInteractiveComponent', 'componentEditorCanWrite'),
        openComponentEditor: method('openComponentEditor', 'closeComponentEditor') };
    return { drawer, plant, runtime, panel, header, list, detail, view, level, flow };
}

test('clique de sensor usa o drawer, seleciona o nome público e troca de grupo sem controlar', () => {
    const f = fixture();
    // Qualquer desvio para controles ou eventos globais falharia neste contexto sem esses handlers.
    f.view.beginElementGesture({ model: f.level }, { button: 0, clientX: 100, clientY: 100 });
    f.view.openComponentEditor(f.view.pendingElementGesture.selection);
    assert.equal(f.panel.inert, false);
    assert.equal(f.header.children[0].textContent, 'NÍVEIS');
    assert.equal(f.list.children[1].attributes['aria-pressed'], 'true');
    assert.match(f.panel.text(), /LI3/);
    f.list.children[0].click();
    assert.equal(f.list.children[0].attributes['aria-pressed'], 'true');
    assert.equal(f.list.children[1].attributes['aria-pressed'], 'false');
    f.view.openComponentEditor(f.view.getInteractiveComponent(f.flow));
    assert.equal(f.header.children[0].textContent, 'VAZÕES');
    assert.equal(f.list.children[0].attributes['aria-pressed'], 'true');
    assert.match(f.detail.text(), /1,42 L\/min/);
    f.header.children[1].click();
    assert.equal(f.panel.inert, true);
    assert.equal(f.panel.attributes['aria-hidden'], 'true');
});

test('atualização reutiliza as linhas e os valores confirmados MODELICA/HARDWARE', () => {
    const f = fixture();
    f.drawer.open('levelSensors', 'LI2');
    const button = f.list.children[1];
    f.plant.levelSensors[1].heightCm = 14.5;
    f.drawer.update(f.plant, f.runtime);
    assert.equal(f.list.children[1], button);
    assert.match(button.text(), /14,5 cm/);
    f.runtime.backendMode = 'HARDWARE';
    f.runtime.hardware = { serial: { connected: true } };
    f.plant.levelSensors[1].diagnostics = { rawMean50: 201.3 };
    f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /Fonte: HARDWARE/);
    assert.match(f.detail.text(), /RAW médio: 201,3/);
    f.plant.levelSensors[1].status = 'stale';
    f.drawer.update(f.plant, f.runtime);
    assert.match(button.text(), /Sem leitura/);
    assert.match(f.detail.text(), /Desatualizado/);
    f.runtime.hardware.serial.connected = false;
    f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /Desconectado/);
});

test('sensor sem dado não é apresentado como zero; fechar e reabrir preserva atualização', () => {
    const f = fixture();
    f.plant.flowSensors[0].flow = null;
    f.drawer.open('flowSensors', 'FI1');
    assert.match(f.list.text(), /Sem leitura/);
    f.drawer.close();
    f.plant.flowSensors[0].flow = 0;
    f.drawer.update(f.plant, f.runtime);
    f.drawer.open('flowSensors', 'FI1');
    assert.match(f.list.text(), /0,00 L\/min/);
    assert.doesNotMatch(code, /send.*Command|WebSocket|fetch\(/);
});

test('ordena FI e LI pelo número público sem modificar as listas recebidas', () => {
    const f = fixture();
    const flows = ['FI5', 'FI6', 'FI1', 'FI3', 'FI4', 'FI2'];
    const levels = ['LI4', 'LI6', 'LI2', 'LI5', 'LI3', 'LI1'];
    f.plant.flowSensors = flows.map(id => ({ id }));
    f.plant.levelSensors = levels.map(id => ({ id }));
    f.drawer.open('flowSensors', 'FI4');
    assert.deepEqual(f.list.children.map(row => row.children[0].textContent), ['FI1', 'FI2', 'FI3', 'FI4', 'FI5', 'FI6']);
    assert.equal(f.list.children[3].attributes['aria-pressed'], 'true');
    f.drawer.open('levelSensors', 'LI3');
    assert.deepEqual(f.list.children.map(row => row.children[0].textContent), ['LI1', 'LI2', 'LI3', 'LI4', 'LI5', 'LI6']);
    assert.deepEqual(f.plant.flowSensors.map(s => s.id), flows);
    assert.deepEqual(f.plant.levelSensors.map(s => s.id), levels);
});

function moduleUrl(url) {
    const source = readFileSync(url, 'utf8').replace(/from '(\.\.?\/[^']+)'/g,
        (_, path) => `from '${moduleUrl(new URL(path, url))}'`);
    return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const { normalizeBackendState } = await import(moduleUrl(new URL('../connection/backend-state.js', import.meta.url)));

test('detalhes usam campos normalizados reais e atualizam RAW, filtro, média e vazão', () => {
    const f = fixture();
    const data = { mode: 'HARDWARE', levelSensors: { LI2: {
        status: 'available', heightCm: 8.4, raw: 173,
        diagnostics: { valid: true, stale: false, filteredRaw: 171, rawMean50: 170.6, rawMeanCount: 4, rawMeanWindow: 10 }
    } }, flowSensors: { FI1: { status: 'available', flow: 1.42, pulses: 200, frequency: 17.25,
        diagnostics: { valid: true, stale: false, rawFlow: .0237, sourceUnit: 'L/s' } } } };
    f.runtime.backendMode = 'HARDWARE';
    f.runtime.hardware = { serial: { connected: true } };
    const update = () => f.drawer.update(normalizeBackendState(data), f.runtime);
    update(); f.drawer.open('levelSensors', 'LI2');
    for (const expected of ['8,4 cm', 'RAW atual: 173', 'RAW filtrado: 171,0', 'RAW médio: 170,6', 'Leitura válida: sim']) {
        assert.ok(f.detail.text().includes(expected), expected);
    }
    data.levelSensors.LI2.raw = 180;
    data.levelSensors.LI2.diagnostics.filteredRaw = 178;
    assert.match(f.detail.text(), /Amostras: 4\/10/);
    data.levelSensors.LI2.diagnostics.rawMeanCount = 10;
    data.levelSensors.LI2.diagnostics.rawMean50 = 175.2;
    update();
    for (const expected of ['RAW atual: 180', 'RAW filtrado: 178,0', 'RAW médio: 175,2']) assert.ok(f.detail.text().includes(expected));
    f.drawer.open('flowSensors', 'FI1');
    for (const expected of ['1,42 L/min', 'Pulsos acumulados: 200', 'Frequência derivada: 17,250 Hz', 'Vazão bruta recebida: 0,024 L/s']) assert.ok(f.detail.text().includes(expected), expected);
    data.flowSensors.FI1.pulses = 250; update();
    assert.match(f.detail.text(), /Pulsos acumulados: 250/);
    data.flowSensors.FI1.diagnostics = {}; data.flowSensors.FI1.pulses = null; data.flowSensors.FI1.frequency = null;
    update();
    assert.match(f.detail.text(), /Pulsos acumulados: —/);
    assert.match(f.detail.text(), /Vazão bruta recebida: —/);
    assert.doesNotMatch(f.detail.text(), /250|17,250|0,024/);
});

test('RAW não reaparece como leitura atual após invalidade, timeout ou desconexão', () => {
    const f = fixture();
    const sensor = f.plant.levelSensors[1];
    Object.assign(sensor, { raw: 173, diagnostics: { filteredRaw: 171, rawMean50: 170.6, valid: true } });
    Object.assign(f.runtime, { backendMode: 'HARDWARE', hardware: { serial: { connected: true } } });
    f.drawer.open('levelSensors', 'LI2');
    for (const status of ['stale', 'invalid', 'unavailable']) {
        sensor.status = status; f.drawer.update(f.plant, f.runtime);
        assert.match(f.detail.text(), /RAW médio: —/);
        assert.doesNotMatch(f.detail.text(), /173|171|170,6/);
    }
    sensor.status = 'uncalibrated'; f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /RAW atual: 173/);
    assert.match(f.detail.text(), /Valor: Sem leitura/);
    sensor.diagnostics.stale = true; f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /RAW atual: —/);
    sensor.diagnostics.stale = false; sensor.diagnostics.valid = false;
    f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /Leitura válida: não/);
    sensor.diagnostics.valid = true; f.runtime.hardware.serial.connected = false;
    f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /RAW médio: —/);
    assert.match(f.detail.text(), /Desconectado/);
});

test('MODELICA não apresenta nem calcula RAW físico, mesmo após trocar de HARDWARE', () => {
    const f = fixture();
    f.plant.levelSensors[1].raw = 173;
    f.plant.levelSensors[1].diagnostics = { rawMean50: 170.6 };
    Object.assign(f.runtime, { backendMode: 'HARDWARE', hardware: { serial: { connected: true } } });
    f.drawer.open('levelSensors', 'LI2');
    f.runtime.backendMode = 'MODELICA';
    f.drawer.update(f.plant, f.runtime);
    assert.match(f.detail.text(), /9,8 cm/);
    assert.match(f.detail.text(), /RAW: — \(não aplicável à simulação\)/);
    assert.doesNotMatch(f.detail.text(), /173|170,6|RAW médio/);
});
