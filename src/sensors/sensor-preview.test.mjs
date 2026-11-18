import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function moduleUrl(url) {
    const source = readFileSync(url, 'utf8').replace(/from '(\.\.?\/[^']+)'/g,
        (_, path) => `from '${moduleUrl(new URL(path, url))}'`);
    return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const { normalizeBackendState } = await import(moduleUrl(new URL('../connection/backend-state.js', import.meta.url)));
const source = readFileSync(new URL('../plant/plant-view.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('    updateSensorPreview() {') + '    updateSensorPreview() {'.length,
    source.indexOf('    hideSensorPreview() {')).trim().slice(0, -1);

class Element {
    children = []; textContent = ''; style = {};
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, width: 600, height: 600 }; }
    text() { return [this.textContent, ...this.children.map(c => c.text())].join('\n'); }
}
const render = new Function('document', 'componentLabel', method);

test('preview HARDWARE distingue RAW, filtro, média longa, ADC e poll', () => {
    for (const profile of ['PLANTA1-RO', 'PLANTA1-CTRL']) {
        const hardware = { serial: { connected: true }, capabilities: {
            profile, pressureFilterSamples: 4, pressureSampleIntervalMs: 50
        }, acquisition: { pollIntervalSeconds: 1 } };
        const data = { mode: 'HARDWARE', hardware, levelSensors: { LI1: {
            status: 'available', raw: 205, heightCm: 12.34,
            diagnostics: { filteredRaw: 204.5, rawMean50: 203.8, rawMeanCount: 10, rawMeanWindow: 10 }
        } }, flowSensors: { FI1: { status: 'available', flow: 2, frequency: 17.25, pulses: 100 } } };
        const context = { currentPlant: normalizeBackendState(data), currentRuntime: { backendMode: 'HARDWARE', hardware },
            sensorPreview: new Element(), paperContainer: new Element(),
            sensorPreviewSelection: { group: 'levelSensors', id: 'TQ1', elementView: { el: new Element() } } };
        assert.equal(context.currentPlant.levelSensors[0].diagnostics.filteredRaw, 204.5);
        const preview = () => { render.call(context, { createElement: () => new Element() }, id => id); return context.sensorPreview.text(); };
        const text = preview();
        for (const expected of ['RAW atual: 205', 'RAW filtrado (4): 204,5', 'RAW médio (10/10): 203,8',
            'Amostragem ADC: 20,0 Hz (50 ms)', 'Atualização HMI: ~1,0 Hz (poll 1,0 s)']) assert.ok(text.includes(expected), expected);
        for (const status of ['stale', 'unavailable']) {
            context.currentPlant.levelSensors[0].status = status;
            assert.ok(preview().includes('RAW filtrado (4): Sem leitura'));
        }
        context.currentPlant.levelSensors[0].status = 'available';
        hardware.serial.connected = false;
        assert.ok(preview().includes('RAW filtrado (4): Sem leitura'));
        hardware.serial.connected = true;
        context.sensorPreviewSelection.group = 'flowSensors'; context.sensorPreviewSelection.id = 'FI1';
        const flow = preview();
        assert.ok(flow.includes('Hz derivado entre polls 17,250 Hz'));
        assert.ok(flow.includes('Atualização HMI: ~1,0 Hz (poll 1,0 s)'));
        assert.ok(!flow.includes('Amostragem ADC'));
        for (const mode of ['MODELICA', 'MOCK']) {
            context.currentRuntime.backendMode = mode;
            assert.ok(!preview().includes('Atualização HMI'));
        }
    }
});
