// Usa coordenadas lógicas, independentes da transformação do paper e do DPI.
export function fitViewport(bounds, width, height, userZoom = 1) {
    if (!bounds || !(bounds.width > 0 && bounds.height > 0 && width > 0 && height > 0)) return null;
    const fitScale = Math.min(width / bounds.width, height / bounds.height) * 0.94;
    const scale = fitScale * userZoom;
    return {
        fitScale, scale,
        x: (width - bounds.width * scale) / 2 - bounds.x * scale,
        y: (height - bounds.height * scale) / 2 - bounds.y * scale
    };
}

export function observeViewport(container, resize, Observer = ResizeObserver,
    schedule = requestAnimationFrame, cancel = cancelAnimationFrame) {
    let frame = null;
    const observer = new Observer(() => {
        if (frame !== null) return;
        frame = schedule(() => { frame = null; resize(); });
    });
    observer.observe(container);
    return { disconnect() { observer.disconnect(); if (frame !== null) cancel(frame); } };
}
