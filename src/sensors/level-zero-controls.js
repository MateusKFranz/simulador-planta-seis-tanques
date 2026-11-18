export function canCalibrateZero(sensor, runtime) {
    const d = sensor?.diagnostics ?? {};
    return runtime.backendMode === 'HARDWARE' && runtime.connected === true && runtime.hardware?.serial?.connected === true
        && ['available', 'uncalibrated', 'valid', 'good'].includes(sensor?.status)
        && d.valid === true && d.stale === false && !d.outOfRange
        && Number.isFinite(d.rawMean50) && d.rawMean50 >= 0 && d.rawMean50 <= 1023
        && d.rawMeanCount >= (d.rawMeanWindow ?? 10);
}

export function createLevelZeroControls(doc, send) {
    const make = (tag, text = '') => { const node = doc.createElement(tag); node.textContent = text; return node; };
    const root = make('div'); root.className = 'level-zero-controls';
    const calibrate = make('button', 'Calibrar 0 cm');
    const restore = make('button', 'Restaurar calibração de zero'); restore.className = 'level-zero-restore';
    const dialog = make('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Confirmar calibração de zero');
    const explanation = make('p'), cancel = make('button', 'Cancelar'), confirm = make('button', 'Confirmar 0 cm');
    dialog.append(explanation, cancel, confirm); dialog.hidden = true;
    const status = make('p'); status.setAttribute('role', 'status');
    root.append(calibrate, restore, dialog, status);
    for (const b of [calibrate, restore, cancel, confirm]) b.type = 'button';
    let sensor, runtime, key = null, request = null, busy = false;
    const number = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : 'Sem leitura';
    function refresh() {
        root.hidden = !sensor || runtime.backendMode !== 'HARDWARE';
        calibrate.hidden = !canCalibrateZero(sensor, runtime);
        restore.hidden = sensor?.diagnostics?.zeroIsField !== true;
        calibrate.disabled = restore.disabled = busy || !runtime.connected;
        dialog.hidden = !request;
        confirm.disabled = busy || !runtime.connected ||
            (request?.action === 'calibrate' && !Number.isFinite(request.raw));
    }
    function prepare(action) {
        if (busy || (action === 'calibrate' && !canCalibrateZero(sensor, runtime))) return;
        request = { action, id: sensor.id, raw: sensor.diagnostics?.rawMean50 };
        explanation.textContent = action === 'calibrate'
            ? `Confirmar calibração de ${sensor.id} em 0 cm?\nRAW capturado: ${number(request.raw)}\nValor no instante da captura: ${number(sensor.heightCm)} cm\nConfirme que o nível físico deste tanque está realmente em 0 cm. O RAW capturado permanecerá fixo mesmo que a telemetria continue mudando.`
            : `Restaurar a calibração de zero de ${sensor.id} ao padrão do projeto?`;
        confirm.textContent = action === 'calibrate' ? 'Confirmar 0 cm' : 'Confirmar restauração';
        status.textContent = ''; refresh();
    }
    calibrate.addEventListener('click', () => prepare('calibrate'));
    restore.addEventListener('click', () => prepare('restore'));
    cancel.addEventListener('click', () => { request = null; status.textContent = ''; refresh(); });
    confirm.addEventListener('click', async () => {
        if (!request || confirm.disabled) return;
        const current = request, selected = key;
        busy = true; refresh(); status.textContent = 'Aguardando confirmação do backend…';
        try {
            const result = await send(current.action, current.id, current.raw);
            if (key === selected) status.textContent = result.message;
        } catch (error) {
            if (key === selected) status.textContent = `Não confirmado: ${error.message}`;
        } finally { request = null; busy = false; refresh(); }
    });
    return { element: root, update(nextSensor, nextRuntime) {
        const nextKey = `${nextRuntime.backendMode}:${nextSensor?.id}`;
        if (key !== nextKey) { request = null; status.textContent = ''; key = nextKey; }
        sensor = nextSensor; runtime = nextRuntime; refresh();
    } };
}
