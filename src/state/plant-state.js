// ESTADO COMUM DA PLANTA
/* Estrutura de dados compartilhada pela simulação e pela planta real. */

export function createPlantState() {

    return {

        // TANQUES

        tanks: [

            {
                id: 'TQ1',
                volume: 0,
                height: 0
            },

            {
                id: 'TQ2',
                volume: 0,
                height: 0
            },

            {
                id: 'TQ3',
                volume: 0,
                height: 0
            },

            {
                id: 'TQ4',
                volume: 0,
                height: 0
            },

            {
                id: 'TQ5',
                volume: 0,
                height: 0
            },

            {
                id: 'TQ6',
                volume: 0,
                height: 0
            }
        ],

        // BOMBAS
        /* power:
           0 = desligada
           1 = ligada
           command:
           comando normalizado entre 0 e 1
         */

        pumps: [

            {
                id: 'JIC3',

                source:
                    'TQ3',

                power:
                    0,

                command:
                    1
            },

            {
                id: 'JIC4',

                source:
                    'TQ4',

                power:
                    0,

                command:
                    1
            },

            {
                id: 'JIC1',

                source:
                    'RESERVOIR',

                power:
                    0,

                command:
                    1
            }
        ],

        // VÁLVULA PRINCIPAL
        /* JIC1 -> HV9 -> LV1 / LV2
         */

        mainValve: {

            id:
                'HV9',

            opening:
                0
        },

        // VÁLVULAS ATUADAS
        /* LV1 -> conjunto OY1
           LV2 -> conjunto OY2
           LV3 -> TQ1
           LV4 -> TQ2
         */

        actuatedValves: [

            {
                id: 'LV1',
                opening: 1
            },

            {
                id: 'LV2',
                opening: 1
            },

            {
                id: 'LV3',
                opening: 1
            },

            {
                id: 'LV4',
                opening: 1
            }
        ],

        // VÁLVULAS MANUAIS DE RECIRCULAÇÃO
        /* Essas já existiam no modelo.
           JIC3 -> HV7 -> entrada comum de TQ3
           JIC4 -> HV8 -> entrada comum de TQ4
           HV7 e HV8 continuam existindo independentemente das
           novas válvulas manuais observadas.
         */

        recycleValves: [

            {
                id:
                    'HV7',

                tank:
                    'TQ3',

                opening:
                    0
            },

            {
                id:
                    'HV8',

                tank:
                    'TQ4',

                opening:
                    0
            }
        ],

        // OUTRAS VÁLVULAS MANUAIS DA PLANTA
        /* HV5/HV6 alimentam TQ3/TQ4 a partir de TQ5/TQ6.
           HV3/HV4 regulam a sucção; HV1/HV2 drenam TQ1/TQ2. */

        manualValves: [

            {
                id:
                    'HV5',

                function:
                    'COMMON_INLET_TQ3',

                opening:
                    0
            },

            {
                id:
                    'HV6',

                function:
                    'COMMON_INLET_TQ4',

                opening:
                    0
            },

            {
                id:
                    'HV3',

                function:
                    'TQ3_TO_JIC3',

                opening:
                    0
            },

            {
                id:
                    'HV4',

                function:
                    'TQ4_TO_JIC4',

                opening:
                    0
            },

            {
                id:
                    'HV1',

                function:
                    'TQ1_TO_RESERVOIR',

                opening:
                    0
            },

            {
                id:
                    'HV2',

                function:
                    'TQ2_TO_RESERVOIR',

                opening:
                    0
            }
        ],

        // VÁLVULAS DE 3 VIAS / RELÉS
        /* Mapeamento físico atual:
           OY1_A -> TQ3
           OY1_B -> TQ6
           OY2_A -> TQ5
           OY2_B -> TQ4
         */

        threeWayValves: [{ id: 'OY1' }, { id: 'OY2' }],

        threeWayBranches: [

            {
                id: 'OY1_A',
                equipment: 'OY1',
                branch: 'A',

                group:
                    'OY1',

                target:
                    'TQ3',

                state:
                    true
            },

            {
                id: 'OY1_B',
                equipment: 'OY1',
                branch: 'B',

                group:
                    'OY1',

                target:
                    'TQ6',

                state:
                    true
            },

            {
                id: 'OY2_A',
                equipment: 'OY2',
                branch: 'A',

                group:
                    'OY2',

                target:
                    'TQ5',

                state:
                    true
            },

            {
                id: 'OY2_B',
                equipment: 'OY2',
                branch: 'B',

                group:
                    'OY2',

                target:
                    'TQ4',

                state:
                    true
            }
        ],

        // SENSORES DE VAZÃO
        /* FI1/FI2 medem na entrada de LV1/LV2, antes das três vias.
           FI3/FI4 alimentam TQ1/TQ2; FI5/FI6 alimentam TQ5/TQ6.
           flow é apresentado em L/min. */

        flowSensors: [

            {
                id:
                    'FI5',

                flow:
                    0
            },

            {
                id:
                    'FI6',

                flow:
                    0
            },

            {
                id:
                    'FI1',

                flow:
                    0
            },

            {
                id:
                    'FI3',

                flow:
                    0
            },

            {
                id:
                    'FI4',

                flow:
                    0
            },

            {
                id:
                    'FI2',

                flow:
                    0
            }
        ],

        // SENSORES DE NÍVEL
        /* No simulador:
           valores calculados a partir do nível dos tanques.
           Na planta real:
           serão obtidos a partir dos MPX5010.
         */

        levelSensors: [

            {
                id:
                    'LI1',

                tank:
                    'TQ1',

                level:
                    0,

                pressure:
                    0,

                voltage:
                    null,

                raw:
                    null
            },

            {
                id:
                    'LI2',

                tank:
                    'TQ2',

                level:
                    0,

                pressure:
                    0,

                voltage:
                    null,

                raw:
                    null
            },

            {
                id:
                    'LI3',

                tank:
                    'TQ3',

                level:
                    0,

                pressure:
                    0,

                voltage:
                    null,

                raw:
                    null
            },

            {
                id:
                    'LI4',

                tank:
                    'TQ4',

                level:
                    0,

                pressure:
                    0,

                voltage:
                    null,

                raw:
                    null
            },

            {
                id:
                    'LI5',

                tank:
                    'TQ5',

                level:
                    0,

                pressure:
                    0,

                voltage:
                    null,

                raw:
                    null
            },

            {
                id:
                    'LI6',

                tank:
                    'TQ6',

                level:
                    0,

                pressure:
                    0,

                voltage:
                    null,

                raw:
                    null
            }
        ]
    };
}

/*
  FUNÇÕES AUXILIARES DE ACESSO
  Acesso ao estado compartilhado da aplicação.
*/

// TANQUES

export function getTank(
    plant,
    id
) {

    return plant.tanks.find(
        tank =>
            tank.id === id
    );
}

// BOMBAS

export function getPump(
    plant,
    id
) {

    return plant.pumps.find(
        pump =>
            pump.id === id
    );
}

// VÁLVULAS ATUADAS

export function getActuatedValve(
    plant,
    id
) {

    return plant.actuatedValves.find(
        valve =>
            valve.id === id
    );
}

// VÁLVULAS DE RECIRCULAÇÃO

export function getRecycleValve(
    plant,
    id
) {

    return plant.recycleValves.find(
        valve =>
            valve.id === id
    );
}

// DEMAIS VÁLVULAS MANUAIS

export function getManualValve(
    plant,
    id
) {

    return plant.manualValves.find(
        valve =>
            valve.id === id
    );
}

// VÁLVULAS DE 3 VIAS

export function getThreeWayValve(
    plant,
    id
) {

    return plant.threeWayBranches.find(
        valve =>
            valve.id === id
    );
}

// SENSORES DE VAZÃO

export function getFlowSensor(
    plant,
    id
) {

    return plant.flowSensors.find(
        sensor =>
            sensor.id === id
    );
}

// SENSORES DE NÍVEL

export function getLevelSensor(
    plant,
    id
) {

    return plant.levelSensors.find(
        sensor =>
            sensor.id === id
    );
}
// Associação entre equipamento e medição de nível.
export function tankLevelSensorId(id) {
    return ({ TQ1: 'LI1', TQ2: 'LI2', TQ3: 'LI3', TQ4: 'LI4', TQ5: 'LI5', TQ6: 'LI6' })[id] ?? null;
}
