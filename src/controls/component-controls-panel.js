import './component-controls-panel.css';

// Os controles e seus listeners continuam pertencendo à aplicação principal.
export function createComponentControlsPanel(groups) {
    const panel = document.createElement('section');
    panel.className = 'interface-panel component-controls-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Controle dos componentes');
    panel.innerHTML = `<header><strong>Controle dos componentes</strong><div>
        <button class="detach" title="Destacar" aria-label="Destacar">↗</button><button class="dock" title="Reacoplar" aria-label="Reacoplar" hidden>↙</button>
        <button class="close" aria-label="Fechar controles" title="Fechar e reacoplar" hidden>×</button></div></header>
        <div class="component-bulk"><div class="op-buttons"><button class="apply-all">Aplicar todos</button>
        <button class="discard-all">Descartar todos</button><span class="draft-count"></span></div>
        <p class="batch-validation" role="status"></p><p class="batch-status" role="status"></p></div>
        <p class="popup-status" role="status"></p><div class="component-groups"></div>`;
    const content = panel.querySelector('.component-groups');
    content.append(...groups);
    const home = document.createComment('Controle dos componentes');
    const recover = document.createElement('button');
    recover.textContent = '↙'; recover.title = 'Reacoplar controles'; recover.setAttribute('aria-label', recover.title);
    recover.className = 'components-recover'; recover.hidden = true;
    document.querySelector('.sidebar-scroll').prepend(panel, home, recover);
    let popup = null, closing = false;
    const detach = panel.querySelector('.detach'), dock = panel.querySelector('.dock');
    const close = panel.querySelector('.close');
    function restore() {
        const old = popup; popup = null;
        home.before(panel); panel.classList.remove('components-detached');
        detach.hidden = false; dock.hidden = close.hidden = recover.hidden = true;
        if (old && !old.closed) old.close();
    }
    close.onclick = dock.onclick = recover.onclick = restore;
    detach.onclick = () => {
        if (popup && !popup.closed) { popup.focus(); return; }
        const win = window.open('', 'plant-components', 'popup,width=420,height=760,resizable=yes,scrollbars=yes');
        if (!win) {
            panel.querySelector('.popup-status').textContent = 'Popup bloqueado. Use o painel aqui ou permita popups neste site.';
            return;
        }
        popup = win;
        win.document.title = 'Controle dos componentes';
        win.document.documentElement.lang = 'pt-BR';
        win.document.body.replaceChildren();
        for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) win.document.head.append(style.cloneNode(true));
        panel.querySelector('.popup-status').textContent = '';
        panel.classList.add('components-detached');
        win.document.body.append(panel); detach.hidden = true; dock.hidden = close.hidden = recover.hidden = false;
        win.addEventListener('pagehide', () => { if (!closing && popup === win) restore(); });
        win.focus();
    };
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && popup) restore(); });
    window.addEventListener('pagehide', () => { closing = true; if (popup && !popup.closed) popup.close(); });
    return panel;
}
