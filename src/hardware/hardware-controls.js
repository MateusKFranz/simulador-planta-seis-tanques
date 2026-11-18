import { realRuntime, getRealViewRuntime, hardwareConnectionReady, hardwareCommandPending, sendHardwareCommand } from '../connection/real.js';
import './hardware-controls.css';

export function createHardwareControls() {
    const section = document.createElement('section');
    section.className = 'control-section hardware-manual';
    section.hidden = true;
    section.innerHTML = `<h3>Segurança da planta real</h3>
        <p class="hw-state"></p>
        <div class="hw-actions">
            <button data-action="arm">Habilitar controle</button><button data-action="disarm">Desarmar</button>
            <button data-action="plant_reset">Resetar comandos</button>
            <button data-action="estop" class="hw-stop">Emergency Stop</button><button data-action="reset">Reset Fault</button>
        </div>
        <p class="hw-error" role="status"></p><p class="hw-reset-result" role="status"></p>
        <p>OY1/OY2: associação A/B provisória. LV1–LV4 habilitadas para teste em 10°–80°; sincronize antes de mover.</p>`;
    document.getElementById('real-connection-section').after(section);
    const controls = Object.fromEntries([...section.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));
    let resetAwaiting = false, previousReset = null;
    for (const [action, button] of Object.entries(controls)) button.addEventListener('click', () => {
        const sent = sendHardwareCommand(action);
        if (action === 'plant_reset') {
            previousReset = realRuntime.hardware?.control?.plantReset?.id;
            resetAwaiting = sent;
            section.querySelector('.hw-reset-result').textContent = sent
                ? 'Aguardando confirmação do reset físico.' : 'Reset físico não pôde ser confirmado: controle desconectado ou incompatível.';
        }
    });
    return {update() {
        section.hidden = getRealViewRuntime().mode !== 'real';
        if (section.hidden) return;
        const c=realRuntime.hardware?.control ?? {}, connected=hardwareConnectionReady();
        const data=connected ? c.confirmed : null;
        const busy=c.busy || hardwareCommandPending();
        section.querySelector('.hw-state').textContent = !connected ? 'Aquisição somente leitura ou controle desconectado.' :
            `${c.armed ? 'Armado' : 'Desarmado'} · ${data?.fault ?? 'aguardando confirmação'}${busy ? ' · comando pendente' : ''}`;
        section.querySelector('.hw-error').textContent=c.lastError ?? c.fault ?? '';
        const reset = c.plantReset;
        if (resetAwaiting && !connected) {
            section.querySelector('.hw-reset-result').textContent = 'Reset físico não pôde ser confirmado: conexão indisponível.';
            resetAwaiting = false;
        } else if (connected && reset && (!resetAwaiting || reset.id !== previousReset)) {
            section.querySelector('.hw-reset-result').textContent = reset.message;
            if (reset.status !== 'pending') resetAwaiting = false;
        }
        controls.plant_reset.disabled = !connected || !c.compatible;
        controls.arm.disabled = !connected || !c.ready || c.armed || busy;
        controls.disarm.disabled = controls.estop.disabled = !connected;
        controls.reset.disabled = !connected || busy;
    }};
}
