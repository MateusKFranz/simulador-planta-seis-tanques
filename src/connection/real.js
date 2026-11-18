import { normalizeBackendState, normalizeBackendFlows } from './backend-state.js';
import { requestLevelZero, receiveLevelZero } from '../sensors/level-zero-client.js';
import { canCalibrateZero } from '../sensors/level-zero-controls.js';
import {
    createPlantState,
    getTank,
    getPump,
    getActuatedValve,
    getRecycleValve,
    getManualValve,
    getThreeWayValve,
    getFlowSensor,
    getLevelSensor
} from '../state/plant-state.js';

/*
  TELEMETRIA
  Recebe snapshots e envia comandos ao backend WebSocket.
*/

// ESTADO DA PLANTA REAL

export const realPlant =
    normalizeBackendState();
for (const sensor of realPlant.flowSensors) sensor.flow = null;
for (const sensor of realPlant.levelSensors) {
    for (const key of ['level', 'pressure', 'voltage', 'raw']) sensor[key] = null;
}
for (const tank of realPlant.tanks) tank.level = tank.height = tank.volume = null;


// ESTADO DA CONEXÃO

export const realRuntime = {

    connected:
        false,

    connecting:
        false,

    connectionLabel:
        'Desconectado',

    transport:
        null,

    port:
        null,

    lastUpdate:
        null,

    lastError:
        null,

    flows:
        {}
};

// WEBSOCKET
/* Navegador (HMI) <-> servidor Python
   O backend publica snapshots completos. O
   endereço padrão é local, na porta 8765.
 */

const DEFAULT_WEBSOCKET_URL =
    'ws://localhost:8765';

let realSocket =
    null;

let intentionalDisconnect =
    false;

// AUXILIAR

function clamp(
    value,
    min,
    max
) {

    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}

// ENVIO DE COMANDOS AO SERVIDOR PYTHON
let pendingHardwareCommand = null;
export function hardwareCommandPending() {
    return pendingHardwareCommand !== null && Date.now()-pendingHardwareCommand.sentAt < 2000;
}

export function canSendModelicaCommand() {
    return expectedBackendMode === 'MODELICA' && realRuntime.backendMode === 'MODELICA' &&
        realRuntime.connected && realSocket?.readyState === WebSocket.OPEN && realRuntime.modelicaReady === true;
}

export function sendLevelZeroCommand(action, id, raw) {
    const sensor = realPlant.levelSensors.find(s => s.id === id);
    if (expectedBackendMode !== 'HARDWARE' || realRuntime.backendMode !== 'HARDWARE' ||
        !realRuntime.connected || realSocket?.readyState !== WebSocket.OPEN || !sensor ||
        !['calibrate', 'restore'].includes(action) ||
        (action === 'calibrate' && (!Number.isFinite(raw) || raw < 0 || raw > 1023)))
        return Promise.reject(new Error('Leitura capturada ou conexão indisponível para calibração.'));
    return requestLevelZero(message => realSocket.send(JSON.stringify(message)), action, id, raw);
}

export function canCommandComponent(kind, id) {
    if (realRuntime.operation?.mode === 'AUTO' &&
        (Object.values(realRuntime.operation.fixed ?? {}).some(group => group && Object.hasOwn(group, id)) ||
        Object.values(realRuntime.loops ?? {}).some(loop => loop.mvTarget?.id === id && loop.effectiveMode === 'AUTO'))) return false;
    if (expectedBackendMode === 'HARDWARE') {
        const c = realRuntime.hardware?.control;
        if (!hardwareConnectionReady() || !c?.armed || !c.ready || c.busy || hardwareCommandPending()) return false;
        if (kind === 'pump') {
            const index = c.pumpChannels?.[id];
            return Boolean(index && c.confirmed?.pumps?.[index-1]?.[1]);
        }
        if (kind === 'actuatedValve') return c.confirmed?.valves?.some(v => Array.isArray(v) && v[1] === 1 && id === `LV${v[0]}`) === true;
        return false;
    }
    if (!canSendModelicaCommand()) return false;
    const groups = { pump: 'pumps', actuatedValve: 'actuatedValves', recycleValve: 'recycleValves', manualValve: 'manualValves' };
    const item = kind === 'mainValve' ? realPlant.mainValve : realPlant[groups[kind]]?.find(x => x.id === id);
    if (!item || (kind === 'pump' ? item.power === null || item.command === null : item.opening === null)) return false;
    const targetType = kind === 'pump' ? 'bomba' : kind === 'actuatedValve' ? 'valvula' : null;
    return !targetType || !Object.values(realRuntime.loops ?? {}).some(loop =>
        loop.mvTarget?.tipo === targetType && loop.mvTarget.id === id && (loop.effectiveMode ?? loop.mode) === 'AUTO');
}

function sendRealCommand(message) {
    if (!canSendModelicaCommand()) return false;
    if (!['sim', 'pump', 'valve', 'manual_valve', 'scenario', 'loop', 'operation', 'oy', 'xv'].includes(message.type)) return false;
    realSocket.send(JSON.stringify(message));
    return true;
}

export function hardwareConnectionReady() {
    return expectedBackendMode === 'HARDWARE' && realRuntime.backendMode === 'HARDWARE' &&
        realRuntime.connected && realSocket?.readyState === WebSocket.OPEN &&
        Date.now()-realRuntime.lastUpdate < 2000 && realRuntime.hardware?.serial?.connected === true &&
        realRuntime.hardware?.control?.supported === true;
}

export function sendHardwareCommand(action, values = {}) {
    if (!hardwareConnectionReady()) return false;
    const c = realRuntime.hardware.control;
    if (action === 'plant_reset' && !c.compatible) return false;
    if (!['arm', 'disarm', 'estop', 'reset', 'plant_reset', 'lease', 'pump', 'valve', 'valve_sync', 'valve_stop', 'valve_angle', 'oy'].includes(action)) return false;
    if (!['estop', 'disarm', 'plant_reset', 'lease'].includes(action) && hardwareCommandPending()) return false;
    if (!['estop', 'disarm', 'reset', 'plant_reset'].includes(action) &&
        (!c.ready || (action !== 'arm' && !c.armed) || (action !== 'lease' && c.busy))) return false;
    if (action !== 'lease') pendingHardwareCommand = { sentAt: Date.now(), confirmation: c.lastConfirmation?.at ?? null };
    realSocket.send(JSON.stringify({ ...values, type: 'hardware', action }));
    return true;
}

// A sessão expira no backend se a HMI deixar de responder; não rearma.
setInterval(() => {
    if (hardwareConnectionReady() && realRuntime.hardware.control.armed) sendHardwareCommand('lease');
}, 1000);

export function sendSimulationCommand(command) {
    const message = { type: 'sim' };
    if (typeof command.running === 'boolean') message.running = command.running;
    if (command.reset === true) message.reset = true;
    if ([0.25, 0.5, 1, 2, 5, 10].includes(command.speed)) message.speed = command.speed;
    if (command.levels && Object.entries(command.levels).every(([id, value]) =>
        realPlant.tanks.some(t => t.id === id) && Number.isFinite(value) && value >= 0 &&
        value <= realRuntime.sim?.tankHeightCm)) message.levels = command.levels;
    return Object.keys(message).length > 1 && sendRealCommand(message);
}

export function canSendOperationCommand() {
    return canSendModelicaCommand() || hardwareConnectionReady();
}
export function sendOperationCommand(message) {
    if (!['operation', 'scenario', 'loop', 'xv'].includes(message.type)) return false;
    if (canSendModelicaCommand()) return sendRealCommand(message);
    if (!hardwareConnectionReady()) return false;
    realSocket.send(JSON.stringify(message));
    return true;
}
export function applyManualActuator(id, value, unit = 'percent') {
    if (/^HV[1-9]$/.test(id)) {
        if (expectedBackendMode !== 'MODELICA' || unit !== 'percent' ||
            !Number.isFinite(value) || value < 0 || value > 100) return false;
        if (id === 'HV9') return setRealMainValveOpening(value/100);
        if (['HV7','HV8'].includes(id)) return setRealRecycleValveOpening(id,value/100);
        return setRealManualValveOpening(id,value/100);
    }
    if (expectedBackendMode === 'HARDWARE') {
        const action = id.startsWith('JIC') ? 'pump' : id.startsWith('OY') ? 'oy' :
            ({angle: 'valve_angle', sync: 'valve_sync', stop: 'valve_stop'})[unit] ?? 'valve';
        const key = action === 'pump' ? 'pwm' : action === 'oy' ? 'state' : ['angle','sync'].includes(unit) ? 'angle' : 'percent';
        return sendHardwareCommand(action, {id, ...(unit === 'stop' ? {} : {[key]: value})});
    }
    if (id.startsWith('JIC')) return Number.isInteger(value) && value>=0 && value<=255 && canCommandComponent('pump', id) &&
        sendRealCommand({type: 'pump', id, command: value/255, power: value>0});
    if (id.startsWith('LV')) return unit === 'percent' && setRealActuatedValveOpening(id, value/100);
    if (id.startsWith('OY')) return realRuntime.operation?.mode === 'MANUAL' && ['A','B'].includes(value) && sendRealCommand({type:'oy',id,state:value});
    return false;
}
export function selectScenario(id) {
    return realRuntime.scenarios?.some(scenario => scenario.id === id) === true &&
        sendOperationCommand({ type: 'scenario', id });
}

export function sendLoopCommand(id, command) {
    const loop = realRuntime.loops?.[id];
    if (!canSendOperationCommand() || !loop) return false;
    const message = { type: 'loop', id };
    if (['AUTO', 'MAN'].includes(command.mode)) message.mode = command.mode;
    if (Number.isFinite(command.sp)) message.sp = command.sp;
    if (Number.isFinite(command.mv) && (command.mode === 'MAN' || (!command.mode && (loop.effectiveMode ?? loop.mode) === 'MAN'))) message.mv = command.mv;
    if (command.tuning) {
        const fields = ['kp', 'ti', 'td', 'b', 'c', 'n', 'ftt', 'u_bias', 'u_min', 'u_max'];
        message.tuning = Object.fromEntries(Object.entries(command.tuning).filter(([key, value]) =>
            fields.includes(key) && Number.isFinite(value)));
        if (!Object.keys(message.tuning).length) delete message.tuning;
    }
    return Object.keys(message).length > 2 && sendOperationCommand(message);
}

const openingCommand = (kind, id, opening, type) =>
    Number.isFinite(opening) && opening >= 0 && opening <= 1 && canCommandComponent(kind, id) &&
    sendRealCommand({ type, id, opening });


// RECEBIMENTO DE MENSAGENS DO SERVIDOR PYTHON

function handleRealWebSocketMessage(
    rawMessage
) {

    let message;

    try {

        message =
            JSON.parse(
                rawMessage
            );

    } catch (error) {

        console.warn(
            '[REAL] Mensagem JSON inválida recebida:',
            rawMessage
        );

        return;
    }

    if (
        !message ||
        typeof message !==
            'object'
    ) {

        return;
    }

    if (message.type === 'level_zero_result') { receiveLevelZero(message); return; }
    if (
        message.type ===
        'state'
    ) {

        const data =
            message.data &&
            typeof message.data ===
                'object'
                ? message.data
                : message;

        applyRealData(
            data
        );

        return;
    }

    if (
        message.type ===
        'hello'
    ) {

        console.log(
            '[REAL] Servidor Python conectado:',
            message
        );

        return;
    }

    if (
        message.type ===
        'error'
    ) {
        pendingHardwareCommand = null;

        realRuntime.lastError =
            message.message ??
            'Erro informado pelo servidor Python.';

        console.error(
            '[REAL]',
            realRuntime.lastError
        );

        return;
    }

    console.warn(
        '[REAL] Tipo de mensagem desconhecido:',
        message.type
    );
}

// CONEXÃO

export function setRealConnectionState(
    connected,
    options = {}
) {
    if (!connected) {
        pendingHardwareCommand = null;
        Object.assign(realPlant, normalizeBackendState());
        realRuntime.flows = {};
        realRuntime.sim = {};
        realRuntime.loops = {};
        realRuntime.scenario = null;
        realRuntime.scenarios = [];
        realRuntime.backendMode = null;
    realRuntime.modelicaReady = false;
        realRuntime.operation = {mode: "MANUAL"};
    }

    realRuntime.connected =
        Boolean(
            connected
        );

    realRuntime.connecting =
        false;

    if (
        options.transport !==
        undefined
    ) {

        realRuntime.transport =
            options.transport;
    }

    if (
        options.port !==
        undefined
    ) {

        realRuntime.port =
            options.port;
    }

    if (
        options.label !==
        undefined
    ) {

        realRuntime.connectionLabel =
            options.label;

    } else {

        realRuntime.connectionLabel =
            realRuntime.connected
                ? 'Conectado'
                : 'Desconectado';
    }
}

export function setRealConnecting(
    connecting
) {

    realRuntime.connecting =
        Boolean(
            connecting
        );

    if (
        realRuntime.connecting
    ) {

        realRuntime.connectionLabel =
            'Conectando...';
    }
}

export function setRealConnectionError(
    error
) {

    realRuntime.connected =
        false;

    realRuntime.connecting =
        false;

    realRuntime.lastError =
        error;

    realRuntime.connectionLabel =
        'Erro de conexão';
}



// SNAPSHOT CONFIRMADO
let expectedBackendMode = 'MODELICA';
const snapshotListeners = new Set();
export function subscribeBackendSnapshot(listener) {
    snapshotListeners.add(listener);
    return () => snapshotListeners.delete(listener);
}
export function selectBackendMode(mode) {
    if (expectedBackendMode === 'HARDWARE' && mode !== 'HARDWARE') sendHardwareCommand('disarm');
    cancelReconnect();
    reconnectAttempt = 0;
    expectedBackendMode = mode;
    Object.assign(realPlant, normalizeBackendState());
    realRuntime.flows = {};
    realRuntime.sim = {};
    realRuntime.loops = {};
    realRuntime.scenario = null;
    realRuntime.scenarios = [];
    realRuntime.backendMode = null;
    realRuntime.modelicaReady = false;
        realRuntime.operation = {mode: "MANUAL"};
}

export function applyRealData(data) {
    realRuntime.modelicaReady = data.mode === expectedBackendMode && data.mode === 'MODELICA' &&
        typeof data.sim?.running === 'boolean' && Number.isFinite(data.sim?.t);
    if (realRuntime.modelicaReady) {
        reconnectAttempt = 0;
        realRuntime.connectionLabel = data.sim.running ? 'Conectado' : 'Pausado';
    }
    realRuntime.backendMode = data.mode ?? null;
    realRuntime.lastUpdate = Date.now();
    if (data.mode !== expectedBackendMode) {
        Object.assign(realPlant, normalizeBackendState());
        realRuntime.flows = {};
        realRuntime.sim = {};
        realRuntime.loops = {};
        realRuntime.scenario = null;
        realRuntime.scenarios = [];
        realRuntime.lastError = `Esperado ${expectedBackendMode}; backend conectado em ${data.mode ?? 'modo desconhecido'}.`;
        return;
    }
    Object.assign(realPlant, normalizeBackendState(data));
    realRuntime.sim = { ...data.sim };
    realRuntime.loops = { ...data.loops };
    realRuntime.operation = data.operation ?? {mode: "MANUAL"};
    realRuntime.xv = data.xv ?? {};
    realRuntime.scenario = data.scenario;
    realRuntime.scenarios = data.scenarios ?? [];
    realRuntime.hardware = data.mode === 'HARDWARE' ? data.hardware ?? null : null;
    if (pendingHardwareCommand && (data.mode !== 'HARDWARE' ||
        (data.hardware?.control?.lastConfirmation?.at ?? null) !== pendingHardwareCommand.confirmation)) pendingHardwareCommand = null;
    realRuntime.flows = normalizeBackendFlows(data.flows);
    realRuntime.lastError = data.sim?.error ?? null;
    const runtime = { ...getRealViewRuntime(), scenario: data.scenario, scenarios: data.scenarios };
    const measurements = normalizeBackendState(data, { processLayout: false });
    for (const listener of snapshotListeners) listener(measurements, runtime);
}

export function toggleRealPump(id) {
    const pump = realPlant.pumps.find(x => x.id === id);
    if (expectedBackendMode === 'HARDWARE') return pump?.power === 1 && sendHardwareCommand('pump', {id, percent: 0});
    return canCommandComponent('pump', id) && sendRealCommand({ type: 'pump', id, power: !pump.power });
}
export function setRealPumpPower(id, power) {
    if (expectedBackendMode === 'HARDWARE') return power === false && sendHardwareCommand('pump', {id, percent: 0});
    return typeof power === 'boolean' && canCommandComponent('pump', id) && sendRealCommand({ type: 'pump', id, power });
}
export function setRealPumpCommand(id, command) {
    if (expectedBackendMode === 'HARDWARE') return Number.isFinite(command) && command >= 0 && command <= 1 &&
        canCommandComponent('pump', id) && sendHardwareCommand('pump', {id, percent: command*100});
    return Number.isFinite(command) && command >= 0 && command <= 1 && canCommandComponent('pump', id) && sendRealCommand({ type: 'pump', id, command });
}
export function setRealMainValveOpening(opening) {
    return openingCommand('mainValve', 'HV9', opening, 'valve');
}
export function setRealActuatedValveOpening(id, opening) {
    if (expectedBackendMode === 'HARDWARE') return Number.isFinite(opening) && opening >= 0 && opening <= 1 &&
        canCommandComponent('actuatedValve', id) && sendHardwareCommand('valve', {id, percent: opening*100});
    return openingCommand('actuatedValve', id, opening, 'valve');
}
export function setRealRecycleValveOpening(id, opening) {
    return openingCommand('recycleValve', id, opening, 'manual_valve');
}
export function setRealManualValveOpening(id, opening) {
    return openingCommand('manualValve', id, opening, 'manual_valve');
}

// OY1_A / OY1_B / OY2_A / OY2_B

export function toggleRealThreeWayValve(
    id
) {
    return false; // Aquisição somente leitura.
}

export function setRealThreeWayValveState(
    id,
    state
) {
    return false; // Aquisição somente leitura.
}

/*
  VAZÕES VISUAIS
  Mapa auxiliar dos canais FT. A HMI conectada utiliza flows do backend.
*/

export function updateRealVisualFlows() {

    const FI5 =
        getFlowSensor(
            realPlant,
            'FI5'
        )?.flow ??
        0;

    const FI6 =
        getFlowSensor(
            realPlant,
            'FI6'
        )?.flow ??
        0;

    const FI1 =
        getFlowSensor(
            realPlant,
            'FI1'
        )?.flow ??
        0;

    const FI3 =
        getFlowSensor(
            realPlant,
            'FI3'
        )?.flow ??
        0;

    const FI4 =
        getFlowSensor(
            realPlant,
            'FI4'
        )?.flow ??
        0;

    const FI2 =
        getFlowSensor(
            realPlant,
            'FI2'
        )?.flow ??
        0;

    // RAMO CENTRAL
    /* Como temos FI5, FI6, FI1 e FI2 após a divisão, podemos
       inferir a vazão total do ramo central pela soma.
     */

    const branchX1 =
        FI6 +
        FI1;

    const branchX2 =
        FI5 +
        FI2;

    const centralFlow =
        branchX1 +
        branchX2;

    // MAPA VISUAL

    realRuntime.flows =
        {

            // JIC1 / RAMO CENTRAL

            RES_JIC1:
                centralFlow,

            JIC1_HV9:
                centralFlow,

            HV9_LV1:
                branchX1,

            HV9_LV2:
                branchX2,

            // OY1_A -> FI1 -> TQ3

            LV1_OY1_A:
                FI1,

            OY1_A_OUT:
                FI1,

            OY1_A_TQ3:
                FI1,

            // OY1_B -> FI6 -> TQ6

            LV1_OY1_B:
                FI6,

            OY1_B_FI6:
                FI6,

            FI6_TQ6:
                FI6,

            // OY2_A -> FI5 -> TQ5

            LV2_OY2_A:
                FI5,

            OY2_A_FI5:
                FI5,

            FI5_TQ5:
                FI5,

            // OY2_B -> FI2 -> TQ4

            LV2_OY2_B:
                FI2,

            OY2_B_OUT:
                FI2,

            OY2_B_TQ4:
                FI2,

            // JIC3 -> LV3 -> FI3 -> TQ1
            /* FI3 confirma apenas este ramo.
             */

            JIC3_LV3:
                FI3,

            LV3_FI3:
                FI3,

            FI3_TQ1:
                FI3,

            // JIC4 -> LV4 -> FI4 -> TQ2

            JIC4_LV4:
                FI4,

            LV4_FI4:
                FI4,

            FI4_TQ2:
                FI4,

            // TRECHOS NÃO MEDIDOS DIRETAMENTE
            /* Deixamos 0 até termos informação suficiente.
             */

            TQ5_HV5:
                0,

            HV5_TQ3:
                0,

            JIC3_HV7:
                0,

            HV7_TQ3:
                0,

            TQ3_HV3:
                0,

            HV3_JIC3:
                0,

            TQ6_HV6:
                0,

            HV6_TQ4:
                0,

            JIC4_HV8:
                0,

            HV8_TQ4:
                0,

            TQ4_HV4:
                0,

            HV4_JIC4:
                0,

            TQ1_HV1:
                0,

            HV1_RES:
                0,

            TQ2_HV2:
                0,

            HV2_RES:
                0
        };

    return realRuntime.flows;
}

// RUNTIME ENVIADO PARA PLANT-VIEW

export function getRealViewRuntime() {
    const sim = realRuntime.sim ?? {};
    return {
        ...realRuntime,
        mode: expectedBackendMode === 'MODELICA' ? 'simulation' : 'real',
        readOnly: !canSendModelicaCommand(),
        simulationReady: canSendModelicaCommand(),
        canCommandComponent,
        running: realRuntime.connected && sim.running === true,
        time: Number.isFinite(sim.t) ? sim.t : null,
        speed: Number.isFinite(sim.speed) ? sim.speed : null
    };
}

// Reconecta somente MODELICA; desconexão manual e saída da página cancelam a espera.
let reconnectTimer = null;
let reconnectAttempt = 0;
let connectionUrl = DEFAULT_WEBSOCKET_URL;
let pageClosed = false;
function cancelReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}
function scheduleReconnect() {
    if (expectedBackendMode !== 'MODELICA' || intentionalDisconnect || pageClosed || reconnectTimer !== null) return;
    realRuntime.connectionLabel = 'Aguardando backend...';
    const delay = Math.min(500 * 2 ** Math.min(reconnectAttempt++, 3), 3000);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (expectedBackendMode === 'MODELICA' && !intentionalDisconnect && !pageClosed) connectRealPlant(connectionUrl);
    }, delay);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => {
    pageClosed = true;
    disconnectRealPlant();
});

// CONEXÃO WEBSOCKET

export async function connectRealPlant(
    url = DEFAULT_WEBSOCKET_URL
) {

    if (
        realRuntime.connected ||
        realRuntime.connecting
    ) {

        return false;
    }

    if (
        realSocket &&
        (
            realSocket.readyState ===
                WebSocket.OPEN ||
            realSocket.readyState ===
                WebSocket.CONNECTING
        )
    ) {

        return false;
    }

    cancelReconnect();
    connectionUrl = url;
    intentionalDisconnect =
        false;

    realRuntime.lastError =
        null;

    realRuntime.transport =
        'WebSocket';

    realRuntime.port =
        new URL(url).port || (url.startsWith('wss:') ? '443' : '80');

    setRealConnecting(
        true
    );

    try {

        realSocket =
            new WebSocket(
                url
            );

    } catch (error) {

        realSocket =
            null;

        setRealConnectionError(
            `Não foi possível criar a conexão WebSocket: ${error.message}`
        );

        scheduleReconnect();
        return false;
    }

    const socket = realSocket;
    realSocket.addEventListener(
        'open',
        () => {
            if (socket !== realSocket) return;

            setRealConnectionState(
                true,
                {
                    transport:
                        'WebSocket',

                    port:
                        realRuntime.port,

                    label:
                        'Conectado'
                }
            );

            realRuntime.lastError =
                null;

            socket.send(JSON.stringify(
                {
                    type:
                        'hello',

                    client:
                        'hmi',

                    application:
                        'six-tank-supervisor'
                }
            ));

            console.log(
                `[REAL] Conectado a ${url}`
            );
        }
    );

    realSocket.addEventListener(
        'message',
        event => {
            if (socket !== realSocket) return;

            handleRealWebSocketMessage(
                event.data
            );
        }
    );

    realSocket.addEventListener(
        'error',
        () => {
            if (socket !== realSocket) return;

            if (
                intentionalDisconnect
            ) {

                return;
            }

            realRuntime.lastError =
                `Não foi possível comunicar com ${url}.`;
        }
    );

    realSocket.addEventListener(
        'close',
        event => {
            if (socket !== realSocket) return;

            realSocket =
                null;

            if (
                intentionalDisconnect
            ) {

                setRealConnectionState(
                    false,
                    {
                        transport:
                            'WebSocket',

                        port:
                            realRuntime.port,

                        label:
                            'Desconectado'
                    }
                );

                realRuntime.lastError =
                    null;

                return;
            }

            setRealConnectionState(false);

            realRuntime.connecting =
                false;

            if (
                event.code === 1000
            ) {

                realRuntime.connectionLabel =
                    'Desconectado';

            } else {

                realRuntime.connectionLabel =
                    'Erro de conexão';

                if (
                    !realRuntime.lastError
                ) {

                    realRuntime.lastError =
                        `Conexão encerrada inesperadamente (código ${event.code}).`;
                }
            }

            scheduleReconnect();
            console.log(
                '[REAL] WebSocket desconectado.'
            );
        }
    );

    return true;
}

// DESCONECTAR

export async function disconnectRealPlant() {
    cancelReconnect();
    reconnectAttempt = 0;

    intentionalDisconnect =
        true;

    const socketToClose =
        realSocket;

    realSocket =
        null;

    if (
        socketToClose &&
        (
            socketToClose.readyState ===
                WebSocket.OPEN ||
            socketToClose.readyState ===
                WebSocket.CONNECTING
        )
    ) {

        try {

            socketToClose.close(
                1000,
                'Desconexão solicitada pela HMI'
            );

        } catch (error) {

            console.warn(
                '[REAL] Erro ao fechar WebSocket:',
                error
            );
        }
    }

    setRealConnectionState(
        false,
        {
            transport:
                'WebSocket',

            port:
                realRuntime.port,

            label:
                'Desconectado'
        }
    );

    realRuntime.lastError =
        null;

    return true;
}
