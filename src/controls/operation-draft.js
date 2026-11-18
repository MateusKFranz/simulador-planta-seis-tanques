// Rascunho local: editar e descartar nunca enviam comandos.
export class Draft {
    constructor() { this.confirmed = null; this.value = null; this.dirty = false; }
    receive(value) { this.confirmed = value; if (Object.is(this.value, value)) this.dirty = false; if (!this.dirty) this.value = value; }
    edit(value) { this.value = value; this.dirty = true; }
    discard() { this.value = this.confirmed; this.dirty = false; }
    apply(send) { return send(this.value); }
}
