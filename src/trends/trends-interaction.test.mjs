import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const load = async name => import(`data:text/javascript;base64,${Buffer.from(readFileSync(new URL(name, import.meta.url))).toString('base64')}`);
const { timeRange, panTime, zoomTime, bindTimeline, wheelDelta } = await load('./trends-interaction.js');
const { panelHeight, panelLimits, setupTrendsResize, createTrendsWindow } = await load('./trends-panel-layout.js');
const state = () => ({ first: 0, last: 1000, duration: 120, end: 700, follow: false, hasData: true });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6);
class Node {
    events = {}; attributes = {}; style = {}; children = []; captured = null;
    classes = new Set();
    classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) };
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute(name, value) { this.attributes[name] = value; }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
    fire(name, data = {}) { const e = { pointerId: 1, button: 0, clientX: 200, clientY: 40, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...data }; this.events[name]?.(e); return e; }
    append(node) { this.children.push(node); node.parent = this; }
    replaceChildren() { this.children = []; }
    getBoundingClientRect() { return { height: parseFloat(this.style.height) || 400 }; }
}
test('zoom contínuo ancorado, limites, clamp e pan com duração preservada', () => {
    const s = state(), z = zoomTime(s, -5, .3);
    assert.ok(z.duration < 120 && z.duration > 110);
    near(timeRange(s)[0] + .3 * 120, timeRange(z)[0] + .3 * z.duration);
    assert.equal(zoomTime(s, -1e5, .5).duration, 5);
    assert.equal(zoomTime(s, 1e5, .5).duration, 3600);
    assert.equal(panTime(s, -1e5).end, 120);
    assert.equal(panTime(s, 1e5).end, 1000);
    assert.equal(panTime(s, -10).duration, 120);
    assert.deepEqual(timeRange({ ...s, last: 10 }), [-110, 10]);
    const live = zoomTime({ ...s, follow: true }, -100, .2);
    assert.ok(live.follow); assert.equal(timeRange(live)[1], 1000);
    assert.equal(panTime(live, -20).follow, false);
    const restored = { ...live, follow: true, end: null };
    near(restored.duration, live.duration); assert.equal(timeRange(restored)[1], 1000);
});
test('ponteiro principal arrasta conteúdo, ignora outros IDs e encerra em up/cancel', () => {
    const canvas = new Node(), box = new Node(); let s = state();
    bindTimeline(canvas, box, () => ({ left: 0, top: 0, width: 600, height: 200 }), () => s, next => s = next, () => {});
    canvas.fire('pointerdown', { button: 2 }); assert.equal(canvas.captured, null);
    canvas.fire('pointerdown'); assert.equal(canvas.captured, 1);
    canvas.fire('pointermove', { pointerId: 2, clientX: 300 }); assert.equal(s.end, 700);
    canvas.fire('pointermove', { clientX: 300 }); near(s.end, 680); assert.equal(s.follow, false);
    canvas.fire('pointerup'); assert.equal(canvas.captured, null);
    canvas.fire('pointermove', { clientX: 400 }); near(s.end, 680);
    canvas.fire('pointerdown'); canvas.fire('pointercancel'); assert.equal(canvas.captured, null);
    assert.equal(box.classes.size, 0);
});
test('wheel normal faz zoom, Ctrl faz só pan e eventos externos não são consumidos', () => {
    const canvas = new Node(); let s = state();
    bindTimeline(canvas, new Node(), () => ({ left: 0, top: 0, width: 600, height: 200 }), () => s, next => s = next, () => {});
    assert.ok(canvas.fire('wheel', { deltaY: -10 }).prevented);
    assert.ok(s.duration < 120);
    const duration = s.duration, end = s.end;
    assert.ok(canvas.fire('wheel', { deltaY: 30, ctrlKey: true }).prevented);
    near(s.duration, duration); assert.ok(s.end < end);
    assert.ok(!canvas.fire('wheel', { clientY: 900, ctrlKey: true, deltaY: 30 }).prevented);
    assert.equal(wheelDelta({ deltaY: 2, deltaMode: 1 }, 600), 32);
    assert.equal(wheelDelta({ deltaY: 10, deltaMode: 2 }, 600), 240);
});
test('resize integrado respeita limites, direção, persistência e reset por duplo clique', () => {
    const previous = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    try {
        const panel = new Node(), handle = new Node(), storage = new Map([['trends-panel-height', '400']]);
        setupTrendsResize(panel, { clientHeight: 900, querySelector: () => ({ offsetHeight: 60 }) }, handle, () => {},
            { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
        assert.equal(panel.style.height, '400px');
        handle.fire('pointerdown', { clientY: 500 }); handle.fire('pointermove', { clientY: 400 }); handle.fire('pointerup');
        assert.equal(panel.style.height, '500px'); assert.equal(storage.get('trends-panel-height'), '500');
        handle.fire('dblclick'); assert.equal(panel.style.height, `${panelHeight(824 * .55, 824)}px`);
        assert.equal(panelHeight(1e6, 824), panelLimits(824).max);
        assert.equal(panelHeight(-1e6, 824), panelLimits(824).min);
    } finally { globalThis.ResizeObserver = previous; }
});
test('destacar e reacoplar movem a mesma view e fechar pelo X preserva referência', () => {
    const panel = new Node(), host = new Node(), body = new Node(); let visible, opened = 0, focuses = 0;
    panel.history = [1, 2];
    const popup = { document: { body, head: new Node(), documentElement: {}, createElement: () => ({}) }, closed: false,
        focus() { focuses++; }, close() { this.closed = true; }, addEventListener() {} };
    const main = { document: { querySelectorAll: () => [] }, open() { opened++; popup.closed = false; return popup; }, addEventListener() {} };
    const api = createTrendsWindow(panel, host, { show: () => visible = true, hide: () => visible = false, changed() {} }, main);
    api.detach(); assert.equal(body.children[0], panel); api.detach(); assert.equal(opened, 1); assert.equal(focuses, 2);
    api.dock(); assert.equal(host.children.at(-1), panel); assert.deepEqual(panel.history, [1, 2]); assert.ok(visible);
    api.detach(); popup.closed = true; assert.equal(api.alive(), false); assert.equal(visible, false);
    assert.equal(host.children.at(-1), panel);
    assert.doesNotMatch(readFileSync(new URL('./trends-panel-layout.js', import.meta.url), 'utf8'), /WebSocket|setInterval|fetch\(/);
});
