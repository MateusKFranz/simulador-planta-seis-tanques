"""Cenários de controle do modo MODELICA.

Cada cenário é uma lista de malhas. Uma malha liga uma variável de
processo (PV) a uma variável manipulada (MV) por um controlador do banco
(PID_ISA ou PI). As associações usam os IDs oficiais dos equipamentos.

Correspondência com o P&ID (ver cabeçalho de modelica/modelo_6tanques_v13.mo):
    FT101 = FI1   FT102 = FI2   FT103 = FI5   FT104 = FI6   FT105 = FI3   FT106 = FI4
    LV101 = LV1    LV102 = LV2    LV103 = LV3    LV104 = LV4
    B101 = JIC3     B102 = JIC4     B103 = JIC1
    TQ101..106 = TQ1..TQ6, LT101..106 = LI1..LI6

As sintonias iniciais são provisórias (a planta ainda não foi
identificada); o backend permite ajustá-las com a simulação rodando.
"""

import copy

# Sintonia padrão de uma malha quando o cenário não diz outra coisa.
SINTONIA_PADRAO = {
    "tipo": "PID_ISA",   # PID_ISA ou PI (PI = PID_ISA com Td = 0)
    "kp": 0.1,
    "ti": 10.0,
    "td": 0.0,
    "b": 1.0,
    "c": 0.0,
    "n": 10.0,
    "ftt": 2.0,
    "u_bias": 0.5,
    "u_min": 0.0,
    "u_max": 1.0,
}


def malha(tag, pv, mv, descricao, unidade, sp, sp_min, sp_max, acao=1, modo_inicial="AUTO", **sintonia):
    base = copy.deepcopy(SINTONIA_PADRAO)
    base.update(sintonia)
    return {
        "tag": tag,
        "modo_inicial": modo_inicial,   # modo ao carregar o cenário e no reset
        "descricao": descricao,
        "pv": pv,            # {"tipo": "vazao", "id": "FI1"} | {"tipo": "nivel", "id": "TQ1"} | {"tipo": "vazao_soma", "ids": [...]}
        "mv": mv,            # {"tipo": "valvula", "id": "LV1"} | {"tipo": "bomba", "id": "JIC3"}
        "unidade": unidade,
        "sp": sp,
        "sp_min": sp_min,
        "sp_max": sp_max,
        "acao": acao,        # +1 direta (MV sobe quando PV < SP), -1 reversa
        "sintonia": base,
    }


def vazao(ft):
    return {"tipo": "vazao", "id": ft}


def vazao_soma(*fts):
    return {"tipo": "vazao_soma", "ids": list(fts)}


def nivel(tanque):
    return {"tipo": "nivel", "id": tanque}


def valvula(v):
    return {"tipo": "valvula", "id": v}


def bomba(p):
    return {"tipo": "bomba", "id": p}


# ESTIMATIVAS DE OPERAÇÃO DA PLANTA
# Aplicadas por cima dos padrões da FMU (modelo v13) ao iniciar o modo
# MODELICA. NÃO são medições: existem só para a simulação ter um ponto de
# operação utilizável enquanto a bancada não é caracterizada. Trocar pelos
# valores medidos (ensaio de esvaziamento e abertura real das HV) quando houver.
#
# CV_HV: condutância da válvula manual toda aberta (cm³/s por raiz de cm.c.a.).
# No v13 o padrão é 1000 ("perda desprezível"); com isso a abertura da HV
# não tem efeito acima de ~2 % e as descargas (mangueira de 10 mm, Cd 0,6)
# escoam ~66 cm³/s com 10 cm de coluna, quase toda a vazão da JIC1: os
# tanques não passam de 4 cm. Com 10 (cerca de metade da condutância da
# mangueira) TQ1/TQ2 ficam em ~15 cm com as válvulas a 50 %.
PARAMETROS_PLANTA = {f"CV_HV10{i}": 10.0 for i in range(1, 10)}

# Aberturas de operação das válvulas manuais (o operador ajusta na bancada).
# HV1/HV2 sempre abertas, como na bancada; HV5/HV6 parcialmente
# fechadas para TQ5/TQ6 segurarem nível; recirculações a 30 %.
VALVULAS_MANUAIS_OPERACAO = {
    "HV9": 1.0,          # HV9, descarga de JIC1
    "HV1": 1.0,   # HV1
    "HV2": 1.0,   # HV2
    "HV3": 1.0,      # HV3, sucção de JIC3
    "HV4": 1.0,      # HV4, sucção de JIC4
    "HV5": 0.4,      # HV5, TQ5 -> TQ3
    "HV6": 0.4,      # HV6, TQ6 -> TQ4
    "HV7": 0.3,         # HV7, recirculação de JIC3
    "HV8": 0.3,         # HV8, recirculação de JIC4
}

# SINTONIAS (SIMC, PI) a partir de degraus em malha aberta no ponto de operação,
# com as outras malhas em AUTO (modelo + PARAMETROS_PLANTA acima):
#   LIC1/LIC2 por LV3/LV4: K = 63 cm, tau = 70 s, sem atraso; tau_c = 20 s
#   LIC3/LIC4 por LV1/LV2: integrador, 0,33 cm/s, atraso 2 s; tau_c = 20 s
#   LIC3/LIC4 por LV3/LV4: integrador, -0,72 cm/s; tau_c = 20 s
#   LIC3/LIC4 por JIC3/JIC4:  integrador, -0,48 cm/s; tau_c = 20 s
#   FIC1/FIC2 por LV1/LV2: estático, 3,6 L/min; FIC3 por JIC1: 4,2 L/min
# Nível: b = 0,6 (peso do SP; tira o sobressinal do degrau de SP) e FTt = 10
# (anti-windup mais rápido na partida com os tanques vazios). As vazões do
# dente de serra das XV (3 s / 2 s) aparecem como ±0,3 cm em TQ3/TQ4.
NIVEL = {"b": 0.6, "ftt": 10.0}

# TQ3 e TQ4 não têm descarga por gravidade (só as bombas os esvaziam):
# são integradores e só ficam estáveis com uma malha de nível. Por isso os
# dois cenários de vazão também seguram o nível deles, pelo atuador de saída.

CENARIOS = {
    "nivel": {
        "nome": "Nível",
        "descricao": "Níveis de TQ1..TQ4 pelas válvulas de controle (pareamento direto); bombas fixas em 100 %.",
        "fixos": {
            "pumps": {"JIC3": 1.0, "JIC4": 1.0, "JIC1": 1.0},
            "valvulas_manuais": VALVULAS_MANUAIS_OPERACAO,
        },
        "malhas": [
            malha("LIC1", nivel("TQ1"), valvula("LV3"), "Nível de TQ1 por LV3", "cm", 12.0, 0.0, 25.0, kp=0.056, ti=70.0, **NIVEL),
            malha("LIC2", nivel("TQ2"), valvula("LV4"), "Nível de TQ2 por LV4", "cm", 12.0, 0.0, 25.0, kp=0.056, ti=70.0, **NIVEL),
            malha("LIC3", nivel("TQ3"), valvula("LV1"), "Nível de TQ3 por LV1", "cm", 10.0, 0.0, 25.0, kp=0.138, ti=88.0, **NIVEL),
            malha("LIC4", nivel("TQ4"), valvula("LV2"), "Nível de TQ4 por LV2", "cm", 10.0, 0.0, 25.0, kp=0.138, ti=88.0, **NIVEL),
        ],
    },
    "vazao_valvula": {
        "nome": "Vazão por válvula",
        "descricao": "Vazões de alimentação pelas LV1/LV2; TQ3/TQ4 seguram nível pelas LV3/LV4. Bombas fixas em 100 %.",
        "fixos": {
            "pumps": {"JIC3": 1.0, "JIC4": 1.0, "JIC1": 1.0},
            "valvulas_manuais": VALVULAS_MANUAIS_OPERACAO,
        },
        "malhas": [
            malha("FIC1", vazao("FI1"), valvula("LV1"), "Vazão antes de LV1", "L/min", 1.6, 0.0, 6.0, kp=0.12, ti=1.5),
            malha("FIC2", vazao("FI2"), valvula("LV2"), "Vazão antes de LV2", "L/min", 1.6, 0.0, 6.0, kp=0.12, ti=1.5),
            malha("LIC3", nivel("TQ3"), valvula("LV3"), "Nível de TQ3 por LV3", "cm", 10.0, 0.0, 25.0, acao=-1, kp=0.069, ti=80.0, **NIVEL),
            malha("LIC4", nivel("TQ4"), valvula("LV4"), "Nível de TQ4 por LV4", "cm", 10.0, 0.0, 25.0, acao=-1, kp=0.069, ti=80.0, **NIVEL),
        ],
    },
    "vazao_bomba": {
        "nome": "Vazão por bomba",
        "descricao": "Vazão total de alimentação pela JIC1; TQ3/TQ4 seguram nível pelas JIC3/JIC4. Válvulas de controle fixas em 100 %.",
        "fixos": {
            "actuatedValves": {"LV1": 1.0, "LV2": 1.0, "LV3": 1.0, "LV4": 1.0},
            "valvulas_manuais": VALVULAS_MANUAIS_OPERACAO,
        },
        "malhas": [
            malha("FIC3", vazao_soma("FI1", "FI2"), bomba("JIC1"), "Vazão total de JIC1 (FI1 + FI2)", "L/min", 3.0, 0.0, 12.0, kp=0.1, ti=2.0),
            malha("LIC3", nivel("TQ3"), bomba("JIC3"), "Nível de TQ3 por JIC3", "cm", 10.0, 0.0, 25.0, acao=-1, kp=0.104, ti=80.0, **NIVEL),
            malha("LIC4", nivel("TQ4"), bomba("JIC4"), "Nível de TQ4 por JIC4", "cm", 10.0, 0.0, 25.0, acao=-1, kp=0.104, ti=80.0, **NIVEL),
        ],
    },
}

CENARIO_PADRAO = "nivel"


def obter_cenario(nome):
    """Cópia independente do cenário, para o runtime alterar SP/sintonia à vontade."""
    if nome not in CENARIOS:
        raise KeyError(f"Cenário desconhecido: {nome}")
    return copy.deepcopy(CENARIOS[nome])


def resumo_cenarios():
    return [
        {
            "id": nome,
            "nome": c["nome"],
            "descricao": c["descricao"],
            "malhas": [m["tag"] for m in c["malhas"]],
        }
        for nome, c in CENARIOS.items()
    ]
