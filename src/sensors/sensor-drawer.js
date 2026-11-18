import { createLevelZeroControls } from './level-zero-controls.js';
const groups = {
    levelSensors: { title: 'NÍVEIS', field: 'heightCm', unit: 'cm', digits: 1 },
    flowSensors: { title: 'VAZÕES', field: 'flow', unit: 'L/min', digits: 2 }
};

export function createSensorDrawer(container, doc = document, options = {}) {
    const element = (tag, className, text = '') => {
        const node = doc.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
    };
    const panel = element('aside', 'sensor-drawer');
    panel.setAttribute('aria-label', 'Sensores da planta');
    const header = element('header', 'sensor-drawer-header');
    const title = element('strong', 'sensor-drawer-title');
    const closeButton = element('button', 'sensor-drawer-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Fechar sensores');
    header.append(title, closeButton);
    const list = element('div', 'sensor-drawer-list');
    const detail = element('div', 'sensor-drawer-detail');
    panel.append(header, list, detail);
    container.append(panel);
    let plant = {}, runtime = {}, group = null, selected = null, opened = false;
    const zeroControls = options.calibrate ? createLevelZeroControls(doc, options.calibrate) : null;
    const snapshot = () => ({ plant, runtime, group, selected });
    if (options.onPopout) {
        const popout = element('button', 'sensor-drawer-popout', '↗');
        popout.type = 'button';
        popout.title = 'Destacar sensores';
        popout.setAttribute('aria-label', popout.title);
        const notice = element('small', 'sensor-drawer-notice');
        header.append(popout);
        panel.append(notice);
        popout.addEventListener('click', () => {
            notice.textContent = options.onPopout(snapshot()) === false ? 'Permita popups neste navegador para destacar os sensores.' : '';
        });
    }
    const rows = new Map();
    const format = (value, digits, unit = '') => Number.isFinite(value)
        ? `${value.toFixed(digits).replace('.', ',')} ${unit}`.trim() : 'Sem leitura';
    const online = () => runtime.connected !== false &&
        (runtime.backendMode !== 'HARDWARE' || runtime.hardware?.serial?.connected === true);
    const valid = sensor => online() && ['available', 'good', 'valid'].includes(sensor.status)
        && sensor.diagnostics?.valid !== false && sensor.diagnostics?.stale !== true;

    function render() {
        options.onSnapshot?.(snapshot());
        if (!opened) return;
        const config = groups[group];
        title.textContent = config.title;
        // Ordena uma cópia, sem modificar o estado nem a topologia.
        const sensors = [...(plant[group] ?? [])].sort((a, b) =>
            Number(a.id.match(/\d+$/)?.[0] ?? Infinity) - Number(b.id.match(/\d+$/)?.[0] ?? Infinity));
        const ids = sensors.map(sensor => sensor.id).join('|');
        if (list.dataset.ids !== ids) {
            list.dataset.ids = ids;
            list.replaceChildren();
            rows.clear();
            for (const sensor of sensors) {
                const button = element('button', 'sensor-drawer-row');
                button.type = 'button';
                const name = element('span', '', sensor.id);
                const value = element('strong', 'sensor-drawer-value');
                button.append(name, value);
                button.addEventListener('click', () => { selected = sensor.id; render(); });
                rows.set(sensor.id, { button, value });
                list.append(button);
            }
        }
        for (const sensor of sensors) {
            const row = rows.get(sensor.id);
            row.button.setAttribute('aria-pressed', String(sensor.id === selected));
            row.value.textContent = format(valid(sensor) ? sensor[config.field] : null, config.digits, config.unit);
        }
        const sensor = sensors.find(item => item.id === selected);
        detail.replaceChildren();
        if (!sensor) { detail.append(element('div', '', 'Sensor indisponível')); return; }
        const states = { available: 'OK', good: 'OK', valid: 'OK', stale: 'Desatualizado',
            uncalibrated: 'Sem calibração', invalid: 'Inválido', unavailable: 'Sem leitura' };
        const diagnostics = sensor.diagnostics ?? {};
        zeroControls?.update(group === 'levelSensors' ? sensor : null, runtime);
        const fresh = online() && ['available', 'good', 'valid', 'uncalibrated'].includes(sensor.status)
            && diagnostics.valid !== false && diagnostics.stale !== true;
        const reading = (value, digits, unit = '') => fresh && Number.isFinite(value) ? format(value, digits, unit) : '—';
        const name = element('strong', 'sensor-drawer-selected', sensor.id);
        const value = element('div', 'sensor-drawer-primary',
            'Valor: ' + format(valid(sensor) && fresh ? sensor[config.field] : null, config.digits, config.unit));
        const raw = element('div', 'sensor-drawer-diagnostics');
        if (runtime.backendMode === 'HARDWARE') {
            const fields = group === 'levelSensors'
                ? [['RAW atual', sensor.raw ?? diagnostics.raw, 0, ''],
                    ['RAW filtrado', diagnostics.filteredRaw, 1, ''],
                    ['RAW médio', diagnostics.rawMean50, 1, '']]
                : [['Pulsos acumulados', sensor.pulses, 0, ''],
                    ['Frequência derivada', sensor.frequency, 3, 'Hz'],
                    ['Vazão bruta recebida', diagnostics.rawFlow, 3, diagnostics.sourceUnit ?? 'unidade não informada']];
            if (group === 'flowSensors' && Number.isFinite(sensor.raw)) fields.push(['RAW', sensor.raw, 3, '']);
            const lines = fields.map(([label, number, digits, unit]) => label + ': ' + reading(number, digits, unit));
            if (group === 'levelSensors')
                lines.push('Amostras: ' + (fresh ? diagnostics.rawMeanCount ?? 0 : 0) + '/' + (diagnostics.rawMeanWindow ?? 10));
            if (group === 'levelSensors' && Number.isFinite(diagnostics.zeroRaw))
                lines.push('RAW de zero: ' + format(diagnostics.zeroRaw, 2));
            if (typeof diagnostics.valid === 'boolean') lines.push('Leitura válida: ' + (online() && diagnostics.stale !== true && fresh ? 'sim' : 'não'));
            raw.textContent = lines.join('\n');
        } else {
            raw.textContent = runtime.backendMode === 'MODELICA' ? 'RAW: — (não aplicável à simulação)' : 'RAW: —';
        }
        const metadata = element('div', 'sensor-drawer-metadata',
            'Status: ' + (online() ? states[sensor.status] ?? 'Sem leitura' : 'Desconectado') +
            '\nFonte: ' + (runtime.backendMode ?? '—'));
        if (runtime.backendMode === 'HARDWARE' && sensor.reason) metadata.textContent += '\n' + sensor.reason;
        detail.append(name, value, raw, metadata);
        if (zeroControls && group === 'levelSensors') detail.append(zeroControls.element);
    }
    function close() {
        opened = false;
        container.classList.remove('sensor-drawer-open');
        panel.classList.remove('is-open');
        panel.inert = true;
        panel.setAttribute('aria-hidden', 'true');
    }
    closeButton.addEventListener('click', close);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    // Os gestos dentro do painel não arrastam nem ampliam o sinótico.
    for (const event of ['pointerdown', 'wheel']) panel.addEventListener(event, e => e.stopPropagation());
    close();
    return {
        open(nextGroup, id) {
            if (!groups[nextGroup]) return;
            group = nextGroup;
            selected = id;
            opened = true;
            container.classList.add('sensor-drawer-open');
            panel.inert = false;
            panel.setAttribute('aria-hidden', 'false');
            panel.classList.add('is-open');
            render();
        },
        close,
        update(nextPlant, nextRuntime) { plant = nextPlant; runtime = nextRuntime; render(); }
    };
}
