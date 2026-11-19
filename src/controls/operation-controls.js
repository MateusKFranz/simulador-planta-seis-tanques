import { realPlant, getRealViewRuntime, canSendOperationCommand, sendOperationCommand,
    applyManualActuator, hardwareCommandPending, canCommandComponent, canRecordManualPosition, manualPositionResult } from '../connection/real.js';
import { createComponentControlsPanel } from './component-controls-panel.js';
import { ComponentBatch } from './component-batch.js';
import { setupFloatingEditor } from '../ui/floating-editor.js';
import { Draft } from './operation-draft.js';
import './operation-controls.css';

export const oyStateLabel = value => ({ A: 'A ON / B OFF', B: 'A OFF / B ON', RELEASE: 'RELEASE' })[value] ?? '—';
const fmt = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', {maximumFractionDigits: 1}) : '—';
export function openOperationActuator(id, anchor) {
    document.dispatchEvent(new CustomEvent('operation-actuator', {detail: {id:id.split('_')[0], anchor}}));
}

export function createOperationControls() {
    const section = document.createElement('section');
    section.className = 'control-section operation-controls';
    section.innerHTML = `<h2>Modo de operação</h2><p class="op-error" role="status"></p>
        <div class="op-buttons"><button data-mode="MANUAL">Manual</button><button data-mode="AUTO">Automático</button></div><small class="mode-block"></small>
        <details class="op-requirements"><summary>Condições do automático</summary><p class="op-blocks"></p><small class="op-fixed"></small></details>`;
    section.dataset.collapsible = 'false';
    document.querySelector('.sidebar-fixed').append(section);
    for (const b of section.querySelectorAll('[data-mode]')) b.onclick = () => sendOperationCommand({type:'operation',mode:b.dataset.mode});
    const requirements = section.querySelector('.op-requirements');
    const summaries = new Map();
    const sidebarRows = new Map();
    const groups = [];
    for (const [title, ids] of [['Bombas',['JIC1','JIC3','JIC4']],
        ['Válvulas 3 vias',['OY1','OY2']], ['Válvulas atuadas',['LV1','LV2','LV3','LV4']],
        ['Válvulas manuais',Array.from({length:9},(_,i)=>`HV${i+1}`)]]) {
        const group = document.createElement('section');
        group.className = 'control-section actuator-shortcuts';
        const heading = document.createElement('h2'); heading.textContent = title;
        group.append(heading);
        for (const id of ids) {
            const button = document.createElement('button'); button.type = 'button';
            button.className = 'actuator-shortcut'; button.dataset.actuator = id;
            button.setAttribute('aria-label', `Abrir ${id}`);
            const name = document.createElement('strong'); name.textContent = id;
            const value = document.createElement('small'); button.append(name, value);
            button.onclick = () => openOperationActuator(id, button.ownerDocument === document ? button.getBoundingClientRect() : null);
            const card = document.createElement('div'); card.className = 'actuator-card'; card.dataset.id = id;
            card.append(button); group.append(card);
            summaries.set(id, value); sidebarRows.set(id, card);
        }
        groups.push(group);
    }
    const panel = createComponentControlsPanel(groups);
    const batch = new ComponentBatch();
    const submitted = new Map();
    const applyAll = panel.querySelector('.apply-all'), discardAll = panel.querySelector('.discard-all');
    const faceplate = document.createElement('section');
    faceplate.className = 'operation-controls actuator-faceplate';
    faceplate.hidden = true;
    faceplate.setAttribute('role', 'dialog');
    faceplate.setAttribute('aria-label', 'Equipamento');
    faceplate.innerHTML = '<header><strong class="actuator-title"></strong><button aria-label="Fechar equipamento">×</button></header><div class="op-actuators"></div>';
    document.body.append(faceplate);
    const floating = setupFloatingEditor(faceplate);
    faceplate.querySelector('header button').onclick = () => { faceplate.hidden = true; };
    faceplate.addEventListener('keydown', e => { if (e.key === 'Escape') faceplate.hidden = true; });
    document.addEventListener('workspace-panel-open', () => { faceplate.hidden = true; });
    const times = document.createElement('div');
    times.className = 'op-times operation-controls';
    document.querySelector('.sidebar-scroll').append(times);
    const rows = new Map();
    for (const id of ['JIC1','JIC3','JIC4','LV1','LV2','LV3','LV4','OY1','OY2',...Array.from({length:9},(_,i)=>`HV${i+1}`)]) {
        const row = document.createElement('details');
        row.innerHTML = `<summary>${id}</summary><p class="confirmed"></p><p class="requested"></p><p class="reason"></p><label class="unit-label">Desejado
            <select class="unit"><option value="percent">Abertura (%)</option><option value="angle">Ângulo (°)</option></select></label>
            <input class="value" type="number" min="0" step="1"><select class="branch" aria-label="Estado desejado"><option value="A">A ON / B OFF</option><option value="B">A OFF / B ON</option><option value="RELEASE">RELEASE</option></select><div class="oy-choices"></div>
            <p class="component-note" hidden></p><p class="draft-status"></p><div class="op-buttons"><button class="apply">Aplicar</button><button class="discard">Descartar</button><button class="stop">${id.startsWith('JIC')?'Zerar':'Parar pulso'}</button></div>
            <label class="sync-label">Referência física atual (°)<input class="sync" type="number" step="1"><button class="sync-button">Sincronizar sem pulsos</button></label>`;
        const pump=id.startsWith('JIC'), oy=id.startsWith('OY'), hv=id.startsWith('HV'), draft=new Draft();
        const input=row.querySelector('.value'), branch=row.querySelector('.branch'), unit=row.querySelector('.unit');
        row.open = true; row.hidden = true;
        input.setAttribute('aria-label', pump ? 'PWM desejado' : 'Valor desejado');
        const sidebar = sidebarRows.get(id);
        const sidebarDesired = document.createElement('small'); sidebarDesired.className = 'sidebar-desired';
        sidebar.append(sidebarDesired);
        const choices = row.querySelector('.oy-choices');
        choices.hidden = !oy;
        const sidebarChoices = document.createElement('div'); sidebarChoices.className = 'oy-choices';
        if (oy) sidebar.append(sidebarChoices);
        if (oy) for (const container of [choices, sidebarChoices]) for (const state of ['A','B','RELEASE']) {
            const button = document.createElement('button'); button.type = 'button';
            button.textContent = oyStateLabel(state); button.dataset.state = state;
            button.onclick = () => { if(button.disabled) return; branch.value = state; draft.edit(state); update(); };
            container.append(button);
        }
        const slider = oy ? null : document.createElement('input');
        const sidebarSlider = oy ? null : document.createElement('input');
        if (!oy) {
            for (const control of [slider, sidebarSlider]) {
                control.type = 'range'; control.step = '1'; control.min = '0'; control.max = pump ? '255' : '100';
                control.setAttribute('aria-label', `${pump ? 'PWM' : 'Abertura'} desejado ${id}`);
                control.className = 'actuator-slider';
            }
            input.before(slider); sidebar.append(sidebarSlider);
            slider.oninput = () => {
                if(slider.disabled) return;
                draft.edit(slider.valueAsNumber); input.value = slider.value; update();
            };
            sidebarSlider.oninput = () => {
                if(sidebarSlider.disabled) return;
                unit.value = 'percent'; draft.edit(sidebarSlider.valueAsNumber);
                input.value = sidebarSlider.value; update();
            };
        }
        const sidebarActions = document.createElement('div'); sidebarActions.className = 'op-buttons';
        sidebarActions.innerHTML = '<button class="apply">Aplicar</button><button class="discard">Descartar</button>';
        sidebar.append(sidebarActions);
        input.max=pump?255:100; input.hidden=oy; branch.hidden=true;
        row.querySelector('.unit-label').hidden=pump||oy||hv;
        row.querySelector('.stop').hidden=oy||hv;
        const edit=()=> { draft.edit(oy?branch.value:input.valueAsNumber); update(); };
        input.oninput=branch.onchange=edit;
        unit.onchange=()=> { draft.discard(); update(); };
        const discard=()=>{
            if (batch.active) batch.stop('Sequência interrompida pelo descarte individual. Restante não enviado.');
            if (submitted.has(id)) { batch.message = 'Comando em trânsito: aguarde o readback antes de descartar.'; update(); return; }
            draft.discard(); input.value=oy?'':draft.value??''; update();
        };
        row.querySelector('.discard').onclick=sidebar.querySelector('.discard').onclick=discard;
        row.querySelector('.apply').onclick=sidebar.querySelector('.apply').onclick=()=> {
            if(row.querySelector('.apply').disabled) return;
            if (!validateItem(id)) sendItem({id, value:draft.value, unit:unit.value});
            update();
        };
        row.querySelector('.stop').onclick=()=>{
            if (batch.active) batch.stop('Sequência interrompida por comando individual de parada.');
            applyManualActuator(id,0,pump?'percent':'stop');
        };
        const sync=row.querySelector('.sync');
        row.querySelector('.sync-button').onclick=()=> {
            if(sync.value!=='' && sync.validity.valid) applyManualActuator(id,sync.valueAsNumber,'sync');
        };
        faceplate.querySelector('.op-actuators').append(row);
        rows.set(id,{row,draft,input,branch,unit,pump,oy,hv,slider,sidebarSlider,sidebar,sidebarDesired});
    }
    const timing = new Map();
    for (const id of ['OY1','OY2']) {
        const row=document.createElement('details');
        row.innerHTML=`<summary>${id} · tempos automáticos</summary><label>A (s)<input type="number" min="0" step="0.1"></label><label>B (s)<input type="number" min="0" step="0.1"></label><button>Aplicar tempos</button>`;
        const inputs=[...row.querySelectorAll('input')], drafts=inputs.map(()=>new Draft());
        inputs.forEach((input,i)=>input.oninput=()=>drafts[i].edit(input.valueAsNumber));
        row.querySelector('button').onclick=()=>{
            if(inputs.every(i=>i.value!=='' && i.validity.valid) && drafts[0].value+drafts[1].value>0)
                sendOperationCommand({type:'xv',id,tA:drafts[0].value,tB:drafts[1].value});
        };
        times.append(row); timing.set(id,{row,inputs,drafts});
    }
    document.addEventListener('operation-actuator',e=> {
        const id = typeof e.detail === 'string' ? e.detail : e.detail?.id;
        if (!rows.has(id)) return;
        for (const [key, {row}] of rows) row.hidden = key !== id;
        const runtime = getRealViewRuntime();
        const channel = runtime.backendMode === 'HARDWARE' ? runtime.hardware?.control?.pumpChannels?.[id] : null;
        faceplate.querySelector('.actuator-title').textContent = id + (channel ? ' / Pump' + channel : '');
        faceplate.hidden = false;
        update();
        floating.open(e.detail?.anchor);
        faceplate.querySelector('header button').focus();
    });
    let source=null, lastReset=null, previousContext=null;
    const context = r => JSON.stringify([r.backendMode, r.scenario, r.operation?.mode, r.operation?.fixed,
        Object.entries(r.loops ?? {}).map(([id,l]) => [id,l.effectiveMode,l.mvTarget])]);
    function validateItem(id) {
        const item = rows.get(id);
        if (!item || !item.allowed) return item?.reason || 'Controle indisponível';
        if (submitted.has(id)) return 'Comando aguardando readback';
        if (item.oy) return ['A','B', ...(getRealViewRuntime().backendMode === 'HARDWARE' ? ['RELEASE'] : [])].includes(item.draft.value) ? '' : 'Estado inválido';
        return Number.isFinite(item.draft.value) && item.input.value !== '' && item.input.validity.valid
            ? '' : 'Valor fora da faixa ou inválido';
    }
    function sendItem(item) {
        if (!applyManualActuator(item.id, item.value, item.unit)) return false;
        submitted.set(item.id, {value:item.value, time:Date.now(), revision:getRealViewRuntime().lastUpdate});
        return true;
    }
    applyAll.onclick = () => {
        update();
        if (getRealViewRuntime().backendMode !== 'MODELICA' || batch.active) return;
        const items = [...rows].filter(([,item]) => item.draft.dirty).map(([id,item]) => ({
            id, value:item.draft.value, unit:item.unit.value, error:validateItem(id)
        }));
        batch.start(items, context(getRealViewRuntime()), Date.now());
        update();
    };
    discardAll.onclick = () => {
        if (batch.active) batch.stop('Sequência interrompida pelo descarte. Comandos já enviados não são desfeitos.');
        for (const [id,item] of rows) if (!submitted.has(id)) {
            item.draft.discard(); item.input.value = item.oy ? '' : item.draft.value ?? '';
        }
        batch.message = submitted.size ? 'Comando em trânsito preservado; demais rascunhos descartados.' : 'Rascunhos locais descartados. Nenhum comando enviado.';
        update();
    };
    function update() {
        for (const id of ['pump-controls','central-valve-controls','output-valve-controls','split-valve-controls','manual-valve-controls']) {
            const old=document.getElementById(id)?.closest('section'); if(old) old.hidden=true;
        }
        const r=getRealViewRuntime(), hardware=r.backendMode==='HARDWARE', enabled=canSendOperationCommand();
        const c=r.hardware?.control, data=c?.confirmed, mode=r.operation?.mode??'MANUAL';
        const currentContext = context(r);
        if (previousContext && previousContext !== currentContext && [...rows.values()].some(item=>item.draft.dirty))
            batch.message = 'Fonte, cenário ou autoridade alterada. Revise os rascunhos pendentes antes de aplicar.';
        previousContext = currentContext;
        const reset = hardware && c?.plantReset?.status === 'confirmed' ? c.plantReset.id : null;
        const resetDrafts = reset && reset !== lastReset;
        if (reset) lastReset = reset;
        if(source!==r.backendMode) {
            if (source && [...rows.values()].some(i=>i.draft.dirty)) batch.message = 'Rascunhos invalidados pela troca de fonte.';
            submitted.clear();
            for(const {draft} of rows.values()) draft.discard(); source=r.backendMode; }
        section.querySelector('.op-error').textContent = r.lastError ?? '';
        const blockedCount = r.operation?.autoBlocked?.length ?? 0;
        section.querySelector('.mode-block').textContent = !r.connected ? 'Aguardando conexão' :
            blockedCount ? `Automático indisponível · ${blockedCount} pendência${blockedCount === 1 ? '' : 's'}` : 'Automático disponível';
        requirements.querySelector('.op-blocks').textContent = !r.connected ? 'Sem conexão' :
            (r.operation?.autoBlocked?.length ? r.operation.autoBlocked.join(' · ') : 'Nenhum bloqueio informado pelo backend.');
        requirements.querySelector('.op-fixed').textContent='Saídas fixas do cenário: '+Object.values(r.operation?.fixed??{}).flatMap(group=>Object.entries(group).map(([id,value])=>`${id} ${fmt(value*100)}%`)).join(' · ');
        for(const b of section.querySelectorAll('[data-mode]')) {
            const active = r.connected && !!r.backendMode && b.dataset.mode === mode;
            b.classList.toggle('is-active', Boolean(active));
            b.setAttribute('aria-pressed', String(Boolean(active)));
            b.disabled=!enabled || (b.dataset.mode==='AUTO' && !!r.operation?.autoBlocked?.length);
        }
        for(const [id,{row,draft,input,branch,unit,pump,oy,hv,slider,sidebarSlider,sidebar,sidebarDesired}] of rows) {
            const v=hardware && Array.isArray(data?.valves) ? data.valves.find(v=>Array.isArray(v) && v[1] && `LV${v[0]}`===id) : null;
            const p=hardware?data?.pumps?.[c?.pumpChannels?.[id]-1]:null;
            const loop=Object.values(r.loops??{}).find(l=>l.mvTarget?.id===id);
            const fixed=Object.values(r.operation?.fixed??{}).some(group=>group && Object.hasOwn(group,id));
            const auto=!(hardware && hv) && mode==='AUTO' && (oy||fixed||loop?.effectiveMode==='AUTO');
            const hasReadback = pump ? Array.isArray(p) && Number.isFinite(p[0])
                : oy ? [0,1,2].includes(data?.oy?.[Number(id.at(-1))-1])
                : Array.isArray(v) && Number.isFinite(v[2]);
            const hvKind = id === 'HV9' ? 'mainValve' : ['HV7','HV8'].includes(id) ? 'recycleValve' : 'manualValve';
            const ready=hardware && hv ? canRecordManualPosition() : enabled && (!hv || canCommandComponent(hvKind,id)) && (!hardware||hasReadback && c?.ready && c?.armed && !c?.busy && !hardwareCommandPending());
            let confirmed;
            if (hv) {
                const valve = id === 'HV9' ? realPlant.mainValve : [...realPlant.manualValves,...realPlant.recycleValves].find(v=>v.id===id);
                confirmed = Number.isFinite(valve?.opening) ? valve.opening*100 : null;
            } else if(pump) {
                const model=realPlant.pumps.find(p=>p.id===id);
                confirmed=hardware?p?.[0]:model?.command==null?null:Math.round((model.power?model.command:0)*255);
            } else if(oy) {
                const value=hardware?data?.oy?.[Number(id.at(-1))-1]:null;
                const model=realPlant.threeWayValves.find(v=>v.id===id);
                confirmed=hardware?['RELEASE','A','B'][value]:model?.branches.A.state?'A':model?.branches.B.state?'B':null;
            } else confirmed=hardware?(unit.value==='angle'?v?.[3]:v?.[2]):(realPlant.actuatedValves.find(v=>v.id===id)?.opening??NaN)*100;
            if(confirmed<0 || typeof confirmed==='number' && !Number.isFinite(confirmed)) confirmed=null;
            // Remove apenas o resíduo binário da conversão de fração para percentual.
            if ((!hardware || hv) && !pump && !oy && Number.isFinite(confirmed)) confirmed = Number(confirmed.toFixed(8));
            draft.receive(confirmed);
            const pending = submitted.get(id);
            const record = hardware && hv ? manualPositionResult(id) : null;
            if (pending && (r.lastUpdate > pending.revision && Object.is(confirmed,pending.value) && (!hardware || !hv || record?.success === true) ||
                record?.success === false && record?.pending === false ||
                Date.now()-pending.time >= 8000 || !r.connected || r.lastError)) submitted.delete(id);
            if (resetDrafts) { draft.discard(); submitted.delete(id); }
            row.querySelector('.confirmed').textContent=pump?`PWM atual: ${fmt(confirmed)} / 255 · ${fmt(confirmed==null?null:confirmed/255*100)} %`:
                oy?`Estado atual: ${oyStateLabel(confirmed)}`:
                hardware && !hv?`Abertura atual: ${fmt(v?.[2]<0?null:v?.[2])}% · Ângulo atual: ${fmt(v?.[3]<0?null:v?.[3])}° · ${!v?'BLOQUEADA':!v[5]?'NÃO SINCRONIZADA':v[7]?'MOVENDO':'PARADA'}`:hardware && hv ? `Posição informada: ${confirmed == null ? 'Não informada' : fmt(confirmed)+' %'}` : `Abertura atual: ${fmt(confirmed)} %`;
            summaries.get(id).textContent = (auto ? 'AUTO · ' : '') + (pump
                ? `${fmt(confirmed)} / 255 · ${fmt(confirmed == null ? null : confirmed / 255 * 100)}%`
                : oy ? oyStateLabel(confirmed) : hardware && !hv
                ? !v ? 'Sem leitura' : !v[5] ? 'Não sincronizada' : `${fmt(v[2] < 0 ? null : v[2])}% · ${fmt(v[3] < 0 ? null : v[3])}°`
                : hardware && hv ? confirmed == null ? 'Não informada' : `Informada: ${fmt(confirmed)}%` : `${fmt(confirmed)}%`);
            if (!pump && !oy && !hv) row.querySelector('.confirmed').title = 'Último ângulo confirmado pelo controlador; não é uma medição física da posição.';
            const reason=hv && hardware ? '' : auto?'Sob autoridade automática':hardware?(pump?!p?.[1]?'Sentido da bomba não configurado':'':oy?'':!v?'Associação/limites ausentes':!v[5]?'LV não sincronizada':''):'';
            row.querySelector('.reason').textContent=reason || (hardware && hv ? ready ? '' : 'Sem conexão com o backend' : !enabled ? 'Controle indisponível nesta conexão' : hardware && !ready ? 'Controle bloqueado: verifique conexão, ARM e pendências no painel de segurança' : '');
            const note = row.querySelector('.component-note');
            note.textContent = hardware ? (oy ? 'Associação A/B provisória.' : hv
                ? 'A posição começa em 0% no software e pode ser informada pelo operador. Sem medição ou acionamento físico.'
                : !pump ? 'Faixa 10°–80°; sincronize antes de mover.' : '') : '';
            note.hidden = !note.textContent;
            const item = rows.get(id);
            item.allowed = ready && !reason; item.reason = row.querySelector('.reason').textContent;
            row.querySelector('.apply').disabled=sidebar.querySelector('.apply').disabled=!ready||!!reason||batch.active||submitted.has(id);
            row.querySelector('.discard').disabled=sidebar.querySelector('.discard').disabled=submitted.has(id);
            input.disabled = branch.disabled = batch.active || !ready || !!reason; unit.disabled = batch.active || submitted.has(id);
            row.querySelector('.stop').disabled=!ready;
            row.querySelector('.sync-label').hidden=!hardware||pump||oy||hv;
            row.querySelector('.sync-button').disabled=!ready||!v||auto;
            unit.querySelector('[value="angle"]').disabled=!hardware||!v;
            if(!hardware) unit.value='percent';
            input.min=unit.value==='angle'&&v?v[10]:0;
            input.max=pump?255:unit.value==='angle'&&v?v[11]:100;
            if(v) {row.querySelector('.sync').min=v[10];row.querySelector('.sync').max=v[11];}
            branch.querySelector('option:last-child').disabled=!hardware;
            if(input.ownerDocument.activeElement!==input) input.value=oy?'':draft.value??'';
            if(oy && draft.value) branch.value=draft.value;
            row.querySelector('.requested').textContent = pump
                ? 'PWM desejado: ' + fmt(draft.value) + ' / 255 · ' + fmt(draft.value == null ? null : draft.value / 255 * 100) + '%'
                : oy ? 'Estado desejado: ' + oyStateLabel(draft.value)
                : (unit.value === 'angle' ? 'Ângulo desejado: ' : 'Abertura desejada: ') + fmt(draft.value) + (unit.value === 'angle' ? '°' : '%');
            if (!pump && !oy && v && unit.value === 'percent' && Number.isFinite(draft.value))
                row.querySelector('.requested').textContent += ' · Ângulo desejado: ' + fmt(v[8]+Math.trunc((v[9]-v[8])*draft.value/100)) + '°';
            if (!oy) {
                slider.min=input.min; slider.max=input.max;
                slider.setAttribute('aria-label', `${pump ? 'PWM' : unit.value === 'angle' ? 'Ângulo' : 'Abertura'} desejado ${id}`);
                slider.disabled=sidebarSlider.disabled=!ready||!!reason||batch.active;
                slider.value=Number.isFinite(draft.value)?draft.value:slider.min;
                // A sidebar apresenta em %, usando os mesmos extremos confirmados da LV.
                const percent = unit.value === 'angle' && v
                    ? Number.isFinite(draft.value) && v[9] !== v[8] ? (draft.value-v[8])*100/(v[9]-v[8]) : null
                    : draft.value;
                sidebarSlider.value=Number.isFinite(percent)?percent:0;
                sidebarDesired.textContent=pump
                    ? `Desejado ${fmt(draft.value)} / 255 · ${fmt(draft.value==null?null:draft.value/255*100)}%`
                    : `Desejado ${fmt(percent)}%`;
            } else sidebarDesired.textContent='Desejado: '+oyStateLabel(draft.value);
            for (const container of [row, sidebar]) for (const b of container.querySelectorAll('[data-state]')) {
                b.disabled = !ready || !!reason || batch.active || b.dataset.state === 'RELEASE' && !hardware;
                b.setAttribute('aria-pressed', String(b.dataset.state === draft.value));
            }
            row.querySelector('.draft-status').textContent=hardware && hv && submitted.has(id) ? 'Aguardando confirmação de registro…' : hardware && hv && record?.pending === false && !record.success ? record.message : draft.dirty?'Rascunho local — use Aplicar ou Descartar':hardware && hv && record?.pending === false ? record.message : '';
        }
        batch.tick({
            context:context(r), ready:enabled && r.backendMode === 'MODELICA', revision:r.lastUpdate,
            now:Date.now(), error:r.lastError, validate:item=>validateItem(item.id),
            confirmed:item=>rows.get(item.id).draft.confirmed, send:sendItem
        });
        const dirty = [...rows.values()].filter(item=>item.draft.dirty);
        panel.querySelector('.draft-count').textContent = `${dirty.length} alterações`;
        const invalid = !batch.active && [...rows].filter(([,item])=>item.draft.dirty)
            .map(([id])=>({id,error:validateItem(id)})).find(item=>item.error);
        panel.querySelector('.batch-validation').textContent = invalid ? `${invalid.id}: ${invalid.error}` : hardware && dirty.length ? 'Lote HARDWARE indisponível. Aplique individualmente e aguarde confirmação.' : '';
        applyAll.disabled = !dirty.length || !enabled || hardware || batch.active || submitted.size > 0 || !!invalid;
        discardAll.disabled = !dirty.length && !batch.active;
        panel.querySelector('.batch-status').textContent = batch.text();
        for(const [id,{row,inputs,drafts}] of timing) {
            inputs.forEach((input,i)=>{drafts[i].receive(r.xv?.[id]?.[i?'tB':'tA']);if(input.ownerDocument.activeElement!==input)input.value=drafts[i].value??'';});
            row.querySelector('button').disabled=!enabled;
        }
    }
    return {update};
}
