"""Offsets de campo por sensor; os ganhos permanecem na configuração versionada."""
import copy
import json
import math
import os
from pathlib import Path
import tempfile

from hardware.hardware_config import LEVEL_CALIBRATION, ADC_MAX


class LevelZeroCalibration:
    def __init__(self, path):
        self.path = Path(path)
        self.defaults = copy.deepcopy(LEVEL_CALIBRATION)
        self.zeros = {}
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if data.get("version") != 1 or not isinstance(data.get("zeros"), dict):
                raise ValueError("Arquivo de calibração de zero inválido.")
            # Compatibilidade restrita aos IDs antigos dos sensores persistidos.
            aliases = {"LIC3": "LI3", "LIC4": "LI4"}
            zeros = {}
            for stored_id, raw in data["zeros"].items():
                sensor = aliases.get(stored_id, stored_id)
                self.validate(sensor, raw)
                if sensor in zeros and zeros[sensor] != raw:
                    raise ValueError(f"Conflito de calibração de zero para {sensor}: chaves antiga e nova divergentes. Arquivo preservado.")
                zeros[sensor] = raw
            self.zeros = zeros

    def validate(self, sensor, raw):
        if sensor not in self.defaults:
            raise ValueError("Sensor de nível desconhecido.")
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or not 0 <= raw <= ADC_MAX:
            raise ValueError("RAW médio deve ser numérico, finito e estar entre 0 e 1023.")

    def parameters(self, sensor):
        result = dict(self.defaults[sensor])
        if sensor in self.zeros:
            result.update(offset_raw=self.zeros[sensor], offset=0.0)
        return result

    def info(self, sensor):
        p = self.parameters(sensor)
        return {"zeroRaw": p["offset_raw"] - p["offset"] / p["slope"], "zeroIsField": sensor in self.zeros}

    def save(self, sensor, raw=None, restore=False):
        self.validate(sensor, 0 if restore else raw)
        updated = dict(self.zeros)
        if restore:
            updated.pop(sensor, None)
        else:
            updated[sensor] = float(raw)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as out:
                temporary = out.name
                json.dump({"version": 1, "zeros": updated}, out, allow_nan=False, indent=2)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
        self.zeros = updated
