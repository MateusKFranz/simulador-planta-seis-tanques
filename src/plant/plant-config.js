// CONFIGURAÇÃO VISUAL DA PLANTA
/* Posições dos componentes e vértices das tubulações.
Coordenadas normalizadas: x vai da esquerda (0) à direita (1);
y vai do topo (0) à base (1). */

export const PLANT_CONFIG = {
    // Referência visual; o ajuste à tela usa os limites reais do grafo.
    drawingSize: { width: 1548, height: 832 },
    // Deslocamentos em pixels após a escala, para evitar sobreposição com equipamentos e bordas.
    componentOffsets: {
        levelSensors: { LI2: { x: 55 }, LI4: { x: 30 } },
        flowSensors: { FI6: { y: 15 } },
        relayValves: { OY1_A: { x: -10 }, OY1_B: { x: 10 }, OY2_A: { x: -10 }, OY2_B: { x: 10 } }
    },
    // Dimensões apenas visuais. Mantém cada componente centralizado na rota existente.
    componentScale: {
        LiquidTank: [1, 1, 1.3],
        Pump: [1.2, 1.2, 1.4],
        LevelSensor: [1.5, 1.5, 1.6],
        FlowSensor: [1.5, 1.5, 1.6],
        ActuatedValve: [1.3, 1.15, 1.4],
        RelayThreeWayValve: [1, 1.25, 1.3],
        ManualValve: [1.4, 1.4, 1.6],
        MainValve: [1.25, 1.25, 1.4]
    },


    // LAYOUT DOS COMPONENTES

    layout: {

        // TANQUES

        tanks: {

            TQ5: {
                x: 0.08,
                y: 0.06
            },

            TQ6: {
                x: 0.82,
                y: 0.06
            },

            TQ3: {
                x: 0.08,
                y: 0.42
            },

            TQ4: {
                x: 0.82,
                y: 0.42
            },

            TQ1: {
                x: 0.28,
                y: 0.40
            },

            TQ2: {
                x: 0.65,
                y: 0.40
            }
        },

        // SENSORES DE NÍVEL

        levelSensors: {

            LI5: {
                x: 0.03,
                y: 0.16
            },

            LI6: {
                x: 0.905,
                y: 0.16
            },

            LI3: {
                x: 0.03,
                y: 0.52
            },

            LI4: {
                x: 0.885,
                y: 0.52
            },

            LI1: {
                x: 0.23,
                y: 0.50
            },

            LI2: {
                x: 0.695,
                y: 0.50
            }
        },

        // SENSORES DE VAZÃO
        /* FI1/FI2 medem antes de OY1/OY2, nos trechos de entrada de LV1/LV2.
           FI3/FI4 medem a alimentação de TQ1/TQ2; FI5/FI6, de TQ5/TQ6. */

        flowSensors: {

            FI5: {
                x: 0.29,
                y: 0.03
            },

            FI6: {
                x: 0.68,
                y: -0.01
            },

            FI1: {
                x: 0.425,
                y: 0.46
            },

            FI3: {
                x: 0.34,
                y: 0.32
            },

            FI4: {
                x: 0.63,
                y: 0.32
            },

            FI2: {
                x: 0.555,
                y: 0.46
            }
        },

        // BOMBAS

        pumps: {

            JIC3: {
                x: 0.105,
                y: 0.82
            },

            JIC4: {
                x: 0.835,
                y: 0.82
            },

            JIC1: {
                x: 0.484,
                y: 0.86
            }
        },

        // VÁLVULAS DE 3 VIAS / RELÉS

        relayValves: {

            OY1_A: {
                x: 0.405,
                y: 0.14
            },

            OY1_B: {
                x: 0.435,
                y: 0.14
            },

            OY2_A: {
                x: 0.54,
                y: 0.14
            },

            OY2_B: {
                x: 0.57,
                y: 0.14
            }
        },

        // VÁLVULAS ATUADAS
        /* LV1 -> OY1
           LV2 -> OY2
           LV3 -> TQ1
           LV4 -> TQ2
         */

        actuatedValves: {

            LV1: {
                x: 0.425,
                y: 0.31
            },

            LV2: {
                x: 0.555,
                y: 0.31
            },

            LV3: {
                x: 0.38,
                y: 0.55
            },

            LV4: {
                x: 0.59,
                y: 0.55
            }
        },

        // VÁLVULAS DE RECIRCULAÇÃO
        /* HV7 e HV8 pertencem à
           recirculação de JIC3 e JIC4.
         */

        recycleValves: {

            HV7: {
                x: 0.175,
                y: 0.64
            },

            HV8: {
                x: 0.795,
                y: 0.64
            }
        },

        // VÁLVULAS MANUAIS
        /* HV = Hand Valve
           HV5:
           TQ5 -> TQ3
           HV7:
           JIC3 -> TQ3 diretamente por uma entrada independente
           HV6:
           TQ6 -> TQ4
           HV8:
           JIC4 -> TQ4 diretamente por uma entrada independente
           HV3:
           TQ3 -> JIC3
           HV4:
           TQ4 -> JIC4
           HV1:
           TQ1 -> reservatório
           HV2:
           TQ2 -> reservatório
         */

        manualValves: {

            HV5: {
                x: 0.115,
                y: 0.35
            },

            HV6: {
                x: 0.823,
                y: 0.35
            },

            HV3: {
                x: 0.07,
                y: 0.70
            },

            HV4: {
                x: 0.87,
                y: 0.70
            },

            HV1: {
                x: 0.2995,
                y: 0.67
            },

            HV2: {
                x: 0.6695,
                y: 0.67
            }
        },

        // VÁLVULA PRINCIPAL

        mainValve: {

            HV9: {
                x: 0.485,
                y: 0.78
            }
        },

        // JUNÇÕES HIDRÁULICAS
        /* Junções auxiliares, sem desenho de equipamento.
           TQ3 recebe FI1, TQ5 via HV5 e HV7 por entradas separadas.
           TQ4 recebe FI2, TQ6 via HV6 e HV8 por entradas separadas. */

        junctions: {

            JH3: {
                x: 0.070,
                y: 0.335
            },

            JH4: {
                x: 0.930,
                y: 0.335
            }
        }
    },

    // RESERVATÓRIO

    reservoir: {

        x:
            0.38,

        y:
            0.955,

        width:
            0.25,

        heightPx:
            38
    },

    // ROTAS DAS TUBULAÇÕES
    /* Cada array contém os vértices intermediários do link.
       O início e o fim são definidos pelo plant-view.js.
     */

    routes: {

        // JIC1 / RAMO CENTRAL

        RES_JIC1: [],

        JIC1_HV9: [],

        HV9_LV1: [
            {
                x: 0.505,
                y: 0.72
            },
            {
                x: 0.44,
                y: 0.72
            }
        ],

        HV9_LV2: [
            {
                x: 0.505,
                y: 0.72
            },
            {
                x: 0.57,
                y: 0.72
            }
        ],

        // LV1 -> OY1_A / OY1_B

        LV1_OY1_A: [
                        {
                x: 0.44,
                y: 0.26
            },

        ],

        LV1_OY1_B: [
            {
                x: 0.44,
                y: 0.26
            },
        ],

        // LV2 -> OY2_A / OY2_B

        LV2_OY2_A: [
            {
                x: 0.57,
                y: 0.26
            },
        ],

        LV2_OY2_B: [
            {
                x: 0.57,
                y: 0.26
            },
        ],

        // OY1_A -> TQ3

        OY1_A_TQ3: [

            {
                x: 0.426,
                y: 0.100
            },
            {
                x: 0.165,
                y: 0.100
            },
            {
                x: 0.165,
                y: 0.33
            },
            {
                x: 0.101,
                y: 0.33
            }
        ],

        // OY1_B -> FI6 -> TQ6

        OY1_B_FI6: [
            {
                x: 0.45,
                y: 0.025
            }
        ],

        FI6_TQ6: [
            {
                x: 0.855,
                y: 0.025
            }
        ],

        // OY2_A -> FI5 -> TQ5

        OY2_A_FI5: [
            {
                x: 0.56,
                y: 0.05
            }
        ],

        FI5_TQ5: [
            {
                x: 0.1155,
                y: 0.05
            }
        ],

        // OY2_B -> TQ4

        OY2_B_TQ4: [
            {
                x: 0.586,
                y: 0.10
            },
            {
                x: 0.815,
                y: 0.1
            },
            {
                x: 0.815,
                y: 0.170
            },
            {
                x: 0.815,
                y: 0.33
            },
            {
                x: 0.869,
                y: 0.33
            }
        ],

        // LADO ESQUERDO
        /* TQ5 -> HV5 -> TQ3
           HV7 -> TQ3 diretamente (entrada separada)
         */

        TQ5_HV5: [
            {
                x: 0.116,
                y: 0.315
            },
            {
                x: 0.123,
                y: 0.315
            }
        ],

        JIC3_HV7: [
            {
                x: 0.191,
                y: 0.86
            },
            {
                x: 0.191,
                y: 0.690
            }
        ],

        HV7_TQ3: [
            {
                x: 0.191,
                y: 0.590
            },
            {
                x: 0.191,
                y: 0.41
            },
            {
                x: 0.13,
                y: 0.41
            }
        ],

        HV5_TQ3: [
            {
                x: 0.123,
                y: 0.4
            },
            {
                x: 0.1154,
                y: 0.4
            }
        ],

        // TQ3 -> HV3 -> JIC3

        TQ3_HV3: [
            {
                x: 0.1153,
                y: 0.72
            },

        ],

        HV3_JIC3: [
            {
                x: 0.05,
                y: 0.72
            },
            {
                x: 0.05,
                y: 0.860
            }
        ],

        // LADO DIREITO
        /* TQ6 -> HV6 -> TQ4
           HV8 -> TQ4 diretamente (entrada separada)
         */

        TQ6_HV6: [
            {
                x: 0.856,
                y: 0.315
            },
            {
                x: 0.84,
                y: 0.315
            }
        ],

        JIC4_HV8: [
            {
                x: 0.811,
                y: 0.86
            },

        ],

        HV8_TQ4: [
            {
                x: 0.811,
                y: 0.590
            },
            {
                x: 0.811,
                y: 0.41
            },
            {
                x: 0.8411,
                y: 0.41
            }
        ],

        HV6_TQ4: [
            {
                x: 0.84,
                y: 0.4
            },
                        {
                x: 0.8558,
                y: 0.4
            }

        ],

        // TQ4 -> HV4 -> JIC4

        TQ4_HV4: [
            {
                x: 0.8556,
                y: 0.72
            },
        ],

        HV4_JIC4: [
            {
                x: 0.921,
                y: 0.720
            },
            {
                x: 0.921,
                y: 0.860
            }
        ],

        // JIC3 -> LV3 -> FI3 -> TQ1

        JIC3_LV3: [
            {
                x: 0.394,
                y: 0.86
            }
        ],

        LV3_FI3: [
            {
                x: 0.394,
                y: 0.34
            }
        ],

        FI3_TQ1: [
            {
                x: 0.3153,
                y: 0.34
            },

        ],

        // JIC4 -> LV4 -> FI4 -> TQ2

        JIC4_LV4: [
            {
                x: 0.604,
                y: 0.86
            }
        ],

        LV4_FI4: [
            {
                x: 0.604,
                y: 0.34
            }
        ],

        FI4_TQ2: [
            {
                x: 0.685,
                y: 0.34
            },
        ],

        // TQ1 -> HV1 -> RESERVATÓRIO



        HV1_RES: [
            {
                x: 0.3155,
                y: 0.92
            },
            {
                x: 0.41,
                y: 0.92
            }
        ],

        // TQ2 -> HV2 -> RESERVATÓRIO



        HV2_RES: [
            {
                x: 0.6855,
                y: 0.92
            },
            {
                x: 0.6,
                y: 0.92
            }
        ]
    }
};
