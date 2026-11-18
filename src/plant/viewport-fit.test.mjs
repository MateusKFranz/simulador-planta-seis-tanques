import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const source = readFileSync(new URL('./viewport-fit.js', import.meta.url), 'utf8');
const { fitViewport, observeViewport } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const bounds = { x: -30, y: 70, width: 1400, height: 720 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);

test('fit respeita largura, altura, proporção e margens centradas', () => {
    const wide = fitViewport(bounds, 1548, 832);
    const narrow = fitViewport(bounds, 1164, 650);
    assert.ok(wide.fitScale > narrow.fitScale);
    assert.ok(fitViewport(bounds, 1548, 400).fitScale < wide.fitScale);
    for (const [w, h] of [[1548, 832], [1164, 650], [800, 450], [500, 900]]) {
        const f = fitViewport(bounds, w, h);
        near(f.scale, f.fitScale);
        near(f.x + (bounds.x + bounds.width / 2) * f.scale, w / 2);
        near(f.y + (bounds.y + bounds.height / 2) * f.scale, h / 2);
        assert.ok(bounds.width * f.scale <= w * .94 + 1e-8);
        assert.ok(bounds.height * f.scale <= h * .94 + 1e-8);
    }
    assert.equal(fitViewport(bounds, 0, 0), null);
    assert.equal(fitViewport(null, 100, 100), null);
});

test('bbox JointJS inclui componentes e vértices dos links, sem depender do zoom', () => {
    const { dia, shapes } = createRequire(import.meta.url)('@joint/core');
    const graph = new dia.Graph({}, { cellNamespace: shapes });
    const element = new shapes.standard.Rectangle({ position: { x: 0, y: 0 }, size: { width: 100, height: 80 } });
    const link = new shapes.standard.Link({ source: { id: element.id }, target: { x: 300, y: 200 }, vertices: [{ x: 400, y: -60 }] });
    graph.addCells([element, link]);
    const bbox = graph.getBBox();
    assert.equal(bbox.x, 0);
    assert.equal(bbox.y, -60);
    assert.equal(bbox.width, 400);
    assert.equal(bbox.height, 260);
});

const viewSource = readFileSync(new URL('./plant-view.js', import.meta.url), 'utf8');
const viewportMethods = viewSource.slice(viewSource.indexOf('    resize() {'), viewSource.indexOf('    createViewportControls()'));
const View = new Function('fitViewport', `return class {${viewportMethods}}`)(fitViewport);
function view() {
    const v = new View();
    Object.assign(v, { userZoom: 1, fitScale: 1, viewportZoom: 1, viewportMinZoom: .55, viewportMaxZoom: 2.5,
        paperContainer: { style: {}, clientWidth: 1548, clientHeight: 832 },
        graph: { getBBox: () => bounds }, updateCoordinateOverlay() {},
        paper: { setDimensions() {}, scale(x, y) { near(x, y); }, translate() {} } });
    return v;
}

test('zoom manual multiplica fit, preserva âncora; resize sem deriva e reset ao automático', () => {
    const v = view();
    v.resize();
    const original = v.fitScale;
    const anchor = (300 - v.viewportPanX) / v.viewportZoom;
    v.setViewportZoom(1.1, 300, 200);
    near(v.userZoom, 1.1);
    near(v.fitScale, original);
    near(v.viewportZoom, original * 1.1);
    near(v.viewportPanX + anchor * v.viewportZoom, 300);
    for (let i = 0; i < 30; i++) {
        v.paperContainer.clientWidth = 800; v.resize();
        v.paperContainer.clientWidth = 1548; v.resize();
    }
    near(v.viewportZoom, original * 1.1);
    v.resetViewport();
    near(v.userZoom, 1);
    near(v.viewportZoom, original);
    near(v.viewportPanX + (bounds.x + bounds.width / 2) * v.viewportZoom, 1548 / 2);
    // As funções reais executam sem transporte nem callbacks de comandos.
    assert.doesNotMatch(viewportMethods, /send.*Command|WebSocket|fetch\(/);
});

test('ResizeObserver agrupa notificações, recalcula fit e cancela ao destruir', () => {
    const v = view();
    let notify, frame, cancelled = false, disconnected = false, schedules = 0;
    class Observer {
        constructor(fn) { notify = fn; }
        observe(container) { assert.equal(container, v.paperContainer); }
        disconnect() { disconnected = true; }
    }
    const observer = observeViewport(v.paperContainer, () => v.resize(), Observer,
        fn => { frame = fn; schedules++; return 12; }, id => { assert.equal(id, 12); cancelled = true; });
    notify(); notify(); assert.equal(schedules, 1); frame();
    const wide = v.fitScale;
    v.paperContainer.clientWidth = 800; notify(); frame();
    assert.ok(v.fitScale < wide);
    notify(); observer.disconnect();
    assert.ok(disconnected && cancelled);
});
