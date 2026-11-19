import { createTrends } from './trends.js';
import { setupTrendsResize, createTrendsWindow } from './trends-panel-layout.js';
import './trends.css';

export function createTrendsPanel() {
    const host = document.querySelector('.main-area');
    const trends = createTrends(host, {
        onSelectionChange: () => resize.keepHeight(),
        onPlotResize: delta => resize.plotResized(delta)
    });
    const panel = trends.element, bar = panel.querySelector('.tv-bar');
    const button = (text, label = text) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        b.setAttribute('aria-label', label); b.title = label; return b;
    };
    const open = button('Tendências e dados');
    open.className = 'experiment-open-button';
    const recover = button('↙', 'Reacoplar tendências');
    recover.className = 'trends-recover'; recover.hidden = true;
    const close = button('×', 'Fechar tendências');
    const popout = button('↗', 'Destacar tendências');
    const dock = button('↙', 'Reacoplar tendências'); dock.hidden = true;
    const notice = document.createElement('small');
    bar.prepend(popout, dock, close); bar.append(notice);
    const handle = document.createElement('div');
    handle.className = 'tv-resize-handle'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', 'Altura de Tendências; duplo clique restaura');
    panel.prepend(handle);
    const resize = setupTrendsResize(panel, host, handle, trends.redraw);
    const hide = () => { trends.hide(); open.setAttribute('aria-expanded', 'false'); };
    const show = () => { trends.show(); open.setAttribute('aria-expanded', 'true'); };
    const detached = createTrendsWindow(panel, host, { show, hide, changed: value => {
        recover.hidden = dock.hidden = !value; popout.hidden = value;
        handle.hidden = value; close.hidden = value;
        if (!value) resize.apply();
        trends.redraw();
    } });
    open.onclick = () => {
        if (detached.alive()) { detached.focus(); return; }
        document.dispatchEvent(new CustomEvent('workspace-panel-open', { detail: 'trends' }));
        show(); resize.apply(); close.focus();
    };
    popout.onclick = () => { notice.textContent = detached.detach() ? '' : 'Permita popups para destacar Tendências.'; };
    dock.onclick = recover.onclick = () => {
        document.dispatchEvent(new CustomEvent('workspace-panel-open', { detail: 'trends' }));
        detached.dock();
    };
    close.onclick = () => { hide(); open.focus(); };
    document.addEventListener('workspace-panel-open', event => { if (event.detail !== 'trends' && !detached.alive()) hide(); });
    host.append(open, recover);
    return { ...trends, update(plant, runtime) {
        detached.alive();
        trends.update(plant, runtime);
    } };
}
