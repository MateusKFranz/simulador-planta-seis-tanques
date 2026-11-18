// A sequência avança pelo readback, nunca pelo retorno de WebSocket.send().
export class ComponentBatch {
    constructor() { this.items = []; this.active = false; }
    start(items, context, now) {
        if (this.active) return false;
        const invalid = items.find(item => item.error);
        if (!items.length || invalid) { this.items = []; this.message = invalid ? `${invalid.id}: ${invalid.error}` : 'Nenhuma alteração.'; return false; }
        this.items = items.map(item => ({...item, status: 'Pendente'}));
        this.context = context; this.active = true; this.index = 0; this.sentAt = null;
        this.message = ''; this.started = now;
        return true;
    }
    stop(reason) {
        if (this.active && this.sentAt !== null) this.items[this.index].status = 'Sem confirmação';
        this.active = false; this.message = reason;
    }
    tick({context, ready, revision, now, error, validate, confirmed, send}) {
        if (!this.active) return;
        if (!ready || context !== this.context || error) { this.stop(error || 'Sequência interrompida: conexão, fonte, cenário ou autoridade alterada.'); return; }
        const item = this.items[this.index];
        if (this.sentAt !== null) {
            if (revision > this.revision && Object.is(confirmed(item), item.value)) {
                item.status = 'Confirmado'; this.index++; this.sentAt = null;
                if (this.index === this.items.length) { this.active = false; this.message = 'Valores confirmados pelo backend.'; }
            } else if (now - this.sentAt >= 8000) this.stop(`${item.id}: tempo de confirmação esgotado. Restante não enviado.`);
            return;
        }
        const reason = validate(item);
        if (reason) { this.stop(`${item.id}: ${reason}. Restante não enviado.`); return; }
        if (!send(item)) { this.stop(`${item.id}: envio rejeitado. Restante não enviado.`); return; }
        this.sentAt = now; this.revision = revision; item.status = 'Aguardando readback';
    }
    text() { return [this.message, ...this.items.map(i => `${i.id}: ${i.status}`)].filter(Boolean).join('\n'); }
}
