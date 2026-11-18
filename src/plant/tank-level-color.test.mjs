import test from 'node:test';
import assert from 'node:assert/strict';
import { tankLevelColor } from './tank-level-color.mjs';

for (const [level, expected] of [
    [0, '#5593b3'], [50, '#5593b3'], [89.999, '#5593b3'],
    [90, '#e4bd38'], [95, '#e4bd38'], [98.999, '#e4bd38'],
    [99, '#d94b45'], [100, '#d94b45'], [110, '#d94b45'],
]) {
    test(`Cor do tanque em ${level}%`, () => {
        assert.equal(tankLevelColor(level), expected);
    });
}

test('Transbordamento explícito tem prioridade sobre o percentual', () => {
    for (const level of [0, 80, 95, null]) {
        assert.equal(tankLevelColor(level, true), '#d94b45');
    }
});

test('Leitura ausente ou inválida não cria alarme', () => {
    for (const level of [null, undefined, NaN, Infinity, -Infinity, '100']) {
        assert.equal(tankLevelColor(level), '#5593b3');
    }
    assert.equal(tankLevelColor(null, 'true'), '#5593b3');
});
