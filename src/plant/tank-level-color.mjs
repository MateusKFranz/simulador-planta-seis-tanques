// Cor do líquido a partir do nível percentual recebido pela HMI.
export function tankLevelColor(levelPercent, explicitOverflow = false) {
    if (explicitOverflow === true || (Number.isFinite(levelPercent) && levelPercent >= 99)) {
        return '#d94b45';
    }
    if (Number.isFinite(levelPercent) && levelPercent >= 90) {
        return '#e4bd38';
    }
    return '#5593b3';
}
