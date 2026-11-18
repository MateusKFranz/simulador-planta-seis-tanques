import asyncio
from contextlib import suppress
from common.instrument_ids import LEVEL_IDS, FLOW_CHANNEL_IDS

import json
import math
import os
import time

import websockets

from hardware.serial_bridge import SerialBridge
from hardware.dequi_hardware import DequiHardware
from hardware.hardware_control import ManualHardware, PUMP_CHANNELS
from hardware.hardware_config import LEVEL_CALIBRATION, RAW_MEAN_WINDOW
from pathlib import Path
from hardware.level_zero import LevelZeroCalibration
level_zero = LevelZeroCalibration(Path(os.environ.get('SIX_TANK_LEVEL_ZERO_FILE', Path(__file__).resolve().parent.parent / 'data' / 'level-zero.json')))
dequi_hardware = ManualHardware()
hardware_operation = None

def get_hardware_operation():
    global hardware_operation
    from hardware.hardware_operation import HardwareOperation
    if hardware_operation is None or hardware_operation.control is not dequi_hardware:
        hardware_operation = HardwareOperation(state, dequi_hardware)
    return hardware_operation

from hardware.hardware_config import ADC_MAX, ADC_REFERENCE_V, LT_CALIBRATION, FT_ANALOG_CALIBRATION, TELEMETRY_TIMEOUT_S
from hardware.hardware_config import LT_PRESSURE_CALIBRATION, WATER_DENSITY_KG_M3, GRAVITY_M_S2
from hardware.hardware_config import LT_CHANNELS, FT_CHANNELS, TANK_GEOMETRY
last_telemetry_time = None
last_telemetry_received_at = None
telemetry_valid = False


# CONFIGURAÇÃO DO SERVIDOR
HOST = "localhost"
PORT = int(os.getenv("SIX_TANK_WS_PORT", "8765"))

# MOCK permite executar o backend sem bancada ou FMUs.
BACKEND_MODE = os.getenv(
    "SIX_TANK_MODE",
    "MOCK"
).strip().upper()

SERIAL_PORT = os.getenv(
    "SIX_TANK_SERIAL_PORT",
    "COM3"
).strip()

SERIAL_BAUD = int(
    os.getenv(
        "SIX_TANK_SERIAL_BAUD",
        "115200"
    )
)

if BACKEND_MODE not in {
    "MOCK",
    "MODELICA",
    "HARDWARE"
}:
    raise ValueError(
        "SIX_TANK_MODE deve ser MOCK, MODELICA ou HARDWARE."
    )

clients = set()
serial_bridge = None
modelica_runtime = None
last_synced_serial_connection_id = 0


# PARÂMETROS DO MOCK
# Valores de teste; não representam a calibração da bancada.
TANK_CAPACITY_L = 2.0

TANK_MAX_HEIGHT_M = 0.45

# Vazão máxima aproximada usada no mock.

JIC1_MAX_FLOW_L_MIN = 3.0

JIC3_MAX_FLOW_L_MIN = 2.0

JIC4_MAX_FLOW_L_MIN = 2.0


# Vazão gravitacional máxima TQ5 -> TQ3 e TQ6 -> TQ4.

GRAVITY_MAX_FLOW_L_MIN = 0.70


# Vazão máxima de descarga de TQ1 e TQ2.

DRAIN_MAX_FLOW_L_MIN = 0.55


# ESTADO DO MOCK
state = {

    "tanks": {

        "TQ1": {
            "level": 20.0,
            "height": 0.0,
            "volume": 0.0
        },

        "TQ2": {
            "level": 25.0,
            "height": 0.0,
            "volume": 0.0
        },

        "TQ3": {
            "level": 30.0,
            "height": 0.0,
            "volume": 0.0
        },

        "TQ4": {
            "level": 35.0,
            "height": 0.0,
            "volume": 0.0
        },

        "TQ5": {
            "level": 40.0,
            "height": 0.0,
            "volume": 0.0
        },

        "TQ6": {
            "level": 45.0,
            "height": 0.0,
            "volume": 0.0
        },
    },

    "levelSensors": {

        "LI1": {
            "level": 20.0,
            "pressure": 0.0,
            "voltage": 0.0,
            "raw": 0
        },

        "LI2": {
            "level": 25.0,
            "pressure": 0.0,
            "voltage": 0.0,
            "raw": 0
        },

        "LI3": {
            "level": 30.0,
            "pressure": 0.0,
            "voltage": 0.0,
            "raw": 0
        },

        "LI4": {
            "level": 35.0,
            "pressure": 0.0,
            "voltage": 0.0,
            "raw": 0
        },

        "LI5": {
            "level": 40.0,
            "pressure": 0.0,
            "voltage": 0.0,
            "raw": 0
        },

        "LI6": {
            "level": 45.0,
            "pressure": 0.0,
            "voltage": 0.0,
            "raw": 0
        },
    },

    "flowSensors": {

        "FI5": {
            "flow": 0.0
        },

        "FI6": {
            "flow": 0.0
        },

        "FI1": {
            "flow": 0.0
        },

        "FI3": {
            "flow": 0.0
        },

        "FI4": {
            "flow": 0.0
        },

        "FI2": {
            "flow": 0.0
        },
    },

    "pumps": {

        "JIC3": {
            "power": False,
            "command": 1.0
        },

        "JIC4": {
            "power": False,
            "command": 1.0
        },

        "JIC1": {
            "power": False,
            "command": 1.0
        },
    },

    "mainValve": {
        "id": "HV9",

        "opening": 1.0
    },

    "actuatedValves": {

        "LV1": {
            "opening": 1.0
        },

        "LV2": {
            "opening": 1.0
        },

        "LV3": {
            "opening": 1.0
        },

        "LV4": {
            "opening": 1.0
        },
    },

    "recycleValves": {

        "HV7": {
            "opening": 1.0
        },

        "HV8": {
            "opening": 1.0
        },
    },

    "manualValves": {

        "HV5": {
            "opening": 1.0
        },

        "HV6": {
            "opening": 1.0
        },

        "HV3": {
            "opening": 1.0
        },

        "HV4": {
            "opening": 1.0
        },

        "HV1": {
            "opening": 1.0
        },

        "HV2": {
            "opening": 1.0
        },
    },

    "threeWayValves": {

        "OY1_A": {
            "state": False
        },

        "OY1_B": {
            "state": False
        },

        "OY2_A": {
            "state": False
        },

        "OY2_B": {
            "state": False
        },
    },

    # Vazões por trecho usadas apenas para animação/diagnóstico da HMI.
    "flows": {},
    "mode": BACKEND_MODE,
}


# AUXILIARES
def clamp(
    value,
    minimum=0.0,
    maximum=1.0
):

    return max(
        minimum,
        min(
            maximum,
            value
        )
    )


def clamp_level(
    level
):

    return max(
        0.0,
        min(
            100.0,
            level
        )
    )


def public_state():
    """Agrupa os ramos A/B sob os dois equipamentos de três vias."""
    snapshot = dict(state)
    if hardware_mode():
        connected = serial_bridge is not None and serial_bridge.connected
        age = None if last_telemetry_time is None else max(0, time.monotonic() - last_telemetry_time)
        snapshot["hardware"] = {
            **dequi_hardware.snapshot(),
            "serial": {"connected": connected, "open": connected,
                       "port": serial_bridge.port if serial_bridge else SERIAL_PORT,
                       "baud": serial_bridge.baud if serial_bridge else SERIAL_BAUD},
            "telemetry": {"status": "receiving" if connected and telemetry_valid and age is not None and age <= TELEMETRY_TIMEOUT_S
                          else "expired" if age is not None else "absent",
                          "lastReceivedAt": last_telemetry_received_at, "ageSeconds": age},
            "geometry": TANK_GEOMETRY,
        }
    snapshot["threeWayValves"] = {
        equipment: {"branches": {
            branch: dict(state["threeWayValves"][f"{equipment}_{branch}"])
            for branch in ("A", "B")
        }} for equipment in ("OY1", "OY2")
    }
    if hardware_mode():
        for group, fields in (("pumps", ("power", "command")), ("actuatedValves", ("opening",)),
                              ("manualValves", ("opening",)), ("recycleValves", ("opening",))):
            snapshot[group] = {key: {**item, **dict.fromkeys(fields)} for key, item in state[group].items()}
        snapshot["mainValve"] = {**state["mainValve"], "opening": None}
        snapshot["threeWayValves"] = {id: {"branches": {branch: {"state": None} for branch in ("A", "B")}}
                                    for id in ("OY1", "OY2")}
        control = snapshot["hardware"].get("control", {})
        confirmed = control.get("confirmed") if connected else None
        if confirmed:
            for tag, index in PUMP_CHANNELS.items():
                pwm, forward = confirmed["pumps"][index-1]
                snapshot["pumps"][tag].update(power=int(pwm > 0), command=pwm/255,
                    pwm=pwm, status="available", confirmedAt=control["confirmedAt"])
            for row in confirmed["valves"]:
                lv, configured, percent, angle = row[:4]
                if configured:
                    snapshot["actuatedValves"][f"LV{lv}"].update(opening=percent/100 if percent >= 0 else None,
                        angle=angle if angle >= 0 else None, targetAngle=row[4], synced=bool(row[5]),
                        pulsing=bool(row[6]), ramping=bool(row[7]), targetPercent=row[12],
                        status="available", confirmedAt=control["confirmedAt"])
            for i, oy in enumerate(("OY1", "OY2")):
                snapshot["threeWayValves"][oy] = {"branches": {b: {"state": confirmed["oy"][i] == n} for b,n in (("A",1),("B",2))}}
        snapshot.update(get_hardware_operation().snapshot())
    return snapshot


async def send_json(
    websocket,
    data
):

    if data.get("type") == "state" and data.get("data") is state:
        data = {**data, "data": public_state()}
    await websocket.send(
        json.dumps(
            data
        )
    )


# No MOCK, JIC1 divide a vazão proporcionalmente às aberturas de LV1/LV2.
def split_flow(
    total_flow,
    opening_a,
    opening_b
):

    opening_a = clamp(
        opening_a
    )

    opening_b = clamp(
        opening_b
    )

    total_opening = (
        opening_a +
        opening_b
    )

    if (
        total_opening <=
        0.0
    ):

        return (
            0.0,
            0.0
        )

    flow_a = (
        total_flow *
        opening_a /
        total_opening
    )

    flow_b = (
        total_flow *
        opening_b /
        total_opening
    )

    return (
        flow_a,
        flow_b
    )


# DIVISÃO OY1 / OY2
#
# No MOCK:
#
# somente A ligada -> 100 % para A
# somente B ligada -> 100 % para B
# A e B ligadas   -> 50 / 50
# ambas desligadas -> vazão zero
def split_relay_flow(
    total_flow,
    state_a,
    state_b
):

    if (
        state_a and
        state_b
    ):

        return (
            total_flow / 2.0,
            total_flow / 2.0
        )

    if (
        state_a
    ):

        return (
            total_flow,
            0.0
        )

    if (
        state_b
    ):

        return (
            0.0,
            total_flow
        )

    return (
        0.0,
        0.0
    )


# CONVERSÃO DE VAZÃO PARA VARIAÇÃO DO NÍVEL
#
# flow = L/min
# dt   = segundos
#
# Retorna variação percentual do tanque.
def flow_to_level_change(
    flow_l_min,
    dt
):

    volume_change_l = (
        flow_l_min *
        dt /
        60.0
    )

    fraction = (
        volume_change_l /
        TANK_CAPACITY_L
    )

    return (
        fraction *
        100.0
    )


# No MOCK, estima pressão e tensão do MPX5010 a partir do nível e da altura útil.
def update_level_sensors():

    rho = 1000.0

    gravity = 9.81

    supply_voltage = 5.0

    for index in range(
        1,
        7
    ):

        tank_id = (
            f"TQ{index}"
        )

        sensor_id = (
            LEVEL_IDS[index - 1]
        )

        tank = (
            state["tanks"][tank_id]
        )

        sensor = (
            state["levelSensors"][sensor_id]
        )

        level = clamp_level(
            tank["level"]
        )

        level_fraction = (
            level /
            100.0
        )

        height = (
            level_fraction *
            TANK_MAX_HEIGHT_M
        )

        volume = (
            level_fraction *
            TANK_CAPACITY_L
        )

        pressure_pa = (
            rho *
            gravity *
            height
        )

        pressure_kpa = (
            pressure_pa /
            1000.0
        )

        # MPX5010:
        #
        # Vout = Vs * (0.09 * P + 0.04)

        voltage = (
            supply_voltage *
            (
                0.09 *
                pressure_kpa +
                0.04
            )
        )

        voltage = max(
            0.0,
            min(
                supply_voltage,
                voltage
            )
        )

        raw = int(
            round(
                voltage /
                supply_voltage *
                1023
            )
        )

        tank["level"] = (
            level
        )

        tank["height"] = (
            height
        )

        tank["volume"] = (
            volume
        )

        sensor["level"] = (
            level
        )

        sensor["pressure"] = (
            pressure_kpa
        )

        sensor["voltage"] = (
            voltage
        )

        sensor["raw"] = (
            raw
        )


# HARDWARE / SERIAL
def hardware_mode():
    return BACKEND_MODE == "HARDWARE"


def apply_hardware_telemetry(values, *, received=True):
    """Cada frame é um snapshot: campo ausente/null nunca reaproveita leitura antiga."""
    global last_telemetry_time, last_telemetry_received_at, telemetry_valid
    telemetry_valid = received and bool(values)
    if received and values:
        last_telemetry_time = time.monotonic()
        last_telemetry_received_at = time.time() * 1000
    for index in range(1, 7):
        sid = LEVEL_IDS[index - 1]
        origin = LT_CHANNELS[sid]
        raw = values.get(f"{origin['physical']}_RAW")
        raw = raw if isinstance(raw, (int, float)) and math.isfinite(raw) and 0 <= raw <= ADC_MAX else None
        calibration = LT_CALIBRATION[sid]
        level = None
        voltage = raw/ADC_MAX*ADC_REFERENCE_V if raw is not None and ADC_REFERENCE_V else None
        pressure = None
        height = None
        geometry = TANK_GEOMETRY[f"TQ{index}"]
        height_max = geometry["heightM"]
        capacity = geometry["capacityL"]
        pressure_calibration = LT_PRESSURE_CALIBRATION[sid]
        if voltage is not None and pressure_calibration and pressure_calibration[1] > 0:
            pressure = max(0, (voltage-pressure_calibration[0])/pressure_calibration[1])
            height = pressure*1000/(WATER_DENSITY_KG_M3*GRAVITY_M_S2)
            level = clamp_level(height/height_max*100) if height_max and height_max > 0 else None
        if raw is not None and calibration and calibration[1] > calibration[0]:
            level = clamp_level((raw-calibration[0])/(calibration[1]-calibration[0])*100)
        if height is None and level is not None and height_max and height_max > 0:
            height = level / 100 * height_max
        state["levelSensors"][sid].update(raw=raw,
            source=dict(origin), heightCm=height * 100 if height is not None else None,
            voltage=voltage,
            pressure=pressure, level=level,
            status="available" if level is not None or pressure is not None else "uncalibrated" if raw is not None else "unavailable")
        state["tanks"][f"TQ{index}"].update(level=level,
            height=height, heightCm=height * 100 if height is not None else None,
            volume=level/100*capacity if level is not None and capacity and capacity > 0 else None)
        sid = FLOW_CHANNEL_IDS[index - 1]
        origin = FT_CHANNELS[sid]
        channel = origin["physical"]
        raw = values.get(f"{channel}_RAW")
        raw = raw if isinstance(raw, (int, float)) and math.isfinite(raw) and 0 <= raw <= ADC_MAX else None
        flow = values.get(channel)
        calibration = FT_ANALOG_CALIBRATION[sid]
        if flow is None and raw is not None and calibration:
            zero, reference, reference_flow = calibration
            if reference > zero and reference_flow > 0:
                flow = max(0, (raw-zero)/(reference-zero)*reference_flow)
        flow = flow if isinstance(flow, (int, float)) and math.isfinite(flow) and flow >= 0 else None
        hz = values.get(f"{channel}_HZ")
        hz = hz if isinstance(hz, (int, float)) and math.isfinite(hz) and hz >= 0 else None
        pulses = values.get(f"{channel}_PULSES")
        pulses = pulses if isinstance(pulses, (int, float)) and math.isfinite(pulses) and pulses >= 0 and pulses == int(pulses) else None
        state["flowSensors"][sid].update(flow=flow, raw=raw, frequency=hz, pulses=pulses, source=dict(origin),
            status="available" if flow is not None else "uncalibrated" if raw is not None or hz is not None or pulses is not None else "unavailable")
    update_hardware_visual_flows()



def update_hardware_visual_flows():
    """Monta animacao a partir dos FT reais disponiveis."""

    ft1 = state["flowSensors"]["FI5"]["flow"]
    ft2 = state["flowSensors"]["FI6"]["flow"]
    ft3 = state["flowSensors"]["FI1"]["flow"]
    ft4 = state["flowSensors"]["FI3"]["flow"]
    ft5 = state["flowSensors"]["FI4"]["flow"]
    ft6 = state["flowSensors"]["FI2"]["flow"]

    # Sem reconstrução topológica: somente trechos dos instrumentos diretos.
    branch_x1 = None
    branch_x2 = None
    central_flow = None

    state["flows"] = {
        "RES_JIC1": central_flow,
        "JIC1_HV9": central_flow,
        "HV9_LV1": ft3,
        "HV9_LV2": ft6,
        "LV1_OY1_A": None,
        "OY1_A_OUT": None,
        "OY1_A_TQ3": None,
        "LV1_OY1_B": None,
        "OY1_B_FI6": ft2,
        "FI6_TQ6": ft2,
        "LV2_OY2_A": None,
        "OY2_A_FI5": ft1,
        "FI5_TQ5": ft1,
        "LV2_OY2_B": None,
        "OY2_B_OUT": None,
        "OY2_B_TQ4": None,
        "JIC3_LV3": ft4,
        "LV3_FI3": ft4,
        "FI3_TQ1": ft4,
        "JIC4_LV4": ft5,
        "LV4_FI4": ft5,
        "FI4_TQ2": ft5,

        # Estes trechos nao possuem FT proprio confirmado.
        # Nao inventamos vazao no modo HARDWARE.
        "TQ5_HV5": None,
        "HV5_TQ3": None,
        "JIC3_HV7": None,
        "HV7_TQ3": None,
        "TQ3_HV3": None,
        "HV3_JIC3": None,
        "TQ6_HV6": None,
        "HV6_TQ4": None,
        "JIC4_HV8": None,
        "HV8_TQ4": None,
        "TQ4_HV4": None,
        "HV4_JIC4": None,
        "TQ1_HV1": None,
        "HV1_RES": None,
        "TQ2_HV2": None,
        "HV2_RES": None
    }


def process_serial_events():
    global last_synced_serial_connection_id

    if serial_bridge is None:
        return

    for event in serial_bridge.poll_events():
        event_type = event.get("type")

        if event_type == "serial_connected":
            dequi_hardware.reset()
            print(
                f"[SERIAL] Conectado em {event['port']} "
                f"@ {event['baud']} baud."
            )

            connection_id = event.get(
                "connection_id",
                0
            )

            if connection_id != last_synced_serial_connection_id:
                last_synced_serial_connection_id = connection_id
                apply_hardware_telemetry({}, received=False)

            continue

        if event_type == "serial_disconnected":
            dequi_hardware.reset()
            apply_hardware_telemetry({}, received=False)
            print("[SERIAL] Arduino desconectado; tentando reconectar...")
            continue

        if event_type == "serial_error":
            dequi_hardware.reset()
            print(
                "[SERIAL] Erro:",
                event.get("message", "")
            )
            continue

        if event_type == "arduino_hello":
            print(
                "[ARDUINO]",
                event.get("board"),
                event.get("application"),
                f"protocolo={event.get('protocol')}"
            )
            continue

        if event_type == "arduino_ack":
            print(
                "[ARDUINO ACK]",
                ",".join(event.get("command", []))
            )
            continue

        if event_type == "arduino_error":
            print(
                "[ARDUINO ERRO]",
                event.get("message", "")
            )
            continue

        if event_type == "dequi":
            dequi_hardware.handle(event)
            continue

        if event_type == "telemetry":
            # Parser legado isolado; HARDWARE adquire exclusivamente pela API DEQUI.
            continue

        if event_type == "serial_line":
            # Linhas intermediárias VERBOSE não repetem o prefixo @id.
            dequi_hardware.handle({"kind": "text", "body": event.get("line", "")})


def apply_dequi_readings():
    global last_telemetry_time, last_telemetry_received_at, telemetry_valid
    readings = dequi_hardware.readings()
    values = {}
    for tag, sample in readings.items():
        channel = sample["source"]["physical"]
        if sample["status"] not in {"available", "uncalibrated"}:
            continue
        if channel.startswith("LT"):
            values[f"{channel}_RAW"] = sample.get("raw")
        else:
            values[channel] = sample.get("flow")
            values[f"{channel}_PULSES"] = sample.get("pulses")
            values[f"{channel}_HZ"] = sample.get("frequency")
    apply_hardware_telemetry(values, received=False)
    for group in ("levelSensors", "flowSensors"):
        for tag, sensor in state[group].items():
            sample = readings.get(tag, {})
            sensor["diagnostics"] = {k: v for k, v in sample.items() if k not in {"source", "status"}}
            if group == "levelSensors":
                for field, default in (("rawMean50", None), ("rawMeanCount", 0), ("adcVoltageMean50", None)):
                    sensor["diagnostics"][field] = sample.get(field, default)
            sensor["source"] = sample.get("source", sensor["source"])
            if group == "levelSensors" and sample.get("voltageSource") == "adc_nominal_5V":
                # Diagnóstico elétrico separado da conversão pressão/nível.
                sensor["voltage"] = sample.get("voltage") if sample.get("status") == "uncalibrated" else None
            # Valores inválidos/stale ficam nos diagnósticos, não na medição atual.
            if sample.get("status") not in {"available", "uncalibrated"}:
                sensor["status"] = sample.get("status", "unavailable")
            sensor["reason"] = "Não fornecido pelo firmware" if tag not in readings else None
            if group == "levelSensors":
                calibration = level_zero.parameters(tag) if tag in LEVEL_CALIBRATION else None
                if calibration:
                    sensor["diagnostics"].update(level_zero.info(tag))
                mean = sample.get("rawMean50")
                height_cm = None
                if (calibration and sample.get("status") == "uncalibrated"
                        and sample.get("rawMeanCount", 0) > 0
                        and isinstance(mean, (int, float)) and math.isfinite(mean)):
                    height_cm = max(0.0, calibration["slope"] * (mean-calibration["offset_raw"]) + calibration["offset"])
                tank_id = f"TQ{LEVEL_IDS.index(tag)+1}"
                sensor.update(heightCm=height_cm, level=None, pressure=None)
                if height_cm is not None:
                    sensor["status"] = "available"
                state["tanks"][tank_id].update(heightCm=height_cm,
                    height=height_cm/100 if height_cm is not None else None, level=None, volume=None)
    last_telemetry_time = dequi_hardware.last_success
    last_telemetry_received_at = dequi_hardware.last_success_at
    telemetry_valid = dequi_hardware.snapshot()["acquisition"]["active"]


# COMANDOS RECEBIDOS DA HMI
def handle_level_zero(message):
    result = {"type": "level_zero_result", "requestId": message.get("requestId"), "id": message.get("id"), "success": False}
    try:
        if not hardware_mode():
            raise ValueError("Calibração de zero disponível somente em HARDWARE.")
        sensor, action = message.get("id"), message.get("action")
        if sensor not in LEVEL_CALIBRATION or action not in {"calibrate", "restore"}:
            raise ValueError("Sensor ou ação de calibração inválidos.")
        if action == "calibrate":
            raw = message.get("rawMean50")
            level_zero.validate(sensor, raw)
            sample = dequi_hardware.readings().get(sensor, {})
            mean = sample.get("rawMean50")
            if (not serial_bridge or not serial_bridge.connected
                    or sample.get("status") not in {"available", "uncalibrated"}
                    or sample.get("valid") is not True or sample.get("stale") is not False
                    or sample.get("outOfRange", False) or sample.get("rawMeanCount", 0) < RAW_MEAN_WINDOW):
                raise ValueError("Leitura ausente, inválida ou desatualizada; calibração recusada.")
            # O RAW enviado pela HMI e um snapshot capturado no clique em
            # 'Calibrar 0 cm'. A media ao vivo pode mudar naturalmente entre
            # o clique e a confirmacao; isso nao invalida a amostra capturada.
            level_zero.validate(sensor, mean)
            level_zero.save(sensor, raw)
            raw_label = f"{raw:g}".replace(".", ",")
            result["message"] = f"Zero de {sensor} calibrado com RAW médio {raw_label}."
        else:
            level_zero.save(sensor, restore=True)
            result["message"] = f"Calibração de zero de {sensor} restaurada."
        apply_dequi_readings()
        result.update(success=True, calibration=level_zero.info(sensor))
    except (ValueError, TypeError, OSError) as error:
        result["message"] = str(error)
    return result


def handle_command(
    message, owner=None
):
    if hardware_mode():
        return isinstance(dequi_hardware, ManualHardware) and get_hardware_operation().handle(message, serial_bridge, owner)
    if modelica_mode():
        return modelica_runtime is not None and modelica_runtime.handle_command(message)

    if message.get("type") == "relay":
        equipment, branch = message.get("id"), message.get("branch")
        if equipment not in ("OY1", "OY2") or branch not in ("A", "B"):
            return False
        message = {**message, "id": f"{equipment}_{branch}"}

    message_type = (
        message.get(
            "type"
        )
    )


    # HELLO
    if (
        message_type ==
        "hello"
    ):

        print(
            "[HMI] cliente identificado:",
            message
        )

        return


    # BOMBA
    if (
        message_type ==
        "pump"
    ):

        pump_id = (
            message.get(
                "id"
            )
        )

        if (
            pump_id not in
            state["pumps"]
        ):

            return

        pump = (
            state["pumps"][pump_id]
        )

        if (
            "power" in
            message
        ):

            pump["power"] = bool(
                message["power"]
            )

        if (
            "command" in
            message
        ):

            pump["command"] = clamp(
                float(
                    message["command"]
                )
            )

        print(
            f"[COMANDO] {pump_id}: "
            f"power={pump['power']} "
            f"command={pump['command']:.2f}"
        )

        return


    # VÁLVULA
    if (
        message_type ==
        "valve"
    ):

        valve_id = (
            message.get(
                "id"
            )
        )

        opening = clamp(
            float(
                message.get(
                    "opening",
                    0.0
                )
            )
        )

        if (
            valve_id ==
            "HV9"
        ):

            state[
                "mainValve"
            ][
                "opening"
            ] = opening

        elif (
            valve_id in
            state[
                "actuatedValves"
            ]
        ):

            state[
                "actuatedValves"
            ][
                valve_id
            ][
                "opening"
            ] = opening

        else:

            return

        print(
            f"[COMANDO] {valve_id}: "
            f"opening={opening:.2f}"
        )

        return


    # VÁLVULA MANUAL / RECIRCULAÇÃO
    #
    # Estas válvulas não são atuadas eletricamente.
    # A HMI apenas informa ao backend a posição declarada
    # pelo operador para que o mock hidráulico use esse valor.
    if (
        message_type ==
        "manual_valve"
    ):

        valve_id = (
            message.get(
                "id"
            )
        )

        opening = clamp(
            float(
                message.get(
                    "opening",
                    0.0
                )
            )
        )

        if (
            valve_id in
            state[
                "recycleValves"
            ]
        ):

            state[
                "recycleValves"
            ][
                valve_id
            ][
                "opening"
            ] = opening

        elif (
            valve_id in
            state[
                "manualValves"
            ]
        ):

            state[
                "manualValves"
            ][
                valve_id
            ][
                "opening"
            ] = opening

        else:

            return

        print(
            f"[MANUAL] {valve_id}: "
            f"opening={opening:.2f}"
        )

        return


    # RELÉ
    if (
        message_type ==
        "relay"
    ):

        relay_id = (
            message.get(
                "id"
            )
        )

        if (
            relay_id not in
            state[
                "threeWayValves"
            ]
        ):

            return

        relay_state = bool(
            message.get(
                "state",
                False
            )
        )

        state[
            "threeWayValves"
        ][
            relay_id
        ][
            "state"
        ] = relay_state

        print(
            f"[COMANDO] {relay_id}: "
            f"state={relay_state}"
        )

        return


    print(
        "[AVISO] comando desconhecido:",
        message
    )


# MODELO HIDRÁULICO SIMPLIFICADO
def update_mock_plant(
    dt
):

    # NÍVEIS ATUAIS
    h1 = state["tanks"]["TQ1"]["level"]
    h2 = state["tanks"]["TQ2"]["level"]
    h3 = state["tanks"]["TQ3"]["level"]
    h4 = state["tanks"]["TQ4"]["level"]
    h5 = state["tanks"]["TQ5"]["level"]
    h6 = state["tanks"]["TQ6"]["level"]


    # JIC1
    #
    # Reservatório -> JIC1 -> HV9
    p3 = (
        state["pumps"]["JIC1"]
    )

    if (
        p3["power"]
    ):

        p3_flow = (
            JIC1_MAX_FLOW_L_MIN *
            p3["command"]
        )

    else:

        p3_flow = (
            0.0
        )

    p3_flow *= (
        state[
            "mainValve"
        ][
            "opening"
        ]
    )


    # DIVISÃO LV1 / LV2
    v1_opening = (
        state[
            "actuatedValves"
        ][
            "LV1"
        ][
            "opening"
        ]
    )

    v2_opening = (
        state[
            "actuatedValves"
        ][
            "LV2"
        ][
            "opening"
        ]
    )

    (
        v1_flow,
        v2_flow
    ) = split_flow(
        p3_flow,
        v1_opening,
        v2_opening
    )


    # OY1
    #
    # OY1_A -> FI1 -> TQ3
    # OY1_B -> FI6 -> TQ6
    x1a = (
        state[
            "threeWayValves"
        ][
            "OY1_A"
        ][
            "state"
        ]
    )

    x1b = (
        state[
            "threeWayValves"
        ][
            "OY1_B"
        ][
            "state"
        ]
    )

    (
        ft3,
        ft2
    ) = split_relay_flow(
        v1_flow,
        x1a,
        x1b
    )


    # OY2
    #
    # OY2_A -> FI5 -> TQ5
    # OY2_B -> FI2 -> TQ4
    x2a = (
        state[
            "threeWayValves"
        ][
            "OY2_A"
        ][
            "state"
        ]
    )

    x2b = (
        state[
            "threeWayValves"
        ][
            "OY2_B"
        ][
            "state"
        ]
    )

    (
        ft1,
        ft6
    ) = split_relay_flow(
        v2_flow,
        x2a,
        x2b
    )


    # GRAVIDADE
    #
    # TQ5 -> TQ3
    # TQ6 -> TQ4
    #
    # Usamos sqrt(nível), inspirado na relação de Torricelli,
    # mas ainda sem parâmetros físicos calibrados.
    hv3_in = (
        state[
            "manualValves"
        ][
            "HV5"
        ][
            "opening"
        ]
    )

    hv4_in = (
        state[
            "manualValves"
        ][
            "HV6"
        ][
            "opening"
        ]
    )

    gravity_h5_h3 = (
        GRAVITY_MAX_FLOW_L_MIN *
        math.sqrt(
            max(
                h5,
                0.0
            ) /
            100.0
        ) *
        hv3_in
    )

    gravity_h6_h4 = (
        GRAVITY_MAX_FLOW_L_MIN *
        math.sqrt(
            max(
                h6,
                0.0
            ) /
            100.0
        ) *
        hv4_in
    )


    # JIC3
    #
    # TQ3 -> JIC3
    #
    # divide entre:
    #
    # LV3  -> FI3 -> TQ1
    # HV7 -> retorno para TQ3
    p1 = (
        state["pumps"]["JIC3"]
    )

    hv3_p1 = (
        state[
            "manualValves"
        ][
            "HV3"
        ][
            "opening"
        ]
    )

    if (
        p1["power"] and
        h3 > 0.0
    ):

        p1_total_flow = (
            JIC3_MAX_FLOW_L_MIN *
            p1["command"] *
            hv3_p1
        )

    else:

        p1_total_flow = (
            0.0
        )

    v3_opening = (
        state[
            "actuatedValves"
        ][
            "LV3"
        ][
            "opening"
        ]
    )

    rv1_opening = (
        state[
            "recycleValves"
        ][
            "HV7"
        ][
            "opening"
        ]
    )

    # Nova inspeção física:
    # HV7 retorna diretamente para TQ3 por uma entrada própria.
    # Portanto HV5 NÃO limita a recirculação.
    rv1_effective_opening = (
        rv1_opening
    )

    (
        ft4,
        p1_recycle
    ) = split_flow(
        p1_total_flow,
        v3_opening,
        rv1_effective_opening
    )

    actual_p1_flow = (
        ft4 +
        p1_recycle
    )


    # JIC4
    #
    # TQ4 -> JIC4
    #
    # divide entre:
    #
    # LV4  -> FI4 -> TQ2
    # HV8 -> retorno para TQ4
    p2 = (
        state["pumps"]["JIC4"]
    )

    hv4_p2 = (
        state[
            "manualValves"
        ][
            "HV4"
        ][
            "opening"
        ]
    )

    if (
        p2["power"] and
        h4 > 0.0
    ):

        p2_total_flow = (
            JIC4_MAX_FLOW_L_MIN *
            p2["command"] *
            hv4_p2
        )

    else:

        p2_total_flow = (
            0.0
        )

    v4_opening = (
        state[
            "actuatedValves"
        ][
            "LV4"
        ][
            "opening"
        ]
    )

    rv2_opening = (
        state[
            "recycleValves"
        ][
            "HV8"
        ][
            "opening"
        ]
    )

    # No MOCK, HV8 retorna diretamente para TQ4, sem limitação por HV6.
    rv2_effective_opening = (
        rv2_opening
    )

    (
        ft5,
        p2_recycle
    ) = split_flow(
        p2_total_flow,
        v4_opening,
        rv2_effective_opening
    )

    actual_p2_flow = (
        ft5 +
        p2_recycle
    )


    # DRENAGEM TQ1 / TQ2
    hv1_drain = (
        state[
            "manualValves"
        ][
            "HV1"
        ][
            "opening"
        ]
    )

    hv2_drain = (
        state[
            "manualValves"
        ][
            "HV2"
        ][
            "opening"
        ]
    )

    drain_h1 = (
        DRAIN_MAX_FLOW_L_MIN *
        math.sqrt(
            max(
                h1,
                0.0
            ) /
            100.0
        ) *
        hv1_drain
    )

    drain_h2 = (
        DRAIN_MAX_FLOW_L_MIN *
        math.sqrt(
            max(
                h2,
                0.0
            ) /
            100.0
        ) *
        hv2_drain
    )


    # BALANÇO DE VAZÃO
    #
    # positivo = entra no tanque
    # negativo = sai do tanque
    net_h1 = (
        ft4 -
        drain_h1
    )

    net_h2 = (
        ft5 -
        drain_h2
    )

    net_h3 = (
        ft3 +
        gravity_h5_h3 +
        p1_recycle -
        actual_p1_flow
    )

    net_h4 = (
        ft6 +
        gravity_h6_h4 +
        p2_recycle -
        actual_p2_flow
    )

    net_h5 = (
        ft1 -
        gravity_h5_h3
    )

    net_h6 = (
        ft2 -
        gravity_h6_h4
    )


    # ATUALIZA NÍVEIS
    state["tanks"]["TQ1"]["level"] = (
        clamp_level(
            h1 +
            flow_to_level_change(
                net_h1,
                dt
            )
        )
    )

    state["tanks"]["TQ2"]["level"] = (
        clamp_level(
            h2 +
            flow_to_level_change(
                net_h2,
                dt
            )
        )
    )

    state["tanks"]["TQ3"]["level"] = (
        clamp_level(
            h3 +
            flow_to_level_change(
                net_h3,
                dt
            )
        )
    )

    state["tanks"]["TQ4"]["level"] = (
        clamp_level(
            h4 +
            flow_to_level_change(
                net_h4,
                dt
            )
        )
    )

    state["tanks"]["TQ5"]["level"] = (
        clamp_level(
            h5 +
            flow_to_level_change(
                net_h5,
                dt
            )
        )
    )

    state["tanks"]["TQ6"]["level"] = (
        clamp_level(
            h6 +
            flow_to_level_change(
                net_h6,
                dt
            )
        )
    )


    # ATUALIZA SENSORES FT
    state[
        "flowSensors"
    ][
        "FI5"
    ][
        "flow"
    ] = ft1

    state[
        "flowSensors"
    ][
        "FI6"
    ][
        "flow"
    ] = ft2

    state[
        "flowSensors"
    ][
        "FI1"
    ][
        "flow"
    ] = ft3

    state[
        "flowSensors"
    ][
        "FI3"
    ][
        "flow"
    ] = ft4

    state[
        "flowSensors"
    ][
        "FI4"
    ][
        "flow"
    ] = ft5

    state[
        "flowSensors"
    ][
        "FI2"
    ][
        "flow"
    ] = ft6


    # VAZÕES POR TRECHO PARA A HMI
    #
    # Os FT continuam sendo as medições principais. Para os
    # trechos sem FT, o mock fornece as vazões calculadas para
    # que as válvulas manuais tenham efeito visível na interface.
    branch_x1 = (
        ft2 +
        ft3
    )

    branch_x2 = (
        ft1 +
        ft6
    )

    central_flow = (
        branch_x1 +
        branch_x2
    )

    common_h3_flow = (
        gravity_h5_h3 +
        p1_recycle
    )

    common_h4_flow = (
        gravity_h6_h4 +
        p2_recycle
    )

    state["flows"] = {
        "RES_JIC1": central_flow,
        "JIC1_HV9": central_flow,
        "HV9_LV1": branch_x1,
        "HV9_LV2": branch_x2,

        "LV1_OY1_A": ft3,
        "OY1_A_OUT": ft3,
        "OY1_A_TQ3": ft3,
        "LV1_OY1_B": ft2,
        "OY1_B_FI6": ft2,
        "FI6_TQ6": ft2,

        "LV2_OY2_A": ft1,
        "OY2_A_FI5": ft1,
        "FI5_TQ5": ft1,
        "LV2_OY2_B": ft6,
        "OY2_B_OUT": ft6,
        "OY2_B_TQ4": ft6,

        "TQ5_HV5": gravity_h5_h3,
        "HV5_TQ3": gravity_h5_h3,
        "JIC3_HV7": p1_recycle,
        "HV7_TQ3": p1_recycle,
        "TQ3_HV3": actual_p1_flow,
        "HV3_JIC3": actual_p1_flow,
        "JIC3_LV3": ft4,
        "LV3_FI3": ft4,
        "FI3_TQ1": ft4,

        "TQ6_HV6": gravity_h6_h4,
        "HV6_TQ4": gravity_h6_h4,
        "JIC4_HV8": p2_recycle,
        "HV8_TQ4": p2_recycle,
        "TQ4_HV4": actual_p2_flow,
        "HV4_JIC4": actual_p2_flow,
        "JIC4_LV4": ft5,
        "LV4_FI4": ft5,
        "FI4_TQ2": ft5,

        "TQ1_HV1": drain_h1,
        "HV1_RES": drain_h1,
        "TQ2_HV2": drain_h2,
        "HV2_RES": drain_h2,
    }


    # ATUALIZA LT
    update_level_sensors()


# ENVIO PERIÓDICO DO ESTADO
async def state_sender(
    websocket
):

    try:
        while True:
            await send_json(
                websocket,
                {
                    "type":
                        "state",

                    "data":
                        state
                }
            )

            await asyncio.sleep(
                0.10
            )

    except websockets.ConnectionClosed:

        pass


# CLIENTE CONECTADO
async def client_handler(
    websocket
):

    print(
        "[WEBSOCKET] HMI conectada."
    )

    clients.add(
        websocket
    )

    await send_json(
        websocket,
        {
            "type":
                "hello",

            "server":
                "six-tank-python-server"
        }
    )

    sender_task = (
        asyncio.create_task(
            state_sender(
                websocket
            )
        )
    )

    try:

        async for raw_message in websocket:

            try:

                message = (
                    json.loads(
                        raw_message
                    )
                )

            except json.JSONDecodeError:

                await send_json(
                    websocket,
                    {
                        "type":
                            "error",

                        "message":
                            "JSON inválido."
                    }
                )

                continue

            if not isinstance(message, dict):
                await send_json(websocket, {"type": "error", "message": "Mensagem deve ser um objeto JSON."})
                continue
            if message.get("type") == "hello":
                continue  # Identificação da HMI, sem comando de atuação.
            if message.get("type") == "level_zero":
                await send_json(websocket, handle_level_zero(message))
                continue
            if hardware_mode():
                # RO não chega ao roteador de escrita; CTRL aceita somente o contrato hardware.
                if not isinstance(dequi_hardware, ManualHardware) or not dequi_hardware.identified_control():
                    await send_json(websocket, {"type": "error", "message": "Planta real somente leitura."})
                elif not handle_command(message, owner=websocket):
                    await send_json(websocket, {"type": "error", "message": dequi_hardware.control_error or "Comando HARDWARE recusado."})
            elif modelica_mode():
                if not handle_command(message):
                    await send_json(websocket, {"type": "error", "message": "Comando recusado pelo runtime Modelica."})
            else:
                handle_command(message)

    except websockets.ConnectionClosed:

        pass

    finally:

        sender_task.cancel()
        if hardware_mode() and isinstance(dequi_hardware, ManualHardware) and dequi_hardware.owner is websocket:
            get_hardware_operation().cancel()
            dequi_hardware.stop(reason="HMI desconectada; controle desarmado")

        clients.discard(
            websocket
        )

        print(
            "[WEBSOCKET] HMI desconectada."
        )


# INICIALIZAÇÃO
def modelica_mode():
    return BACKEND_MODE == "MODELICA"


def create_modelica_runtime():
    try:
        from simulation.modelica_runtime import RuntimeModelica
        return RuntimeModelica(state)
    except (ImportError, FileNotFoundError) as exc:
        raise SystemExit(
            f"MODELICA indisponível: {exc}\n"
            "Confira o ambiente PyFMI e gere as duas FMUs com python/build_fmu.py (ver README)."
        ) from exc


async def process_loop():
    # Uma evolução da planta por ciclo, independentemente dos clientes.
    previous_time = time.monotonic()
    next_tick = previous_time
    while True:
        now = time.monotonic()
        dt = min(now - previous_time, 0.5)
        previous_time = now
        if modelica_mode():
            modelica_runtime.tick()
        elif hardware_mode():
            process_serial_events()
            dequi_hardware.tick(serial_bridge)
            apply_dequi_readings()
            get_hardware_operation().tick(serial_bridge, dt)
        else:
            update_mock_plant(dt)
        next_tick += 0.10
        delay = next_tick - time.monotonic()
        if delay < 0:
            next_tick = time.monotonic()
            delay = 0
        await asyncio.sleep(delay)

async def main():
    global modelica_runtime
    if modelica_mode():
        modelica_runtime = create_modelica_runtime()
    if hardware_mode():
        apply_hardware_telemetry({}, received=False)

    global serial_bridge

    if hardware_mode():
        # Prepara a FMU antes de abrir Serial; falha mantém aquisição e Manual disponíveis.
        try:
            get_hardware_operation().initialize()
        except (ImportError, FileNotFoundError, RuntimeError, OSError) as exc:
            get_hardware_operation().error = f"BancoControladores indisponível: {exc}"
        serial_bridge = SerialBridge(
            port=SERIAL_PORT,
            baud=SERIAL_BAUD
        )
        serial_bridge.start()

    print(
        "=============================================="
    )

    print(
        "Servidor da Planta de Seis Tanques"
    )

    print(
        f"WebSocket: ws://{HOST}:{PORT}"
    )

    if hardware_mode():
        print(
            "Modo: HARDWARE"
        )
        print(
            f"Serial: {SERIAL_PORT} @ {SERIAL_BAUD} baud"
        )
        print(
            "Se o Arduino ainda nao estiver conectado, "
            "o servidor continuara tentando reconectar."
        )
    elif modelica_mode():
        print(f"Modo: MODELICA | Cenário: {modelica_runtime.cenario_id}")
    else:
        print(
            "Modo: MOCK (hidraulica simulada)"
        )

    print(
        "Aguardando conexão da HMI..."
    )

    print(
        "=============================================="
    )

    try:
        async with websockets.serve(
            client_handler,
            HOST,
            PORT
        ):

            loop_task = asyncio.create_task(process_loop())
            try:
                await loop_task
            finally:
                loop_task.cancel()
                with suppress(asyncio.CancelledError):
                    await loop_task

    finally:
        if serial_bridge is not None:
            serial_bridge.stop()


# EXECUÇÃO
if __name__ == "__main__":

    try:

        asyncio.run(
            main()
        )

    except KeyboardInterrupt:

        print(
            "\nServidor encerrado."
        )
