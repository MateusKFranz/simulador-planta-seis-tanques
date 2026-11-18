import { getRealViewRuntime, canSendOperationCommand, selectScenario, sendLoopCommand } from '../connection/real.js';
import './loop-controls.css';

const format = value => Number.isFinite(value)
    ? value.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—';

// Operação das malhas publicadas pelo backend.
export function createLoopControls() {
    const scenarioLabel = document.createElement('label');
    scenarioLabel.className = 'control-label';
    scenarioLabel.textContent = 'Cenário';
    const scenarioSelect = document.createElement('select');
    scenarioSelect.id = 'control-scenario';
    scenarioLabel.append(scenarioSelect);
    document.querySelector('.sidebar-scroll').prepend(scenarioLabel);
    const sidebarLabel = document.createElement('label');
    sidebarLabel.className = 'control-label sidebar-scenario';
    sidebarLabel.textContent = 'Cenário';
    const sidebarSelect = document.createElement('select');
    sidebarSelect.id = 'sidebar-scenario'; sidebarLabel.append(sidebarSelect);
    document.querySelector('.sidebar-scroll').prepend(sidebarLabel);
    const scenarioSelectors = [scenarioSelect, sidebarSelect];

    const section = document.createElement('section');
    section.id = 'loop-controls';
    section.className = 'control-section';
    section.innerHTML = '<h2>Malhas de controle</h2><div class="loop-list"></div>';
    document.querySelector('.sidebar-scroll').prepend(section);
    const list = section.querySelector('.loop-list');

    const faceplate = document.createElement('section');
    faceplate.className = 'loop-faceplate';
    faceplate.hidden = true;
    faceplate.setAttribute('role', 'dialog');
    faceplate.setAttribute('aria-label', 'Malha de controle');
    faceplate.innerHTML = `<header><div><strong class="loop-title"></strong><small class="loop-description"></small></div>
        <button type="button" aria-label="Fechar malha">×</button></header>
        <div class="loop-body"><div class="loop-readings"></div><p class="loop-status"></p>
        <div class="loop-operation"></div><details><summary>Sintonia</summary><div class="loop-tuning"></div></details>
        <small>Valores aplicados após confirmação do backend. MV em escala 0–1.</small></div>`;
    document.body.append(faceplate);
    let selected = null, scenario = null, scenarioOptions = '', loopIds = '';
    const fields = new Map();
    const drafts = new Set();
    const rows = new Map();
    let returnFocus = null;
    const close = () => { selected = null; faceplate.hidden = true; returnFocus?.focus(); };
    faceplate.querySelector('header button').onclick = close;
    document.addEventListener('workspace-panel-open', () => { selected = null; faceplate.hidden = true; });
    faceplate.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

    function field(key, labelText, options, tuning = false) {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement(options ? 'select' : 'input');
        input.dataset.field = key;
        if (options) for (const [value, text] of options) input.add(new Option(text, value));
        else { input.type = 'number'; input.step = 'any'; }
        label.append(input);
        faceplate.querySelector(tuning ? '.loop-tuning' : '.loop-operation').append(label);
        fields.set(key, input);
        input.addEventListener('input', () => drafts.add(key));
        input.addEventListener('change', () => drafts.add(key));

    }
    field('mode', 'Modo desejado', [['AUTO', 'AUTO'], ['MAN', 'MAN']]);
    field('sp', 'SP');
    field('mv', 'MV manual (0–1)');
    for (const [key, label] of Object.entries({ kp: 'Kp', ti: 'Ti (s)', td: 'Td (s)', b: 'b', c: 'c',
        n: 'N', ftt: 'FTt', uBias: 'U bias', uMin: 'U mínimo', uMax: 'U máximo' })) field(key, label, null, true);

    for (const select of scenarioSelectors) select.onchange = () => {
        selectScenario(select.value);
        update(); // Ambos voltam ao cenário confirmado até chegar o readback.
    };
    const apply = document.createElement('button'), discard = document.createElement('button');
    apply.textContent = 'Aplicar alterações'; discard.textContent = 'Descartar';
    faceplate.querySelector('.loop-body').append(apply, discard);
    apply.onclick = () => {
        const command = {}, tuning = {};
        for (const key of drafts) {
            const input = fields.get(key);
            if (input.disabled) continue;
            if (key !== 'mode' && (input.value === '' || !input.validity.valid)) return;
            const value = key === 'mode' ? input.value : input.valueAsNumber;
            if (['mode','sp','mv'].includes(key)) command[key] = value;
            else tuning[({uBias:'u_bias',uMin:'u_min',uMax:'u_max'})[key] ?? key] = value;
        }
        if (Object.keys(tuning).length) command.tuning = tuning;
        if (sendLoopCommand(selected, command)) drafts.clear();
    };
    discard.onclick = () => update(true);

    // Arraste altera somente a posição da janela.
    const header = faceplate.querySelector('header');
    header.onpointerdown = event => {
        if (faceplate.closest('.automation-panel') || event.button !== 0 || event.target.closest('button')) return;
        const bounds = faceplate.getBoundingClientRect();
        const x = event.clientX, y = event.clientY;
        header.setPointerCapture(event.pointerId);
        header.onpointermove = move => {
            faceplate.style.left = `${Math.max(0, Math.min(innerWidth - bounds.width, bounds.left + move.clientX - x))}px`;
            faceplate.style.top = `${Math.max(0, Math.min(innerHeight - 48, bounds.top + move.clientY - y))}px`;
            faceplate.style.right = 'auto';
        };
        header.onlostpointercapture = () => { header.onpointermove = null; };
        header.onpointerup = up => header.releasePointerCapture(up.pointerId);
    };

    function update(force = false) {
        if (force) drafts.clear();
        const runtime = getRealViewRuntime();
        const enabled = canSendOperationCommand();
        scenarioLabel.hidden = sidebarLabel.hidden = section.hidden = !enabled;
        for (const select of scenarioSelectors) select.disabled = !enabled;
        if (!enabled) { faceplate.hidden = true; selected = null; return; }
        const available = runtime.scenarios ?? [];
        const options = JSON.stringify(available.map(s => [s.id, s.nome]));
        if (options !== scenarioOptions) {
            scenarioOptions = options;
            for (const select of scenarioSelectors) select.replaceChildren(...available.map(s => new Option(s.nome, s.id)));
        }
        for (const select of scenarioSelectors) select.value = runtime.scenario ?? available[0]?.id ?? '';
        const loops = runtime.loops ?? {};
        if (scenario !== runtime.scenario) {
            scenario = runtime.scenario;
            selected = null;
            faceplate.hidden = true;
            force = true;
            drafts.clear();
        }
        const ids = JSON.stringify(Object.keys(loops));
        if (ids !== loopIds) {
            loopIds = ids;
            rows.clear(); list.replaceChildren();
            for (const id of Object.keys(loops)) {
                const button = document.createElement('button');
                button.type = 'button'; button.dataset.loop = id;
                button.onclick = () => {
                    selected = id; returnFocus = button; faceplate.hidden = false;
                    update(true); faceplate.querySelector('header button').focus();
                };
                rows.set(id, button); list.append(button);
            }
        }
        for (const [id, button] of rows) {
            const loop = loops[id];
            button.textContent = `${id} · ${loop.effectiveMode ?? loop.mode} · PV ${format(loop.pv)} ${loop.unit ?? ''}`;
        }
        const loop = loops[selected];
        if (!loop) { faceplate.hidden = true; return; }
        faceplate.querySelector('.loop-title').textContent = loop.tag ?? selected;
        faceplate.querySelector('.loop-description').textContent = loop.descricao ?? '';
        faceplate.querySelector('.loop-readings').textContent =
            `PV ${format(loop.pv)} ${loop.unit ?? ''} · SP ${format(loop.sp)} ${loop.unit ?? ''} · MV ${format(loop.mv)}`;
        faceplate.querySelector('.loop-status').textContent =
            `Modo atual: ${loop.effectiveMode ?? loop.mode} · Qualidade: ${loop.quality ?? '—'} · Atuador: ${loop.mvTarget?.id ?? '—'} · Ação: ${{ direct: 'direta', reverse: 'reversa' }[loop.action] ?? '—'}`;
        fields.get('sp').parentElement.firstChild.textContent = `SP (${loop.unit ?? '—'})`;
        for (const [key, input] of fields) {
            input.disabled = !enabled || loop[key] == null ||
                (key === 'mv' && fields.get('mode').value !== 'MAN' && runtime.operation?.mode !== 'MANUAL');
            if (force || input.disabled || !drafts.has(key)) {
                input.value = key === 'mv' && Number.isFinite(loop[key]) ? Number(loop[key].toFixed(4)) : loop[key] ?? '';
            }
            if (key === 'sp' || key === 'mv') {
                const min = loop[key === 'sp' ? 'spMin' : 'uMin'];
                const max = loop[key === 'sp' ? 'spMax' : 'uMax'];
                if (Number.isFinite(min)) input.min = min; else input.removeAttribute('min');
                if (Number.isFinite(max)) input.max = max; else input.removeAttribute('max');
            }
        }
    }
    return { update };
}
