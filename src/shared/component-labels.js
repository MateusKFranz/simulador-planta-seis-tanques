// Identificadores oficiais; A/B são ramos do mesmo conjunto de três vias.
export function componentLabel(value) {
    return String(value ?? '').replace(/\b(OY[12])_([AB])\b/g, '$1 $2');
}
