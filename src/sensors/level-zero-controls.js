export function parseMeasuredHeight(text) {
    const value = String(text ?? '').trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(value)) return null;
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) && number >= 0 ? number : null;
}
export function canCalibrateZero(sensor, runtime) {
    const d = sensor?.diagnostics ?? {};
    return runtime.backendMode === 'HARDWARE' && runtime.connected === true && runtime.hardware?.serial?.connected === true
        && ['available','uncalibrated','valid','good','outside_calibration','calibration_warning'].includes(sensor?.status)
        && d.valid === true && d.stale === false && !d.outOfRange
        && Number.isFinite(d.rawMean50) && d.rawMean50 >= 0 && d.rawMean50 <= 1023
        && (d.rawMeanWindow ?? 10) === 10 && d.rawMeanCount >= 10;
}

export function createLevelZeroControls(doc, send) {
    const make = (tag, text = '') => { const node = doc.createElement(tag); node.textContent = text; return node; };
    const root = make('div'); root.className = 'level-zero-controls';
    const calibrate = make('button', 'Calibrar 0 cm');
    const restore = make('button', 'Restaurar ajustes deste sensor'); restore.className = 'level-zero-restore';
    const dialog = make('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Confirmar calibração');
    const explanation = make('p'), cancel = make('button', 'Cancelar'), confirm = make('button', 'Confirmar');
    dialog.append(explanation, cancel, confirm); dialog.hidden = true;
    const status = make('p'); status.setAttribute('role', 'status');
    root.append(calibrate, restore, dialog, status);
    const label = make('label','Altura medida (cm)'), height = make('input');
    height.type = 'text'; height.inputMode = 'decimal'; height.setAttribute('aria-label','Altura medida (cm)'); label.append(height);
    const add = make('button','Adicionar ponto'), count = make('p'), table = make('table'), quality = make('p');
    const technical = make('details'), technicalSummary = make('summary','Detalhes técnicos'), technicalText = make('p');
    table.className = 'calibration-points'; quality.className = 'calibration-quality';
    technical.append(technicalSummary,technicalText);
    root.append(label,add,count,table,quality,technical);
    for (const b of [calibrate,restore,cancel,confirm,add]) b.type = 'button';
    let sensor, runtime = {}, key = null, request = null, busy = false, tableKey = null;
    const number = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', {maximumFractionDigits:6}) : '—';
    const points = () => sensor?.diagnostics?.calibrationPoints ?? [];
    function refresh() {
        root.hidden = !sensor || (runtime.backendMode ?? runtime.lastBackendMode) !== 'HARDWARE';
        const fresh = canCalibrateZero(sensor,runtime), connected = runtime.connected === true;
        calibrate.hidden = false; calibrate.disabled = busy || !fresh;
        add.disabled = busy || !fresh || points().length >= 5 || parseMeasuredHeight(height.value) === null;
        height.disabled = busy;
        restore.hidden = !points().length && sensor?.diagnostics?.zeroIsField !== true;
        restore.disabled = busy || !connected;
        count.textContent = `${points().length}/5 pontos · ${fresh ? 'Média de 10 leituras pronta' : 'Captura indisponível: aguarde 10 leituras válidas e conexão Serial'}`;
        dialog.hidden = !request;
        confirm.disabled = busy || !connected || (request?.raw !== undefined && !fresh);
        const d = sensor?.diagnostics ?? {};
        const warning = d.calibrationWarning ?? '';
        const onePoint = warning.includes('Um ponto: offset com ganho provisório');
        quality.textContent = onePoint ? warning.replace('Um ponto: offset com ganho provisório', '').trim() : warning;
        technicalText.textContent = d.calibrationMode === 'linear'
            ? `h = ${number(d.slope)} × RAW + ${number(d.intercept)}\nErro RMS: ${number(d.rmseCm)} cm\nFaixa: ${d.heightRange?.map(number).join(' a ')} cm; RAW ${d.rawRange?.map(number).join(' a ')}\nResíduos (cm): ${d.residualsCm?.map(number).join('; ')}`
            : onePoint ? 'Um ponto: offset com ganho provisório' : '';
        technical.hidden = !technicalText.textContent;
        const nextTable = JSON.stringify([key,points(),busy,connected,fresh]);
        if (tableKey !== nextTable) {
            tableKey = nextTable; table.replaceChildren();
            const head = make('tr'); head.append(make('th','Altura (cm)'),make('th','RAW médio'),make('th','Ações')); table.append(head);
            for (const point of points()) {
                const row = make('tr'), actions = make('td');
                const replace = make('button','Substituir'), remove = make('button','Excluir');
                replace.type = remove.type = 'button'; replace.disabled = busy || !fresh; remove.disabled = busy || !connected;
                replace.addEventListener('click',()=>prepare('replace',point));
                remove.addEventListener('click',()=>prepare('delete',point));
                actions.append(replace,remove); row.append(make('td',number(point.heightCm)),make('td',number(point.raw)),actions); table.append(row);
            }
        }
    }
    function prepare(action, point) {
        const capture = ['calibrate','add','replace'].includes(action);
        if (busy || (capture && !canCalibrateZero(sensor,runtime))) return;
        const cm = action === 'calibrate' ? 0
            : action === 'replace' && !height.value.trim() ? point.heightCm : parseMeasuredHeight(height.value);
        if (capture && cm === null) { status.textContent = 'Informe uma altura medida válida (por exemplo 5,7 cm).'; return; }
        if (capture && Number.isFinite(sensor.diagnostics.heightLimitCm) && cm > sensor.diagnostics.heightLimitCm) { status.textContent = 'Altura acima da geometria física medida.'; return; }
        if (action === 'calibrate') point = points().find(p=>p.heightCm===0);
        if (capture && !point && points().length >= 5) { status.textContent = 'Limite de cinco pontos; substitua ou exclua um.'; return; }
        const raw = capture ? sensor.diagnostics.rawMean50 : null;
        if (capture) {
            const index = point ? points().findIndex(p => p.heightCm === point.heightCm && p.raw === point.raw) : -1;
            const outros = points().filter((_, i) => i !== index);
            if (outros.some(p => p.heightCm === cm)) {
                status.textContent = 'Altura já registrada em outro ponto.'; return;
            }
            if (outros.some(p => Math.abs(p.raw - raw) < 1e-6)) {
                status.textContent = 'RAW indistinguível de outro ponto.'; return;
            }
            const ordenados = [...outros, { heightCm: cm, raw }].sort((a, b) => a.heightCm - b.heightCm);
            if (ordenados.some((p, i) => i > 0 && p.raw <= ordenados[i - 1].raw)) {
                status.textContent = 'O RAW deve aumentar com a altura.'; return;
            }
        }
        request = {action: action === 'calibrate' ? point ? 'replace' : 'add' : action, id:sensor.id,
            ...(capture ? {raw, heightCm:cm} : {}), ...(point ? {point:{...point}} : {})};
        explanation.textContent = capture
            ? `${point ? 'Substituir ponto' : 'Registrar ponto'} de ${sensor.id}?\nAltura física informada: ${number(cm)} cm\nRAW capturado: ${number(request.raw)}`
            : action === 'delete' ? `Excluir ponto de ${sensor.id}: ${number(point.heightCm)} cm / RAW ${number(point.raw)}?` : `Restaurar os ajustes de ${sensor.id}? Todos os pontos deste sensor serão removidos; os demais serão preservados.`;
        confirm.textContent = point && capture ? 'Confirmar substituição' : action === 'restore' ? 'Confirmar restauração' : action === 'delete' ? 'Confirmar exclusão' : 'Confirmar ponto';
        status.textContent = ''; refresh();
    }
    height.addEventListener('input',refresh);
    add.addEventListener('click',()=>prepare('add'));
    calibrate.addEventListener('click',()=>prepare('calibrate'));
    restore.addEventListener('click',()=>prepare('restore'));
    cancel.addEventListener('click',()=>{request=null;status.textContent='';refresh();});
    confirm.addEventListener('click',async()=>{
        if (!request || confirm.disabled) return;
        const current=request, selected=key;
        busy=true;refresh();status.textContent='Aguardando confirmação do backend…';
        try {
            const details = {...(current.heightCm !== undefined ? {heightCm:current.heightCm} : {}), ...(current.point ? {point:current.point} : {})};
            const result=await send(current.action,current.id,current.raw,details);
            if (key===selected) status.textContent=result.message;
        } catch(error) { if (key===selected) status.textContent=`Não confirmado: ${error.message}`; }
        finally {request=null;busy=false;refresh();}
    });
    return {element:root,update(nextSensor,nextRuntime) {
        const nextKey=`${nextRuntime.backendMode}:${nextSensor?.id}`;
        if (key!==nextKey) {request=null;status.textContent='';height.value='';key=nextKey;}
        sensor=nextSensor;runtime=nextRuntime;refresh();
    }};
}
