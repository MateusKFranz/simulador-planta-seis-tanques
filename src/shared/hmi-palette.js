// Cores de identificação independentes dos estados operacionais.
const SIGNAL_COLORS = ['#0072B2', '#D55E00', '#009E73', '#AA568B', '#4B5563', '#986900', '#216A83'];

export const CATEGORY_COLORS = {
    niveis: { accent: '#1D5FA8', row: '#DBEAFE', plot: '#c7dff8' },
    vazoes: { accent: '#076C59', row: '#D9F2EA', plot: '#c9e9bd' },
    malhas: { accent: '#6B3FA0', row: '#EBE2F8', plot: '#dfcef0' },
    atuadores: { accent: '#92500C', row: '#FAE8CF', plot: '#f1daba' }
};

export const NEUTRAL_COLORS = {
    panel: '#F7F9FB', background: '#F3F5F7', text: '#182630',
    grid: '#B3C1CE', majorGrid: '#667A8E', frame: '#5B6D7E'
};

export const STATUS_COLORS = {
    fault: '#B42318', warning: '#9A6700', normal: '#18794E', unknown: '#64748B'
};

export const LOOP_COLORS = {
    LIC1: SIGNAL_COLORS[0], LIC2: SIGNAL_COLORS[1],
    LIC3: SIGNAL_COLORS[2], LIC4: SIGNAL_COLORS[3],
    FIC1: SIGNAL_COLORS[4], FIC2: SIGNAL_COLORS[5], FIC3: SIGNAL_COLORS[6]
};

const ACTUATOR_COLORS = {
    JIC3: SIGNAL_COLORS[0], JIC4: SIGNAL_COLORS[2], JIC1: SIGNAL_COLORS[3],
    LV1: SIGNAL_COLORS[6], LV2: SIGNAL_COLORS[1], LV3: SIGNAL_COLORS[4], LV4: SIGNAL_COLORS[5]
};

export function seriesColor(id) {
    const number = /^(?:LI|FI)([1-6])$/.exec(id)?.[1];
    if (number) return SIGNAL_COLORS[Number(number) - 1];
    if (Object.hasOwn(LOOP_COLORS, id)) return LOOP_COLORS[id];
    if (Object.hasOwn(ACTUATOR_COLORS, id)) return ACTUATOR_COLORS[id];
    return NEUTRAL_COLORS.frame;
}
