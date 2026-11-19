// A popup recebe somente cópias da telemetria; não carrega a aplicação ou o transporte.
export function sensorSnapshot({ plant, runtime, group, selected }) {
    return JSON.parse(JSON.stringify({
        plant: { levelSensors: plant.levelSensors ?? [], flowSensors: plant.flowSensors ?? [] },
        runtime: { backendMode: runtime.backendMode, lastBackendMode: runtime.lastBackendMode, connected: runtime.connected,
            hardware: { serial: { connected: runtime.hardware?.serial?.connected === true } } },
        group, selected
    }));
}

export function createSensorPopout(createDrawer, host = window) {
    let popup = null, drawer = null, previous = null;
    function sync(state) {
        if (!popup || popup.closed || !drawer) return;
        const snapshot = sensorSnapshot(state);
        drawer.update(snapshot.plant, snapshot.runtime);
        if (!previous || previous.group !== snapshot.group || previous.selected !== snapshot.selected)
            drawer.open(snapshot.group, snapshot.selected);
        previous = { group: snapshot.group, selected: snapshot.selected };
    }
    function open(state) {
        if (popup && !popup.closed) { sync(state); popup.focus(); return true; }
        popup = host.open('', 'plant-sensors', 'popup,width=380,height=760,resizable=yes,scrollbars=yes');
        if (!popup) return false;
        const doc = popup.document;
        doc.title = 'Sensores da planta';
        doc.documentElement.lang = 'pt-BR';
        doc.body.replaceChildren();
        for (const node of host.document.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.append(node.cloneNode(true));
        const style = doc.createElement('style');
        style.textContent = 'body{margin:0;background:#eef0f1;font-family:Arial,sans-serif}.sensor-drawer{position:relative;inset:auto;width:100%;max-width:none;min-height:100vh;box-shadow:none;border:0;border-radius:0;transform:none}.sensor-drawer-close{display:none}';
        doc.head.append(style);
        drawer = createDrawer(doc.body, doc);
        popup.addEventListener('keydown', event => { if (event.key === 'Escape') popup.close(); });
        previous = null;
        sync(state);
        popup.focus();
        return true;
    }
    // Recarregar/fechar a principal encerra a janela de leitura, sem reconexão própria.
    host.addEventListener('pagehide', () => { if (popup && !popup.closed) popup.close(); drawer = null; });
    return { open, sync };
}
