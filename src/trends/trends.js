import { bindTimeline, durationLimit, timeRange } from './trends-interaction.js';
// TENDÊNCIAS
/* Níveis, PV/SP e MV compartilham o eixo de tempo.
   Dados ausentes são lacunas. O registro exporta CSV em português. */

import { componentLabel } from '../shared/component-labels.js';
import { tankLevelSensorId } from '../state/plant-state.js';

// PALETA
const AZUL = '#2a78d6';
const VERDE = '#138a5e';
const ROSA = '#d55181';
const CORES_MALHA = [AZUL, VERDE, ROSA];
const TRACEJADO = [6, 4];
const PONTILHADO = [2, 3];       // setpoint

const MAX_AMOSTRAS = 36000;      // 1 h de simulação a 10 Hz
const MAX_REGISTRO = 400000;
const JANELAS = [15, 30, 60, 120, 300, 600, 1800];
const MARGEM = { esq: 50, dir: 48, topo: 22, base: 6 };   // à direita: ponteiros de SP
const ALTURA_EIXO_T = 20;
const ALTURA_FAIXA = 12;

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
    pena('LI1', 'LI1', AZUL, { descricao: 'TQ1' }),
    pena('LI2', 'LI2', AZUL, { descricao: 'TQ2', direita: true }),
    pena('LI3', 'LI3', VERDE, { descricao: 'TQ3' }),
    pena('LI4', 'LI4', VERDE, { descricao: 'TQ4', direita: true }),
    pena('LI5', 'LI5', ROSA, { descricao: 'TQ5' }),
    pena('LI6', 'LI6', ROSA, { descricao: 'TQ6', direita: true })
];

const PENAS_VAZAO = [
    pena('FI3', 'FI3', AZUL, { descricao: 'LV3 → TQ1', digitos: 2 }),
    pena('FI4', 'FI4', AZUL, { descricao: 'LV4 → TQ2', digitos: 2, direita: true }),
    pena('FI1', 'FI1', VERDE, { descricao: 'antes de LV1', digitos: 2 }),
    pena('FI2', 'FI2', VERDE, { descricao: 'antes de LV2', digitos: 2, direita: true }),
    pena('FI5', 'FI5', ROSA, { descricao: 'OY2_A → TQ5', digitos: 2 }),
    pena('FI6', 'FI6', ROSA, { descricao: 'OY1_B → TQ6', digitos: 2, direita: true })
];

// Só para o CSV (bombas e válvulas de controle)
const PENAS_BOMBA = ['JIC3', 'JIC4', 'JIC1'].map(id => pena(id, componentLabel(id), AZUL));
const PENAS_VALVULA = ['LV1', 'LV2', 'LV3', 'LV4'].map(id => pena(id, componentLabel(id), AZUL));

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

export function createTrends(host, { getRuntime = () => ({}) } = {}) {
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
    let janelasGraficos = [];       // descrição das três janelas
    let plots = [];                 // {canvas, caixa, janela, sub, ultimo}
    const ocultas = new Set();
    let estilo = null;
    let cenarioNome = '';

    // ESTRUTURA
    const raiz = h('section', { class: 'trends-view', 'aria-label': 'Tendências' });
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

    const barra = h('div', { class: 'tv-bar' }, [
        titulo,
        h('div', { class: 'tv-spacer' }),
        h('div', { class: 'tv-group' }, [h('label', { text: 'Janela' }), seletorJanela, botaoAoVivo]),
        h('div', { class: 'tv-group' }, [nomeEnsaio, botaoGravar, contagem, botaoCsv]),
        h('div', { class: 'tv-group' }, [botaoLimpar])
    ]);
    const linhas = h('div', { class: 'tv-rows' });
    const vazio = h('div', { class: 'tv-empty', text: 'Aguardando dados do backend…' });
    raiz.append(barra, linhas, vazio);
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
        aoVivo = true;
        fimVista = null;
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
    function estiloMalhas(malhas) {
        const tags = Object.keys(malhas);
        const estilos = {};
        tags.forEach((tag, i) => {
            if (tags.length <= 3) estilos[tag] = { cor: CORES_MALHA[i], dash: [] };
            else estilos[tag] = { cor: CORES_MALHA[Math.floor(i / 2) % 3], dash: i % 2 ? TRACEJADO : [] };
        });
        return estilos;
    }

    function pvNome(malha) {
        const pv = malha.pvSource ?? {};
        if (pv.tipo === 'vazao_soma') return (pv.ids ?? []).map(componentLabel).join(' + ');
        if (pv.tipo === 'nivel') return componentLabel(tankLevelSensorId(pv.id));
        return componentLabel(pv.id);
    }

    function montarJanelas(runtime) {
        const malhas = runtime.loops ?? {};
        const estilos = estiloMalhas(malhas);
        const hMax = runtime.sim?.tankHeightCm ?? 25;
        const lista = [];

        // SP dos tanques com malha de nível, pontilhado na cor do tanque
        const spNivel = [];
        for (const [tag, malha] of Object.entries(malhas)) {
            if (malha.pvSource?.tipo !== 'nivel') continue;
            const lt = tankLevelSensorId(malha.pvSource.id);
            const base = PENAS_NIVEL.find(x => x.key === lt);
            if (!base) continue;
            const sp = pena(`${tag}.sp`, `SP ${tag}`, base.cor, { degrau: true, largura: 1.6, digitos: 1, malha: tag });
            sp.dash = PONTILHADO;
            sp.sp = true;
            sp.de = lt;
            spNivel.push(sp);
        }
        lista.push({
            id: 'niveis',
            titulo: 'Nível dos tanques',
            subtitulo: spNivel.length ? 'pontilhado: setpoint' : null,
            subs: [{ unidade: 'cm', faixa: { min: 0, max: hMax }, penas: [...PENAS_NIVEL, ...spNivel] }]
        });

        const tags = Object.keys(malhas);
        if (tags.length) {
            const porUnidade = new Map();
            for (const tag of tags) {
                const malha = malhas[tag];
                const unidade = malha.unit ?? '';
                const digitos = unidade === 'cm' ? 1 : 2;
                const { cor, dash } = estilos[tag];
                const pv = pena(`${tag}.pv`, tag, cor, { descricao: pvNome(malha), digitos, malha: tag });
                pv.dash = dash;
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
            lista.push({ id: 'controladas', titulo: 'Variáveis controladas', subtitulo: 'PV linha · SP pontilhado', subs: [...porUnidade.values()], malhas: tags });
            lista.push({
                id: 'manipuladas',
                titulo: 'Variáveis manipuladas',
                subtitulo: 'saída dos controladores',
                malhas: tags,
                subs: [{
                    unidade: '%',
                    faixa: { min: 0, max: 100 },
                    faixasModo: tags,
                    penas: tags.map(tag => {
                        const malha = malhas[tag];
                        const p = pena(`${tag}.mv`, componentLabel(malha.mvTarget?.id), estilos[tag].cor, { descricao: tag, digitos: 0, malha: tag });
                        p.dash = estilos[tag].dash;
                        return p;
                    })
                }]
            });
        } else {
            lista.push({ id: 'controladas', titulo: 'Vazões medidas', subtitulo: 'sem malhas de controle neste modo', subs: [{ unidade: 'L/min', faixa: { auto: true, min: 0, max: 12, spanMin: 1, deZero: true }, penas: PENAS_VAZAO }] });
            lista.push({
                id: 'manipuladas',
                titulo: 'Variáveis manipuladas',
                vazio: runtime.backendMode === 'HARDWARE'
                    ? 'Planta real em somente leitura: o estado dos atuadores não é medido.'
                    : 'Sem malhas de controle no cenário.',
                subs: []
            });
        }
        return lista;
    }

    // MONTAGEM DO DOM DAS JANELAS
    function montarLinhas() {
        linhas.innerHTML = '';
        plots = [];
        janelasGraficos.forEach((jan, indiceJanela) => {
            const ultimaJanela = indiceJanela === janelasGraficos.length - 1;
            const area = h('div', { class: 'tv-plot' });
            const legenda = h('div', { class: 'tv-legend' });
            linhas.append(h('div', { class: `tv-row tv-row-${jan.id}` }, [area, legenda]));

            if (jan.vazio) {
                area.append(h('div', { class: 'tv-plot-empty' }, [h('strong', { text: jan.titulo }), h('span', { text: jan.vazio })]));
            }
            jan.subs.forEach((sub, i) => {
                const canvas = h('canvas', { class: 'tv-canvas' });
                const caixa = h('div', { class: 'tv-sub' }, [canvas]);
                area.append(caixa);
                plots.push({ canvas, caixa, janela: jan, sub, primeiroSub: i === 0, ultimo: ultimaJanela });
                ligarPonteiro(canvas, caixa, sub, ultimaJanela);
            });

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
                legenda.append(h('div', { class: 'tv-legend-note' }, [h('span', { class: 'tv-man-swatch' }), h('span', { text: 'faixa âmbar: malha em MAN' })]));
            } else {
                for (const sub of jan.subs) {
                    for (const p of sub.penas) {
                        if (p.sp) continue;
                        const sp = sub.penas.find(x => x.sp && x.de === p.key) ?? null;
                        legenda.append(linhaLegendaSimples(p, sub.unidade, sp));
                    }
                }
            }
        });
        aplicarDestaque();
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
    function ligarPonteiro(canvas, caixa, sub, ultimo) {
        const geometry = () => {
            const r = canvas.getBoundingClientRect();
            const faixas = sub.faixasModo?.length ?? 0;
            return { left: r.left + MARGEM.esq, top: r.top + MARGEM.topo,
                width: Math.max(1, r.width - MARGEM.esq - MARGEM.dir),
                height: Math.max(1, r.height - MARGEM.topo - MARGEM.base - (faixas ? faixas * ALTURA_FAIXA + 6 : 0) - (ultimo ? ALTURA_EIXO_T : 0)) };
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
            aoVivo = true;
            fimVista = null;
        }
        ultimaBase = base;
        ultimoCenario = cenario;
        if (ultimo && amostras.length && t - ultimo.t < 0.1) return;

        const valores = {};
        for (const sensor of plant.levelSensors) {
            valores[sensor.id] = finito(sensor.heightCm);
        }
        for (const sensor of plant.flowSensors) valores[sensor.id] = finito(sensor.flow);
        // As séries diretas de atuadores ficam sem amostras em HARDWARE.
        const atuadoresConhecidos = runtime.backendMode !== 'HARDWARE';
        for (const bomba of plant.pumps) valores[bomba.id] = !atuadoresConhecidos || bomba.power == null ? null : bomba.power ? (finito(bomba.command) === null ? null : bomba.command * 100) : 0;
        for (const valvula of plant.actuatedValves) valores[valvula.id] = !atuadoresConhecidos || finito(valvula.opening) === null ? null : valvula.opening * 100;
        const modos = {};
        for (const [tag, malha] of Object.entries(runtime.loops ?? {})) {
            valores[`${tag}.pv`] = finito(malha.pv);
            valores[`${tag}.sp`] = finito(malha.sp);
            valores[`${tag}.mv`] = finito(malha.mv) === null ? null : malha.mv * 100;
            modos[tag] = malha.quality === 'bad' ? 'BAD' : (malha.effectiveMode ?? malha.mode ?? '—');
        }
        const amostra = { t, data: agora, valores, modos };
        amostras.push(amostra);
        if (amostras.length > MAX_AMOSTRAS) amostras.splice(0, amostras.length - MAX_AMOSTRAS);

        if (gravando) {
            registro.push(linhaRegistro(plant, runtime, amostra));
            if (registro.length >= MAX_REGISTRO) pararGravacao('Registro encerrado: limite de linhas atingido.');
        }
    }

    // DESENHO
    function lerEstilo() {
        const css = raiz.ownerDocument.defaultView.getComputedStyle(raiz);
        const v = (nome, padrao) => css.getPropertyValue(nome).trim() || padrao;
        estilo = {
            tinta: v('--ink', '#1c1d21'),
            suave: v('--muted', '#5f6168'),
            regra: v('--rule', '#d9d9d9'),
            papel: v('--paper', '#ffffff'),
            man: v('--man', '#b45309'),
            ruim: v('--bad', '#9333ea')
        };
    }

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
        if (!estilo) lerEstilo();
        vazio.hidden = amostras.length > 1;
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
            campo.textContent = valor === null || valor === undefined ? '—' : `${numero(valor, Number(campo.dataset.digits))} ${unidade}`;
        }
        for (const campo of linhas.querySelectorAll('.tv-spval')) {
            const valor = ref ? ref.valores[campo.dataset.key] : null;
            campo.textContent = `SP ${valor === null || valor === undefined ? '—' : numero(valor, Number(campo.dataset.digits))}`;
        }
        for (const campo of linhas.querySelectorAll('.tv-mode')) {
            const modo = ref ? ref.modos[campo.dataset.mode] : null;
            campo.textContent = modo === 'BAD' ? 'sem PV' : modo ?? '—';
            campo.className = `tv-mode${modo && !['AUTO', '—'].includes(modo) ? ' man' : ''}`;
        }
        linhas.classList.toggle('at-cursor', cursor !== null);
        const base = ultimaBase === 'relogio' ? 'horário do computador' : 'tempo de simulação';
        const quando = cursor !== null && ref ? ` · cursor em ${formatarTempo(ref, ref.t)}` : '';
        titulo.querySelector('.tv-subtitle').textContent = `${cenarioNome ? `Cenário ${cenarioNome} · ` : ''}${base}${quando}`;
    }

    function faixaY(sub, visiveis) {
        const f = sub.faixa;
        if (!f.auto) return [f.min, f.max];
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
        let hi = Math.min(f.max, max + folga);
        if (hi <= lo) hi = lo + (f.spanMin ?? 1);
        const passo = passoBonito(hi - lo, 4);
        return [Math.max(f.min, Math.floor(lo / passo) * passo), Math.ceil(hi / passo) * passo];
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

        const faixas = sub.faixasModo ?? [];
        const alturaFaixas = faixas.length ? faixas.length * ALTURA_FAIXA + 6 : 0;
        const x0 = MARGEM.esq;
        const x1 = largura - MARGEM.dir;
        const y0 = MARGEM.topo;
        const y1 = altura - MARGEM.base - alturaFaixas - (ultimo ? ALTURA_EIXO_T : 0);
        if (y1 - y0 < 20) return;
        const [vmin, vmax] = faixaY(sub, visiveis);
        const xDe = t => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
        const yDe = v => y1 - ((Math.max(vmin, Math.min(vmax, v)) - vmin) / (vmax - vmin || 1)) * (y1 - y0);

        ctx.fillStyle = estilo.papel;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

        // Grade Y
        ctx.font = '11px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        const passoY = passoBonito(vmax - vmin, Math.max(2, Math.min(5, Math.floor((y1 - y0) / 28))));
        const digitosY = passoY < 1 ? (passoY < 0.1 ? 2 : 1) : 0;
        for (let v = Math.ceil(vmin / passoY - 1e-9) * passoY; v <= vmax + 1e-9; v += passoY) {
            const y = Math.round(yDe(v)) + 0.5;
            ctx.strokeStyle = estilo.regra;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.fillStyle = estilo.suave;
            ctx.fillText(numero(v, digitosY), x0 - 6, y);
        }

        // Grade de tempo
        const passoT = passoTempo(t1 - t0, x1 - x0);
        const yRotuloT = y1 + alturaFaixas + 6;
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
        ctx.strokeStyle = '#9aa0a6';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
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
            ctx.strokeStyle = p.cor;
            ctx.lineWidth = p.largura + (destaque !== null && p.malha === destaque ? 0.6 : 0);
            ctx.lineJoin = 'round';
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
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.restore();

        // Faixas de modo por malha (âmbar = MAN, magenta = sem PV), abaixo das MV
        if (faixas.length) {
            ctx.font = '600 9px ui-monospace, Consolas, monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            faixas.forEach((tag, i) => {
                const yf = y1 + 4 + i * ALTURA_FAIXA;
                ctx.globalAlpha = destaque !== null && tag !== destaque ? 0.35 : 1;
                ctx.fillStyle = '#eef0f2';
                ctx.fillRect(x0, yf, x1 - x0, ALTURA_FAIXA - 3);
                let inicio = null;
                let modoAberto = null;
                const fechar = fim => {
                    const xa = Math.max(x0, xDe(inicio));
                    const xb = Math.min(x1, xDe(fim));
                    if (xb - xa > 0.3) {
                        ctx.fillStyle = modoAberto === 'BAD' ? estilo.ruim : estilo.man;
                        ctx.fillRect(xa, yf, xb - xa, ALTURA_FAIXA - 3);
                    }
                };
                for (const a of visiveis) {
                    const modo = a.modos[tag];
                    const emMan = modo != null && !['AUTO', '—'].includes(modo);
                    if (emMan && inicio === null) { inicio = a.t; modoAberto = modo; }
                    if (!emMan && inicio !== null) { fechar(a.t); inicio = null; }
                }
                if (inicio !== null && visiveis.length) fechar(visiveis[visiveis.length - 1].t);
                ctx.fillStyle = estilo.suave;
                ctx.fillText(tag, x0 - 4, yf + (ALTURA_FAIXA - 3) / 2 + 0.5);
                ctx.globalAlpha = 1;
            });
        }

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
            ctx.lineTo(x, y1 + alturaFaixas);
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
            ...PENAS_NIVEL.map(p => [`${p.rotulo} nivel (cm)`, l => l.valores[p.key]]),
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
                for (const [key, label] of Object.entries(fields)) colunas.push([`${id} ${label}`, l => l.diagnostics?.[id]?.[key]]);
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
            janelasGraficos = montarJanelas(runtime);
            if (destaque !== null && !malhas[destaque]) destaque = null;
            montarLinhas();
        }
        if (gravando || registro.length) atualizarRegistro();
        desenhar();
    }

    function mostrar(sim) {
        visivel = Boolean(sim);
        raiz.hidden = !visivel;
        if (visivel) agendarDesenho();
    }

    function destacarMalha(tag) {
        destaque = tag ?? null;
        aplicarDestaque();
        desenhar();
    }

    new ResizeObserver(agendarDesenho).observe(linhas);

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
