import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tankPresentation} from './tank-presentation.mjs';
function moduleUrl(url) {
    const code=readFileSync(url,'utf8').replace(/from '(\.\.?\/[^']+)'/g,
        (_,path)=>`from '${moduleUrl(new URL(path,url))}'`);
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {normalizeBackendState}=await import(moduleUrl(new URL('../connection/backend-state.js',import.meta.url)));
for (const mode of ['MODELICA','HARDWARE']) {
    test(`${mode}: percentual confirmado, zero real e altura sem percentual`,()=>{
        for (const [source,expected] of [
            [{level:42,volume:0.8},42], [{level:0},0], [{height:0.1,heightCm:10},null],
            [{},null], [{level:null,height:0.1},null], [{level:50,status:'unavailable'},null]
        ]) {
            const state=normalizeBackendState({mode,tanks:{TQ1:source}});
            assert.equal(tankPresentation(state.tanks.find(t=>t.id==='TQ1')).level,expected);
        }
    });
}
test('o desenho usa a apresentação sem fallback para altura de 1 m',()=>{
    const source=readFileSync(new URL('./plant-view.js',import.meta.url),'utf8');
    const update=source.slice(source.indexOf('    updateTanks(plant)'),source.indexOf('    updateLevelSensors(plant)'));
    assert.match(update,/tankPresentation\(tank\)/);
    assert.doesNotMatch(update,/maxHeight|tank\.height|PLANT_MODEL/);
});
