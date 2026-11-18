import { createPlantState } from '../state/plant-state.js';

/*
  TELEMETRIA
  Apenas normaliza o contrato do backend; não calcula a dinâmica da planta.
*/
const valid = source => source &&
    (source.quality == null || ['good', 'valid', 'available'].includes(source.quality)) &&
    (source.status == null || ['good', 'valid', 'available'].includes(source.status));
const number = value => Number.isFinite(value) ? value : null;
const bit = value => value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : null;

export function normalizeBackendState(data = {}, { processLayout = true } = {}) {
    const plant = createPlantState();
    for (const tank of plant.tanks) {
        const source = data.tanks?.[tank.id];
        for (const key of ['level', 'height', 'heightCm', 'volume']) {
            tank[key] = valid(source) ? number(source[key]) : null;
        }
        tank.capacity = data.mode === 'HARDWARE' ? number(data.hardware?.geometry?.[tank.id]?.capacityL) : number(source?.capacityL);
    }
    for (const sensor of plant.levelSensors) {
        const source = data.levelSensors?.[sensor.id];
        for (const key of ['level', 'heightCm', 'pressure', 'voltage', 'raw']) {
            sensor[key] = data.mode === 'HARDWARE' || valid(source) ? number(source?.[key]) : null;
        }
        sensor.status = source?.status ?? 'unavailable';
        sensor.source = source?.source ?? null;
        if (data.mode === 'HARDWARE') {
            sensor.diagnostics = source?.diagnostics ?? {};
            sensor.reason = source?.reason ?? null;
        }
        // HARDWARE fornece a altura em metros no tanque associado.
        const tank = data.tanks?.[sensor.tank];
        if (!processLayout && data.mode === 'HARDWARE' && valid(source) &&
            number(source.level) !== null && valid(tank) && sensor.heightCm === null) {
            sensor.heightCm = number(tank.height) === null ? null : tank.height * 100;
        }
    }
    for (const sensor of plant.flowSensors) {
        const source = data.flowSensors?.[sensor.id];
        sensor.flow = valid(source) ? number(source.flow) : null;
        sensor.status = source?.status ?? 'unavailable';
        sensor.source = source?.source ?? null;
        if (data.mode === 'HARDWARE') {
            sensor.diagnostics = source?.diagnostics ?? {};
            sensor.reason = source?.reason ?? null;
        }
        for (const key of ['raw', 'frequency', 'pulses']) sensor[key] = number(source?.[key]);
    }
    for (const pump of plant.pumps) {
        const source = data.pumps?.[pump.id];
        const known = valid(source) && (data.mode !== 'HARDWARE' ||
            (data.hardware?.serial?.connected === true && data.hardware?.control?.confirmed != null));
        pump.power = known ? bit(source.power) : null;
        pump.command = known ? number(source.command) : null;
    }
    for (const group of ['actuatedValves', 'manualValves', 'recycleValves', 'threeWayBranches']) {
        for (const valve of plant[group]) {
            const source = group === 'threeWayBranches'
                ? data.threeWayValves?.[valve.equipment]?.branches?.[valve.branch]
                : data[group]?.[valve.id];
            const known = valid(source) && (data.mode !== 'HARDWARE' ||
                (['actuatedValves','threeWayBranches'].includes(group) && data.hardware?.serial?.connected === true && data.hardware?.control?.confirmed != null));
            if (group === 'threeWayBranches') valve.state = known ? bit(source.state) : null;
            else valve.opening = known ? number(source.opening) : null;
        }
    }
    for (const equipment of plant.threeWayValves) {
        equipment.branches = Object.fromEntries(plant.threeWayBranches
            .filter(branch => branch.equipment === equipment.id)
            .map(branch => [branch.branch, { state: branch.state }]));
    }
    plant.mainValve.opening = data.mode !== 'HARDWARE' && valid(data.mainValve)
        ? number(data.mainValve.opening) : null;
    return plant;
}

export function normalizeBackendFlows(flows = {}) {
    return Object.fromEntries(Object.entries(flows ?? {}).map(([id, value]) => [id, number(value)]));
}
