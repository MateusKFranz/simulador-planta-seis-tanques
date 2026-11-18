# Identificação dos componentes

Os IDs abaixo são utilizados no backend, snapshots WebSocket, JavaScript, sinótico, Tendências e CSV. As variáveis matemáticas e os nomes de entradas/saídas das FMUs permanecem internos ao adaptador Python.

## Tanques e níveis

| Equipamento | Estado físico da FMU | Saída de altura | Instrumento público |
| --- | --- | --- | --- |
| TQ1 | h1 | h_TQ101 | LI1 |
| TQ2 | h2 | h_TQ102 | LI2 |
| TQ3 | h3 | h_TQ103 | LI3 |
| TQ4 | h4 | h_TQ104 | LI4 |
| TQ5 | h5 | h_TQ105 | LI5 |
| TQ6 | h6 | h_TQ106 | LI6 |

`TQ1` identifica o tanque; `h1` é a variável física. As saídas LT101…LT106 e LT101_V…LT106_V da FMU alimentam pressão e tensão dos instrumentos correspondentes.

LI1…LI6 medem nível. LIC1…LIC4 controlam nível; FIC1…FIC3 controlam vazão. `levelSensors.LI3` e `levelSensors.LI4` são leituras de TQ3/TQ4; `loops.LIC3` e `loops.LIC4` contêm PV, SP, MV e modo das malhas correspondentes.

LIC1/LIC2 usam nível de TQ1/TQ2; FIC1/FIC2 usam FI1/FI2; FIC3 usa a soma FI1 + FI2. Cenários, pareamentos e sintonias são definidos em `python/simulation/cenarios.py`.

## Vazões

| Saída Modelica | ID oficial | Local de medição |
| --- | --- | --- |
| FT101 | FI1 | Antes de OY1, na entrada de LV1 |
| FT102 | FI2 | Antes de OY2, na entrada de LV2 |
| FT105 | FI3 | LV3 → TQ1 |
| FT106 | FI4 | LV4 → TQ2 |
| FT103 | FI5 | OY2, ramo A → TQ5 |
| FT104 | FI6 | OY1, ramo B → TQ6 |

FI1/FI2 seguem os pontos de medição do modelo. A disposição física correspondente depende de confirmação experimental.

## Atuadores

| Elemento Modelica | ID oficial | Entrada da FMU |
| --- | --- | --- |
| B103 | JIC1 | pwm_B103 |
| B101 | JIC3 | pwm_B101 |
| B102 | JIC4 | pwm_B102 |
| LV101…LV104 | LV1…LV4 | abertura_LV101…abertura_LV104 |
| HV101…HV109 | HV1…HV9 | abertura_HV101…abertura_HV109 |
| XV101 | OY1 | tA_XV101, tB_XV101 |
| XV102 | OY2 | tA_XV102, tB_XV102 |

HV1/HV2 drenam TQ1/TQ2; HV3/HV4 ficam nas sucções de JIC3/JIC4; HV5/HV6 ligam os tanques superiores aos intermediários; HV7/HV8 regulam recirculação; HV9 é a válvula manual central.

OY1/OY2 são dois equipamentos, cada um com ramos A/B. O snapshot apresenta `threeWayValves.OY1.branches.A.state` e `.B.state`. `xv.OY1` informa a temporização. OY2 tem a mesma estrutura. Os identificadores OY1_A/OY1_B/OY2_A/OY2_B são internos à representação dos ramos e dos trechos, não equipamentos independentes.

## Comandos

A estrutura funcional dos comandos permanece. Exemplos:

```json
{"type":"sim","reset":true,"levels":{"TQ1":4,"TQ3":10}}
{"type":"pump","id":"JIC3","command":0.37}
{"type":"valve","id":"LV3","opening":0.61}
{"type":"valve","id":"HV9","opening":0.61}
{"type":"manual_valve","id":"HV7","opening":0.61}
{"type":"xv","id":"OY1","tA":3,"tB":2}
{"type":"loop","id":"LIC3","sp":10}
```

O comando `relay`, quando utilizado por cliente externo, identifica o equipamento e o ramo (`id: "OY1"`, `branch: "A"`, `state: true`). Seu efeito é selecionar o ramo pela temporização do modelo. A HMI não oferece atuação independente dos ramos. HARDWARE recusa comandos de atuação.

## Aquisição física

O protocolo serial do Arduino identifica canais LT1…LT6 e FT1…FT6. Esses nomes pertencem à aquisição, não ao contrato WebSocket. O adaptador traduz os canais antes de publicar:

- LT1…LT6 → LI1…LI6.
- FT1…FT6 → FI5, FI6, FI1, FI3, FI4, FI2.

As calibrações Python usam os IDs oficiais. Sensor ausente permanece sem leitura; a existência de seis canais no contrato não significa seis sensores físicos instalados.

## Geometria

FI1 está em `(0.425, 0.46)` e FI2 em `(0.555, 0.46)`, coordenadas normalizadas de configuração. As âncoras OY1_A_OUT e OY2_B_OUT são pontos de passagem invisíveis que preservam a geometria das tubulações de saída. Os traços de continuidade conectam seus extremos sem alterar os vértices das rotas.

As saídas XY101A/XY101B e XY102A/XY102B da FMU alimentam os estados dos ramos de OY1 e OY2. Os sinais internos de vazão F_B*, F_LV*, F_XV* e q_TQ* são publicados em segments com os IDs oficiais dos equipamentos ou ramos correspondentes.
