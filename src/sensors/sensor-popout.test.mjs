import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('./sensor-popout.js', import.meta.url), 'utf8');
const { createSensorPopout, sensorSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const state = () => ({ group: 'levelSensors', selected: 'LI1', plant: { levelSensors: [{ id: 'LI1', heightCm: 12, status: 'available' }], pumps: [{ id: 'JIC1' }] }, runtime: { backendMode: 'MODELICA', connected: true, operation: { mode: 'MANUAL' } } });
test('popup recebe cópia serializável apenas dos sensores, sem estado de controle', () => {
    const original = state(), copy = sensorSnapshot(original);
    assert.equal(copy.plant.pumps, undefined);
    assert.equal(copy.runtime.operation, undefined);
    copy.plant.levelSensors[0].heightCm = 50;
    assert.equal(original.plant.levelSensors[0].heightCm, 12);
});
test('popup única atualiza, reutiliza, reabre após fechar e encerra junto da principal', () => {
    let count = 0, updates = [], opens = [], onHide;
    const popup = { closed: false, focus() {}, close() { this.closed = true; }, addEventListener() {},
        document: { documentElement: {}, body: { replaceChildren() {} }, head: { append() {} }, createElement: () => ({}) } };
    const host = { document: { querySelectorAll: () => [] },
        open() { count++; popup.closed = false; return popup; }, addEventListener(name, fn) { if (name === 'pagehide') onHide = fn; } };
    const bridge = createSensorPopout(() => ({ update(p, r) { updates.push({ p, r }); }, open(g, id) { opens.push([g, id]); } }), host);
    const s = state();
    assert.equal(bridge.open(s), true);
    bridge.open(s); assert.equal(count, 1);
    s.plant.levelSensors[0].heightCm = 15; bridge.sync(s);
    assert.equal(updates.at(-1).p.levelSensors[0].heightCm, 15);
    s.runtime.connected = false; bridge.sync(s);
    assert.equal(updates.at(-1).r.connected, false);
    s.group = 'flowSensors'; s.selected = 'FI2'; bridge.sync(s);
    assert.deepEqual(opens.at(-1), ['flowSensors', 'FI2']);
    popup.close(); const before = updates.length; bridge.sync(s); assert.equal(updates.length, before);
    bridge.open(s); assert.equal(count, 2);
    onHide(); assert.equal(popup.closed, true);
    assert.doesNotMatch(code, /WebSocket|setInterval|fetch\(|send.*Command/);
});
test('popup bloqueada pelo navegador é informada sem exceção', () => {
    const bridge = createSensorPopout(() => assert.fail(), { open: () => null, addEventListener() {} });
    assert.equal(bridge.open(state()), false);
});
