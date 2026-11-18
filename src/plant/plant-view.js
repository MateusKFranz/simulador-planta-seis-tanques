import { componentLabel } from '../shared/component-labels.js';
import { fitViewport, observeViewport } from './viewport-fit.js';
import '../style.css';

import { dia, shapes } from '@joint/core';

import {
    LiquidTank,
    Pump,
    LevelSensor,
    FlowSensor,
    RelayThreeWayValve,
    ThreeWayValve,
    ActuatedValve,
    ManualValve,
    MainValve,
    createPipe,
    createFlow
} from './components.js';

import {
    PLANT_CONFIG
} from './plant-config.js';

import { tankPresentation } from './tank-presentation.mjs';

// PLANT VIEW
/* Desenha a planta e gerencia os controles e a animação dos fluxos.
Não calcula a dinâmica física. */

export class PlantView {

    constructor(options = {}) {

        // CALLBACKS
        this.onSensorSelect = options.onSensorSelect ?? (() => {});

        this.onModeChange =
            options.onModeChange ??
            (() => {});

        this.onStartPause =
            options.onStartPause ??
            (() => {});

        this.onReset =
            options.onReset ??
            (() => {});

        this.onSimulationSpeedChange =
            options.onSimulationSpeedChange ??
            (() => {});

        this.onInitialLevelChange =
            options.onInitialLevelChange ??
            (() => {});

        this.onTankCapacityChange =
            options.onTankCapacityChange ??
            (() => {});

        this.onPumpToggle =
            options.onPumpToggle ??
            (() => {});

        this.onPumpCommandChange =
            options.onPumpCommandChange ??
            (() => {});

        this.onMainValveChange =
            options.onMainValveChange ??
            (() => {});

        this.onActuatedValveChange =
            options.onActuatedValveChange ??
            (() => {});

        this.onRecycleValveChange =
            options.onRecycleValveChange ??
            (() => {});

        this.onManualValveChange =
            options.onManualValveChange ??
            (() => {});

        this.onThreeWayValveToggle =
            options.onThreeWayValveToggle ??
            (() => {});

        this.onRealConnectToggle =
            options.onRealConnectToggle ??
            (() => {});

        // ESTADO ATUAL DA VIEW

        this.currentPlant =
            null;

        this.currentRuntime = {

            mode:
                'simulation',

            running:
                false,

            time:
                0,

            speed:
                1,

            connected:
                false,

            connecting:
                false,

            connectionLabel:
                'Desconectado',

            transport:
                null,

            port:
                null,

            lastUpdate:
                null,

            lastError:
                null,

            flows:
                {}
        };

        this.flowOffset =
            0;

        // ESCALA DO TEXTO DA SIDEBAR

        this.sidebarFontScale =
            1.12;

        // VIEWPORT DA PLANTA
        /* Permite zoom e movimentação (pan) sem alterar as
           coordenadas reais dos elementos do JointJS.
         */

        this.viewportZoom =
            1;
        this.userZoom = 1;
        this.fitScale = 1;
        this.drawingSize = PLANT_CONFIG.drawingSize;

        this.viewportMinZoom =
            0.55;

        this.viewportMaxZoom =
            2.50;

        this.viewportPanX =
            0;

        this.viewportPanY =
            0;

        this.viewportPanning =
            false;

        this.viewportPanStart =
            null;

        this.viewportControls =
            null;

        // RÉGUA TEMPORÁRIA DE COORDENADAS
        /* Mostra x/y normalizados sobre o grid para facilitar
           o ajuste manual de posições e rotas.
         */

        this.coordinateOverlay =
            null;

        this.coordinateOverlayVisible =
            false;

        // CONTAINER

        this.paperContainer =
            document.getElementById(
                'paper'
            );

        if (
            !this.paperContainer
        ) {

            throw new Error(
                'Elemento #paper não encontrado.'
            );
        }

        // JOINTJS

        this.graph =
            new dia.Graph();

        this.paper =
            new dia.Paper({

                el:
                    this.paperContainer,

                model:
                    this.graph,

                width:
                    this.paperContainer.clientWidth,

                height:
                    this.paperContainer.clientHeight,

                gridSize:
                    25,

                drawGrid: {

                    name:
                        'mesh',

                    args: {

                        color:
                            '#b8bab9',

                        thickness:
                            0.5
                    }
                },

                background: {

                    color:
                        '#c4c4c2'
                },

                interactive: {

                    elementMove:
                        false,

                    linkMove:
                        false,

                    labelMove:
                        false,

                    arrowheadMove:
                        false,

                    vertexMove:
                        false,

                    vertexAdd:
                        false
                }
            });

        // VIEWS

        this.tankViews =
            {};

        this.pumpViews =
            {};

        this.levelSensorViews =
            {};

        this.flowSensorViews =
            {};

        this.threeWayValveViews =
            {};

        this.threeWayEquipmentViews = {};

        this.actuatedValveViews =
            {};

        this.recycleValveViews =
            {};

        this.manualValveViews =
            {};

        this.junctionViews =
            {};

        this.mainValveView =
            null;

        this.hydraulicConnections =
            {};

        this.instrumentLines =
            [];

        // CONTROLES HTML

        this.pumpControls =
            {};

        this.threeWayButtons =
            {};

        this.initialLevelControls =
            {};

        this.centralValveControls =
            {};

        this.outputValveControls =
            {};

        this.recycleValveControls =
            {};

        this.manualValveControls =
            {};

        this.mainValveControl =
            null;

        // EDITOR FLUTUANTE DOS COMPONENTES
        /* Aberto ao clicar/tocar em um componente controlável
           da planta. Mantém a sidebar existente como alternativa.
         */

        this.componentEditor =
            null;

        this.componentEditorSelection =
            null;

        this.componentEditorSlider =
            null;

        this.componentEditorToggle =
            null;

        this.componentEditorValue =
            null;

        this.componentEditorTitle =
            null;

        this.componentEditorSubtitle =
            null;

        // GESTO CLIQUE X ARRASTE SOBRE COMPONENTES
        /* Toque/clique curto -> abre o editor.
           Arraste -> movimenta (pan) a planta.
         */

        this.pendingElementGesture =
            null;

        this.suppressComponentClickUntil =
            0;

        this.elementPanThreshold =
            12;

        // CRIAÇÃO

        this.createReservoir();

        this.createPlantElements();

        // TQ3 e TQ4 possuem três entradas independentes.
        this.createHydraulicTopology();
        // Indicadores sobrepostos ao tubo mantêm a leitura à frente da animação.
        this.flowSensorViews.FI1.toFront();
        this.flowSensorViews.FI2.toFront();

        this.createInstrumentLines();

        this.createControlPanel();

        this.createSidebarFontControl();

        this.createViewportControls();

        this.createCoordinateOverlay();

        this.createComponentEditor();

        this.bindPaperEvents();

        this.resize();

        // RESPONSIVIDADE

        this.handleResize =
            () => {

                this.resize();
            };

        window.addEventListener(
            'resize',
            this.handleResize
        );
        this.paperResizeObserver = observeViewport(this.paperContainer, this.handleResize);
    }

    // CONFIGURAÇÃO

    getLayoutSection(...names) {

        for (
            const name of names
        ) {

            if (
                PLANT_CONFIG.layout &&
                PLANT_CONFIG.layout[name]
            ) {

                return PLANT_CONFIG
                    .layout[name];
            }

            if (
                PLANT_CONFIG[name]
            ) {

                return PLANT_CONFIG[name];
            }
        }

        return {};
    }

    getPositionConfig(
        sectionNames,
        id
    ) {

        const section =
            this.getLayoutSection(
                ...sectionNames
            );

        return (
            section[id] ??
            {
                x: 0,
                y: 0
            }
        );
    }

    pointFromConfig(point) {

        return {

            x:
                this.drawingSize.width *
                point.x,

            y:
                this.drawingSize.height *
                point.y
        };
    }

    positionFromConfig(
        sectionNames,
        id
    ) {

        const point = this.pointFromConfig(this.getPositionConfig(sectionNames, id));
        const dimensions = {
            tanks: ['LiquidTank', 110, 200], pumps: ['Pump', 66, 66],
            levelSensors: ['LevelSensor', 62, 36], flowSensors: ['FlowSensor', 58, 32],
            actuatedValves: ['ActuatedValve', 42, 76],
            relayValves: ['RelayThreeWayValve', 58, 46],
            recycleValves: ['ManualValve', 50, 34], manualValves: ['ManualValve', 50, 34],
            mainValve: ['MainValve', 62, 42]
        };
        const size = dimensions[sectionNames[0]];
        if (size) {
            const [sx, sy] = PLANT_CONFIG.componentScale[size[0]];
            point.x -= size[1] * (sx - 1) / 2;
            point.y -= size[2] * (sy - 1) / 2;
        }
        const offset = PLANT_CONFIG.componentOffsets?.[sectionNames[0]]?.[id];
        point.x += offset?.x ?? 0;
        point.y += offset?.y ?? 0;
        return point;
    }

    routeFromConfig(
        routeName
    ) {

        const route =
            PLANT_CONFIG
                .routes?.[
                    routeName
                ];

        if (
            !Array.isArray(
                route
            )
        ) {

            return [];
        }

        return route.map(
            point =>
                this.pointFromConfig(
                    point
                )
        );
    }

    // PORTAS DOS TANQUES

    tankTopPort(
        view,
        horizontalOffset = 0
    ) {

        const position =
            view.position();

        const size =
            view.size();

        return {

            x:
                position.x +
                size.width /
                2 +
                horizontalOffset,

            y:
                position.y
        };
    }

    /* TQ3 e TQ4 possuem duas entradas físicas distintas.
       Em vez de fazer as duas tubulações terminarem no mesmo
       ponto no centro do tanque, usamos dois pontos separados
       no topo. Isso evita a sobreposição visual dos tubos.
     */

    tankTopLeftPort(view) {

        return this.tankTopPort(
            view,
            -22
        );
    }

    tankTopRightPort(view) {

        return this.tankTopPort(
            view,
            22
        );
    }

    tankBottomPort(view) {

        const position =
            view.position();

        const size =
            view.size();

        return {

            x:
                position.x +
                size.width /
                2,

            y:
                position.y +
                size.height
        };
    }

    // RESERVATÓRIO

    createReservoir() {

        this.reservoir =
            new shapes.standard.Rectangle();

        this.reservoir.attr({

            body: {

                fill:
                    '#d6dce0',

                stroke:
                    '#6b7b85',

                strokeWidth:
                    1.5,

                rx:
                    3,

                ry:
                    3
            },

            label: {

                text:
                    'RESERVATÓRIO',

                fontSize:
                    11,

                fontWeight:
                    'bold',

                fill:
                    '#2b353c'
            }
        });

        this.reservoir.addTo(
            this.graph
        );

        this.updateReservoirPosition();
    }

    updateReservoirPosition() {

        const config =
            PLANT_CONFIG.reservoir ??
            PLANT_CONFIG
                .layout
                ?.reservoir;

        if (
            !config
        ) {

            return;
        }

        this.reservoir.position(

            this.drawingSize.width *
                config.x,

            this.drawingSize.height *
                config.y
        );

        this.reservoir.resize(

            this.drawingSize.width *
                config.width,

            config.heightPx ??
                38
        );
    }

    // ELEMENTOS DA PLANTA

    createPlantElements() {

        const tankIds = [
            'TQ1',
            'TQ2',
            'TQ3',
            'TQ4',
            'TQ5',
            'TQ6'
        ];

        const pumpIds = [
            'JIC3',
            'JIC4',
            'JIC1'
        ];

        const flowSensorIds = [
            'FI5',
            'FI6',
            'FI1',
            'FI3',
            'FI4',
            'FI2'
        ];

        const levelSensorMap = {

            LI1: 'TQ1',
            LI2: 'TQ2',
            LI3: 'TQ3',
            LI4: 'TQ4',
            LI5: 'TQ5',
            LI6: 'TQ6'
        };

        const relayValveIds = [
            'OY1_A',
            'OY1_B',
            'OY2_A',
            'OY2_B'
        ];

        const actuatedValveIds = [
            'LV1',
            'LV2',
            'LV3',
            'LV4'
        ];

        const recycleValveIds = [
            'HV7',
            'HV8'
        ];

        const manualValveIds = [
            'HV5',
            'HV6',
            'HV3',
            'HV4',
            'HV1',
            'HV2'
        ];

        // TANQUES

        tankIds.forEach(
            id => {

                const view =
                    new LiquidTank({

                        position:
                            this.positionFromConfig(
                                ['tanks'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.tankViews[id] =
                    view;
            }
        );

        // BOMBAS

        pumpIds.forEach(
            id => {

                const view =
                    new Pump({

                        position:
                            this.positionFromConfig(
                                ['pumps'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.pumpViews[id] =
                    view;
            }
        );

        // FT

        flowSensorIds.forEach(
            id => {

                const view =
                    new FlowSensor({

                        position:
                            this.positionFromConfig(
                                ['flowSensors'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.flowSensorViews[id] =
                    view;
            }
        );

        // LT

        Object.entries(
            levelSensorMap
        ).forEach(
            (
                [
                    sensorId,
                    tankId
                ]
            ) => {

                const view =
                    new LevelSensor({

                        position:
                            this.positionFromConfig(
                                ['levelSensors'],
                                sensorId
                            )
                    });

                this.graph.addCell(
                    view
                );

                view.sensorId =
                    sensorId;

                this.levelSensorViews[
                    tankId
                ] =
                    view;
            }
        );

        // Âncoras internas dos ramos A/B, sem representação própria.

        relayValveIds.forEach(
            id => {

                const view =
                    new RelayThreeWayValve({

                        attrs: { root: { display: 'none' } },

                        position:
                            this.positionFromConfig(
                                ['relayValves'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.threeWayValveViews[
                    id
                ] =
                    view;
            }
        );

        for (const id of ['OY1', 'OY2']) {
            const view = new ThreeWayValve();
            view.updateValve({ id });
            this.threeWayEquipmentViews[id] = view;
            this.graph.addCell(view);
        }
        this.positionThreeWayEquipment();

        // LV1 - LV4

        actuatedValveIds.forEach(
            id => {

                const view =
                    new ActuatedValve({

                        position:
                            this.positionFromConfig(
                                ['actuatedValves'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.actuatedValveViews[
                    id
                ] =
                    view;
            }
        );

        // HV7 / HV8

        recycleValveIds.forEach(
            id => {

                const view =
                    new ManualValve({

                        position:
                            this.positionFromConfig(
                                ['recycleValves'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.recycleValveViews[
                    id
                ] =
                    view;
            }
        );

        // NOVAS VÁLVULAS MANUAIS

        manualValveIds.forEach(
            id => {

                const view =
                    new ManualValve({

                        position:
                            this.positionFromConfig(
                                ['manualValves'],
                                id
                            )
                    });

                this.graph.addCell(
                    view
                );

                this.manualValveViews[
                    id
                ] =
                    view;
            }
        );

        // HV9

        this.mainValveView =
            new MainValve({

                position:
                    this.positionFromConfig(
                        ['mainValve'],
                        'HV9'
                    )
            });

        this.graph.addCell(
            this.mainValveView
        );
    }

    // JUNÇÕES INVISÍVEIS

    createJunctions() {

        [
            'JH3',
            'JH4'
        ].forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['junctions'],
                        id
                    );

                const junction =
                    new shapes.standard.Circle();

                junction.position(
                    position.x,
                    position.y
                );

                junction.resize(
                    2,
                    2
                );

                junction.attr({

                    body: {

                        fill:
                            'transparent',

                        stroke:
                            'transparent'
                    },

                    label: {

                        text:
                            ''
                    }
                });

                junction.addTo(
                    this.graph
                );

                junction.toBack();

                this.junctionViews[id] =
                    junction;
            }
        );
    }

    // LINKS

    createInstrumentLine(
        source,
        target
    ) {

        const line =
            new shapes.standard.Link();

        line.source(
            source
        );

        line.target(
            target
        );

        line.attr({

            line: {

                stroke:
                    '#8c969d',

                strokeWidth:
                    1,

                strokeDasharray:
                    '4 4',

                sourceMarker:
                    null,

                targetMarker:
                    null
            }
        });

        line.addTo(
            this.graph
        );

        line.toBack();

        this.instrumentLines.push(
            line
        );

        return line;
    }

    createHydraulicConnection(
        name,
        source,
        target,
        options = {}
    ) {

        const pipe =
            createPipe(
                this.graph,
                source,
                target
            );

        const flow =
            createFlow(
                this.graph,
                source,
                target
            );

        pipe.connector(
            'rounded',
            {
                radius: 10
            }
        );

        flow.connector(
            'rounded',
            {
                radius: 10
            }
        );

        const thin =
            Boolean(
                options.thin
            );

        if (
            thin
        ) {

            pipe.attr(
                'line/strokeWidth',
                5
            );

            flow.attr(
                'line/strokeWidth',
                2
            );
        }

        this.hydraulicConnections[
            name
        ] = {

            pipe,
            flow,
            thin
        };

        return this.hydraulicConnections[
            name
        ];
    }

    setConnectionVertices(
        connection,
        vertices
    ) {

        if (
            !connection
        ) {

            return;
        }

        connection.pipe.vertices(
            vertices
        );

        connection.flow.vertices(
            vertices
        );
    }

    setConnectionSource(
        connection,
        source
    ) {

        if (
            !connection
        ) {

            return;
        }

        connection.pipe.source(
            source
        );

        connection.flow.source(
            source
        );
    }

    setConnectionTarget(
        connection,
        target
    ) {

        if (
            !connection
        ) {

            return;
        }

        connection.pipe.target(
            target
        );

        connection.flow.target(
            target
        );
    }

    // TOPOLOGIA HIDRÁULICA

    createHydraulicTopology() {

        // JIC1 / RAMO CENTRAL

        this.createHydraulicConnection(
            'RES_JIC1',
            this.reservoir,
            this.pumpViews.JIC1
        );

        this.createHydraulicConnection(
            'JIC1_HV9',
            this.pumpViews.JIC1,
            this.mainValveView
        );

        this.createHydraulicConnection(
            'HV9_LV1',
            this.mainValveView,
            this.actuatedValveViews.LV1
        );

        this.createHydraulicConnection(
            'HV9_LV2',
            this.mainValveView,
            this.actuatedValveViews.LV2
        );

        // OY1

        this.createHydraulicConnection(
            'LV1_OY1_A',
            this.actuatedValveViews.LV1,
            this.threeWayConnectionPoint('OY1', 'A', 'bottom')
        );

        this.createHydraulicConnection(
            'LV1_OY1_B',
            this.actuatedValveViews.LV1,
            this.threeWayConnectionPoint('OY1', 'B', 'bottom')
        );

        this.createHydraulicConnection(
            'OY1_A_TQ3',
            this.threeWayConnectionPoint('OY1', 'A'),
            this.tankTopLeftPort(
                this.tankViews.TQ3
            )
        );

        this.createHydraulicConnection(
            'OY1_B_FI6',
            this.threeWayConnectionPoint('OY1', 'B'),
            this.flowSensorViews.FI6
        );

        this.createHydraulicConnection(
            'FI6_TQ6',
            this.flowSensorViews.FI6,
            this.tankTopPort(
                this.tankViews.TQ6
            )
        );

        // OY2

        this.createHydraulicConnection(
            'LV2_OY2_A',
            this.actuatedValveViews.LV2,
            this.threeWayConnectionPoint('OY2', 'A', 'bottom')
        );

        this.createHydraulicConnection(
            'LV2_OY2_B',
            this.actuatedValveViews.LV2,
            this.threeWayConnectionPoint('OY2', 'B', 'bottom')
        );

        this.createHydraulicConnection(
            'OY2_A_FI5',
            this.threeWayConnectionPoint('OY2', 'A'),
            this.flowSensorViews.FI5
        );

        this.createHydraulicConnection(
            'FI5_TQ5',
            this.flowSensorViews.FI5,
            this.tankTopPort(
                this.tankViews.TQ5
            )
        );

        this.createHydraulicConnection(
            'OY2_B_TQ4',
            this.threeWayConnectionPoint('OY2', 'B'),
            this.tankTopRightPort(
                this.tankViews.TQ4
            )
        );

        // LADO ESQUERDO

        this.createHydraulicConnection(
            'TQ5_HV5',
            this.tankBottomPort(
                this.tankViews.TQ5
            ),
            this.manualValveViews.HV5
        );

        this.createHydraulicConnection(
            'HV5_TQ3',
            this.manualValveViews.HV5,
            this.tankTopPort(
                this.tankViews.TQ3
            )
        );

        this.createHydraulicConnection(
            'JIC3_HV7',
            this.pumpViews.JIC3,
            this.recycleValveViews.HV7,
            {
                thin: true
            }
        );

        this.createHydraulicConnection(
            'HV7_TQ3',
            this.recycleValveViews.HV7,
            this.tankTopRightPort(
                this.tankViews.TQ3
            ),
            {
                thin: true
            }
        );

        this.createHydraulicConnection(
            'TQ3_HV3',
            this.tankBottomPort(
                this.tankViews.TQ3
            ),
            this.manualValveViews.HV3
        );

        this.createHydraulicConnection(
            'HV3_JIC3',
            this.manualValveViews.HV3,
            this.pumpViews.JIC3
        );

        this.createHydraulicConnection(
            'JIC3_LV3',
            this.pumpViews.JIC3,
            this.actuatedValveViews.LV3
        );

        this.createHydraulicConnection(
            'LV3_FI3',
            this.actuatedValveViews.LV3,
            this.flowSensorViews.FI3
        );

        this.createHydraulicConnection(
            'FI3_TQ1',
            this.flowSensorViews.FI3,
            this.tankTopPort(
                this.tankViews.TQ1
            )
        );

        // LADO DIREITO

        this.createHydraulicConnection(
            'TQ6_HV6',
            this.tankBottomPort(
                this.tankViews.TQ6
            ),
            this.manualValveViews.HV6
        );

        this.createHydraulicConnection(
            'HV6_TQ4',
            this.manualValveViews.HV6,
            this.tankTopPort(
                this.tankViews.TQ4
            )
        );

        this.createHydraulicConnection(
            'JIC4_HV8',
            this.pumpViews.JIC4,
            this.recycleValveViews.HV8,
            {
                thin: true
            }
        );

        this.createHydraulicConnection(
            'HV8_TQ4',
            this.recycleValveViews.HV8,
            this.tankTopLeftPort(
                this.tankViews.TQ4
            ),
            {
                thin: true
            }
        );

        this.createHydraulicConnection(
            'TQ4_HV4',
            this.tankBottomPort(
                this.tankViews.TQ4
            ),
            this.manualValveViews.HV4
        );

        this.createHydraulicConnection(
            'HV4_JIC4',
            this.manualValveViews.HV4,
            this.pumpViews.JIC4
        );

        this.createHydraulicConnection(
            'JIC4_LV4',
            this.pumpViews.JIC4,
            this.actuatedValveViews.LV4
        );

        this.createHydraulicConnection(
            'LV4_FI4',
            this.actuatedValveViews.LV4,
            this.flowSensorViews.FI4
        );

        this.createHydraulicConnection(
            'FI4_TQ2',
            this.flowSensorViews.FI4,
            this.tankTopPort(
                this.tankViews.TQ2
            )
        );

        // DESCARGAS TQ1 / TQ2

        this.createHydraulicConnection(
            'TQ1_HV1',
            this.tankBottomPort(
                this.tankViews.TQ1
            ),
            this.manualValveViews.HV1
        );

        this.createHydraulicConnection(
            'HV1_RES',
            this.manualValveViews.HV1,
            this.reservoir
        );

        this.createHydraulicConnection(
            'TQ2_HV2',
            this.tankBottomPort(
                this.tankViews.TQ2
            ),
            this.manualValveViews.HV2
        );

        this.createHydraulicConnection(
            'HV2_RES',
            this.manualValveViews.HV2,
            this.reservoir
        );

        this.updatePipeRoutes();
    }

    // LINHAS DOS SENSORES DE NÍVEL

    createInstrumentLines() {

        [
            'TQ1',
            'TQ2',
            'TQ3',
            'TQ4',
            'TQ5',
            'TQ6'
        ].forEach(
            id => {

                this.createInstrumentLine(
                    this.levelSensorViews[id],
                    this.tankViews[id]
                );
            }
        );
    }

    // ATUALIZAÇÃO DAS PORTAS

    updateTankConnectionPorts() {

        this.setConnectionTarget(
            this.hydraulicConnections.FI5_TQ5,
            this.tankTopPort(
                this.tankViews.TQ5
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.FI6_TQ6,
            this.tankTopPort(
                this.tankViews.TQ6
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.OY1_A_TQ3,
            this.tankTopLeftPort(
                this.tankViews.TQ3
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.OY2_B_TQ4,
            this.tankTopRightPort(
                this.tankViews.TQ4
            )
        );

        this.setConnectionSource(
            this.hydraulicConnections.TQ5_HV5,
            this.tankBottomPort(
                this.tankViews.TQ5
            )
        );

        this.setConnectionSource(
            this.hydraulicConnections.TQ6_HV6,
            this.tankBottomPort(
                this.tankViews.TQ6
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.HV7_TQ3,
            this.tankTopRightPort(
                this.tankViews.TQ3
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.HV8_TQ4,
            this.tankTopLeftPort(
                this.tankViews.TQ4
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.HV5_TQ3,
            this.tankTopPort(
                this.tankViews.TQ3
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.HV6_TQ4,
            this.tankTopPort(
                this.tankViews.TQ4
            )
        );

        this.setConnectionSource(
            this.hydraulicConnections.TQ3_HV3,
            this.tankBottomPort(
                this.tankViews.TQ3
            )
        );

        this.setConnectionSource(
            this.hydraulicConnections.TQ4_HV4,
            this.tankBottomPort(
                this.tankViews.TQ4
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.FI3_TQ1,
            this.tankTopPort(
                this.tankViews.TQ1
            )
        );

        this.setConnectionTarget(
            this.hydraulicConnections.FI4_TQ2,
            this.tankTopPort(
                this.tankViews.TQ2
            )
        );

        this.setConnectionSource(
            this.hydraulicConnections.TQ1_HV1,
            this.tankBottomPort(
                this.tankViews.TQ1
            )
        );

        this.setConnectionSource(
            this.hydraulicConnections.TQ2_HV2,
            this.tankBottomPort(
                this.tankViews.TQ2
            )
        );
    }

    threeWayConnectionPoint(id, branch, edge = 'top') {
        const { x, y, width, height } = this.threeWayEquipmentViews[id].getBBox();
        return {
            x: x + width * (branch === 'A' ? 0.35 : 0.65),
            y: edge === 'bottom' ? y + height : y
        };
    }

    // ROTAS

    updatePipeRoutes() {

        this.updateTankConnectionPorts();

        for (const [id, valve, outputA, outputB] of [
            ['OY1', 'LV1', 'OY1_A_TQ3', 'OY1_B_FI6'],
            ['OY2', 'LV2', 'OY2_A_FI5', 'OY2_B_TQ4']
        ]) {
            for (const branch of ['A', 'B']) {
                this.setConnectionTarget(
                    this.hydraulicConnections[`${valve}_${id}_${branch}`],
                    this.threeWayConnectionPoint(id, branch, 'bottom')
                );
            }
            this.setConnectionSource(this.hydraulicConnections[outputA], this.threeWayConnectionPoint(id, 'A'));
            this.setConnectionSource(this.hydraulicConnections[outputB], this.threeWayConnectionPoint(id, 'B'));
        }

        Object.keys(
            this.hydraulicConnections
        ).forEach(
            routeName => {

                this.setConnectionVertices(

                    this.hydraulicConnections[
                        routeName
                    ],

                    this.routeFromConfig(
                        routeName
                    )
                );
            }
        );
    }

    // REPOSICIONAMENTO

    repositionElements() {
        Object.keys(
            this.tankViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['tanks'],
                        id
                    );

                this.tankViews[id]
                    .position(
                        position.x,
                        position.y
                    );
            }
        );

        Object.keys(
            this.pumpViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['pumps'],
                        id
                    );

                this.pumpViews[id]
                    .position(
                        position.x,
                        position.y
                    );
            }
        );

        Object.keys(
            this.flowSensorViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['flowSensors'],
                        id
                    );

                this.flowSensorViews[id]
                    .position(
                        position.x,
                        position.y
                    );
            }
        );

        Object.keys(
            this.levelSensorViews
        ).forEach(
            tankId => {

                const position =
                    this.positionFromConfig(
                        ['levelSensors'],
                        this.levelSensorViews[tankId].sensorId
                    );

                this.levelSensorViews[
                    tankId
                ].position(
                    position.x,
                    position.y
                );
            }
        );

        Object.keys(
            this.threeWayValveViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['relayValves'],
                        id
                    );

                this.threeWayValveViews[
                    id
                ].position(
                    position.x,
                    position.y
                );
            }
        );

        this.positionThreeWayEquipment();

        Object.keys(
            this.actuatedValveViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['actuatedValves'],
                        id
                    );

                this.actuatedValveViews[
                    id
                ].position(
                    position.x,
                    position.y
                );
            }
        );

        Object.keys(
            this.recycleValveViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['recycleValves'],
                        id
                    );

                this.recycleValveViews[
                    id
                ].position(
                    position.x,
                    position.y
                );
            }
        );

        Object.keys(
            this.manualValveViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['manualValves'],
                        id
                    );

                this.manualValveViews[
                    id
                ].position(
                    position.x,
                    position.y
                );
            }
        );

        Object.keys(
            this.junctionViews
        ).forEach(
            id => {

                const position =
                    this.positionFromConfig(
                        ['junctions'],
                        id
                    );

                this.junctionViews[
                    id
                ].position(
                    position.x,
                    position.y
                );
            }
        );

        const mvPosition =
            this.positionFromConfig(
                ['mainValve'],
                'HV9'
            );

        this.mainValveView.position(
            mvPosition.x,
            mvPosition.y
        );

        this.updateReservoirPosition();

        this.updatePipeRoutes();
    }

    resize() {
        // O container define o espaço CSS; o grafo mantém as coordenadas lógicas.
        this.paperContainer.style.width = '100%';
        this.paperContainer.style.height = '100%';
        const width = this.paperContainer.clientWidth;
        const height = this.paperContainer.clientHeight;
        const fit = fitViewport(this.graph.getBBox(), width, height, this.userZoom);
        if (!fit) return;
        this.paper.setDimensions(width, height);
        this.paperContainer.style.width = '100%';
        this.paperContainer.style.height = '100%';
        this.fitScale = fit.fitScale;
        this.viewportZoom = fit.scale;
        this.viewportPanX = fit.x;
        this.viewportPanY = fit.y;
        this.applyViewportTransform();
    }

    // VIEWPORT / ZOOM / PAN

    clampViewportZoom(value) {

        return Math.max(
            this.viewportMinZoom,
            Math.min(
                this.viewportMaxZoom,
                value
            )
        );
    }

    applyViewportTransform() {

        this.paper.scale(
            this.viewportZoom,
            this.viewportZoom
        );

        this.paper.translate(
            this.viewportPanX,
            this.viewportPanY
        );

        this.updateViewportZoomDisplay();

        this.updateCoordinateOverlay();
    }

    setViewportZoom(
        requestedZoom,
        anchorX = null,
        anchorY = null
    ) {

        const previousZoom =
            this.viewportZoom;

        const nextUserZoom = this.clampViewportZoom(requestedZoom);
        const nextZoom = this.fitScale * nextUserZoom;

        if (
            Math.abs(
                nextZoom -
                previousZoom
            ) < 0.000001
        ) {

            return;
        }

        const effectiveAnchorX =
            Number.isFinite(anchorX)
                ? anchorX
                : this.paperContainer.clientWidth / 2;

        const effectiveAnchorY =
            Number.isFinite(anchorY)
                ? anchorY
                : this.paperContainer.clientHeight / 2;

        // Mantém o ponto sob o cursor no mesmo lugar da tela.

        const localX =
            (
                effectiveAnchorX -
                this.viewportPanX
            ) /
            previousZoom;

        const localY =
            (
                effectiveAnchorY -
                this.viewportPanY
            ) /
            previousZoom;

        this.viewportPanX =
            effectiveAnchorX -
            localX *
            nextZoom;

        this.viewportPanY =
            effectiveAnchorY -
            localY *
            nextZoom;

        this.userZoom = nextUserZoom;
        this.viewportZoom = nextZoom;

        this.applyViewportTransform();
    }

    zoomViewportBy(
        factor,
        anchorX = null,
        anchorY = null
    ) {

        this.setViewportZoom(
            this.userZoom * factor,
            anchorX,
            anchorY
        );
    }

    resetViewport() {
        this.userZoom = 1;
        this.resize();
    }

    updateViewportZoomDisplay() {

        const display =
            this.viewportControls
                ?.querySelector(
                    '.plant-zoom-value'
                );

        if (
            display
        ) {

            display.textContent =
                `${Math.round(
                    this.userZoom *
                    100
                )}%`;
        }
    }

    createViewportControls() {

        const controls =
            document.createElement(
                'div'
            );

        controls.className =
            'plant-viewport-controls';

        Object.assign(
            controls.style,
            {
                position: 'absolute',
                left: '12px',
                top: '12px',
                zIndex: '40',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px',
                border: '1px solid #a5afb6',
                borderRadius: '6px',
                background: 'rgba(240, 242, 243, 0.96)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.28)',
                userSelect: 'none'
            }
        );

        const zoomOut =
            document.createElement(
                'button'
            );

        const zoomValue =
            document.createElement(
                'span'
            );

        const zoomIn =
            document.createElement(
                'button'
            );

        const reset =
            document.createElement(
                'button'
            );

        const coordinatesToggle =
            document.createElement(
                'button'
            );

        zoomOut.type =
            'button';

        zoomOut.textContent =
            '−';

        zoomOut.title =
            'Diminuir zoom da planta';

        zoomValue.className =
            'plant-zoom-value';

        zoomValue.textContent =
            '100%';

        Object.assign(
            zoomValue.style,
            {
                minWidth: '48px',
                textAlign: 'center',
                color: '#303a42',
                fontSize: '11px',
                fontWeight: '700'
            }
        );

        [
            zoomOut,
            zoomIn,
            reset,
            coordinatesToggle
        ].forEach(
            button => {

                Object.assign(
                    button.style,
                    {
                        width: '30px',
                        minWidth: '30px',
                        minHeight: '26px',
                        padding: '2px 4px'
                    }
                );
            }
        );

        zoomIn.type =
            'button';

        zoomIn.textContent =
            '+';

        zoomIn.title =
            'Aumentar zoom da planta';

        reset.type =
            'button';

        reset.textContent =
            '↺';

        reset.title =
            'Centralizar e restaurar zoom';

        coordinatesToggle.type =
            'button';

        coordinatesToggle.textContent =
            'XY';

        coordinatesToggle.title =
            'Mostrar/ocultar coordenadas normalizadas';

        coordinatesToggle.style.width =
            '34px';

        coordinatesToggle.style.minWidth =
            '34px';

        coordinatesToggle.style.color =
            '#303a42';

        coordinatesToggle.style.fontWeight =
            '800';

        zoomOut.addEventListener(
            'click',
            event => {

                event.stopPropagation();

                this.zoomViewportBy(
                    1 / 1.15
                );
            }
        );

        zoomIn.addEventListener(
            'click',
            event => {

                event.stopPropagation();

                this.zoomViewportBy(
                    1.15
                );
            }
        );

        reset.addEventListener(
            'click',
            event => {

                event.stopPropagation();

                this.resetViewport();
            }
        );

        coordinatesToggle.addEventListener(
            'click',
            event => {

                event.stopPropagation();

                this.coordinateOverlayVisible =
                    !this.coordinateOverlayVisible;

                coordinatesToggle.style.opacity =
                    this.coordinateOverlayVisible
                        ? '1'
                        : '0.45';

                this.updateCoordinateOverlay();
            }
        );

        controls.addEventListener(
            'pointerdown',
            event => {

                event.stopPropagation();
            }
        );

        controls.append(
            zoomOut,
            zoomValue,
            zoomIn,
            reset,
            coordinatesToggle
        );

        this.paperContainer.appendChild(
            controls
        );

        this.viewportControls =
            controls;

        this.handleViewportWheel =
            event => {

                if (
                    event.target.closest(
                        '.plant-viewport-controls'
                    ) ||
                    event.target.closest(
                        '.component-editor'
                    )
                ) {

                    return;
                }

                event.preventDefault();

                const rect =
                    this.paperContainer
                        .getBoundingClientRect();

                const anchorX =
                    event.clientX -
                    rect.left;

                const anchorY =
                    event.clientY -
                    rect.top;

                const factor =
                    event.deltaY < 0
                        ? 1.10
                        : 1 / 1.10;

                this.zoomViewportBy(
                    factor,
                    anchorX,
                    anchorY
                );
            };

        this.paperContainer.addEventListener(
            'wheel',
            this.handleViewportWheel,
            {
                passive:
                    false
            }
        );
    }

    // COORDENADAS NORMALIZADAS TEMPORÁRIAS
    /* Os valores correspondem diretamente às coordenadas usadas
       no plant-config.js:
       x = 0.00 ... 1.00
       y = 0.00 ... 1.00
       Linhas principais: 0.10
       Marcas intermediárias: 0.05
     */

    createCoordinateOverlay() {

        const overlay =
            document.createElementNS(
                'http://www.w3.org/2000/svg',
                'svg'
            );

        overlay.classList.add(
            'plant-coordinate-overlay'
        );

        Object.assign(
            overlay.style,
            {
                position: 'absolute',
                left: '0',
                top: '0',
                width: '100%',
                height: '100%',
                zIndex: '35',
                pointerEvents: 'none',
                overflow: 'hidden'
            }
        );

        this.paperContainer.appendChild(
            overlay
        );

        this.coordinateOverlay =
            overlay;

        this.updateCoordinateOverlay();
    }

    updateCoordinateOverlay() {

        const overlay =
            this.coordinateOverlay;

        if (
            !overlay
        ) {
            return;
        }

        overlay.style.display =
            this.coordinateOverlayVisible
                ? 'block'
                : 'none';

        if (
            !this.coordinateOverlayVisible
        ) {
            return;
        }

        const width =
            this.paperContainer.clientWidth;

        const height =
            this.paperContainer.clientHeight;

        if (
            width <= 0 ||
            height <= 0
        ) {
            return;
        }

        overlay.setAttribute(
            'viewBox',
            `0 0 ${width} ${height}`
        );

        overlay.setAttribute(
            'width',
            String(width)
        );

        overlay.setAttribute(
            'height',
            String(height)
        );

        overlay.replaceChildren();

        const svgNamespace =
            'http://www.w3.org/2000/svg';

        const addLine =
            (
                x1,
                y1,
                x2,
                y2,
                major = false
            ) => {

                const line =
                    document.createElementNS(
                        svgNamespace,
                        'line'
                    );

                line.setAttribute(
                    'x1',
                    String(x1)
                );

                line.setAttribute(
                    'y1',
                    String(y1)
                );

                line.setAttribute(
                    'x2',
                    String(x2)
                );

                line.setAttribute(
                    'y2',
                    String(y2)
                );

                line.setAttribute(
                    'stroke',
                    major
                        ? 'rgba(75, 91, 103, 0.18)'
                        : 'rgba(75, 91, 103, 0.08)'
                );

                line.setAttribute(
                    'stroke-width',
                    major
                        ? '1'
                        : '0.7'
                );

                line.setAttribute(
                    'stroke-dasharray',
                    major
                        ? '4 5'
                        : '2 6'
                );

                overlay.appendChild(
                    line
                );
            };

        const addText =
            (
                x,
                y,
                value,
                anchor = 'middle'
            ) => {

                const text =
                    document.createElementNS(
                        svgNamespace,
                        'text'
                    );

                text.setAttribute(
                    'x',
                    String(x)
                );

                text.setAttribute(
                    'y',
                    String(y)
                );

                text.setAttribute(
                    'text-anchor',
                    anchor
                );

                text.setAttribute(
                    'dominant-baseline',
                    'middle'
                );

                text.setAttribute(
                    'font-size',
                    '9'
                );

                text.setAttribute(
                    'font-family',
                    'monospace'
                );

                text.setAttribute(
                    'font-weight',
                    '700'
                );

                text.setAttribute(
                    'fill',
                    'rgba(55, 66, 75, 0.85)'
                );

                text.setAttribute(
                    'stroke',
                    'rgba(235, 237, 239, 0.95)'
                );

                text.setAttribute(
                    'stroke-width',
                    '2.5'
                );

                text.setAttribute(
                    'paint-order',
                    'stroke'
                );

                text.textContent =
                    value;

                overlay.appendChild(
                    text
                );
            };

        // Transformação idêntica à aplicada ao paper.

        const toScreenX =
            normalizedX =>
                this.viewportPanX +
                normalizedX *
                this.drawingSize.width *
                this.viewportZoom;

        const toScreenY =
            normalizedY =>
                this.viewportPanY +
                normalizedY *
                this.drawingSize.height *
                this.viewportZoom;

        /* Linhas a cada 0.05.
           Labels a cada 0.10.
         */

        for (
            let index = 0;
            index <= 20;
            index += 1
        ) {

            const value =
                index /
                20;

            const major =
                index %
                    2 ===
                0;

            const x =
                toScreenX(
                    value
                );

            const y =
                toScreenY(
                    value
                );

            if (
                x >= 0 &&
                x <= width
            ) {

                addLine(
                    x,
                    0,
                    x,
                    height,
                    major
                );

                if (
                    major
                ) {

                    addText(
                        x,
                        18,
                        `x=${value.toFixed(2).replace('.', ',')}`
                    );
                }
            }

            if (
                y >= 0 &&
                y <= height
            ) {

                addLine(
                    0,
                    y,
                    width,
                    y,
                    major
                );

                if (
                    major
                ) {

                    addText(
                        8,
                        y,
                        `y=${value.toFixed(2).replace('.', ',')}`,
                        'start'
                    );
                }
            }
        }
    }

    beginViewportPan(event) {

        if (
            this.eventComesFromComponentEditor(
                event
            )
        ) {

            return;
        }

        const pointerEvent =
            event.originalEvent ??
            event;

        if (
            pointerEvent.button !==
                undefined &&
            pointerEvent.button !==
                0
        ) {

            return;
        }

        this.viewportPanning =
            true;

        this.viewportPanStart = {

            clientX:
                pointerEvent.clientX,

            clientY:
                pointerEvent.clientY,

            panX:
                this.viewportPanX,

            panY:
                this.viewportPanY
        };

        this.paperContainer.classList.add(
            'plant-panning'
        );

        this.paperContainer.style.cursor =
            'grabbing';

        pointerEvent.preventDefault?.();
    }

    moveViewportPan(event) {

        if (
            !this.viewportPanning ||
            !this.viewportPanStart
        ) {

            return;
        }

        this.viewportPanX =
            this.viewportPanStart.panX +
            (
                event.clientX -
                this.viewportPanStart.clientX
            );

        this.viewportPanY =
            this.viewportPanStart.panY +
            (
                event.clientY -
                this.viewportPanStart.clientY
            );

        this.applyViewportTransform();
    }

    endViewportPan() {

        if (
            !this.viewportPanning
        ) {

            return;
        }

        this.viewportPanning =
            false;

        this.viewportPanStart =
            null;

        this.paperContainer.classList.remove(
            'plant-panning'
        );

        this.paperContainer.style.cursor =
            'default';
    }

    // ATUALIZAÇÃO GERAL

    update(
        plant,
        runtime = {}
    ) {

        if (
            !plant
        ) {

            return;
        }

        this.currentPlant =
            plant;

        this.currentRuntime = {

            ...this.currentRuntime,
            ...runtime
        };

        this.updateModeVisibility();

        this.updateTanks(
            plant
        );

        this.updateLevelSensors(
            plant
        );

        this.updateFlowSensors(
            plant
        );

        this.updatePumps(
            plant
        );

        this.updateActuatedValves(
            plant
        );

        this.updateRecycleValves(
            plant
        );

        this.updateManualValves(
            plant
        );

        this.updateThreeWayValves(
            plant
        );

        this.updateMainValve(
            plant
        );

        this.updateHydraulicAppearance(
            this.currentRuntime
                .flows ??
                {}
        );

        this.updateRuntimeInterface();

        this.updateRealConnectionInterface();

        this.updateControlStates();
        this.updateSensorPreview();
        this.updateReadOnlyTelemetry();
        /*
          Aplica as atualizações SVG pendentes do JointJS junto com os valores exibidos.
          A entrada do slider não deve aguardar um ciclo posterior de renderização.
        */
        this.paper.updateViews();
    }

    // TELEMETRIA E PERMISSÕES
    updateReadOnlyTelemetry() {

        // Habilita somente controles com equivalente no backend conectado.
        for (const selector of ['#simulation-control-section', '.simulation-only-section',
            '#pump-controls', '#main-valve-controls', '#central-valve-controls',
            '#three-way-controls', '#output-valve-controls', '#recycle-valve-controls',
            '#manual-valve-controls']) {
            for (const control of document.querySelectorAll(`${selector} input, ${selector} select, ${selector} button`)) {
                if (control.classList.contains('section-toggle')) continue;
                control.disabled = this.currentRuntime.readOnly;
            }
        }
        for (const control of document.querySelectorAll('.capacity-row input')) {
            control.disabled = true;
            const capacity = this.currentPlant.tanks.find(tank => tank.id === control.dataset.tankId)?.capacity;
            control.value = Number.isFinite(capacity) ? capacity.toFixed(3) : '';
            control.placeholder = '—';
        }
        for (const [id, control] of Object.entries(this.initialLevelControls)) {
            const sim = this.currentRuntime.sim;
            const height = sim?.initialLevels?.[id];
            this.syncSliderControl(control, Number.isFinite(height) && sim.tankHeightCm > 0
                ? height / sim.tankHeightCm : null);
        }
        const speed = document.getElementById('simulation-speed');
        if (speed && Number.isFinite(this.currentRuntime.speed)) speed.value = String(this.currentRuntime.speed);
        const canWrite = (kind, id) => this.currentRuntime.canCommandComponent?.(kind, id) === true;
        const plant = this.currentPlant;
        for (const pump of plant.pumps) {
            const known = pump.power !== null;
            const view = this.pumpViews[pump.id];
            view?.attr('outer/strokeOpacity', known ? 1 : 0);
            view?.attr('inner/strokeOpacity', known ? 1 : 0);
            if (!known) view?.attr('typeLabel/text', '—');
            const controls = this.pumpControls[pump.id];
            if (controls) controls.button.disabled = controls.command.disabled = !canWrite('pump', pump.id);
            if (controls && this.currentRuntime.backendMode === 'HARDWARE') {
                controls.button.textContent = 'Zerar';
                controls.button.disabled = !canWrite('pump', pump.id) || !pump.power;
            }
            if (controls && !known) {
                controls.state.textContent = '—';
                controls.button.textContent = '—';
            }
        }
        for (const [group, views, field, text] of [
            ['actuatedValves', this.actuatedValveViews, 'opening', 'valueText'],
            ['manualValves', this.manualValveViews, 'opening', 'valueText'],
            ['recycleValves', this.recycleValveViews, 'opening', 'valueText'],
            ['threeWayBranches', this.threeWayValveViews, 'state', 'stateText']
        ]) {
            for (const item of plant[group]) {
                const known = item[field] !== null;
                views[item.id]?.attr('body/strokeOpacity', known ? 1 : 0);
                if (!known) views[item.id]?.attr(`${text}/text`, '—');
                if (group === 'threeWayBranches' && !known) {
                    const controls = this.threeWayButtons[item.id];
                    if (controls) controls.state.textContent = controls.button.textContent = '—';
                }
            }
        }
        for (const [group, controls, kind] of [
            ['actuatedValves', { ...this.centralValveControls, ...this.outputValveControls }, 'actuatedValve'],
            ['manualValves', this.manualValveControls, 'manualValve'],
            ['recycleValves', this.recycleValveControls, 'recycleValve']
        ]) for (const item of plant[group]) {
            if (controls[item.id]) controls[item.id].input.disabled = !canWrite(kind, item.id);
        }
        if (this.mainValveControl) this.mainValveControl.input.disabled = !canWrite('mainValve', 'HV9');
        for (const controls of Object.values(this.threeWayButtons)) controls.button.disabled = true;
        const mainKnown = plant.mainValve.opening !== null;
        this.mainValveView?.attr('body/strokeOpacity', mainKnown ? 1 : 0);
        if (!mainKnown) this.mainValveView?.attr('valueText/text', '—');
        const selection = this.componentEditorSelection;
        if (selection) {
            const item = this.getComponentEditorState(selection);
            if (item && ((selection.kind === 'pump' && item.power === null) ||
                (selection.kind === 'relayValve' && item.state === null))) {
                this.componentEditorToggle.textContent = '—';
            }
        }
        const state = document.getElementById('simulation-state');
        if (state && (!this.currentRuntime.connected || this.currentRuntime.lastError)) {
            state.textContent = this.currentRuntime.lastError || 'Desconectado';
        }
        if (!Number.isFinite(this.currentRuntime.time)) {
            const time = document.getElementById('simulation-time');
            if (time) time.textContent = '—';
        }
        if (!Number.isFinite(this.currentRuntime.speed)) {
            const speed = document.getElementById('simulation-speed-label');
            if (speed) speed.textContent = '—';
        }
    }

    // MODO

    updateModeVisibility() {

        const realMode =
            this.currentRuntime.mode ===
            'real';

        const realSection =
            document.getElementById(
                'real-connection-section'
            );

        const simulationSection =
            document.getElementById(
                'simulation-control-section'
            );

        const simulationOnly =
            document.querySelectorAll(
                '.simulation-only-section'
            );

        if (
            realSection
        ) {

            realSection.hidden =
                !realMode;
        }

        if (
            simulationSection
        ) {

            simulationSection.hidden =
                realMode;
        }

        simulationOnly.forEach(
            section => {

                section.hidden =
                    realMode;
            }
        );
    }

    // CONTROLE DE TAMANHO DO TEXTO DA SIDEBAR

    createSidebarFontControl() {

        const decreaseButton =
            document.getElementById(
                'sidebar-font-decrease'
            );

        const increaseButton =
            document.getElementById(
                'sidebar-font-increase'
            );

        const storedValue =
            Number(
                localStorage.getItem(
                    'sidebar-font-scale'
                )
            );

        if (
            Number.isFinite(
                storedValue
            ) &&
            storedValue >= 0.80 &&
            storedValue <= 1.70
        ) {

            this.sidebarFontScale =
                storedValue;
        }

        this.applySidebarFontScale();

        decreaseButton
            ?.addEventListener(
                'click',
                () => {

                    this.setSidebarFontScale(
                        this.sidebarFontScale -
                        0.05
                    );
                }
            );

        increaseButton
            ?.addEventListener(
                'click',
                () => {

                    this.setSidebarFontScale(
                        this.sidebarFontScale +
                        0.05
                    );
                }
            );
    }

    setSidebarFontScale(scale) {

        const boundedScale =
            Math.max(
                0.80,
                Math.min(
                    1.70,
                    scale
                )
            );

        this.sidebarFontScale =
            Math.round(
                boundedScale *
                100
            ) /
            100;

        localStorage.setItem(
            'sidebar-font-scale',
            String(
                this.sidebarFontScale
            )
        );

        this.applySidebarFontScale();
    }

    applySidebarFontScale() {

        document.documentElement
            .style
            .setProperty(
                '--sidebar-font-scale',
                String(
                    this.sidebarFontScale
                )
            );

        const display =
            document.getElementById(
                'sidebar-font-value'
            );

        if (
            display
        ) {

            display.textContent =
                `${Math.round(
                    this.sidebarFontScale *
                    100
                )}%`;
        }

        const decreaseButton =
            document.getElementById(
                'sidebar-font-decrease'
            );

        const increaseButton =
            document.getElementById(
                'sidebar-font-increase'
            );

        if (
            decreaseButton
        ) {

            decreaseButton.disabled =
                this.sidebarFontScale <=
                0.80;
        }

        if (
            increaseButton
        ) {

            increaseButton.disabled =
                this.sidebarFontScale >=
                1.70;
        }
    }

    // TANQUES

    updateTanks(plant) {

        plant.tanks.forEach(
            tank => {

                const view = this.tankViews[tank.id];
                if (!view) return;

                view.updateTank({
                    overflowing: this.currentRuntime.overflowing?.[tank.id] === true,

                    id:
                        tank.id,

                    ...tankPresentation(tank)
                });
            }
        );
    }

    // LT

    updateLevelSensors(plant) {

        plant.levelSensors.forEach(
            sensor => {

                const view =
                    this.levelSensorViews[
                        sensor.tank
                    ];

                if (
                    !view
                ) {

                    return;
                }

                view.updateSensor({

                    id:
                        sensor.id,

                    level:
                        sensor.level,

                    pressure:
                        sensor.pressure
                });
                if (this.currentRuntime.backendMode === 'HARDWARE') {
                    view.attr('levelText/text', Number.isFinite(sensor.heightCm) ? `${sensor.heightCm.toFixed(2).replace('.', ',')} cm` : '—');
                    view.attr('pressureText/text', '');
                }
            }
        );
    }

    // FT

    updateFlowSensors(plant) {

        plant.flowSensors.forEach(
            sensor => {

                const view =
                    this.flowSensorViews[
                        sensor.id
                    ];

                if (
                    !view
                ) {

                    return;
                }

                view.updateSensor({

                    id:
                        sensor.id,

                    flow:
                        sensor.flow
                });
            }
        );
    }

    // BOMBAS

    updatePumps(plant) {

        plant.pumps.forEach(
            pump => {

                this.pumpViews[
                    pump.id
                ]?.updatePump(
                    pump
                );
            }
        );
    }

    // LV1 - LV4

    updateActuatedValves(plant) {

        plant.actuatedValves.forEach(
            valve => {

                this.actuatedValveViews[
                    valve.id
                ]?.updateValve(
                    valve
                );
            }
        );
    }

    // HV7 / HV8

    updateRecycleValves(plant) {

        plant.recycleValves.forEach(
            valve => {

                this.recycleValveViews[
                    valve.id
                ]?.updateValve(
                    valve
                );
            }
        );
    }

    // VÁLVULAS MANUAIS

    updateManualValves(plant) {

        if (
            !Array.isArray(
                plant.manualValves
            )
        ) {

            return;
        }

        plant.manualValves.forEach(
            valve => {

                this.manualValveViews[
                    valve.id
                ]?.updateValve(
                    valve
                );
            }
        );
    }

    // OY1_A / OY1_B / OY2_A / OY2_B

    positionThreeWayEquipment() {
        for (const [id, view] of Object.entries(this.threeWayEquipmentViews)) {
            const bounds = this.threeWayValveViews[`${id}_A`].getBBox()
                .union(this.threeWayValveViews[`${id}_B`].getBBox());
            view.position(bounds.x, bounds.y);
            view.resize(bounds.width, bounds.height);
        }
    }

    updateThreeWayValves(plant) {

        for (const valve of plant.threeWayValves) {
            this.threeWayEquipmentViews[valve.id]?.updateValve(valve);
        }

        plant.threeWayBranches.forEach(
            valve => {

                this.threeWayValveViews[
                    valve.id
                ]?.updateValve(
                    valve
                );
            }
        );
    }

    // HV9

    updateMainValve(plant) {

        if (
            plant.mainValve &&
            this.mainValveView
        ) {

            this.mainValveView
                .updateValve(
                    plant.mainValve
                );
        }
    }

    // FLUXOS

    updateHydraulicAppearance(
        flows
    ) {

        this.flowOffset -=
            2;

        Object.entries(
            this.hydraulicConnections
        ).forEach(
            (
                [
                    name,
                    connection
                ]
            ) => {

                const value =
                    flows[name];

                connection.flow.attr('line/visibility', Number.isFinite(value) ? 'visible' : 'hidden');
                const active = Number.isFinite(value) &&
                    Math.abs(
                        value
                    ) >
                    0.000001;

                /*
                  Todo o tubo recebe a cor do fluxo; os traços claros em movimento
                  indicam o deslocamento da água, sem serem os únicos pixels azuis.
                */
                connection.pipe.attr('line/stroke', active ? '#4f89a8' : '#8c969d');

                connection.flow.attr(
                    'line/stroke',

                    active
                        ? '#a5cbdc'
                        : '#b8bfc4'
                );

                connection.flow.attr(
                    'line/strokeWidth',

                    connection.thin
                        ? (
                            active
                                ? 2.5
                                : 2
                        )
                        : (
                            active
                                ? 4
                                : 3
                        )
                );

                connection.flow.attr(
                    'line/strokeDashoffset',
                    this.flowOffset
                );
            }
        );
    }

    // PAINEL

    createControlPanel() {

        this.createModeControl();

        this.createGeneralControls();

        this.createRealConnectionControl();

        this.createInitialLevelControls();

        this.createCapacityControls();

        this.createPumpControls();

        this.createMainValveControl();

        this.createCentralValveControls();

        this.createThreeWayValveControls();

        this.createOutputValveControls();

        this.createRecycleValveControls();

        this.createManualValveControls();
    }

    // MODO

    createModeControl() {

        const select =
            document.getElementById(
                'operating-mode'
            );

        if (
            !select
        ) {

            return;
        }

        select.addEventListener(
            'change',
            event => {

                this.onModeChange(
                    event.target.value
                );
            }
        );
    }

    // SIMULAÇÃO

    createGeneralControls() {

        document
            .getElementById(
                'start-pause-button'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.onStartPause();
                }
            );

        document
            .getElementById(
                'reset-button'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.onReset();
                }
            );

        document
            .getElementById(
                'simulation-speed'
            )
            ?.addEventListener(
                'change',
                event => {

                    this.onSimulationSpeedChange(
                        Number(
                            event.target.value
                        )
                    );
                }
            );
    }

    // CONEXÃO REAL

    createRealConnectionControl() {

        document
            .getElementById(
                'real-connect-button'
            )
            ?.addEventListener(
                'click',
                () => {

                    this.onRealConnectToggle();
                }
            );
    }

    // SLIDER

    createSliderControl(
        container,
        label,
        value,
        callback
    ) {

        if (
            !container
        ) {

            return null;
        }

        const wrapper =
            document.createElement(
                'div'
            );

        wrapper.className =
            'slider-control';

        const header =
            document.createElement(
                'div'
            );

        header.className =
            'slider-header';

        const name =
            document.createElement(
                'strong'
            );

        name.textContent =
            componentLabel(label);

        const display =
            document.createElement(
                'span'
            );

        display.className =
            'slider-value';

        const input =
            document.createElement(
                'input'
            );

        input.type =
            'range';

        input.min =
            0;

        input.max =
            100;

        input.step =
            1;

        input.value =
            value;

        const refresh =
            () => {

                display.textContent =
                    `${Math.round(
                        Number(
                            input.value
                        )
                    )}%`;
            };

        input.addEventListener(
            'input',
            () => {

                refresh();

                callback(
                    Number(
                        input.value
                    )
                );
            }
        );

        refresh();

        header.append(
            name,
            display
        );

        wrapper.append(
            header,
            input
        );

        container.appendChild(
            wrapper
        );

        return {

            wrapper,
            input,
            display
        };
    }

    // NÍVEIS INICIAIS

    createInitialLevelControls() {

        const container =
            document.getElementById(
                'initial-level-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        [
            'TQ1',
            'TQ2',
            'TQ3',
            'TQ4',
            'TQ5',
            'TQ6'
        ].forEach(
            id => {

                this.initialLevelControls[
                    id
                ] =
                    this.createSliderControl(

                        container,

                        id,

                        0,

                        value => {

                            this.onInitialLevelChange(
                                id,
                                value / 100
                            );
                        }
                    );
            }
        );
    }

    // CAPACIDADES

    createCapacityControls() {

        const container =
            document.getElementById(
                'capacity-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        [
            'TQ1',
            'TQ2',
            'TQ3',
            'TQ4',
            'TQ5',
            'TQ6'
        ].forEach(
            id => {

                const row =
                    document.createElement(
                        'label'
                    );

                row.className =
                    'capacity-row';

                const name =
                    document.createElement(
                        'strong'
                    );

                name.textContent =
                    componentLabel(id);

                const input =
                    document.createElement(
                        'input'
                    );

                input.type =
                    'number';

                input.min =
                    0.1;

                input.step =
                    0.1;

                input.dataset.tankId = id;
                input.setAttribute('aria-label', `Capacidade de ${componentLabel(id)} em litros`);
                input.disabled = true;
                input.value = '';
                input.placeholder = '—';

                const unit =
                    document.createElement(
                        'span'
                    );

                unit.textContent =
                    'L';

                row.append(
                    name,
                    input,
                    unit
                );

                container.appendChild(
                    row
                );
            }
        );
    }

    // BOMBAS

    createPumpControls() {

        const container =
            document.getElementById(
                'pump-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        [
            'JIC3',
            'JIC4',
            'JIC1'
        ].forEach(
            id => {

                const row =
                    document.createElement(
                        'div'
                    );

                row.className =
                    'pump-line';

                const label =
                    document.createElement(
                        'strong'
                    );

                label.textContent =
                    componentLabel(id);

                const command =
                    document.createElement(
                        'input'
                    );

                command.type =
                    'range';

                command.min =
                    0;

                command.max =
                    100;

                command.step =
                    1;

                command.value =
                    100;

                const state =
                    document.createElement(
                        'span'
                    );

                state.textContent =
                    'OFF';

                const button =
                    document.createElement(
                        'button'
                    );

                button.type =
                    'button';

                button.textContent =
                    'Temporizada';

                command.addEventListener(
                    'input',
                    () => {

                        this.onPumpCommandChange(
                            id,
                            Number(
                                command.value
                            ) / 100
                        );
                    }
                );

                button.addEventListener(
                    'click',
                    () => {

                        this.onPumpToggle(
                            id
                        );
                    }
                );

                row.append(
                    label,
                    command,
                    state,
                    button
                );

                container.appendChild(
                    row
                );

                this.pumpControls[
                    id
                ] = {

                    command,
                    state,
                    button
                };
            }
        );
    }

    // HV9

    createMainValveControl() {

        const container =
            document.getElementById(
                'main-valve-control'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        this.mainValveControl =
            this.createSliderControl(

                container,

                'HV9 → saída JIC1',

                100,

                value => {

                    this.onMainValveChange(
                        value / 100
                    );
                }
            );
    }

    // LV1 / LV2

    createCentralValveControls() {

        const container =
            document.getElementById(
                'central-valve-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        this.centralValveControls.LV1 =
            this.createSliderControl(

                container,

                'LV1 → conjunto OY1',

                100,

                value => {

                    this.onActuatedValveChange(
                        'LV1',
                        value / 100
                    );
                }
            );

        this.centralValveControls.LV2 =
            this.createSliderControl(

                container,

                'LV2 → conjunto OY2',

                100,

                value => {

                    this.onActuatedValveChange(
                        'LV2',
                        value / 100
                    );
                }
            );
    }

    // X

    createThreeWayValveControls() {

        const container =
            document.getElementById(
                'split-valve-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        for (const id of ['OY1', 'OY2']) {
            const row = document.createElement('div');
            row.className = 'pump-line';
            const label = document.createElement('strong');
            label.textContent = id;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Temporizada';
            button.disabled = true;
            row.append(label);
            for (const branch of ['A', 'B']) {
                const branchLabel = document.createElement('span');
                branchLabel.textContent = branch + ': ';
                const state = document.createElement('span');
                state.textContent = '—';
                branchLabel.append(state);
                row.append(branchLabel);
                this.threeWayButtons[id + '_' + branch] = { state, button };
            }
            row.append(button);
            container.append(row);
        }
    }

    // LV3 / LV4

    createOutputValveControls() {

        const container =
            document.getElementById(
                'output-valve-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        this.outputValveControls.LV3 =
            this.createSliderControl(

                container,

                'LV3 → TQ1',

                100,

                value => {

                    this.onActuatedValveChange(
                        'LV3',
                        value / 100
                    );
                }
            );

        this.outputValveControls.LV4 =
            this.createSliderControl(

                container,

                'LV4 → TQ2',

                100,

                value => {

                    this.onActuatedValveChange(
                        'LV4',
                        value / 100
                    );
                }
            );
    }

    // HV7 / HV8

    createRecycleValveControls() {

        const container =
            document.getElementById(
                'recycle-valve-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        this.recycleValveControls.HV7 =
            this.createSliderControl(

                container,

                'HV7 → TQ3',

                100,

                value => {

                    this.onRecycleValveChange(
                        'HV7',
                        value / 100
                    );
                }
            );

        this.recycleValveControls.HV8 =
            this.createSliderControl(

                container,

                'HV8 → TQ4',

                100,

                value => {

                    this.onRecycleValveChange(
                        'HV8',
                        value / 100
                    );
                }
            );
    }

    // NOVAS VÁLVULAS MANUAIS

    createManualValveControls() {

        const container =
            document.getElementById(
                'manual-valve-controls'
            );

        if (
            !container
        ) {

            return;
        }

        container.innerHTML =
            '';

        const labels = {

            HV5:
                'HV5 → TQ5 / TQ3',

            HV6:
                'HV6 → TQ6 / TQ4',

            HV3:
                'HV3 → TQ3 / JIC3',

            HV4:
                'HV4 → TQ4 / JIC4',

            HV1:
                'HV1 → reservatório',

            HV2:
                'HV2 → reservatório'
        };

        Object.entries(
            labels
        ).forEach(
            (
                [
                    id,
                    label
                ]
            ) => {

                this.manualValveControls[
                    id
                ] =
                    this.createSliderControl(

                        container,

                        label,

                        100,

                        value => {

                            this.onManualValveChange(
                                id,
                                value / 100
                            );
                        }
                    );
            }
        );
    }

    // ATUALIZA CONTROLES

    normalizeSliderPercent(value) {

        const numericValue =
            Number.isFinite(value)
                ? value
                : 0;

        const bounded =
            Math.max(
                0,
                Math.min(
                    1,
                    numericValue
                )
            );

        if (
            bounded <=
            0.005
        ) {

            return 0;
        }

        if (
            bounded >=
            0.995
        ) {

            return 100;
        }

        return Math.round(
            bounded *
            100
        );
    }

    syncSliderControl(
        control,
        opening
    ) {

        if (
            !control ||
            !control.input
        ) {

            return;
        }

        if (!Number.isFinite(opening)) {
            control.display.textContent = '—';
            control.input.disabled = true;
            return;
        }
        const value =
            this.normalizeSliderPercent(
                opening
            );

        if (Number(control.input.value) !== value) {
            control.input.value = value;
        }

        control.display.textContent =
            `${value}%`;
    }

    updateControlStates() {

        const plant =
            this.currentPlant;

        if (
            !plant
        ) {

            return;
        }

        const realMode =
            this.currentRuntime
                .mode ===
            'real' || this.currentRuntime.readOnly;

        const realConnected =
            Boolean(
                this.currentRuntime
                    .connected
            );

        // BOMBAS

        plant.pumps.forEach(
            pump => {

                const controls =
                    this.pumpControls[
                        pump.id
                    ];

                if (
                    !controls
                ) {

                    return;
                }

                controls.state
                    .textContent =
                    pump.power
                        ? 'ON'
                        : 'OFF';

                controls.button
                    .textContent =
                    pump.power
                        ? 'DESLIGAR'
                        : 'LIGAR';

                if (
                    this.currentRuntime.backendMode || document.activeElement !==
                    controls.command
                ) {

                    controls.command.value =
                        Math.round(
                            (
                                pump.command ??
                                0
                            ) *
                            100
                        );
                }

                controls.command.disabled =
                    realMode;

                controls.button.disabled =
                    realMode;
            }
        );

        // X

        plant.threeWayBranches.forEach(
            valve => {

                const controls =
                    this.threeWayButtons[
                        valve.id
                    ];

                if (
                    !controls
                ) {

                    return;
                }

                controls.state.textContent =
                    valve.state
                        ? 'ON'
                        : 'OFF';

                controls.button.textContent = 'Temporizada';

                controls.button.disabled =
                    realMode;
            }
        );

        // ATUADORES REMOTOS

        [
            this.mainValveControl,

            this.centralValveControls.LV1,

            this.centralValveControls.LV2,

            this.outputValveControls.LV3,

            this.outputValveControls.LV4
        ].forEach(
            control => {

                if (
                    control?.input
                ) {

                    control.input.disabled =
                        realMode;
                }
            }
        );

        // SINCRONIZA SLIDERS DOS ATUADORES REMOTOS

        this.syncSliderControl(
            this.mainValveControl,
            plant.mainValve?.opening
        );

        plant.actuatedValves.forEach(
            valve => {

                const control =
                    this.centralValveControls[
                        valve.id
                    ] ??
                    this.outputValveControls[
                        valve.id
                    ];

                this.syncSliderControl(
                    control,
                    valve.opening
                );
            }
        );

        // VÁLVULAS MANUAIS

        [
            ...Object.values(
                this.recycleValveControls
            ),

            ...Object.values(
                this.manualValveControls
            )
        ].forEach(
            control => {

                if (
                    control?.input
                ) {

                    /*
                      Válvulas manuais continuam editáveis também
                      no modo Planta real. A posição representa o valor
                      informado pelo operador e não um comando de atuador.
                    */
                    control.input.disabled = realMode;
                }
            }
        );

        // ATUALIZA SLIDERS DE RECIRCULAÇÃO E VÁLVULAS MANUAIS

        if (
            Array.isArray(
                plant.recycleValves
            )
        ) {

            plant.recycleValves.forEach(
                valve => {

                    this.syncSliderControl(
                        this.recycleValveControls[
                            valve.id
                        ],
                        valve.opening
                    );
                }
            );
        }

        if (
            Array.isArray(
                plant.manualValves
            )
        ) {

            plant.manualValves.forEach(
                valve => {

                    this.syncSliderControl(
                        this.manualValveControls[
                            valve.id
                        ],
                        valve.opening
                    );
                }
            );
        }

        // SELETOR DO MODO

        this.syncComponentEditor();

        const modeSelect =
            document.getElementById(
                'operating-mode'
            );

        if (
            modeSelect &&
            modeSelect.value !==
                this.currentRuntime.mode
        ) {

            modeSelect.value =
                this.currentRuntime.mode;
        }
    }

    // STATUS PRINCIPAL

    updateRuntimeInterface() {

        const runtime =
            this.currentRuntime;

        const state =
            document.getElementById(
                'simulation-state'
            );

        const statusDot =
            document.getElementById(
                'status-dot'
            );

        if (
            runtime.mode ===
            'simulation'
        ) {
            const ready = runtime.simulationReady === true;
            for (const id of ['start-pause-button', 'reset-button', 'simulation-speed']) {
                const control = document.getElementById(id);
                if (control) control.disabled = !ready;
            }

            if (
                state
            ) {

                state.textContent =
                    !ready ? (runtime.connecting || runtime.connected ? 'Conectando...' : runtime.connectionLabel || 'Desconectado') : runtime.running
                        ? 'Executando'
                        : 'Pausado';
            }

            if (
                statusDot
            ) {

                statusDot.classList.remove(
                    'running',
                    'paused'
                );

                statusDot.classList.add(
                    runtime.running
                        ? 'running'
                        : 'paused'
                );
            }

            const time =
                document.getElementById(
                    'simulation-time'
                );

            const speed =
                document.getElementById(
                    'simulation-speed-label'
                );

            const button =
                document.getElementById(
                    'start-pause-button'
                );

            if (
                time
            ) {

                time.textContent =
                    Number(
                        runtime.time ??
                        0
                    ).toFixed(
                        1
                    ).replace('.', ',');
            }

            if (
                speed
            ) {

                speed.textContent =
                    `${String(runtime.speed ?? 1).replace('.', ',')}×`;
            }

            if (
                button
            ) {

                button.textContent =
                    runtime.running
                        ? 'Pausar'
                        : 'Iniciar';
            }

            return;
        }

        // PLANTA REAL

        if (
            state
        ) {

            if (
                runtime.connecting
            ) {

                state.textContent =
                    'Conectando';

            } else {

                state.textContent =
                    runtime.connected
                        ? 'Conectado'
                        : 'Desconectado';
            }
        }

        if (
            statusDot
        ) {

            statusDot.classList.remove(
                'running',
                'paused'
            );

            statusDot.classList.add(
                runtime.connected
                    ? 'running'
                    : 'paused'
            );
        }
    }

    // CONEXÃO REAL

    updateRealConnectionInterface() {

        if (
            this.currentRuntime
                .mode !==
            'real'
        ) {

            return;
        }

        const runtime =
            this.currentRuntime;

        const status =
            document.getElementById(
                'real-connection-status'
            );

        const dot =
            document.getElementById(
                'real-status-dot'
            );

        const transport =
            document.getElementById(
                'real-transport'
            );

        const port =
            document.getElementById(
                'real-port'
            );

        const lastUpdate =
            document.getElementById(
                'real-last-update'
            );

        const button =
            document.getElementById(
                'real-connect-button'
            );

        const message =
            document.getElementById(
                'real-connection-message'
            );

        if (
            status
        ) {

            status.textContent =
                runtime.connecting
                    ? 'Conectando...'
                    : (
                        runtime.connectionLabel ??
                        (
                            runtime.connected
                                ? 'Conectado'
                                : 'Desconectado'
                        )
                    );
        }

        if (
            dot
        ) {

            dot.classList.remove(
                'connected',
                'disconnected',
                'connecting'
            );

            if (
                runtime.connecting
            ) {

                dot.classList.add(
                    'connecting'
                );

            } else if (
                runtime.connected
            ) {

                dot.classList.add(
                    'connected'
                );

            } else {

                dot.classList.add(
                    'disconnected'
                );
            }
        }

        if (
            transport
        ) {

            transport.textContent =
                runtime.transport ??
                'Não configurada';
        }

        if (
            port
        ) {

            port.textContent = runtime.hardware?.serial?.port ?? '--';
        }

        if (
            lastUpdate
        ) {

            lastUpdate.textContent =
                runtime.hardware?.telemetry?.lastReceivedAt
                    ? new Date(
                        runtime.hardware.telemetry.lastReceivedAt
                    ).toLocaleTimeString(
                        'pt-BR'
                    )
                    : '--';
        }

        if (
            button
        ) {

            button.disabled =
                Boolean(
                    runtime.connecting
                );

            button.textContent =
                runtime.connecting
                    ? 'Conectando...'
                    : (
                        runtime.connected
                            ? 'Desconectar'
                            : 'Conectar'
                    );
        }

        if (
            message
        ) {

            if (
                runtime.lastError
            ) {

                message.textContent =
                    String(
                        runtime.lastError
                    );

                message.classList.add(
                    'error'
                );

            } else {

                message.classList.remove(
                    'error'
                );

                message.textContent =
                    runtime.connected
                        ? 'Backend WebSocket conectado.'
                        : 'Backend WebSocket desconectado; estado Serial indisponível.';
            }
        }
        if (status) status.textContent = runtime.connected ? 'Backend conectado' : 'Backend desconectado';
        if (transport) transport.textContent = 'WebSocket (backend)';
        if (message && runtime.connected && !runtime.lastError) {
            const serial = runtime.hardware?.serial;
            const telemetry = runtime.hardware?.telemetry;
            const states = { receiving: 'recebendo', absent: 'ausente', expired: 'expirada' };
            const hardware = runtime.hardware ?? {};
            const firmware = hardware.firmware ?? {};
            const compatibility = hardware.compatibility ?? {};
            const labels = { compatible: 'Compatível', partial: 'Parcial', incompatible: 'Incompatível', unknown: 'Desconhecida' };
            const lines = [
                `Serial aberta: ${serial?.open ? 'sim' : 'não'} · ${serial?.baud ?? '—'} baud`,
                `Firmware identificado: ${firmware.identified ? 'sim' : 'não'}`,
                `ID: ${firmware.boardId ?? '—'} · versão ${firmware.version ?? '—'} · ${firmware.board ?? '—'}`,
                `Configuração descoberta: ${hardware.discovery?.complete ? 'sim' : 'não'}`,
                `Planta 1: ${labels[compatibility.status] ?? 'Desconhecida'}`,
                `Pressões mapeadas: ${compatibility.pressureCount ?? 0}/6 · cadastradas: ${hardware.discovery?.components?.PRESSAO ?? '—'}`,
                `Vazões mapeadas: ${compatibility.flowCount ?? 0}/6 · cadastradas: ${hardware.discovery?.components?.VAZAO ?? '—'}`,
                `Aquisição: ${hardware.acquisition?.active ? 'ativa' : 'inativa'} · telemetria ${states[telemetry?.status] ?? 'desconhecida'}`
            ];
            // Atualização preserva a abertura dos detalhes escolhida pelo operador.
            const expanded = this.hardwareDetailsExpanded ?? false;
            message.replaceChildren();
            for (const line of lines) {
                const row = document.createElement('div');
                row.textContent = line;
                message.append(row);
            }
            const details = document.createElement('details');
            details.open = expanded;
            details.addEventListener('toggle', () => {
                if (details.isConnected) this.hardwareDetailsExpanded = details.open;
            });
            const summary = document.createElement('summary');
            summary.textContent = 'Pinagem e diagnóstico';
            details.append(summary);
            const notes = [
                `VERBOSE de vazão: ${hardware.capabilities?.flowVerboseSupported === true ? 'suportado' : hardware.capabilities?.flowVerboseSupported === false ? 'não utilizado; aquisição compacta' : 'a descobrir'}`,
                `Unidade do perfil: ${hardware.capabilities?.flowSourceUnit ?? 'consultada por sensor / desconhecida'}`,
                `Último erro de protocolo: ${hardware.capabilities?.lastProtocolError ?? 'nenhum'}`,
                ...(compatibility.issues ?? []),
                ...(compatibility.reported ?? []).map(item => `${item.kind}${item.apiIndex} → ${item.pin} → ${item.tag ?? 'não mapeado'}`),
                ...(hardware.messages ?? []).slice(-5).map(item => `${item.type}: ${item.message}`)
            ];
            for (const note of notes) {
                const row = document.createElement('div');
                row.textContent = note;
                details.append(row);
            }
            message.append(details);
        }
    }

    // PROTEÇÃO DO EDITOR CONTRA PAN/ZOOM DA PLANTA

    eventComesFromComponentEditor(
        event
    ) {

        const pointerEvent =
            event?.originalEvent ??
            event;

        const target =
            pointerEvent?.target;

        return Boolean(
            target?.closest?.(
                '.component-editor'
            )
        );
    }

    // DISTINÇÃO ENTRE CLIQUE/TOQUE E ARRASTE

    beginElementGesture(
        elementView,
        event
    ) {

        const selection =
            this.getInteractiveComponent(
                elementView.model
            );

        if (
            !selection
        ) {

            return;
        }

        const pointerEvent =
            event.originalEvent ??
            event;

        if (
            pointerEvent.button !==
                undefined &&
            pointerEvent.button !==
                0
        ) {

            return;
        }

        this.pendingElementGesture = {

            selection,

            clientX:
                pointerEvent.clientX,

            clientY:
                pointerEvent.clientY,

            panX:
                this.viewportPanX,

            panY:
                this.viewportPanY
        };
    }

    maybeStartElementPan(
        event
    ) {

        const gesture =
            this.pendingElementGesture;

        if (
            !gesture ||
            this.viewportPanning
        ) {

            return;
        }

        const dx =
            event.clientX -
            gesture.clientX;

        const dy =
            event.clientY -
            gesture.clientY;

        const distance =
            Math.hypot(
                dx,
                dy
            );

        if (
            distance <
            this.elementPanThreshold
        ) {

            return;
        }

        // Arrastar o componente move a planta, sem enviar comandos.
        this.closeComponentEditor();

        this.viewportPanning =
            true;

        this.viewportPanStart = {

            clientX:
                gesture.clientX,

            clientY:
                gesture.clientY,

            panX:
                gesture.panX,

            panY:
                gesture.panY
        };

        this.suppressComponentClickUntil =
            performance.now() +
            250;

        this.paperContainer.classList.add(
            'plant-panning'
        );

        this.paperContainer.style.cursor =
            'grabbing';

        this.moveViewportPan(
            event
        );
    }

    endElementGesture() {

        this.pendingElementGesture =
            null;
    }

    // EDITOR FLUTUANTE DE COMPONENTES

    createComponentEditor() {

        const editor =
            document.createElement(
                'div'
            );

        editor.className =
            'component-editor';

        editor.hidden =
            true;

        editor.setAttribute(
            'role',
            'dialog'
        );

        editor.setAttribute(
            'aria-label',
            'Ajuste do componente'
        );

        /* Impede que eventos do editor iniciem o pan do JointJS.
           Sliders e botões mantêm seus eventos nativos. */
        [
            'pointerdown',
            'pointermove',
            'pointerup',
            'pointercancel',
            /*
              O JointJS também escuta eventos de compatibilidade de mouse e toque.
              Preserva o comportamento nativo dos controles, interrompendo esses eventos antes da área de desenho.
            */
            'mousedown',
            'mousemove',
            'mouseup',
            'touchstart',
            'touchmove',
            'touchend',
            'touchcancel',
            'click',
            'dblclick'
        ].forEach(
            eventName => {

                editor.addEventListener(
                    eventName,
                    event => {

                        event.stopPropagation();
                    }
                );
            }
        );

        const header =
            document.createElement(
                'div'
            );

        header.className =
            'component-editor-header';

        const heading =
            document.createElement(
                'div'
            );

        const title =
            document.createElement(
                'strong'
            );

        title.className =
            'component-editor-title';

        const subtitle = document.createElement('span');
        subtitle.className = 'component-editor-subtitle';
        heading.append(title, subtitle);

        const closeButton =
            document.createElement(
                'button'
            );

        closeButton.type =
            'button';

        closeButton.className =
            'component-editor-close';

        closeButton.textContent =
            '×';

        closeButton.title =
            'Fechar';

        closeButton.setAttribute(
            'aria-label',
            'Fechar ajuste'
        );

        closeButton.addEventListener(
            'click',
            () => {

                this.closeComponentEditor();
            }
        );

        header.append(
            heading,
            closeButton
        );

        const body =
            document.createElement(
                'div'
            );

        body.className =
            'component-editor-body';

        const sliderArea =
            document.createElement(
                'div'
            );

        sliderArea.className =
            'component-editor-slider-area';

        const value =
            document.createElement(
                'strong'
            );

        value.className =
            'component-editor-value';

        value.textContent =
            '0%';

        const slider =
            document.createElement(
                'input'
            );

        slider.type =
            'range';

        slider.min =
            0;

        slider.max =
            100;

        slider.step =
            1;

        slider.value =
            0;

        slider.className =
            'component-editor-slider';

        /*
          A orientação nativa é definida por writing-mode no CSS.
          O CSS abaixo também possui fallback por rotação,
          A semântica também informa a orientação às tecnologias assistivas.
        */
        slider.setAttribute(
            'aria-orientation',
            'vertical'
        );

        slider.setAttribute(
            'aria-label',
            'Valor do componente'
        );

        slider.addEventListener(
            'input',
            () => {

                this.applyComponentEditorSlider();
            }
        );

        sliderArea.append(
            value,
            slider
        );

        const actions =
            document.createElement(
                'div'
            );

        actions.className =
            'component-editor-actions';

        const toggle =
            document.createElement(
                'button'
            );

        toggle.type =
            'button';

        toggle.className =
            'component-editor-toggle';

        toggle.addEventListener(
            'click',
            () => {

                this.applyComponentEditorToggle();
            }
        );

        const hint =
            document.createElement(
                'span'
            );

        hint.className =
            'component-editor-hint';

        hint.textContent =
            'Ajuste pelo slider.';

        actions.append(
            toggle,
            hint
        );

        body.append(
            sliderArea,
            actions
        );

        editor.append(
            header,
            body
        );

        editor.addEventListener(
            'pointerdown',
            () => {

                this.endElementGesture();

                // Encerra qualquer pan ativo antes de mover o slider.
                this.endViewportPan();
            }
        );

        this.paperContainer.appendChild(
            editor
        );

        this.componentEditor =
            editor;
        this.setupComponentEditorLayout(header, editor);

        this.componentEditorSlider =
            slider;

        this.componentEditorToggle =
            toggle;

        this.componentEditorValue =
            value;

        this.componentEditorTitle =
            title;
        this.componentEditorSubtitle = subtitle;

        this.componentEditorHint =
            hint;
    }

    getInteractiveComponent(
        element
    ) {

        for (const [group, views] of [['levelSensors', this.levelSensorViews], ['flowSensors', this.flowSensorViews]]) {
            const match = Object.entries(views ?? {}).find(([, model]) => model === element);
            if (match) {
                const sensor = this.currentPlant?.[group]?.find(item =>
                    group === 'levelSensors' ? item.tank === match[0] : item.id === match[0]);
                if (sensor) return { kind: 'sensor', group, id: sensor.id };
            }
        }

        const collections = [
            {
                kind:
                    'pump',

                views:
                    this.pumpViews
            },
            {
                kind:
                    'mainValve',

                views: {
                    HV9:
                        this.mainValveView
                }
            },
            {
                kind:
                    'actuatedValve',

                views:
                    this.actuatedValveViews
            },
            {
                kind:
                    'recycleValve',

                views:
                    this.recycleValveViews
            },
            {
                kind:
                    'manualValve',

                views:
                    this.manualValveViews
            },
            {
                kind:
                    'relayValve',

                views:
                    this.threeWayEquipmentViews
            }
        ];

        for (
            const collection
            of collections
        ) {

            for (
                const [
                    id,
                    view
                ]
                of Object.entries(
                    collection.views
                )
            ) {

                if (
                    view &&
                    view ===
                        element
                ) {

                    return {
                        kind:
                            collection.kind,

                        id,
                        model: element
                    };
                }
            }
        }

        return null;
    }

    getComponentEditorState(
        selection
    ) {

        const plant =
            this.currentPlant;

        if (
            !plant ||
            !selection
        ) {

            return null;
        }

        const {
            kind,
            id
        } =
            selection;

        if (
            kind ===
            'pump'
        ) {

            return plant.pumps
                ?.find(
                    item =>
                        item.id === id
                ) ??
                null;
        }

        if (
            kind ===
            'mainValve'
        ) {

            return plant.mainValve ??
                null;
        }

        if (
            kind ===
            'actuatedValve'
        ) {

            return plant.actuatedValves
                ?.find(
                    item =>
                        item.id === id
                ) ??
                null;
        }

        if (
            kind ===
            'recycleValve'
        ) {

            return plant.recycleValves
                ?.find(
                    item =>
                        item.id === id
                ) ??
                null;
        }

        if (
            kind ===
            'manualValve'
        ) {

            return plant.manualValves
                ?.find(
                    item =>
                        item.id === id
                ) ??
                null;
        }

        if (
            kind ===
            'relayValve'
        ) {

            return plant.threeWayValves
                ?.find(
                    item =>
                        item.id === id
                ) ??
                null;
        }

        return null;
    }

    componentEditorCanWrite(selection) {
        return Boolean(selection) && this.currentRuntime.canCommandComponent?.(selection.kind, selection.id) === true;
    }

    openComponentEditor(
        selection,
        event
    ) {

        if (selection?.kind === 'sensor') {
            this.hideSensorPreview();
            this.onSensorSelect(selection.group, selection.id);
            return;
        }

        if (
            !selection ||
            !this.componentEditor
        ) {

            return;
        }

        if (['pump', 'actuatedValve', 'relayValve', 'mainValve', 'recycleValve', 'manualValve'].includes(selection.kind)) {
            this.closeComponentEditor();
            document.dispatchEvent(new CustomEvent('operation-actuator', {detail: {id: selection.id.split('_')[0], anchor: this.paper.findViewByModel(selection.model)?.el.getBoundingClientRect()}}));
            return;
        }

        this.componentEditorSelection = {
            ...selection
        };
        this.componentEditorPosition = null;

        this.componentEditor.hidden =
            false;

        /*
          Cliques do JointJS podem manter o foco no slider reutilizado. Ao abrir o editor,
          o componente selecionado deve ser carregado mesmo que esse foco permaneça.
        */
        this.syncComponentEditor(true);

        this.positionComponentEditor(
            event
        );
    }

    positionComponentEditor() {
        const editor = this.componentEditor;
        if (!editor || editor.hidden) return;
        editor.style.width = ''; editor.style.height = '';
        const bounds = this.paperContainer.getBoundingClientRect();
        editor.style.maxWidth = `${Math.max(104, bounds.width - 16)}px`;
        editor.style.maxHeight = `${Math.max(80, bounds.height - 16)}px`;
        const rect = editor.getBoundingClientRect();
        let preferred = this.componentEditorPosition ?? {
            x: bounds.width - rect.width - 16, y: 72
        };
        const model = this.componentEditorSelection?.model;
        const anchor = model && this.paper.findViewByModel(model)?.el.getBoundingClientRect();
        if (!this.componentEditorPosition && anchor) {
            const right = anchor.right - bounds.left + 14;
            const left = anchor.left - bounds.left - rect.width - 14;
            preferred = {
                x: right + rect.width <= bounds.width - 8 ? right : left,
                y: anchor.top - bounds.top + (anchor.height - rect.height) / 2
            };
        }
        const x = Math.max(8, Math.min(preferred.x, bounds.width - rect.width - 8));
        const y = Math.max(8, Math.min(preferred.y, bounds.height - rect.height - 8));
        editor.style.left = `${x}px`;
        editor.style.top = `${y}px`;
    }

    setupComponentEditorLayout(header, editor) {
        header.title = 'Arraste para mover';
        const bindGesture = (handle) => {
            let gesture = null;
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.target.closest('button')) return;
                event.preventDefault();
                gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
                    left: parseFloat(editor.style.left), top: parseFloat(editor.style.top) };
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', event => {
                if (!gesture || event.pointerId !== gesture.id) return;
                const dx = event.clientX - gesture.x;
                const dy = event.clientY - gesture.y;
                const bounds = this.paperContainer.getBoundingClientRect();
                this.componentEditorPosition = {
                    x: Math.max(8, Math.min(gesture.left + dx, bounds.width - editor.offsetWidth - 8)),
                    y: Math.max(8, Math.min(gesture.top + dy, bounds.height - editor.offsetHeight - 8))
                };
                this.positionComponentEditor();
            });
            const end = () => { gesture = null; };
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
            handle.addEventListener('lostpointercapture', end);
        };
        bindGesture(header);
        this.componentEditorLayoutObserver = new ResizeObserver(() => this.positionComponentEditor());
        this.componentEditorLayoutObserver.observe(this.paperContainer);
    }

    closeComponentEditor() {

        if (
            !this.componentEditor
        ) {

            return;
        }

        this.componentEditor.hidden =
            true;

        this.componentEditorSelection =
            null;
    }

    syncComponentEditor(forceSliderSync = false) {

        const selection =
            this.componentEditorSelection;

        if (
            !selection ||
            !this.componentEditor ||
            this.componentEditor.hidden
        ) {

            return;
        }

        const state =
            this.getComponentEditorState(
                selection
            );

        if (
            !state
        ) {

            this.closeComponentEditor();

            return;
        }

        const writable =
            this.componentEditorCanWrite(
                selection
            );

        const {
            kind,
            id
        } =
            selection;

        const typeLabels = {

            pump:
                'Bomba',

            mainValve:
                'Manual central',

            actuatedValve:
                'Válvula atuada',

            recycleValve:
                'Manual de recirculação',

            manualValve:
                'Válvula manual',

            relayValve:
                'Válvula de três vias · ramos A/B'
        };

        this.componentEditorTitle
            .textContent =
            componentLabel(id);
        this.componentEditorSubtitle.textContent = typeLabels[kind] ?? 'Componente';

        this.componentEditorSlider.setAttribute('aria-label',
            `${typeLabels[kind] ?? 'Componente'} ${componentLabel(id)}: ajuste em %`);
        this.componentEditorHint.textContent = writable
            ? '' : 'Somente leitura.';
        if (!writable && this.currentRuntime.backendMode === 'HARDWARE') {
            const confirmed = this.currentRuntime.hardware?.control?.confirmed;
            const configured = kind === 'actuatedValve' && confirmed?.valves.some(v => v[1] && id === `LV${v[0]}`);
            this.componentEditorHint.textContent = kind === 'actuatedValve' && !configured
                ? 'Associação ou limites físicos ainda não configurados.' : 'Controle físico bloqueado; consulte o painel HARDWARE.';
        }
        this.componentEditorHint.hidden = writable;
        this.componentEditorHint.parentElement.hidden = writable &&
            kind !== 'pump' && kind !== 'relayValve';

        const sliderVisible =
            kind !==
                'relayValve';

        this.componentEditor.classList.toggle('component-editor-compact', !sliderVisible);

        this.componentEditorSlider
            .parentElement
            .hidden =
            !sliderVisible;

        this.componentEditorToggle
            .hidden =
            !(
                kind ===
                    'pump' ||
                kind ===
                    'relayValve'
            );

        if (
            sliderVisible
        ) {

            const normalized =
                kind ===
                    'pump'
                    ? (
                        state.command ??
                        0
                    )
                    : (
                        state.opening ??
                        0
                    );

            const percent =
                this.normalizeSliderPercent(
                    normalized
                );

            if (
                forceSliderSync ||
                Number(this.componentEditorSlider.value) !== percent
            ) {

                this.componentEditorSlider
                    .value =
                    percent;
            }

            this.componentEditorValue
                .textContent =
                Number.isFinite(kind === 'pump' ? state.command : state.opening) ? `${percent}%` : '—';

            this.componentEditorSlider
                .disabled =
                !writable;
        }

        if (
            kind ===
            'pump'
        ) {

            this.componentEditorToggle
                .textContent =
                state.power
                    ? 'DESLIGAR'
                    : 'LIGAR';

            this.componentEditorToggle
                .classList.toggle(
                    'active',
                    Boolean(
                        state.power
                    )
                );

            this.componentEditorToggle
                .disabled =
                !writable;
            if (this.currentRuntime.backendMode === 'HARDWARE') {
                this.componentEditorToggle.textContent = 'ZERAR';
                this.componentEditorToggle.disabled = !writable || !state.power;
            }

        } else if (
            kind ===
            'relayValve'
        ) {
            this.componentEditorToggle.hidden = true;
            const branchText = branch => {
                const value = state.branches?.[branch]?.state;
                return typeof value === 'boolean' || value === 0 || value === 1 ? (value ? 'ON' : 'OFF') : '—';
            };
            this.componentEditorHint.textContent =
                'A: ' + branchText('A') + ' · B: ' + branchText('B') + ' · Temporizada';

        }
    }

    applyComponentEditorSlider() {

        const selection =
            this.componentEditorSelection;

        if (
            !selection ||
            !this.componentEditorSlider ||
            !this.componentEditorCanWrite(
                selection
            )
        ) {

            return;
        }

        const value =
            Number(
                this.componentEditorSlider
                    .value
            );

        this.componentEditorValue
            .textContent =
            `${Math.round(
                value
            )}%`;

        const normalized =
            value /
            100;

        if (
            selection.kind ===
            'pump'
        ) {

            this.onPumpCommandChange(
                selection.id,
                normalized
            );

            return;
        }

        if (
            selection.kind ===
            'mainValve'
        ) {

            this.onMainValveChange(
                normalized
            );

            return;
        }

        if (
            selection.kind ===
            'actuatedValve'
        ) {

            this.onActuatedValveChange(
                selection.id,
                normalized
            );

            return;
        }

        if (
            selection.kind ===
            'recycleValve'
        ) {

            this.onRecycleValveChange(
                selection.id,
                normalized
            );

            return;
        }

        if (
            selection.kind ===
            'manualValve'
        ) {

            this.onManualValveChange(
                selection.id,
                normalized
            );
        }
    }

    applyComponentEditorToggle() {

        const selection =
            this.componentEditorSelection;

        if (
            !selection ||
            !this.componentEditorCanWrite(
                selection
            )
        ) {

            return;
        }

        if (
            selection.kind ===
            'pump'
        ) {

            this.onPumpToggle(
                selection.id
            );

            return;
        }

        if (
            selection.kind ===
            'relayValve'
        ) {

            this.onThreeWayValveToggle(
                selection.id
            );
        }
    }

    showSensorPreview(elementView) {
        const groups = [
            ['levelSensors', this.levelSensorViews],
            ['flowSensors', this.flowSensorViews]
        ];
        for (const [group, views] of groups) {
            const match = Object.entries(views).find(([, model]) => model === elementView.model);
            if (!match) continue;
            if (!this.sensorPreview) {
                this.sensorPreview = document.createElement('div');
                this.sensorPreview.className = 'sensor-preview';
                this.sensorPreview.setAttribute('role', 'tooltip');
                this.paperContainer.append(this.sensorPreview);
            }
            this.sensorPreviewSelection = { group, id: match[0], elementView };
            this.sensorPreview.hidden = false;
            this.updateSensorPreview();
        this.updateReadOnlyTelemetry();
            return;
        }
    }

    updateSensorPreview() {
        const selection = this.sensorPreviewSelection;
        if (!selection || !this.sensorPreview) return;
        const sensor = this.currentPlant?.[selection.group]?.find(item =>
            selection.group === 'levelSensors' ? item.tank === selection.id : item.id === selection.id);
        if (!sensor) { this.hideSensorPreview(); return; }
        const format = (value, digits, unit) => Number.isFinite(value) ? `${value.toFixed(digits).replace('.', ',')} ${unit}` : 'Sem leitura';
        const level = selection.group === 'levelSensors';
        this.sensorPreview.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = `${sensor.id} · ${level ? 'Sensor de nível' : 'Sensor de vazão'}`;
        const value = document.createElement('div');
        value.className = 'sensor-preview-value';
        value.textContent = level ? format(sensor.level, 1, '%') : format(sensor.flow, 2, 'L/min');
        const detail = document.createElement('div');
        detail.textContent = level ? `${componentLabel(sensor.tank)} · ${format(sensor.pressure, 2, 'kPa')}` : format(Number.isFinite(sensor.flow) ? sensor.flow / 60 : null, 4, 'L/s');
        this.sensorPreview.append(title, value, detail);
        if (this.currentRuntime.backendMode === 'HARDWARE') {
            const diagnostic = sensor.diagnostics ?? {};
            title.textContent = `${sensor.id} · ${sensor.source?.physical ?? 'origem desconhecida'} · ${sensor.source?.pin ?? '—'}`;
            const states = { available: 'Disponível', uncalibrated: 'Sem leitura', unavailable: 'Sem leitura', stale: 'Leitura desatualizada', invalid: 'Leitura inválida' };
            detail.textContent = `${sensor.reason ?? states[sensor.status] ?? sensor.status} · RAW ${Number.isFinite(sensor.raw) ? sensor.raw : '—'}`;
            if (level) {
                value.textContent = `Nível: ${format(sensor.heightCm, 2, 'cm')}`;
                detail.textContent = `RAW atual: ${Number.isFinite(sensor.raw) ? sensor.raw : '—'}${Number.isFinite(sensor.heightCm) ? '' : ` · ${sensor.reason ?? states[sensor.status] ?? 'Sem leitura'}`}`;
            }
            if (!level && sensor.status === 'uncalibrated' && Number.isFinite(diagnostic.rawFlow)) {
                value.textContent = format(diagnostic.rawFlow, 3, diagnostic.sourceUnit ?? 'unidade desconhecida');
                detail.textContent = 'Leitura recebida · conversão para L/min indisponível';
            } else if (!level) value.textContent = format(sensor.flow, 3, 'L/min');
            const diagnostics = document.createElement('div');
            const hardware = this.currentRuntime.hardware ?? {};
            if (level) {
                const filtered = document.createElement('div');
                const samples = hardware.capabilities?.pressureFilterSamples;
                const fresh = ['available', 'uncalibrated'].includes(sensor.status) && hardware.serial?.connected === true;
                filtered.textContent = `RAW filtrado${Number.isFinite(samples) ? ` (${samples})` : ''}: ${format(fresh ? diagnostic.filteredRaw : null, 1, '')}`;
                diagnostics.append(filtered);
                const row = document.createElement('div');
                const historical = !['available', 'uncalibrated'].includes(sensor.status) && diagnostic.rawMeanCount > 0;
                row.textContent = `RAW médio (${diagnostic.rawMeanCount ?? 0}/${diagnostic.rawMeanWindow ?? 10}): ${format(diagnostic.rawMean50, 1, '')}${historical ? ' · histórico, sem leitura atual' : ''}`;
                const adc = document.createElement('div');
                adc.textContent = `ADC médio estimado (5 V nominal): ${format(diagnostic.adcVoltageMean50, 3, 'V')}`;
                diagnostics.append(row, adc);
                const interval = hardware.capabilities?.pressureSampleIntervalMs;
                if (Number.isFinite(interval) && interval > 0) {
                    const sampling = document.createElement('div');
                    sampling.textContent = `Amostragem ADC: ${format(1000 / interval, 1, 'Hz')} (${format(interval, 0, 'ms')})`;
                    diagnostics.append(sampling);
                }
            }
            const fields = level
                ? []
                : [['Hz derivado entre polls', sensor.frequency, 3, 'Hz'], ['Pulsos acumulados', sensor.pulses, 0, '']];
            for (const [label, reading, digits, unit] of fields) {
                const row = document.createElement('div');
                row.textContent = `${label} ${Number.isFinite(reading) ? format(reading, digits, unit) : `— ${unit}`}`;
                diagnostics.append(row);
            }
            const poll = hardware.acquisition?.pollIntervalSeconds;
            if (Number.isFinite(poll) && poll > 0) {
                const updateRate = document.createElement('div');
                updateRate.textContent = `Atualização HMI: ~${format(1 / poll, 1, 'Hz')} (poll ${format(poll, 1, 's')})`;
                diagnostics.append(updateRate);
            }
            const extra = level
                ? {}
                : { rawFlow: 'Vazão recebida', sourceUnit: 'Unidade recebida', acquisitionMethod: 'Método de aquisição', deltaPulses: 'Delta de pulsos entre polls', deltaSeconds: 'Intervalo entre polls (s)', valid: 'Válido', stale: 'Stale' };
            for (const [key, label] of Object.entries(extra)) {
                const row = document.createElement('div');
                const reading = diagnostic[key];
                row.textContent = `${label}: ${reading == null ? '—' : typeof reading === 'boolean' ? (reading ? 'sim' : 'não') : typeof reading === 'number' ? format(reading, 3, '') : reading}`;
                diagnostics.append(row);
            }
            const api = document.createElement('div');
            api.textContent = `Índice API: ${sensor.source?.apiIndex ?? '—'}${!level && diagnostic.unit === 'L/s' ? ' · L/min = L/s × 60' : ''}`;
            if (!level) diagnostics.append(api);
            this.sensorPreview.append(diagnostics);
        }
        const bounds = this.paperContainer.getBoundingClientRect();
        const anchor = selection.elementView.el.getBoundingClientRect();
        const box = this.sensorPreview.getBoundingClientRect();
        let left = anchor.right - bounds.left + 12;
        if (left + box.width > bounds.width - 8) left = anchor.left - bounds.left - box.width - 12;
        this.sensorPreview.style.left = `${Math.max(8, left)}px`;
        this.sensorPreview.style.top = `${Math.max(8, Math.min(bounds.height - box.height - 8, anchor.top - bounds.top))}px`;
    }

    hideSensorPreview() {
        if (this.sensorPreview) this.sensorPreview.hidden = true;
        this.sensorPreviewSelection = null;
    }

    setDiagramHoverState(
        elementView,
        active
    ) {

        const selection =
            this.getInteractiveComponent(
                elementView.model
            );

        if (
            !selection
        ) {

            return;
        }

        elementView.el.classList.toggle(
            'scada-component-hover',
            active
        );

        elementView.el.classList.toggle(
            'scada-component-interactive',
            active
        );

        if (
            active
        ) {

            elementView.el.setAttribute(
                'aria-label',
                `${selection.id}: toque ou clique para ${selection.kind === 'sensor' ? 'visualizar' : 'ajustar'}`
            );
        } else {

            elementView.el.removeAttribute(
                'aria-label'
            );
        }
    }

    // CLIQUES NO DIAGRAMA

    bindPaperEvents() {

        // O arraste na área vazia inicia o pan.

        this.paper.on(
            'blank:pointerdown',
            event => {

                if (
                    this.eventComesFromComponentEditor(
                        event
                    )
                ) {

                    return;
                }

                this.closeComponentEditor();

                this.endElementGesture();

                this.beginViewportPan(
                    event
                );
            }
        );

        /* Clique curto abre o editor; arraste move a planta.
           A distinção evita acionar o componente durante a navegação. */

        this.paper.on(
            'element:pointerdown',
            (
                elementView,
                event
            ) => {

                this.beginElementGesture(
                    elementView,
                    event
                );
            }
        );

        this.handleViewportPointerMove =
            event => {

                if (
                    this.eventComesFromComponentEditor(
                        event
                    )
                ) {

                    this.endElementGesture();

                    return;
                }

                this.maybeStartElementPan(
                    event
                );

                this.moveViewportPan(
                    event
                );
            };

        this.handleViewportPointerUp =
            event => {
                const gesture = this.pendingElementGesture;
                // Usa a distância na tela, em vez da contagem de eventos mousemove do JointJS.
                const isClick = event.type === 'pointerup' && gesture &&
                    !this.viewportPanning &&
                    Math.hypot(event.clientX - gesture.clientX,
                        event.clientY - gesture.clientY) < this.elementPanThreshold;

                this.endViewportPan();
                this.endElementGesture();

                if (isClick) {
                    this.openComponentEditor(gesture.selection, event);
                }
            };

        window.addEventListener(
            'pointermove',
            this.handleViewportPointerMove
        );

        window.addEventListener(
            'pointerup',
            this.handleViewportPointerUp
        );

        window.addEventListener(
            'pointercancel',
            this.handleViewportPointerUp
        );

        // HOVER:
        /* somente componentes controláveis recebem destaque.
         */

        this.paper.on(
            'element:mouseenter',
            elementView => {

                this.showSensorPreview(elementView);

                this.setDiagramHoverState(
                    elementView,
                    true
                );
            }
        );

        this.paper.on(
            'element:mouseleave',
            elementView => {

                this.hideSensorPreview();

                this.setDiagramHoverState(
                    elementView,
                    false
                );
            }
        );

        // CLIQUE / TOQUE CURTO:
        /* abre o editor apenas se o gesto anterior NÃO virou pan.
         */

        this.handleComponentEditorKeyDown =
            event => {

                if (
                    event.key ===
                    'Escape'
                ) {

                    this.closeComponentEditor();
                }
            };

        window.addEventListener(
            'keydown',
            this.handleComponentEditorKeyDown
        );
    }

    // DESTRUIÇÃO

    destroy() {

        window.removeEventListener(
            'resize',
            this.handleResize
        );

        if (
            this.handleViewportPointerMove
        ) {

            window.removeEventListener(
                'pointermove',
                this.handleViewportPointerMove
            );
        }

        if (
            this.handleViewportPointerUp
        ) {

            window.removeEventListener(
                'pointerup',
                this.handleViewportPointerUp
            );

            window.removeEventListener(
                'pointercancel',
                this.handleViewportPointerUp
            );
        }

        if (
            this.handleComponentEditorKeyDown
        ) {

            window.removeEventListener(
                'keydown',
                this.handleComponentEditorKeyDown
            );
        }

        this.paperResizeObserver?.disconnect();
        this.componentEditorLayoutObserver?.disconnect();
        this.componentEditor
            ?.remove();

        this.paper.remove();

        this.graph.clear();
    }
}
