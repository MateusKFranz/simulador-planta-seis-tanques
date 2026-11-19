"""Configuração de aquisição. None significa ainda não calibrado."""
from common.instrument_ids import LEVEL_IDS, FLOW_CHANNEL_IDS
ADC_MAX = 1023
RAW_MEAN_WINDOW = 10
# Metadados nominais dos perfis PLANTA1-RO/CTRL; nao recebidos pela Serial.
PLANTA1_PRESSURE_SAMPLE_MS = 50
PLANTA1_PRESSURE_FILTER_SAMPLES = 4
# Parâmetros temporários para teste visual, não calibração metrológica final.
LI2_VISUAL_SLOPE = 15.0 / 230.0  # Escala de LI1; falta medir um segundo ponto em LI2.
LEVEL_CALIBRATION = {
    "LI1": {"slope": 15.0 / 230.0, "offset_raw": 0.0, "offset": 0.0},
    "LI2": {"slope": LI2_VISUAL_SLOPE, "offset_raw": 215.0, "offset": 0.0},
    "LI3": {"slope": 10.0 / 206.0, "offset_raw": 0.0, "offset": 0.0},
    "LI4": {"slope": 14.0 / 258.0, "offset_raw": 0.0, "offset": 0.0},
    "LI5": {"slope": 11.4 / 101.0, "offset_raw": 0.0, "offset": 0.0},
    "LI6": {"slope": 9.1 / 125.0, "offset_raw": 0.0, "offset": 0.0},
}
ADC_REFERENCE_V = None  # TODO: medir referência do ADC
TELEMETRY_TIMEOUT_S = 2.0
# Referência física da Planta 1; índice da API é descoberto pelo PINMAP.
LT_CHANNELS = {
    "LI1": {"physical": "LT4", "pin": "A3"},
    "LI2": {"physical": "LT5", "pin": "A4"},
    "LI3": {"physical": "LT3", "pin": "A2"},
    "LI4": {"physical": "LT6", "pin": "A5"},
    "LI5": {"physical": "LT1", "pin": "A0"},
    "LI6": {"physical": "LT2", "pin": "A1"},
}
FT_CHANNELS = {
    "FI1": {"physical": "FT4", "pin": "D33"},
    "FI2": {"physical": "FT5", "pin": "D34"},
    "FI3": {"physical": "FT3", "pin": "D32"},
    "FI4": {"physical": "FT6", "pin": "D35"},
    "FI5": {"physical": "FT1", "pin": "D30"},
    "FI6": {"physical": "FT2", "pin": "D31"},
}
# Somente valores medidos; não herda dimensões do simulador.
TANK_GEOMETRY = {f"TQ{i}": {"heightM": None, "capacityL": None} for i in range(1, 7)}
# TODO: calibrar experimentalmente. LT: (raw_vazio, raw_cheio).
LT_CALIBRATION = {LEVEL_IDS[i - 1]: None for i in range(1, 7)}
# Alternativa: (tensão a zero kPa, volts por kPa), após calibração.
LT_PRESSURE_CALIBRATION = {LEVEL_IDS[i - 1]: None for i in range(1, 7)}
WATER_DENSITY_KG_M3 = 1000.0
GRAVITY_M_S2 = 9.81
# FT analógico: (raw_zero, raw_referencia, vazao_referencia_L_min).
FT_ANALOG_CALIBRATION = {FLOW_CHANNEL_IDS[i - 1]: None for i in range(1, 7)}

# Aquisição DEQUI: um poll por sensor a cada segundo, no máximo 20 GET/s.
POLL_INTERVAL_S = 1.0
REQUEST_SPACING_S = 0.05
REQUEST_TIMEOUT_S = 1.0
DISCOVERY_RETRY_S = 5.0
EXPECTED_OUTPUTS = {
    **{f"D{36+i}": f"VALVULA{i+1}" for i in range(4)},
    **{f"D{9-2*i+j}": f"BOMBA{i+1}" for i in range(3) for j in range(2)},
    **{f"D{26+i}": f"RELE{i+1}" for i in range(4)},
}

# Liberações explícitas após validação física; calibração visual provisória não autoriza AUTO.
AUTO_VALIDATED_PVS = {}
