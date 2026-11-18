// Altura sem percentual confirmado não determina o preenchimento do tanque.
export function tankPresentation(tank) {
    return {
        level: Number.isFinite(tank.level) ? Math.max(0, Math.min(100, tank.level)) : null,
        volume: Number.isFinite(tank.volume) ? tank.volume : null
    };
}
