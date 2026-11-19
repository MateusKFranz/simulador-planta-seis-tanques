let serial = 0;
const pending = new Map();
export function requestLevelZero(send, action, id, raw, details = {}) {
    const requestId = `zero-${Date.now()}-${++serial}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Tempo de confirmação excedido. Confira o RAW de zero antes de repetir.')); }, 5000);
        pending.set(requestId, { id, resolve, reject, timer });
        try { send({ ...details, type: 'level_zero', requestId, action, id, ...(['calibrate','add','replace'].includes(action) ? { rawMean50: raw } : {}) }); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
}
export function receiveLevelZero(message) {
    const request = pending.get(message.requestId);
    if (!request || message.id !== request.id) return;
    clearTimeout(request.timer); pending.delete(message.requestId);
    if (message.success === true) request.resolve(message);
    else request.reject(new Error(message.message ?? 'Calibração recusada.'));
}
