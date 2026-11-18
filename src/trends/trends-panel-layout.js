export function panelLimits(available) {
    const max = Math.max(80, available - Math.min(180, available * .4));
    return { min: Math.min(320, max), max };
}
export function panelHeight(value, available) {
    const { min, max } = panelLimits(available);
    return Math.round(Math.max(min, Math.min(max, value)));
}

export function setupTrendsResize(panel, host, handle, redraw, storage = localStorage) {
    const key = 'trends-panel-height';
    let preferred = null, drag = null;
    try { preferred = Number(storage.getItem(key)) || null; } catch { /* Persistência opcional. */ }
    const available = () => Math.max(100, host.clientHeight - (host.querySelector('.topbar')?.offsetHeight ?? 0) - 16);
    const apply = value => {
        if (panel.classList.contains('tv-detached')) return;
        const height = panelHeight(value ?? available() * .55, available());
        panel.style.height = `${height}px`;
        const limits = panelLimits(available());
        handle.setAttribute('aria-valuenow', height);
        handle.setAttribute('aria-valuemin', limits.min);
        handle.setAttribute('aria-valuemax', limits.max);
        redraw();
    };
    const save = () => { try { storage.setItem(key, String(preferred)); } catch { /* Persistência opcional. */ } };
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag) return;
        event.preventDefault();
        drag = { id: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height };
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('resizing');
    });
    handle.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        preferred = panelHeight(drag.height + drag.y - event.clientY, available());
        apply(preferred);
    });
    const stop = event => {
        if (!drag || event.pointerId !== drag.id) return;
        drag = null; handle.classList.remove('resizing');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        if (preferred !== null) save();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, stop);
    handle.addEventListener('dblclick', () => { preferred = panelHeight(available() * .55, available()); apply(preferred); save(); });
    handle.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        preferred = panelHeight(panel.getBoundingClientRect().height + (event.key === 'ArrowUp' ? 20 : -20), available());
        apply(preferred); save();
    });
    const observer = new ResizeObserver(() => apply(preferred)); observer.observe(host);
    apply(preferred);
    return { apply: () => apply(preferred), destroy: () => observer.disconnect() };
}

// Move a mesma view: histórico, canvases, listeners e registro continuam na principal.
export function createTrendsWindow(panel, host, { show, hide, changed }, main = window) {
    let popup = null, closing = false;
    function restore(visible) {
        const old = popup; popup = null;
        host.append(panel); panel.classList.remove('tv-detached');
        visible ? show() : hide(); changed(false);
        if (old && !old.closed) old.close();
    }
    function alive() {
        if (popup?.closed) restore(false);
        return popup !== null;
    }
    function detach() {
        if (alive()) { popup.focus(); return true; }
        const win = main.open('', 'plant-trends', 'popup,width=1200,height=850,resizable=yes,scrollbars=yes');
        if (!win) return false;
        popup = win;
        const doc = win.document;
        doc.title = 'Tendências e dados'; doc.documentElement.lang = 'pt-BR';
        doc.body.replaceChildren();
        for (const style of main.document.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.append(style.cloneNode(true));
        const style = doc.createElement('style');
        style.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden}';
        doc.head.append(style); panel.classList.add('tv-detached'); doc.body.append(panel);
        show(); changed(true); win.focus();
        win.addEventListener('pagehide', () => { if (!closing && popup === win) restore(false); });
        return true;
    }
    main.addEventListener('pagehide', () => { closing = true; if (popup && !popup.closed) popup.close(); });
    return { detach, alive, focus: () => { if (alive()) popup.focus(); }, dock: () => restore(true) };
}
