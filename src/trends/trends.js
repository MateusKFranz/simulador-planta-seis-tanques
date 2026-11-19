import { bindTimeline, durationLimit, timeRange } from './trends-interaction.js';
// TENDÊNCIAS
/* Níveis, PV/SP e MV compartilham o eixo de tempo.
   Dados ausentes são lacunas. O registro exporta CSV em português. */

import { componentLabel } from '../shared/component-labels.js';
import { tankLevelSensorId } from '../state/plant-state.js';
import { CATEGORY_COLORS, NEUTRAL_COLORS, STATUS_COLORS, seriesColor } from '../shared/hmi-palette.js';

// PALETA
const estilo = {
    tinta: NEUTRAL_COLORS.text, suave: NEUTRAL_COLORS.frame,
    regra: NEUTRAL_COLORS.grid, regraPrincipal: NEUTRAL_COLORS.majorGrid,
    molduraPlot: NEUTRAL_COLORS.frame, papel: NEUTRAL_COLORS.panel,
    man: CATEGORY_COLORS.niveis.accent
};
const TRACEJADO = [6, 4];
const PONTILHADO = [2, 3];       // setpoint
const TRACOS_MV = { AUTO: TRACEJADO, MAN: [], indisponivel: [1, 4] };
const tracoMV = modo => modo === 'AUTO' || modo === 'MAN' ? TRACOS_MV[modo] : TRACOS_MV.indisponivel;
// Separa as duas cores mais claras dos fundos coloridos sem recolorir as curvas.
const PENAS_COM_HALO = new Set([seriesColor('LI2'), seriesColor('LI3')]);

const MAX_AMOSTRAS = 36000;      // 1 h de simulação a 10 Hz
const MAX_REGISTRO = 400000;
const JANELAS = [15, 30, 60, 120, 300, 600, 1800];
const MARGEM = { esq: 50, dir: 48, topo: 22, base: 6 };   // à direita: ponteiros de SP
const ALTURA_EIXO_T = 20;
function limitesPlot(largura, altura, ultimo) {
    return {
        x0: MARGEM.esq, x1: largura - MARGEM.dir, y0: MARGEM.topo,
        y1: altura - MARGEM.base - (ultimo ? ALTURA_EIXO_T : 0)
    };
}

// PENAS FIXAS

function pena(key, rotulo, cor, opcoes = {}) {
    return {
        key,
        rotulo,
        cor,
        dash: opcoes.direita ? TRACEJADO : [],
        descricao: opcoes.descricao ?? '',
        digitos: opcoes.digitos ?? 1,
        degrau: Boolean(opcoes.degrau),
        largura: opcoes.largura ?? 2,
        alfa: opcoes.alfa ?? 1,
        malha: opcoes.malha ?? null,
        rotuloPonta: opcoes.rotuloPonta ?? rotulo
    };
}

const PENAS_NIVEL = [
    pena('LI1', 'LI1', seriesColor('LI1'), { descricao: 'TQ1' }),
    pena('LI2', 'LI2', seriesColor('LI2'), { descricao: 'TQ2', direita: true }),
    pena('LI3', 'LI3', seriesColor('LI3'), { descricao: 'TQ3' }),
    pena('LI4', 'LI4', seriesColor('LI4'), { descricao: 'TQ4', direita: true }),
    pena('LI5', 'LI5', seriesColor('LI5'), { descricao: 'TQ5' }),
    pena('LI6', 'LI6', seriesColor('LI6'), { descricao: 'TQ6', direita: true })
];

const PENAS_VAZAO = [
    pena('FI3', 'FI3', seriesColor('FI3'), { descricao: 'LV3 → TQ1', digitos: 2 }),
    pena('FI4', 'FI4', seriesColor('FI4'), { descricao: 'LV4 → TQ2', digitos: 2, direita: true }),
    pena('FI1', 'FI1', seriesColor('FI1'), { descricao: 'antes de LV1', digitos: 2 }),
    pena('FI2', 'FI2', seriesColor('FI2'), { descricao: 'antes de LV2', digitos: 2, direita: true }),
    pena('FI5', 'FI5', seriesColor('FI5'), { descricao: 'OY2_A → TQ5', digitos: 2 }),
    pena('FI6', 'FI6', seriesColor('FI6'), { descricao: 'OY1_B → TQ6', digitos: 2, direita: true })
];

const PENAS_BOMBA = ['JIC3', 'JIC4', 'JIC1'].map(id => pena(id, componentLabel(id), seriesColor(id)));
const PENAS_VALVULA = ['LV1', 'LV2', 'LV3', 'LV4'].map(id => pena(id, componentLabel(id), seriesColor(id)));
const PENAS_ATUADORES = [...PENAS_BOMBA, ...PENAS_VALVULA].map(p =>
    pena(`atuador.${p.key}`, p.rotulo, p.cor, {
        descricao: p.key.startsWith('JIC') ? 'Comando da bomba' : 'Abertura comandada',
        direita: p.key.startsWith('LV'), degrau: true
    }));
const CATEGORIAS = { niveis: 'Níveis', vazoes: 'Vazões', malhas: 'Malhas', atuadores: 'Atuadores' };
const ALTURAS_INICIAIS = { niveis: 170, vazoes: 170, controladas: 170, manipuladas: 190, atuadores: 170 };

// AUXILIARES

function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
    }
    for (const child of children) {
        if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child));
    }
    return node;
}

function aplicarCategoria(element, id) {
    element.style.setProperty('--tv-category-accent', CATEGORY_COLORS[id].accent);
}

function finito(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numero(value, digitos = 1) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (Math.abs(value) < 0.5 * 10 ** -digitos) value = 0;   // evita "-0"
    return value.toLocaleString('pt-BR', { minimumFractionDigits: digitos, maximumFractionDigits: digitos });
}

function passoBonito(span, alvo = 5) {
    const bruto = span / alvo;
    const potencia = 10 ** Math.floor(Math.log10(bruto));
    const n = bruto / potencia;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * potencia;
}

function passoTempo(span, largura) {
    const passos = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    const maxRotulos = Math.max(2, Math.floor(largura / 90));
    return passos.find(p => span / p <= maxRotulos) ?? 7200;
}

function relogioSim(segundos) {
    const s = Math.max(0, Math.round(segundos));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const dois = n => String(n).padStart(2, '0');
    return hh > 0 ? `${hh}:${dois(mm)}:${dois(ss)}` : `${dois(mm)}:${dois(ss)}`;
}

function rotuloJanela(segundos) {
    return segundos < 60 ? `${segundos} s` : segundos < 3600 ? `${segundos / 60} min` : `${segundos / 3600} h`;
}

function guardar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch { /* armazenamento opcional */ }
}

function ler(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
}

function svgTraco(cor, dash, alfa = 1, largura = 2.4) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 26 10');
    svg.setAttribute('class', 'tv-swatch');
    svg.setAttribute('aria-hidden', 'true');
    const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    linha.setAttribute('x1', '1');
    linha.setAttribute('x2', '25');
    linha.setAttribute('y1', '5');
    linha.setAttribute('y2', '5');
    linha.setAttribute('stroke', cor);
    linha.setAttribute('stroke-width', String(largura));
    linha.setAttribute('stroke-opacity', String(alfa));
    if (dash.length) linha.setAttribute('stroke-dasharray', dash.join(' '));
    svg.append(linha);
    return svg;
}

// TELA

export function createTrends(host, {
    getRuntime = () => ({}), onSelectionChange = () => {}, onPlotResize = () => {}
} = {}) {
    let visivel = false;
    let janela = durationLimit(Number(ler('trends-janela')) || 300);
    let aoVivo = true;
    let fimVista = null;
    let cursor = null;
    let destaque = null;            // tag da malha destacada
    let amostras = [];
    let registro = [];
    let gravando = false;
    let inicioGravacao = null;
    let ultimaBase = null;          // 'sim' | 'relogio'
    let ultimoCenario = null;
    let assinatura = '';
    let janelasGraficos = [];
    let janelasVisiveis = [];
    let plots = [];                 // {canvas, caixa, janela, sub, ultimo}
    const rowHeights = { ...ALTURAS_INICIAIS };
    const manualRowHeights = {};
    const rowViews = new Map();
    let rowBaselines = {};
    const ultimaLeitura = new Map();
    const ocultas = new Set();
    let cenarioNome = '';

    // ESTRUTURA
    const raiz = h('section', { class: 'trends-view', 'aria-label': 'Tendências' });
    for (const [token, color] of Object.entries({
        '--paper': estilo.papel, '--ink': estilo.tinta, '--muted': estilo.suave,
        '--panel': NEUTRAL_COLORS.panel, '--tv-background': NEUTRAL_COLORS.background,
        '--tv-frame': estilo.molduraPlot, '--sig': CATEGORY_COLORS.niveis.accent,
        '--man': estilo.man, '--ok': STATUS_COLORS.normal, '--unknown': STATUS_COLORS.unknown
    })) raiz.style.setProperty(token, color);
    raiz.hidden = true;

    const titulo = h('div', { class: 'tv-title' }, [h('h2', { text: 'Tendências' }), h('p', { class: 'tv-subtitle' })]);
    const seletorJanela = h('select', { class: 'tv-select', 'aria-label': 'Janela de tempo' });
    for (const j of JANELAS) seletorJanela.append(h('option', { value: String(j), text: rotuloJanela(j) }));
    const personalizado = h('option', { value: 'custom', text: 'Personalizado', disabled: true });
    seletorJanela.append(personalizado);
    seletorJanela.value = JANELAS.includes(janela) ? String(janela) : 'custom';
    const botaoAoVivo = h('button', { type: 'button', class: 'tv-live', title: 'Voltar ao tempo atual' }, ['Ao vivo']);
    const nomeEnsaio = h('input', { type: 'text', class: 'tv-name', maxlength: '60', placeholder: 'Nome do ensaio', 'aria-label': 'Nome do ensaio' });
    const botaoGravar = h('button', { type: 'button', class: 'tv-rec' }, ['● Gravar']);
    const contagem = h('span', { class: 'tv-count' });
    const botaoCsv = h('button', { type: 'button', class: 'tv-csv', disabled: true }, ['Exportar CSV']);
    const botaoLimpar = h('button', { type: 'button', title: 'Apaga o histórico dos gráficos (não apaga o registro)' }, ['Limpar gráficos']);
    const seletores = new Map();
    const categorias = h('div', { class: 'tv-categories', role: 'group', 'aria-label': 'Categorias de gráficos' });
    for (const [id, nome] of Object.entries(CATEGORIAS)) {
        const input = h('input', { type: 'checkbox', checked: true, disabled: true, 'aria-label': nome });
        const estado = h('small', { text: 'Sem dados' });
        const label = h('label', {}, [input, h('span', { class: 'tv-category-name', text: nome }), estado]);
        aplicarCategoria(label, id);
        categorias.append(label);
        seletores.set(id, { input, estado });
        input.addEventListener('change', () => { atualizarComposicao(true); desenhar(); });
    }

    const barra = h('div', { class: 'tv-bar' }, [
        titulo,
        h('div', { class: 'tv-spacer' }),
        h('div', { class: 'tv-group' }, [h('label', { text: 'Janela' }), seletorJanela, botaoAoVivo]),
        h('div', { class: 'tv-group' }, [nomeEnsaio, botaoGravar, contagem, botaoCsv]),
        h('div', { class: 'tv-group' }, [botaoLimpar]),
        categorias
    ]);
    const linhas = h('div', { class: 'tv-rows-grid' });
    const viewport = h('div', { class: 'tv-rows', hidden: true }, [linhas]);
    const semGraficos = h('p', { class: 'tv-selection-empty', text: 'Nenhuma categoria com dados disponíveis.' });
    const vazio = h('div', { class: 'tv-empty', hidden: true, text: 'Aguardando mais amostras…' });
    raiz.append(barra, viewport, semGraficos, vazio);
    host.append(raiz);

    // CONTROLES
    seletorJanela.addEventListener('change', () => definirJanela(Number(seletorJanela.value)));
    botaoAoVivo.addEventListener('click', () => {
        aoVivo = true;
        fimVista = null;
        desenhar();
    });
    botaoGravar.addEventListener('click', () => (gravando ? pararGravacao() : iniciarGravacao()));
    botaoCsv.addEventListener('click', exportarCsv);
    botaoLimpar.addEventListener('click', () => {
        amostras = [];
        ultimaLeitura.clear();
        aoVivo = true;
        fimVista = null;
        atualizarComposicao();
        desenhar();
    });

    function definirJanela(segundos) {
        if (!Number.isFinite(segundos)) return;
        janela = durationLimit(segundos);
        seletorJanela.value = JANELAS.includes(janela) ? String(janela) : 'custom';
        guardar('trends-janela', String(janela));
        desenhar();
    }

    // DESCRIÇÃO DAS JANELAS
    function pvNome(malha) {
        const pv = malha.pvSource ?? {};
        if (pv.tipo === 'vazao_soma') return (pv.ids ?? []).map(componentLabel).join(' + ');
        if (pv.tipo === 'nivel') return componentLabel(tankLevelSensorId(pv.id));
        return componentLabel(pv.id);
    }

    function montarJanelas(runtime) {
        const malhas = runtime.loops ?? {};
        const hMax = runtime.backendMode === 'HARDWARE' ? 30 : runtime.sim?.tankHeightCm ?? 25;
        const lista = [];

        // SP pontilhado na cor da malha.
        const spNivel = [];
        for (const [tag, malha] of Object.entries(malhas)) {
            if (malha.pvSource?.tipo !== 'nivel') continue;
            const lt = tankLevelSensorId(malha.pvSource.id);
            const base = PENAS_NIVEL.find(x => x.key === lt);
            if (!base) continue;
            const sp = pena(`${tag}.sp`, `SP ${tag}`, seriesColor(tag), { degrau: true, largura: 1.6, digitos: 1, malha: tag });
            sp.dash = PONTILHADO;
            sp.sp = true;
            sp.de = lt;
            spNivel.push(sp);
        }
        lista.push({
            id: 'niveis',
            categoria: 'niveis',
            titulo: 'Nível dos tanques',
            subtitulo: spNivel.length ? 'pontilhado: setpoint' : null,
            subs: [{ unidade: 'cm', faixa: { min: 0, max: hMax }, penas: [...PENAS_NIVEL, ...spNivel] }]
        });
        lista.push({
            id: 'vazoes', categoria: 'vazoes', titulo: 'Vazões medidas',
            subs: [{ unidade: 'L/min', faixa: { auto: true, min: 0, max: 12, spanMin: 1, deZero: true }, penas: PENAS_VAZAO }]
        });

        const tags = Object.keys(malhas);
        if (tags.length) {
            const porUnidade = new Map();
            for (const tag of tags) {
                const malha = malhas[tag];
                const unidade = malha.unit ?? '';
                const digitos = unidade === 'cm' ? 1 : 2;
                const cor = seriesColor(tag);
                const pv = pena(`${tag}.pv`, tag, cor, { descricao: pvNome(malha), digitos, malha: tag });
                const sp = pena(`${tag}.sp`, `${tag} SP`, cor, { degrau: true, largura: 1.6, digitos, malha: tag, rotuloPonta: 'SP' });
                sp.dash = PONTILHADO;
                sp.sp = true;
                if (!porUnidade.has(unidade)) porUnidade.set(unidade, { unidade, malhas: [], penas: [] });
                const grupo = porUnidade.get(unidade);
                grupo.malhas.push(tag);
                grupo.penas.push(pv, sp);
                grupo.faixa = unidade === 'cm'
                    ? { auto: true, min: 0, max: hMax, spanMin: 3 }
                    : { auto: true, min: 0, max: malha.spMax ?? 100, spanMin: 0.5, deZero: true };
            }
            lista.push({ id: 'controladas', categoria: 'malhas', titulo: 'Variáveis controladas', subtitulo: 'PV linha · SP pontilhado', subs: [...porUnidade.values()], malhas: tags });
            lista.push({
                id: 'manipuladas',
                categoria: 'malhas',
                titulo: 'Variáveis manipuladas',
                subtitulo: 'saída dos controladores',
                malhas: tags,
                subs: [{
                    unidade: '%',
                    faixa: { min: 0, max: 100 },
                    penas: tags.map(tag => {
                        const malha = malhas[tag];
                        return pena(`${tag}.mv`, componentLabel(malha.mvTarget?.id), seriesColor(tag), { descricao: tag, digitos: 0, malha: tag });
                    })
                }]
            });
        }
        lista.push({
            id: 'atuadores', categoria: 'atuadores', titulo: 'Bombas e válvulas atuadas',
            subtitulo: runtime.backendMode === 'HARDWARE' ? 'comandos confirmados pelo firmware' : null,
            subs: [{ unidade: '%', faixa: { min: 0, max: 100 }, penas: PENAS_ATUADORES }]
        });
        return lista;
    }

    function atualizarComposicao(selecaoManual = false) {
        const inicio = amostras[0]?.t ?? Infinity;
        const disponiveis = janelasGraficos.filter(jan => jan.subs.some(sub =>
            sub.penas.some(p => (jan.id !== 'niveis' || !p.sp) && (ultimaLeitura.get(p.key) ?? -Infinity) >= inicio)));
        for (const [id, { input, estado }] of seletores) {
            input.disabled = !disponiveis.some(jan => jan.categoria === id);
            estado.hidden = !input.disabled;
        }
        const visiveis = disponiveis.filter(jan => seletores.get(jan.categoria).input.checked);
        const mudou = visiveis.length !== janelasVisiveis.length || visiveis.some((jan, i) => jan !== janelasVisiveis[i]);
        if (mudou && selecaoManual) onSelectionChange();
        semGraficos.hidden = visiveis.length > 0;
        const mensagem = disponiveis.length
            ? 'Selecione uma categoria para exibir seus gráficos.'
            : 'Nenhuma categoria com dados disponíveis.';
        if (semGraficos.textContent !== mensagem) semGraficos.textContent = mensagem;
        viewport.hidden = visiveis.length === 0;
        if (!mudou) return;
        if (visiveis.map(jan => jan.id).join() !== janelasVisiveis.map(jan => jan.id).join()) rowBaselines = {};
        janelasVisiveis = visiveis;
        montarLinhas();
    }

    function rowMinimum(id, { row, legenda }) {
        const minimoPlot = id === 'manipuladas' ? 150 : 135;
        const contorno = row.offsetHeight - row.clientHeight;
        return Math.max(minimoPlot, Math.ceil(legenda.getBoundingClientRect().height) + contorno);
    }

    function applyRowHeights() {
        let altura = 0;
        const tracks = janelasVisiveis.map(jan => {
            const { id } = jan;
            const minimo = Math.max(rowMinimum(id, rowViews.get(jan)), rowBaselines[id] ?? manualRowHeights[id] ?? 0);
            const desejada = Math.max(minimo, rowBaselines[id] ?? rowHeights[id]);
            altura += desejada;
            return `minmax(${minimo}px, ${desejada}fr)`;
        });
        viewport.style.setProperty('--tv-plot-height', `${altura}px`);
        linhas.style.gridTemplateRows = tracks.join(' ');
    }

    // A legenda mede sua altura natural, independentemente do tamanho da linha.
    const legendObserver = new ResizeObserver(() => {
        applyRowHeights();
        agendarDesenho();
    });

    function createPlotGrip({ id, titulo }, row, legenda) {
        const grip = h('div', { class: 'tv-plot-grip', role: 'separator', tabindex: '0',
            'aria-orientation': 'horizontal', 'aria-label': `Ajustar altura: ${titulo}`,
            title: 'Arraste para ajustar a altura; duplo clique para restaurar' });
        let drag = null;
        const renderedHeight = () => Math.round(row.getBoundingClientRect().height);
        function setHeight(value, previous, reset = false) {
            const height = Math.max(rowMinimum(id, { row, legenda }), Math.round(value));
            const delta = height - previous;
            if (!delta && !reset) return previous;
            // Mantém as outras linhas na altura visível ao iniciar o ajuste.
            if (!drag || !drag.applied) {
                rowBaselines = Object.fromEntries(janelasVisiveis.filter(jan => jan.id !== id).map(jan =>
                    [jan.id, Math.round(rowViews.get(jan).row.getBoundingClientRect().height)]));
                if (drag) drag.applied = true;
            }
            rowHeights[id] = height;
            if (reset) delete manualRowHeights[id];
            else manualRowHeights[id] = height;
            applyRowHeights();
            if (delta) onPlotResize(delta);
            agendarDesenho();
            return height;
        }
        grip.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            event.preventDefault();
            const height = Math.round(renderedHeight());
            drag = { id: event.pointerId, y: event.clientY, height, previous: height };
            grip.setPointerCapture(event.pointerId);
            grip.classList.add('resizing');
        });
        grip.addEventListener('pointermove', event => {
            if (drag?.id === event.pointerId) {
                drag.previous = setHeight(drag.height + event.clientY - drag.y, drag.previous);
            }
        });
        function stop(event) {
            if (drag?.id !== event.pointerId) return;
            drag = null;
            grip.classList.remove('resizing');
            if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
        }
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(name, stop);
        grip.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const height = Math.round(renderedHeight());
            setHeight(height + (event.key === 'ArrowDown' ? 20 : -20), height);
        });
        grip.addEventListener('dblclick', () => setHeight(ALTURAS_INICIAIS[id], renderedHeight(), true));
        return grip;
    }

    // MONTAGEM DO DOM DAS JANELAS
    function montarLinhas() {
        const rows = janelasVisiveis.map(jan => {
            if (!rowViews.has(jan)) rowViews.set(jan, criarLinha(jan));
            return rowViews.get(jan);
        });
        linhas.replaceChildren(...rows.map(({ row }) => row));
        legendObserver.disconnect();
        for (const { legenda } of rows) legendObserver.observe(legenda);
        plots = rows.flatMap(({ items }, index) => {
            for (const item of items) item.ultimo = index === rows.length - 1;
            return items;
        });
        applyRowHeights();
        aplicarDestaque();
    }

    function criarLinha(jan) {
        const items = [];
        const area = h('div', { class: 'tv-plot' });
        const legenda = h('div', { class: 'tv-legend' });
        const row = h('div', { class: `tv-row tv-row-${jan.id}` }, [area, legenda]);
        aplicarCategoria(row, jan.categoria);
        jan.subs.forEach((sub, i) => {
            const canvas = h('canvas', { class: 'tv-canvas' });
            const caixa = h('div', { class: 'tv-sub' }, [canvas]);
            area.append(caixa);
            const item = { canvas, caixa, janela: jan, sub, primeiroSub: i === 0 };
            items.push(item);
            ligarPonteiro(item);
        });
        area.append(createPlotGrip(jan, row, legenda));

        // Legenda
        legenda.append(h('div', { class: 'tv-legend-head' }, [
            h('strong', { text: jan.titulo }),
            jan.subtitulo ? h('span', { text: jan.subtitulo }) : null
        ]));
        if (jan.id === 'controladas' && jan.malhas) {
            legenda.append(h('div', { class: 'tv-legend-row tv-legend-cols' }, [h('span'), h('span'), h('span'), h('span', { text: 'PV' }), h('span', { text: 'SP' })]));
            for (const sub of jan.subs) {
                for (let k = 0; k < sub.penas.length; k += 2) {
                    const pv = sub.penas[k];
                    const sp = sub.penas[k + 1];
                    legenda.append(linhaLegendaMalha(pv, [pv, sp], sub.unidade, [pv.key, sp.key]));
                }
            }
        } else if (jan.id === 'manipuladas' && jan.malhas) {
            legenda.append(h('div', { class: 'tv-legend-row tv-legend-cols' }, [h('span'), h('span'), h('span'), h('span', { text: 'MV' }), h('span', { text: 'modo' })]));
            for (const p of jan.subs[0].penas) legenda.append(linhaLegendaMalha(p, [p], '%', [p.key, `modo:${p.malha}`]));
            legenda.append(h('div', { class: 'tv-legend-note', text: 'AUTO: tracejado · MAN: contínuo · Indisponível: pontilhado' }));
        } else {
            for (const sub of jan.subs) {
                for (const p of sub.penas) {
                    if (p.sp) continue;
                    const sp = sub.penas.find(x => x.sp && x.de === p.key) ?? null;
                    legenda.append(linhaLegendaSimples(p, sub.unidade, sp));
                }
            }
        }
        return { row, items, legenda };
    }

    function linhaLegendaSimples(p, unidade, sp = null) {
        const caixa = h('input', { type: 'checkbox', checked: !ocultas.has(p.key), 'aria-label': `Mostrar ${p.rotulo}` });
        const descricao = sp
            ? h('span', { class: 'tv-desc tv-spval', 'data-key': sp.key, 'data-digits': String(sp.digitos), title: `Setpoint de ${sp.malha}`, text: 'SP —' })
            : h('span', { class: 'tv-desc', text: p.descricao });
        const linha = h('label', { class: `tv-legend-row${ocultas.has(p.key) ? ' off' : ''}`, title: sp ? `${p.descricao} · setpoint de ${sp.malha}` : p.descricao }, [
            caixa,
            svgTraco(p.cor, p.dash),
            h('span', { class: 'tv-tag', text: p.rotulo }),
            descricao,
            h('span', { class: 'tv-value', 'data-key': p.key, 'data-unit': unidade, 'data-digits': String(p.digitos), text: '—' })
        ]);
        caixa.addEventListener('change', () => {
            for (const chave of sp ? [p.key, sp.key] : [p.key]) {
                if (caixa.checked) ocultas.delete(chave);
                else ocultas.add(chave);
            }
            linha.classList.toggle('off', !caixa.checked);
            desenhar();
        });
        return linha;
    }

    function linhaLegendaMalha(p, penasDaLinha, unidade, chavesValor) {
        const tag = p.malha;
        const caixa = h('input', { type: 'checkbox', checked: !penasDaLinha.some(x => ocultas.has(x.key)), 'aria-label': `Mostrar ${tag}` });
        const linha = h('div', { class: 'tv-legend-row tv-loop-row', 'data-loop': tag, title: `${tag}: clique para destacar nas três janelas` }, [
            caixa,
            svgTraco(p.cor, p.dash),
            h('span', { class: 'tv-tag', text: p.rotulo }),
            ...chavesValor.map(chave => chave.startsWith('modo:')
                ? h('span', { class: 'tv-mode', 'data-mode': chave.slice(5), text: '—' })
                : h('span', { class: 'tv-value', 'data-key': chave, 'data-unit': unidade, 'data-digits': String(p.digitos), text: '—' }))
        ]);
        caixa.addEventListener('click', event => event.stopPropagation());
        caixa.addEventListener('change', () => {
            for (const x of penasDaLinha) {
                if (caixa.checked) ocultas.delete(x.key);
                else ocultas.add(x.key);
            }
            linha.classList.toggle('off', !caixa.checked);
            desenhar();
        });
        linha.addEventListener('click', () => {
            destaque = destaque === tag ? null : tag;
            aplicarDestaque();
            desenhar();
        });
        return linha;
    }

    function aplicarDestaque() {
        for (const linha of linhas.querySelectorAll('.tv-loop-row')) {
            linha.classList.toggle('highlight', destaque !== null && linha.dataset.loop === destaque);
            linha.classList.toggle('dim', destaque !== null && linha.dataset.loop !== destaque);
        }
    }

    // INTERAÇÃO
    function primeiroTempo() {
        return amostras.length ? amostras[0].t : 0;
    }

    function ultimoTempo() {
        return amostras.length ? amostras[amostras.length - 1].t : 0;
    }

    function estadoTemporal() {
        return { first: primeiroTempo(), last: ultimoTempo(), duration: janela, follow: aoVivo, end: fimVista, hasData: amostras.length > 0 };
    }
    function intervaloVista() { return timeRange(estadoTemporal()); }
    let frameInteracao = null;
    let frameWindow = null;
    function agendarDesenho() {
        const owner = raiz.ownerDocument.defaultView;
        if (!owner || owner.closed) return;
        if (frameWindow !== owner && frameInteracao !== null) {
            frameWindow?.cancelAnimationFrame(frameInteracao);
            frameInteracao = null;
        }
        if (frameInteracao !== null) return;
        frameWindow = owner;
        frameInteracao = owner.requestAnimationFrame(() => { frameInteracao = null; desenhar(); });
    }
    function ligarPonteiro(item) {
        const { canvas, caixa } = item;
        const geometry = () => {
            const r = canvas.getBoundingClientRect();
            const { x0, x1, y0, y1 } = limitesPlot(r.width, r.height, item.ultimo);
            return { left: r.left + x0, top: r.top + y0, width: x1 - x0, height: y1 - y0 };
        };
        bindTimeline(canvas, caixa, geometry, estadoTemporal, state => {
            janela = state.duration; aoVivo = state.follow; fimVista = state.end;
            seletorJanela.value = JANELAS.includes(janela) ? String(janela) : 'custom';
            personalizado.textContent = 'Personalizado (' + numero(janela, 1) + ' s)';
            guardar('trends-janela', String(janela));
            agendarDesenho();
        }, time => { cursor = time; agendarDesenho(); });
    }

    // AMOSTRAGEM (sempre, mesmo com a tela escondida)
    function amostrar(plant, runtime) {
        if (!runtime.connected || !plant) return;
        const base = runtime.backendMode === 'MODELICA' ? 'sim' : 'relogio';
        const agora = Date.now();
        const t = base === 'sim' ? finito(runtime.time) : agora / 1000;
        if (t === null) return;

        // Reinício da simulação, troca de base de tempo ou de cenário: o histórico não continua
        const ultimo = amostras[amostras.length - 1];
        const cenario = runtime.scenario ?? null;
        if (base !== ultimaBase || (ultimo && t < ultimo.t - 0.05) || (base === 'sim' && cenario !== ultimoCenario && ultimoCenario !== null)) {
            if (gravando && ultimo && t < ultimo.t - 0.05) pararGravacao('Registro encerrado: a simulação foi reiniciada.');
            amostras = [];
            ultimaLeitura.clear();
            aoVivo = true;
            fimVista = null;
        }
        ultimaBase = base;
        ultimoCenario = cenario;
        if (ultimo && amostras.length && t - ultimo.t < 0.1) return;

        const valores = {};
        const limitesNivel = {};
        for (const sensor of plant.levelSensors) {
            valores[sensor.id] = finito(sensor.heightCm);
            const { aboveLevelLimit, extrapolated } = sensor.diagnostics ?? {};
            if (aboveLevelLimit || extrapolated) limitesNivel[sensor.id] = { aboveLevelLimit, extrapolated };
        }
        for (const sensor of plant.flowSensors) valores[sensor.id] = finito(sensor.flow);
        // O CSV preserva as colunas atuais. O gráfico também usa o readback publicado em HARDWARE.
        const atuadoresConhecidos = runtime.backendMode !== 'HARDWARE';
        for (const bomba of plant.pumps) {
            const comando = finito(bomba.command);
            const percentual = bomba.power == null ? null : !bomba.power ? 0 : comando === null ? null : comando * 100;
            valores[`atuador.${bomba.id}`] = percentual;
            valores[bomba.id] = atuadoresConhecidos ? percentual : null;
        }
        for (const valvula of plant.actuatedValves) {
            const abertura = finito(valvula.opening);
            const percentual = abertura === null ? null : abertura * 100;
            valores[`atuador.${valvula.id}`] = percentual;
            valores[valvula.id] = atuadoresConhecidos ? percentual : null;
        }
        const modos = {};
        for (const [tag, malha] of Object.entries(runtime.loops ?? {})) {
            valores[`${tag}.pv`] = finito(malha.pv);
            valores[`${tag}.sp`] = finito(malha.sp);
            valores[`${tag}.mv`] = finito(malha.mv) === null ? null : malha.mv * 100;
            modos[tag] = malha.quality === 'bad' ? 'BAD' : (malha.effectiveMode ?? malha.mode ?? '—');
        }
        const amostra = { t, data: agora, valores, modos, limitesNivel };
        for (const [key, value] of Object.entries(valores)) {
            if (value !== null) ultimaLeitura.set(key, t);
        }
        amostras.push(amostra);
        if (amostras.length > MAX_AMOSTRAS) amostras.splice(0, amostras.length - MAX_AMOSTRAS);

        if (gravando) {
            registro.push(linhaRegistro(plant, runtime, amostra));
            if (registro.length >= MAX_REGISTRO) pararGravacao('Registro encerrado: limite de linhas atingido.');
        }
    }

    // DESENHO
    function amostraEm(t) {
        if (!amostras.length) return null;
        let lo = 0;
        let hi = amostras.length - 1;
        while (hi - lo > 1) {
            const meio = (lo + hi) >> 1;
            if (amostras[meio].t < t) lo = meio;
            else hi = meio;
        }
        return Math.abs(amostras[lo].t - t) <= Math.abs(amostras[hi].t - t) ? amostras[lo] : amostras[hi];
    }

    function formatarTempo(amostra, t) {
        if (ultimaBase === 'relogio') return (amostra ? new Date(amostra.data) : new Date(t * 1000)).toLocaleTimeString('pt-BR');
        return relogioSim(t);
    }

    function desenhar() {
        if (!visivel) return;
        vazio.hidden = !janelasVisiveis.length || amostras.length > 1;
        botaoAoVivo.classList.toggle('active', aoVivo);
        botaoAoVivo.disabled = aoVivo;
        botaoAoVivo.textContent = aoVivo ? 'Seguindo tempo atual' : 'Voltar ao mais recente';
        const range = intervaloVista();
        raiz.dataset.start = String(range[0]); raiz.dataset.end = String(range[1]);
        raiz.dataset.duration = String(janela); raiz.dataset.follow = String(aoVivo);
        const [t0, t1] = intervaloVista();
        const visiveis = amostras.filter(a => a.t >= t0 - 1 && a.t <= t1 + 1);
        for (const item of plots) desenharPlot(item, visiveis, t0, t1);

        // Valores na legenda: no cursor ou o último
        const ref = cursor !== null ? amostraEm(cursor) : amostras[amostras.length - 1];
        for (const campo of linhas.querySelectorAll('.tv-value')) {
            const valor = ref ? ref.valores[campo.dataset.key] : null;
            const unidade = campo.dataset.unit;
            const limite = ref?.limitesNivel[campo.dataset.key];
            campo.textContent = valor == null ? '—' : (limite?.extrapolated ? '≈ ' : '')
                + (limite?.aboveLevelLimit ? '30+ cm' : `${numero(valor, Number(campo.dataset.digits))} ${unidade}`);
        }
        for (const campo of linhas.querySelectorAll('.tv-spval')) {
            const valor = ref ? ref.valores[campo.dataset.key] : null;
            campo.textContent = `SP ${valor === null || valor === undefined ? '—' : numero(valor, Number(campo.dataset.digits))}`;
        }
        for (const campo of linhas.querySelectorAll('.tv-mode')) {
            const modo = ref ? ref.modos[campo.dataset.mode] : null;
            campo.textContent = modo === 'BAD' ? 'sem PV' : modo ?? '—';
            const unknown = !modo || modo === '—' || modo === 'BAD';
            campo.className = `tv-mode${unknown ? ' unknown' : modo === 'MAN' ? ' man' : ''}`;
            const linha = campo.parentElement.querySelector('.tv-swatch line');
            linha.setAttribute('stroke-dasharray', tracoMV(modo).join(' ') || 'none');
        }
        linhas.classList.toggle('at-cursor', cursor !== null);
        const base = ultimaBase === 'relogio' ? 'horário do computador' : 'tempo de simulação';
        const quando = cursor !== null && ref ? ` · cursor em ${formatarTempo(ref, ref.t)}` : '';
        titulo.querySelector('.tv-subtitle').textContent = `${cenarioNome ? `Cenário ${cenarioNome} · ` : ''}${base}${quando}`;
    }

    function faixaY(sub, visiveis) {
        if (sub.unidade === '%') return [0, 110];
        const f = sub.faixa;
        let min = Infinity;
        let max = -Infinity;
        for (const a of visiveis) {
            for (const p of sub.penas) {
                if (ocultas.has(p.key)) continue;
                const v = a.valores[p.key];
                if (v === null || v === undefined) continue;
                if (v < min) min = v;
                if (v > max) max = v;
            }
        }
        if (!f.auto) return [f.min, Math.max(f.max, max)];
        if (!Number.isFinite(min)) return [f.min, f.deZero ? f.min + (f.spanMin ?? 1) : f.max];
        if (f.deZero) min = 0;
        let span = max - min;
        if (span < (f.spanMin ?? 0)) {
            const meio = (max + min) / 2;
            span = f.spanMin;
            min = f.deZero ? 0 : meio - span / 2;
            max = min + span;
        }
        const folga = span * 0.12;
        const lo = f.deZero ? 0 : Math.max(f.min, min - folga);
        let hi = Math.min(Math.max(f.max, max), max + folga);
        if (hi <= lo) hi = lo + (f.spanMin ?? 1);
        const passo = passoBonito(hi - lo, 4);
        return [Math.max(f.min, Math.floor(lo / passo) * passo), Math.ceil(hi / passo) * passo];
    }

    function caminhosMV(visiveis, p, xDe, yDe, passo) {
        const caminhos = new Map();
        let anterior = null;
        let ativo = null;
        for (let i = 0; i < visiveis.length; i++) {
            const a = visiveis[i];
            const v = a.valores[p.key];
            if (v == null) {
                anterior = ativo = null;
                continue;
            }
            const atual = { x: xDe(a.t), y: yDe(v), traco: tracoMV(a.modos[p.malha]) };
            if (anterior) {
                const traco = anterior.traco;
                if (!caminhos.has(traco)) caminhos.set(traco, new Path2D());
                const caminho = caminhos.get(traco);
                if (ativo !== traco) caminho.moveTo(anterior.x, anterior.y);
                // Preserva transições e lacunas mesmo ao reduzir pontos de históricos longos.
                if (i % passo === 0 || atual.traco !== traco || visiveis[i + 1]?.valores[p.key] == null) {
                    caminho.lineTo(atual.x, atual.y);
                }
                ativo = traco;
            }
            anterior = atual;
        }
        return caminhos;
    }

    function desenharPlot(item, visiveis, t0, t1) {
        const { canvas, caixa, janela: jan, sub, ultimo, primeiroSub } = item;
        const dpr = raiz.ownerDocument.defaultView.devicePixelRatio || 1;
        const largura = caixa.clientWidth;
        const altura = caixa.clientHeight;
        if (largura < 10 || altura < 10) return;
        if (canvas.width !== Math.round(largura * dpr) || canvas.height !== Math.round(altura * dpr)) {
            canvas.width = Math.round(largura * dpr);
            canvas.height = Math.round(altura * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, largura, altura);

        const { x0, x1, y0, y1 } = limitesPlot(largura, altura, ultimo);
        if (x1 <= x0 || y1 - y0 < 20) return;
        const [vmin, vmax] = faixaY(sub, visiveis);
        const percentual = sub.unidade === '%';
        const pisoVisual = vmin === 0 ? (percentual ? -5 : -(vmax - vmin) * .08) : vmin;
        const xDe = t => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
        const yDe = v => y1 - ((Math.max(pisoVisual, Math.min(vmax, v)) - pisoVisual) / (vmax - pisoVisual || 1)) * (y1 - y0);

        ctx.fillStyle = CATEGORY_COLORS[jan.categoria].plot;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

        // Grade Y
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const passoY = percentual ? 50
            : passoBonito(vmax - vmin, Math.max(2, Math.min(5, Math.floor((y1 - y0) / 28))));
        const digitosY = passoY < 1 ? (passoY < 0.1 ? 2 : 1) : 0;
        for (let v = Math.ceil(vmin / passoY - 1e-9) * passoY; v <= vmax + 1e-9; v += passoY) {
            const y = Math.round(yDe(v)) + 0.5;
            const principal = percentual || v === 0;
            ctx.strokeStyle = principal ? estilo.regraPrincipal : estilo.regra;
            ctx.lineWidth = principal ? 1.25 : 1;
            ctx.setLineDash(principal && v !== 0 ? [4, 3] : []);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.fillStyle = principal ? estilo.tinta : estilo.suave;
            ctx.font = principal ? '600 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
            ctx.fillText(numero(v, digitosY) + (percentual ? '%' : ''), x0 - 6, y);
        }

        // Grade de tempo
        const passoT = passoTempo(t1 - t0, x1 - x0);
        const yRotuloT = y1 + 6;
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let t = Math.ceil(t0 / passoT) * passoT; t <= t1; t += passoT) {
            const x = Math.round(xDe(t)) + 0.5;
            ctx.strokeStyle = estilo.regra;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            if (ultimo) {
                ctx.fillStyle = estilo.suave;
                ctx.fillText(formatarTempo(null, t), x, yRotuloT);
            }
        }

        // Moldura, título e unidade
        ctx.strokeStyle = estilo.molduraPlot;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.fillStyle = estilo.tinta;
        ctx.font = '600 12px system-ui, sans-serif';
        // Janela dividida por unidade: cada parte diz a grandeza (vazão, nível)
        const grandeza = { 'L/min': 'vazão (L/min)', cm: 'nível (cm)' }[sub.unidade] ?? sub.unidade;
        const tituloPlot = jan.subs.length > 1 ? (primeiroSub ? `${jan.titulo} · ${grandeza}` : grandeza) : jan.titulo;
        ctx.fillText(tituloPlot, x0, y0 - 6);
        ctx.fillStyle = estilo.suave;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(sub.unidade, x0 - 6, y0 - 6);

        // Penas (a malha destacada por cima; as outras apagadas)
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        const passo = Math.max(1, Math.floor(visiveis.length / Math.max(1, (x1 - x0) * 1.5)));
        const ordem = [...sub.penas].sort((a, b) => Number(a.malha === destaque) - Number(b.malha === destaque));
        for (const p of ordem) {
            if (ocultas.has(p.key)) continue;
            const apagada = destaque !== null && p.malha !== null && p.malha !== destaque;
            ctx.globalAlpha = p.alfa * (apagada ? 0.18 : 1);
            const larguraPena = p.largura + (destaque !== null && p.malha === destaque ? 0.6 : 0);
            const pintar = caminho => {
                if (PENAS_COM_HALO.has(p.cor)) {
                    ctx.strokeStyle = estilo.papel;
                    ctx.lineWidth = larguraPena + 1.5;
                    caminho ? ctx.stroke(caminho) : ctx.stroke();
                }
                ctx.strokeStyle = p.cor;
                ctx.lineWidth = larguraPena;
                caminho ? ctx.stroke(caminho) : ctx.stroke();
            };
            ctx.lineJoin = 'round';
            if (jan.id === 'manipuladas') {
                for (const [traco, caminho] of caminhosMV(visiveis, p, xDe, yDe, passo)) {
                    ctx.setLineDash(traco);
                    pintar(caminho);
                }
                continue;
            }
            ctx.setLineDash(p.dash);
            ctx.beginPath();
            let aberto = false;
            let yAnterior = null;
            for (let i = 0; i < visiveis.length; i += passo) {
                const a = visiveis[i];
                const v = a.valores[p.key];
                if (v === null || v === undefined) {
                    aberto = false;
                    continue;
                }
                const x = xDe(a.t);
                const y = yDe(v);
                if (!aberto) {
                    ctx.moveTo(x, y);
                    aberto = true;
                } else if (p.degrau) {
                    ctx.lineTo(x, yAnterior);
                    ctx.lineTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                yAnterior = y;
            }
            pintar();
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.restore();

        // Rótulo na ponta das linhas (identidade além da cor), empilhado se coincidirem
        if (aoVivo && visiveis.length) {
            const ultimaAmostra = visiveis[visiveis.length - 1];
            const rotulos = [];
            for (const p of sub.penas) {
                if (ocultas.has(p.key) || p.degrau) continue;
                if (destaque !== null && p.malha !== null && p.malha !== destaque) continue;
                const v = ultimaAmostra.valores[p.key];
                if (v === null || v === undefined) continue;
                rotulos.push({ p, y: yDe(v) - 9 });
            }
            rotulos.sort((a, b) => a.y - b.y);
            const passoRotulo = 13;
            const topo = y0 + 8;
            const fundo = y1 - 8;
            for (let i = 0; i < rotulos.length; i += 1) rotulos[i].y = Math.max(rotulos[i].y, i === 0 ? topo : rotulos[i - 1].y + passoRotulo);
            const excesso = rotulos.length ? rotulos[rotulos.length - 1].y - fundo : 0;
            if (excesso > 0) for (const r of rotulos) r.y = Math.max(topo, r.y - excesso);
            ctx.font = '600 10.5px system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (const { p, y } of rotulos) {
                const larguraTexto = ctx.measureText(p.rotuloPonta).width;
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.fillRect(x1 - 6 - larguraTexto - 3, y - 7, larguraTexto + 6, 14);
                ctx.fillStyle = estilo.tinta;
                ctx.fillText(p.rotuloPonta, x1 - 6, y);
            }
        }

        /*
          Ponteiros de SP na margem direita: triângulo na cor da malha e o valor
          (no instante do cursor, ou o atual). Valores iguais ficam empilhados.
        */
        const refSp = cursor !== null && cursor >= t0 && cursor <= t1 ? amostraEm(cursor) : visiveis[visiveis.length - 1];
        if (refSp) {
            const ponteiros = [];
            for (const p of sub.penas) {
                if (!p.sp || ocultas.has(p.key)) continue;
                const v = refSp.valores[p.key];
                if (v === null || v === undefined) continue;
                ponteiros.push({ p, v, yAlvo: yDe(v), y: yDe(v) });
            }
            ponteiros.sort((a, b) => a.y - b.y);
            for (let i = 1; i < ponteiros.length; i += 1) ponteiros[i].y = Math.max(ponteiros[i].y, ponteiros[i - 1].y + 11);
            const excesso = ponteiros.length ? ponteiros[ponteiros.length - 1].y - (y1 - 4) : 0;
            if (excesso > 0) for (const q of ponteiros) q.y = Math.max(y0 + 4, q.y - excesso);
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const { p, v, yAlvo, y } of ponteiros) {
                ctx.globalAlpha = destaque !== null && p.malha !== destaque ? 0.3 : 1;
                ctx.fillStyle = p.cor;
                ctx.beginPath();
                ctx.moveTo(x1 + 1, yAlvo);
                ctx.lineTo(x1 + 8, yAlvo - 4.5);
                ctx.lineTo(x1 + 8, yAlvo + 4.5);
                ctx.closePath();
                ctx.fill();
                if (Math.abs(y - yAlvo) > 1) {
                    ctx.strokeStyle = p.cor;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x1 + 8, yAlvo);
                    ctx.lineTo(x1 + 10, y);
                    ctx.stroke();
                }
                ctx.fillStyle = estilo.tinta;
                ctx.fillText(numero(v, p.digitos), x1 + 11, y);
            }
            ctx.globalAlpha = 1;
            if (ponteiros.length) {
                ctx.fillStyle = estilo.suave;
                ctx.font = '600 9.5px system-ui, sans-serif';
                ctx.textBaseline = 'bottom';
                ctx.fillText('SP', x1 + 11, y0 - 6);
            }
        }

        // Cursor (mesmo instante nas três janelas)
        if (cursor !== null && cursor >= t0 && cursor <= t1) {
            const ref = amostraEm(cursor);
            const x = Math.round(xDe(ref ? ref.t : cursor)) + 0.5;
            ctx.strokeStyle = estilo.tinta;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            if (ref) {
                for (const p of sub.penas) {
                    if (ocultas.has(p.key) || p.degrau) continue;
                    if (destaque !== null && p.malha !== null && p.malha !== destaque) continue;
                    const v = ref.valores[p.key];
                    if (v === null || v === undefined) continue;
                    ctx.fillStyle = estilo.papel;
                    ctx.strokeStyle = p.cor;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, yDe(v), 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
                if (ultimo) {
                    const texto = formatarTempo(ref, ref.t);
                    ctx.font = '600 11px system-ui, sans-serif';
                    const w = ctx.measureText(texto).width + 10;
                    const xr = Math.max(x0, Math.min(x1 - w, x - w / 2));
                    ctx.fillStyle = estilo.tinta;
                    ctx.fillRect(xr, yRotuloT - 3, w, 17);
                    ctx.fillStyle = estilo.papel;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText(texto, xr + w / 2, yRotuloT - 1);
                }
            }
        }
    }

    // REGISTRO E CSV
    function iniciarGravacao() {
        registro = [];
        gravando = true;
        inicioGravacao = new Date();
        atualizarRegistro();
    }

    function pararGravacao(motivo = null) {
        gravando = false;
        atualizarRegistro(motivo);
    }

    function atualizarRegistro(motivo = null) {
        botaoGravar.textContent = gravando ? '■ Parar' : '● Gravar';
        botaoGravar.classList.toggle('recording', gravando);
        botaoCsv.disabled = gravando || registro.length === 0;
        nomeEnsaio.disabled = gravando;
        contagem.textContent = motivo ?? (registro.length ? `${registro.length.toLocaleString('pt-BR')} linhas${gravando ? ' gravando' : ''}` : '');
    }

    function linhaRegistro(plant, runtime, amostra) {
        const linha = {
            data: new Date(amostra.data).toISOString(),
            t: amostra.t,
            cenario: runtime.scenario ?? '',
            modo: runtime.backendMode ?? '',
            valores: { ...amostra.valores },
            extras: {},
            modos: { ...amostra.modos }
        };
        if (runtime.backendMode === 'HARDWARE') {
            linha.hardware = structuredClone(runtime.hardware ?? {});
            linha.diagnostics = Object.fromEntries([...plant.levelSensors, ...plant.flowSensors].map(sensor => [sensor.id, {
                source: sensor.source, diagnostics: structuredClone(sensor.diagnostics ?? {}), status: sensor.status, raw: sensor.raw, voltage: sensor.voltage,
                pressure: sensor.pressure, level: sensor.level, heightCm: sensor.heightCm,
                flow: sensor.flow, frequency: sensor.frequency, pulses: sensor.pulses
            }]));
        }
        for (const sensor of plant.levelSensors) linha.extras[`${sensor.id}.kpa`] = finito(sensor.pressure);
        const conhecidos = runtime.backendMode !== 'HARDWARE';
        for (const valvula of [...plant.manualValves, ...plant.recycleValves, plant.mainValve]) {
            linha.extras[`${valvula.id}.ab`] = !conhecidos || finito(valvula.opening) === null ? null : valvula.opening * 100;
        }
        for (const rele of plant.threeWayBranches) linha.extras[`${rele.id}.st`] = conhecidos && rele.state != null ? (rele.state ? 1 : 0) : null;
        return linha;
    }

    function exportarCsv() {
        if (!registro.length) return;
        const malhas = [];
        for (const linha of registro) for (const tag of Object.keys(linha.modos)) if (!malhas.includes(tag)) malhas.push(tag);
        const manuais = ['HV9', 'HV1', 'HV2', 'HV3', 'HV4', 'HV5', 'HV6', 'HV7', 'HV8'];
        const colunas = [
            ['data_hora', l => l.data],
            [ultimaBase === 'sim' ? 'tempo_simulacao_s' : 'tempo_s', l => l.t],
            ['ensaio', () => nomeEnsaio.value.trim()],
            ['cenario', l => l.cenario],
            ['modo_backend', l => l.modo],
            ...PENAS_NIVEL.map(p => [`${p.rotulo} nivel (cm)`, l =>
                l.diagnostics?.[p.key]?.diagnostics?.aboveLevelLimit ? '30+' : l.valores[p.key]]),
            ...PENAS_NIVEL.map(p => [`${p.rotulo} pressao (kPa)`, l => l.extras[`${p.key}.kpa`]]),
            ...PENAS_VAZAO.map(p => [`${p.rotulo} vazao (L/min)`, l => l.valores[p.key]]),
            ...PENAS_BOMBA.map(p => [`${p.rotulo} rotacao (%)`, l => l.valores[p.key]]),
            ...PENAS_VALVULA.map(p => [`${p.rotulo} abertura (%)`, l => l.valores[p.key]]),
            ...manuais.map(id => [`${componentLabel(id)} abertura (%)`, l => l.extras[`${id}.ab`]]),
            ...['OY1_A', 'OY1_B', 'OY2_A', 'OY2_B'].map(id => [`${componentLabel(id)} ligada`, l => l.extras[`${id}.st`]]),
            ...malhas.flatMap(tag => [
                [`${tag} PV`, l => l.valores[`${tag}.pv`]],
                [`${tag} SP`, l => l.valores[`${tag}.sp`]],
                [`${tag} MV (%)`, l => l.valores[`${tag}.mv`]],
                [`${tag} modo`, l => l.modos[tag] ?? '']
            ])
        ];
        if (registro.some(linha => linha.modo === 'HARDWARE')) {
            colunas.push(['ultima_telemetria', l => l.hardware?.telemetry?.lastReceivedAt == null ? null : new Date(l.hardware.telemetry.lastReceivedAt).toISOString()],
                ['serial_conectada', l => l.hardware?.serial?.connected], ['porta_serial', l => l.hardware?.serial?.port],
                ['baud', l => l.hardware?.serial?.baud], ['estado_telemetria', l => l.hardware?.telemetry?.status],
                ['firmware_id', l => l.hardware?.firmware?.boardId], ['firmware_version', l => l.hardware?.firmware?.version],
                ['compatibilidade', l => l.hardware?.compatibility?.status]);
            for (const p of [...PENAS_NIVEL, ...PENAS_VAZAO]) {
                const id = p.key;
                colunas.push([`${id} origem fisica`, l => l.diagnostics?.[id]?.source?.physical],
                    [`${id} pino`, l => l.diagnostics?.[id]?.source?.pin],
                    [`${id} indice API`, l => l.diagnostics?.[id]?.source?.apiIndex]);
                const fields = PENAS_NIVEL.includes(p)
                    ? { raw: 'RAW', voltage: 'tensao ADC (V)', level: 'nivel (%)', heightCm: 'altura (cm)', status: 'status' }
                    : { raw: 'RAW', flow: 'medicao (L/min)', frequency: 'Hz derivado entre polls', pulses: 'pulsos acumulados', status: 'status' };
                for (const [key, label] of Object.entries(fields)) {
                    colunas.push([`${id} ${label}`, l => {
                        const sensor = l.diagnostics?.[id];
                        if (key === 'heightCm' && sensor?.diagnostics?.aboveLevelLimit) return '30+';
                        if (key === 'status' && sensor?.diagnostics?.extrapolated) return 'extrapolated';
                        return sensor?.[key];
                    }]);
                }
                const diagnosticFields = PENAS_NIVEL.includes(p)
                    ? { raw: 'RAW firmware', calibrated: 'calibrado firmware', filtered: 'filtrado firmware', filteredRaw: 'RAW filtrado', voltageSource: 'origem tensao ADC', valid: 'valido', outOfRange: 'fora de faixa', stale: 'stale', ageMs: 'idade firmware (ms)' }
                    : { rawFlow: 'vazao recebida', sourceUnit: 'unidade recebida', acquisitionMethod: 'metodo aquisicao', deltaPulses: 'delta pulsos entre polls', deltaSeconds: 'intervalo polls (s)', valid: 'valido', stale: 'stale', frequencySource: 'origem Hz' };
                for (const [key, label] of Object.entries(diagnosticFields)) colunas.push([`${id} ${label}`, l => l.diagnostics?.[id]?.diagnostics?.[key]]);
                if (PENAS_NIVEL.includes(p)) {
                    for (const key of ['rawMean50', 'rawMeanCount', 'adcVoltageMean50']) {
                        colunas.push([`${id} ${key}`, l => l.diagnostics?.[id]?.diagnostics?.[key]]);
                    }
                }
                colunas.push([`${id} horario aquisicao`, l => {
                    const at = l.diagnostics?.[id]?.diagnostics?.receivedAt;
                    return at == null ? null : new Date(at).toISOString();
                }]);
            }
        }
        const celula = valor => {
            if (valor === null || valor === undefined) return '';
            if (typeof valor === 'number') return Number.isFinite(valor) ? String(Number(valor.toFixed(6))).replace('.', ',') : '';
            const texto = String(valor);
            return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
        };
        const saida = [colunas.map(([nome]) => celula(nome)).join(';')];
        for (const linha of registro) saida.push(colunas.map(([, f]) => celula(f(linha))).join(';'));
        const blob = new Blob(['﻿', saida.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const dois = n => String(n).padStart(2, '0');
        const d = inicioGravacao ?? new Date();
        const carimbo = `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}-${dois(d.getMinutes())}-${dois(d.getSeconds())}`;
        const nome = nomeEnsaio.value.trim().replace(/[^\w\-]+/g, '_').slice(0, 40);
        const link = raiz.ownerDocument.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `seis-tanques${nome ? `_${nome}` : ''}_${carimbo}.csv`;
        raiz.ownerDocument.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    // API
    function update(plant, runtime = getRuntime()) {
        amostrar(plant, runtime);
        cenarioNome = (runtime.scenarios ?? []).find(s => s.id === runtime.scenario)?.nome ?? '';
        const malhas = runtime.loops ?? {};
        const nova = `${runtime.backendMode}#${runtime.sim?.tankHeightCm ?? ''}#`
            + Object.entries(malhas).map(([tag, m]) => `${tag}:${m.unit}:${m.mvTarget?.id}`).join('|');
        if (nova !== assinatura) {
            assinatura = nova;
            rowViews.clear();
            janelasGraficos = montarJanelas(runtime);
            if (destaque !== null && !malhas[destaque]) destaque = null;
        }
        atualizarComposicao();
        if (gravando || registro.length) atualizarRegistro();
        desenhar();
    }

    function mostrar(sim) {
        visivel = Boolean(sim);
        raiz.hidden = !visivel;
        if (visivel) {
            applyRowHeights();
            agendarDesenho();
        }
    }

    function destacarMalha(tag) {
        destaque = tag ?? null;
        aplicarDestaque();
        desenhar();
    }

    new ResizeObserver(agendarDesenho).observe(viewport);

    return {
        element: raiz,
        update,
        show: () => mostrar(true),
        hide: () => mostrar(false),
        isVisible: () => visivel,
        redraw: agendarDesenho,
        focusLoop: destacarMalha
    };
}
