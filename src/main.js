import { sendLevelZeroCommand } from './connection/real.js';
import { setupInterfacePanels } from './ui/interface-panels.js';
import { createSensorDrawer } from './sensors/sensor-drawer.js';
import { createSensorPopout } from './sensors/sensor-popout.js';
import './sensors/sensor-drawer.css';
import { setupWorkspaceControls } from './ui/workspace-controls.js';
import { PlantView } from './plant/plant-view.js';
import { createTrendsPanel } from './trends/trends-panel.js';
import { createLoopControls } from './controls/loop-controls.js';
import { createOperationControls, openOperationActuator } from './controls/operation-controls.js';
import { createHardwareControls } from './hardware/hardware-controls.js';
import { realPlant, realRuntime, getRealViewRuntime, connectRealPlant,
    disconnectRealPlant, selectBackendMode, sendSimulationCommand, subscribeBackendSnapshot,
    toggleRealPump, setRealPumpCommand, setRealMainValveOpening, setRealActuatedValveOpening,
    setRealRecycleValveOpening, setRealManualValveOpening } from './connection/real.js';

/*
  HMI CONECTADA
  Simulação usa MODELICA; Planta real usa HARDWARE. Nenhum integrador local.
*/
let operatingMode = 'simulation';
const getRuntime = () => ({ ...getRealViewRuntime(), mode: operatingMode });
const updateView = () => { plantView.update(realPlant, getRuntime()); loopControls?.update(); hardwareControls?.update(); operationControls?.update(); sensorDrawer?.update(realPlant, getRuntime()); };
let sensorDrawer = null;
let loopControls = null;
let hardwareControls = null;
let operationControls = null;
const endpoint = new URLSearchParams(location.search).get('ws') || 'ws://localhost:8765';

// Reapresenta o snapshot confirmado após cada gesto, sem atualização otimista.
const dispatch = action => (...args) => { action(...args); updateView(); };
const plantView = new PlantView({
    onSensorSelect: (group, id) => sensorDrawer?.open(group, id),
    onStartPause: dispatch(() => sendSimulationCommand({ running: !realRuntime.sim?.running })),
    onReset: dispatch(() => sendSimulationCommand({ reset: true })),
    onSimulationSpeedChange: dispatch(speed => sendSimulationCommand({ speed: Number(speed) })),
    onInitialLevelChange: dispatch((id, fraction) => sendSimulationCommand({ levels: { [id]: fraction * realRuntime.sim?.tankHeightCm } })),
    onPumpToggle: dispatch(openOperationActuator),
    onPumpCommandChange: dispatch(openOperationActuator),
    onMainValveChange: dispatch(setRealMainValveOpening),
    onActuatedValveChange: dispatch(openOperationActuator),
    onRecycleValveChange: dispatch(setRealRecycleValveOpening),
    onManualValveChange: dispatch(setRealManualValveOpening),
    onModeChange: mode => {
        if (!['simulation', 'real'].includes(mode)) return;
        operatingMode = mode;
        selectBackendMode(mode === 'simulation' ? 'MODELICA' : 'HARDWARE');
        updateView();
        if (!realRuntime.connected && !realRuntime.connecting) connectRealPlant(endpoint);
    },
    onRealConnectToggle: async () => {
        if (realRuntime.connected) await disconnectRealPlant();
        else await connectRealPlant(endpoint);
        updateView();
    }
});

// Gráficos continuam somente leitura.
const trends = createTrendsPanel();
const sensorPopout = createSensorPopout(createSensorDrawer);
sensorDrawer = createSensorDrawer(plantView.paperContainer.parentElement, document,
    { onPopout: sensorPopout.open, onSnapshot: sensorPopout.sync, calibrate: sendLevelZeroCommand });
subscribeBackendSnapshot((plant, runtime) => {
    updateView();
    trends.update(plant, runtime);
});
loopControls = createLoopControls();
hardwareControls = createHardwareControls();
operationControls = createOperationControls();
setupInterfacePanels();
setupWorkspaceControls();
selectBackendMode('MODELICA');
updateView();
connectRealPlant(endpoint);
// Atualiza apenas a apresentação e a animação dos fluxos recebidos.
setInterval(updateView, 100);
