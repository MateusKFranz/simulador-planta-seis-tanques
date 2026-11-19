export const MIN_DURATION = 5;
export const MAX_DURATION = 3600;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const durationLimit = value => clamp(value, MIN_DURATION, MAX_DURATION);

export function timeRange(state) {
    const { first, last, duration, follow, end } = state;
    const right = follow || end == null ? last : clamp(end, Math.min(last, first + duration), last);
    return [right - duration, right];
}
export function panTime(state, seconds) {
    const end = timeRange(state)[1] + seconds;
    const next = { ...state, follow: false, end };
    return { ...next, end: timeRange(next)[1] };
}
export function zoomTime(state, delta, anchor) {
    const [, currentEnd] = timeRange(state);
    const duration = durationLimit(state.duration * Math.exp(delta * .002));
    if (duration === state.duration) return state;
    const anchored = { ...state, duration, follow: false,
        end: currentEnd + (1 - anchor) * (duration - state.duration) };
    const end = timeRange(anchored)[1];
    return { ...anchored, end, follow: state.follow && end === state.last };
}
export function wheelDelta(event, pageSize) {
    return clamp(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1), -240, 240);
}

// Única implementação de gestos para o canvas integrado ou destacado.
export function bindTimeline(canvas, box, geometry, read, write, hover) {
    let drag = null;
    const inside = (e, g) => g.width > 0 && g.height >= 20 &&
        e.clientX >= g.left && e.clientX <= g.left + g.width &&
        e.clientY >= g.top && e.clientY <= g.top + g.height;
    canvas.addEventListener('pointerdown', event => {
        const g = geometry();
        if (event.button !== 0 || drag || !read().hasData || !inside(event, g)) return;
        event.preventDefault();
        drag = { id: event.pointerId, x: event.clientX, state: read(), width: g.width };
        canvas.setPointerCapture(event.pointerId);
        box.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', event => {
        const g = geometry();
        if (drag) {
            if (event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x;
            if (Math.abs(dx) < 2) return;
            hover(null);
            write(panTime({ ...drag.state, first: read().first, last: read().last }, -dx * drag.state.duration / drag.width));
        } else {
            const [start] = timeRange(read());
            hover(inside(event, g) ? start + (event.clientX - g.left) / g.width * read().duration : null);
        }
    });
    const stop = event => {
        if (!drag || drag.id !== event.pointerId) return;
        const id = drag.id;
        drag = null;
        box.classList.remove('dragging');
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        hover(null);
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, stop);
    canvas.addEventListener('pointerleave', () => { if (!drag) hover(null); });
    canvas.addEventListener('dragstart', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
        const g = geometry();
        if (drag || !inside(event, g)) return;
        const state = read(), delta = wheelDelta(event, g.width);
        if (!state.hasData || !delta) return;
        const next = event.ctrlKey ? panTime(state, -delta / g.width * state.duration)
            : zoomTime(state, delta, (event.clientX - g.left) / g.width);
        if (next.duration === state.duration && timeRange(next)[1] === timeRange(state)[1]) return;
        event.preventDefault();
        event.stopPropagation();
        hover(null);
        write(next);
    }, { passive: false });
}
