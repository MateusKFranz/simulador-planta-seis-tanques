"""Calibração local por LI; referências de campo não alteram o modelo físico."""
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
        self.points = {}
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or data.get("version") not in (1, 2):
                raise ValueError("Arquivo de calibração inválido.")
            stored = data.get("zeros" if data["version"] == 1 else "points")
            if not isinstance(stored, dict):
                raise ValueError("Arquivo de calibração inválido.")
            for name, value in stored.items():
                sensor = {"LIC3": "LI3", "LIC4": "LI4"}.get(name, name)
                points = [{"heightCm": 0.0, "raw": value}] if data["version"] == 1 else value
                self.validate_points(sensor, points, require_increasing=False)
                points = sorted(points, key=lambda p: p["heightCm"])
                if sensor in self.points and self.points[sensor] != points:
                    raise ValueError(f"Conflito de calibração para {sensor}; arquivo preservado.")
                self.points[sensor] = points

    @property
    def zeros(self):
        return {s: p["raw"] for s, points in self.points.items() for p in points if p["heightCm"] == 0}

    @staticmethod
    def finite(value):
        try:
            return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
        except OverflowError:
            return False

    def validate(self, sensor, raw):
        if not isinstance(sensor, str) or sensor not in self.defaults:
            raise ValueError("Sensor de nível desconhecido.")
        if not self.finite(raw) or not 0 <= raw <= ADC_MAX:
            raise ValueError("RAW médio deve ser numérico, finito e estar entre 0 e 1023.")

    @staticmethod
    def increasing_raw(points):
        ordered = sorted(points, key=lambda p: p["heightCm"])
        return all(a["raw"] < b["raw"] for a, b in zip(ordered, ordered[1:]))

    def validate_points(self, sensor, points, *, require_increasing=True):
        self.validate(sensor, 0)
        if not isinstance(points, list) or len(points) > 5:
            raise ValueError("Máximo de cinco pontos por sensor; substitua ou exclua um ponto.")
        for p in points:
            if not isinstance(p, dict) or set(p) != {"raw", "heightCm"}:
                raise ValueError("Ponto de calibração inválido.")
            self.validate(sensor, p["raw"])
            if not self.finite(p["heightCm"]) or p["heightCm"] < 0:
                raise ValueError("Altura deve ser finita e maior ou igual a zero.")
        for i, p in enumerate(points):
            for q in points[:i]:
                if p["heightCm"] == q["heightCm"] or abs(p["raw"]-q["raw"]) < 1e-6:
                    raise ValueError("Pontos duplicados ou RAWs indistinguíveis.")
        if require_increasing and not self.increasing_raw(points):
            raise ValueError("O RAW deve aumentar com a altura.")
        if len(points) == 1:
            p = points[0]
            if not math.isfinite(p["raw"]-p["heightCm"]/self.defaults[sensor]["slope"]):
                raise ValueError("Altura excede a capacidade numérica do ajuste.")
        if len(points) >= 2: self.fit(points)

    @staticmethod
    def fit(points):
        x = sum(p["raw"] for p in points)/len(points)
        y = sum(p["heightCm"]/len(points) for p in points)
        xx = sum((p["raw"]-x)**2 for p in points)
        a = sum((p["raw"]-x)*(p["heightCm"]-y) for p in points)/xx if xx > 1e-12 else 0
        b = y-a*x
        if not math.isfinite(a) or not math.isfinite(b) or abs(a) < 1e-12:
            raise ValueError("Ajuste degenerado ou ganho nulo.")
        residuals = [p["heightCm"]-(a*p["raw"]+b) for p in points]
        if not all(math.isfinite(v) for v in [b/a, a*ADC_MAX+b, *residuals, math.hypot(*residuals)]):
            raise ValueError("Ajuste excede a capacidade numérica.")
        return a, b, residuals

    def parameters(self, sensor):
        result = dict(self.defaults[sensor])
        points = self.points.get(sensor, [])
        if len(points) == 1:
            result.update(offset_raw=points[0]["raw"], offset=points[0]["heightCm"])
        elif len(points) >= 2:
            a, b, _ = self.fit(points)
            result.update(slope=a, offset_raw=0, offset=b)
        return result

    def info(self, sensor):
        p = self.parameters(sensor)
        points = self.points.get(sensor, [])
        result = dict(zeroRaw=self.zeros.get(sensor, p["offset_raw"]-p["offset"]/p["slope"]), zeroIsField=sensor in self.zeros,
                      calibrationPoints=copy.deepcopy(points), calibrationMode="provisional" if not points else "offset" if len(points)==1 else "linear",
                      calibrationValidated=False, slope=p["slope"], intercept=p["offset"]-p["slope"]*p["offset_raw"],
                      calibrationQuality="provisional", calibrationWarning="Conversão provisória" if not points else "Um ponto: offset com ganho provisório")
        if len(points) >= 2:
            a, b, residuals = self.fit(points)
            ordered = sorted(points, key=lambda q: q["raw"])
            consistent = self.increasing_raw(points)
            rmse = math.hypot(*residuals)/math.sqrt(len(points))
            # Critério de triagem, não certificação metrológica.
            limit = max(0.5, 0.05*(max(q["heightCm"] for q in points)-min(q["heightCm"] for q in points)))
            warning = not consistent or rmse > limit
            result.update(rawRange=[ordered[0]["raw"], ordered[-1]["raw"]], heightRange=[min(q["heightCm"] for q in points),max(q["heightCm"] for q in points)],
                          residualsCm=residuals, rmseCm=rmse, residualLimitCm=limit,
                          calibrationQuality="warning" if warning else "fit",
                          calibrationWarning="Pontos inconsistentes ou erro alto; rever medidas" if warning else "Ajuste de campo; não validado metrologicamente")
        return result

    def convert(self, sensor, raw):
        self.validate(sensor, raw)
        info = self.info(sensor)
        extrapolated = False
        if info["calibrationMode"] == "linear":
            if info["calibrationQuality"] == "warning": return None, "calibration_warning"
            lo, hi = info["rawRange"]
            extrapolated = not lo <= raw <= hi
        p = self.parameters(sensor)
        height = p["slope"]*(raw-p["offset_raw"])+p["offset"]
        return max(0.0, height), "extrapolated" if extrapolated else None

    def save(self, sensor, raw=None, restore=False, *, height=0.0, action="calibrate", point=None):
        self.validate(sensor, 0 if restore or action=="delete" else raw)
        updated = copy.deepcopy(self.points)
        points = updated.setdefault(sensor, [])
        if restore:
            updated.pop(sensor, None)
        elif action in {"delete", "replace"}:
            self.validate_points(sensor, [point])
            if not isinstance(point, dict) or point not in points:
                raise ValueError("Ponto alterado ou inexistente; atualize a seleção.")
            index = points.index(point)
            if action == "delete": points.pop(index)
            else: points[index] = {"raw": raw, "heightCm": height}
        elif action == "calibrate":
            points[:] = [p for p in points if p["heightCm"] != 0]
            points.append({"raw": raw, "heightCm": 0.0})
        elif action == "add":
            points.append({"raw": raw, "heightCm": height})
        else: raise ValueError("Ação inválida.")
        self.validate_points(sensor, updated.get(sensor, []))
        if sensor in updated: updated[sensor].sort(key=lambda p: p["heightCm"])
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as out:
                temporary = out.name
                json.dump({"version": 2, "points": updated}, out, allow_nan=False, indent=2)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary and os.path.exists(temporary): os.unlink(temporary)
        self.points = updated
