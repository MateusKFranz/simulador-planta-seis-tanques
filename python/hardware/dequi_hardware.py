"""Descoberta e aquisição DEQUI somente leitura, associadas pelos pinos."""
import copy
import math
import re
import time
from collections import Counter, deque

from hardware.hardware_config import (LT_CHANNELS, FT_CHANNELS, EXPECTED_OUTPUTS,
    POLL_INTERVAL_S, REQUEST_SPACING_S, REQUEST_TIMEOUT_S, DISCOVERY_RETRY_S,
    TELEMETRY_TIMEOUT_S, RAW_MEAN_WINDOW,
    PLANTA1_PRESSURE_SAMPLE_MS, PLANTA1_PRESSURE_FILTER_SAMPLES)


def normalize_pin(value):
    text = str(value).upper()
    if re.fullmatch(r"A(?:[0-9]|1[0-5])", text):
        return text
    if re.fullmatch(r"D?\d+", text):
        pin = int(text.removeprefix("D"))
        if 0 <= pin <= 69:
            return f"A{pin-54}" if pin >= 54 else f"D{pin}"
    raise ValueError("Pino inválido")


def finite(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Número não finito")
    return number


def integer(value, maximum=0xFFFFFFFF):
    number = finite(value)
    if number != int(number) or not 0 <= number <= maximum:
        raise ValueError("Inteiro inválido")
    return int(number)


def flag(value):
    return bool(integer(value, 1))


class DequiHardware:
    def __init__(self, clock=time.monotonic, wall_clock=time.time):
        self.clock, self.wall_clock = clock, wall_clock
        self.sequence = 0
        self.reset()

    def reset(self):
        self.firmware = {"identified": False, "boardId": None, "version": None, "board": None}
        self.discovery = {"complete": False, "components": None, "enabled": None}
        self.compatibility = {"status": "unknown", "issues": [], "expected": {
            "pressure": copy.deepcopy(LT_CHANNELS), "flow": copy.deepcopy(FT_CHANNELS),
            "outputs": dict(EXPECTED_OUTPUTS)}, "reported": [], "pressureCount": 0, "flowCount": 0}
        self.pending = None
        self.queue = ["GET ID"]
        self.next_send = 0
        self.retry_at = None
        self.mapped = {}
        self.samples = {}
        self.raw_history = {}
        self.units = {}
        self.profile = None
        self.flow_verbose_supported = None
        self.verbose_attempted = set()
        self.last_protocol_error = None
        self.previous_pulses = {}
        self.last_success = None
        self.last_success_at = None
        self.messages = []
        self.comm = None
        self.safety = None

    def note(self, kind, message):
        self.messages.append({"type": kind, "message": message, "at": self.wall_clock()*1000})
        self.messages = self.messages[-20:]

    def tick(self, bridge):
        now = self.clock()
        if not bridge or not bridge.connected:
            return
        if self.pending and now >= self.pending["deadline"]:
            request = self.pending
            self.pending = None
            self.failed(request["command"], "Timeout")
        if self.pending or now < self.next_send:
            return
        if self.retry_at is not None and now >= self.retry_at:
            self.reset()
        if self.queue:
            command = self.queue.pop(0)
        elif self.discovery["complete"]:
            due = [(key, item) for key, item in self.mapped.items() if now >= item["nextPoll"]]
            if not due:
                return
            key, item = min(due, key=lambda pair: pair[1]["nextPoll"])
            item["nextPoll"] = now + POLL_INTERVAL_S
            command = f"GET {key}"
            # VERBOSE informa a unidade; as respostas compactas não a incluem.
            if (key.startswith("VAZAO") and self.flow_verbose_supported is not False
                    and key not in self.units and key not in self.verbose_attempted):
                self.verbose_attempted.add(key)
                command += " VERBOSE"
        else:
            return
        self.sequence += 1
        request_id = str(self.sequence % 1000000000)
        if bridge.send_line(f"@{request_id} {command}"):
            self.pending = {"id": request_id, "command": command, "deadline": now+REQUEST_TIMEOUT_S,
                            "lines": None}
            self.next_send = now + REQUEST_SPACING_S
        else:
            self.failed(command, "Envio indisponível")

    def handle(self, event):
        kind = event.get("kind")
        if kind == "READY":
            self.reset()
            self.note("READY", event["body"])
            return
        if kind in {"ALERT", "WARN"}:
            self.note(kind, event["body"])
            return  # Eventos assíncronos nunca concluem uma requisição.
        request = self.pending
        if not request:
            return
        request_id = event.get("requestId")
        if request_id and request_id != request["id"]:
            return
        if request["lines"] is not None:
            if kind == "END":
                self.pending = None
                try:
                    self.consume_verbose(request["command"], request["lines"])
                except (ValueError, KeyError):
                    self.failed(request["command"], "Resposta VERBOSE inválida")
            elif not request_id and kind not in {"OK", "ERR"}:
                request["lines"].append(event.get("body", ""))
            return
        # Sem eco @id não há como distinguir resposta atrasada de outra consulta.
        if request_id != request["id"]:
            return
        if kind == "ERR":
            self.pending = None
            self.failed(request["command"], event["body"])
        elif kind == "OK":
            if request["command"].endswith(" VERBOSE"):
                request["lines"] = []
                return
            self.pending = None
            try:
                self.consume(request["command"], event["fields"])
            except (ValueError, IndexError, KeyError):
                self.failed(request["command"], "Resposta inválida")

    def failed(self, command, reason):
        self.note("ERR", f"{command}: {reason}")
        self.last_protocol_error = f"{command}: {reason}"
        key = command.removeprefix("GET ").removesuffix(" VERBOSE")
        if command.startswith("GET VAZAO ") and command.endswith(" VERBOSE"):
            # Descobrir unidade é opcional; sua falha não invalida a aquisição.
            self.flow_verbose_supported = False
            if key in self.mapped:
                self.queue.insert(0, f"GET {key}")
            return
        if key in self.mapped:
            self.samples.pop(key, None)
            self.previous_pulses.pop(key, None)
        elif command in {"GET ID", "GET COMPONENTS", "GET ENABLED", "GET PINMAP"}:
            self.queue.clear()
            self.discovery["complete"] = False
            self.compatibility["status"] = "unknown"
            self.compatibility["issues"] = [f"{command}: {reason}"]
            self.retry_at = self.clock() + DISCOVERY_RETRY_S

    def consume(self, command, fields):
        if command == "GET ID":
            if len(fields) != 3 or fields[0] != "DEQUI_HW_API":
                raise ValueError("Firmware não DEQUI")
            self.firmware = dict(identified=True, boardId=fields[0], version=fields[1], board=fields[2])
            if re.search(r"(?:^|[-_])PLANTA1-(?:RO|CTRL)(?:$|[-_+.])", fields[1].upper()):
                self.profile = "PLANTA1-CTRL" if "PLANTA1-CTRL" in fields[1].upper() else "PLANTA1-RO"
                self.flow_verbose_supported = False
            self.queue = ["GET COMPONENTS", "GET ENABLED", "GET PINMAP", "GET COMM", "GET SAFETY"]
        elif command in {"GET COMPONENTS", "GET ENABLED"}:
            if len(fields) != 5:
                raise ValueError("Contagens incompletas")
            key = "components" if command.endswith("COMPONENTS") else "enabled"
            self.discovery[key] = dict(zip(("BOMBA", "PRESSAO", "VAZAO", "VALVULA", "RELE"),
                                          (integer(x, 999) for x in fields)))
        elif command == "GET PINMAP":
            self.discover(fields)
        elif command == "GET COMM":
            if len(fields) != 4:
                raise ValueError("COMM incompleto")
            self.comm = dict(zip(("baud", "uptimeMs", "received", "errors"), (integer(x) for x in fields)))
        elif command == "GET SAFETY":
            if len(fields) != 3:
                raise ValueError("SAFETY incompleto")
            self.safety = dict(state=fields[0], fault=fields[1], configValid=flag(fields[2]))
            if not self.safety["configValid"]:
                # PINMAP não revela os proprietários que perderam um conflito no registro.
                self.compatibility["status"] = "incompatible"
                self.compatibility["issues"].append("Firmware reporta conflito interno de configuração; aquisição suspensa.")
                self.mapped.clear()
                self.samples.clear()
                self.raw_history.clear()
        else:
            key = command.removeprefix("GET ")
            if key not in self.mapped:
                return
            if key.startswith("PRESSAO"):
                if len(fields) != 7:
                    raise ValueError("PRESSAO incompleto")
                data = dict(raw=integer(fields[0], 1023), calibrated=finite(fields[1]), filtered=finite(fields[2]),
                            valid=flag(fields[3]), outOfRange=flag(fields[4]), stale=flag(fields[5]), ageMs=integer(fields[6]))
                if self.profile in {"PLANTA1-RO", "PLANTA1-CTRL"}:
                    data.update(filteredRaw=data["filtered"], voltage=data["raw"]*5.0/1023.0,
                                voltageSource="adc_nominal_5V", pressureValueKind="raw")
            else:
                if len(fields) != 4:
                    raise ValueError("VAZAO incompleto")
                data = dict(rawFlow=finite(fields[0]), pulses=integer(fields[1]), valid=flag(fields[2]), stale=flag(fields[3]))
                if data["rawFlow"] < 0:
                    raise ValueError("Vazão negativa")
                data["unit"] = "L/s" if self.profile in {"PLANTA1-RO", "PLANTA1-CTRL"} else self.units.get(key)
                data["sourceUnit"] = data["unit"]
                data["acquisitionMethod"] = "compact"
                data["flow"] = data["rawFlow"]*60 if data["unit"] == "L/s" else None
                previous = self.previous_pulses.get(key)
                data.update(deltaPulses=None, frequency=None, deltaSeconds=None, frequencySource="backend_poll_delta")
                if data["valid"] and not data["stale"]:
                    if previous and self.clock() > previous[1]:
                        delta = (data["pulses"]-previous[0]) % (2**32)
                        elapsed = self.clock()-previous[1]
                        data.update(deltaPulses=delta, deltaSeconds=elapsed, frequency=delta/elapsed)
                    self.previous_pulses[key] = (data["pulses"], self.clock())
                else:
                    self.previous_pulses.pop(key, None)
            self.record(key, data)

    def consume_verbose(self, command, lines):
        key = command.removeprefix("GET ").removesuffix(" VERBOSE")
        values = dict(line.split(": ", 1) for line in lines if ": " in line)
        reading, unit = values["Vazao instantanea"].rsplit(" ", 1)
        if not re.fullmatch(r"\S+/s", unit):
            raise ValueError("Unidade ausente")
        self.units[key] = unit
        def boolean(name):
            value = values[name]
            if value not in {"sim", "nao"}:
                raise ValueError("Flag inválida")
            return "1" if value == "sim" else "0"
        self.consume(f"GET {key}", [reading, values["Pulsos acumulados"], boolean("Valido"), boolean("Desatualizado")])
        self.flow_verbose_supported = True
        self.samples[key]["acquisitionMethod"] = "verbose"

    def record(self, key, data):
        if key.startswith("PRESSAO") and key in self.mapped:
            raw = data.get("raw")
            if (data.get("valid") and not data.get("stale") and not data.get("outOfRange")
                    and isinstance(raw, (int, float)) and not isinstance(raw, bool)
                    and math.isfinite(raw) and 0 <= raw <= 1023):
                tag = self.mapped[key]["tag"]
                self.raw_history.setdefault(tag, deque(maxlen=RAW_MEAN_WINDOW)).append(raw)
        data.update(receivedAt=self.wall_clock()*1000, receivedMonotonic=self.clock())
        self.samples[key] = data
        if data["valid"] and not data["stale"] and not data.get("outOfRange", False):
            self.last_success = self.clock()
            self.last_success_at = data["receivedAt"]

    def discover(self, fields):
        # Uma nova descoberta inicia outra coleta para calibração.
        self.raw_history.clear()
        reported = []
        for item in fields:
            match = re.fullmatch(r"([^:]+):(BOMBA|PRESSAO|VAZAO|VALVULA|RELE)([1-9][0-9]*)", item)
            if not match:
                raise ValueError("PINMAP inválido")
            pin, kind, index = match.groups()
            reported.append(dict(pin=normalize_pin(pin), kind=kind, apiIndex=int(index)))
        expected = {v["pin"]: dict(v, tag=k, kind=kind) for kind, channels in
                    (("PRESSAO", LT_CHANNELS), ("VAZAO", FT_CHANNELS)) for k, v in channels.items()}
        issues, critical = [], False
        counts = Counter(item["pin"] for item in reported)
        owners = Counter((item["kind"], item["apiIndex"]) for item in reported if item["kind"] in {"PRESSAO", "VAZAO"})
        totals, enabled = self.discovery["components"], self.discovery["enabled"]
        complete = True
        for kind in totals:
            actual = len({r["apiIndex"] for r in reported if r["kind"] == kind})
            if actual != enabled[kind] or enabled[kind] > totals[kind]:
                complete = False
                issues.append(f"PINMAP incompleto/inconsistente: {kind}, {actual} encontrados, {enabled[kind]} habilitados, {totals[kind]} cadastrados.")
        for item in reported:
            pin, kind, index = item["pin"], item["kind"], item["apiIndex"]
            target = expected.get(pin)
            owner = f"{kind}{index}"
            ambiguous = counts[pin] > 1 or owners[(kind, index)] > 1 or index > totals[kind]
            if ambiguous:
                critical = True
                issues.append(f"Conflito de identificação: {pin}, {owner}.")
            if target and kind != target["kind"]:
                critical = True
                issues.append(f"Conflito crítico de pinagem: {pin}, esperado {target['physical']}, firmware reporta {owner}.")
            elif pin in EXPECTED_OUTPUTS and owner != EXPECTED_OUTPUTS[pin]:
                critical = True
                issues.append(f"Conflito de pinagem: {pin}, esperado {EXPECTED_OUTPUTS[pin]}, firmware reporta {owner}.")
            if target and kind == target["kind"] and not ambiguous:
                key = f"{kind} {index}"
                self.mapped[key] = dict(target, apiIndex=index, nextPoll=0)
                item["tag"] = target["tag"]
                item["physical"] = target["physical"]
            elif kind in {"PRESSAO", "VAZAO"}:
                issues.append(f"Não mapeado: {owner} em {pin}.")
        found = {item["pin"] for item in self.mapped.values()}
        for pin, item in expected.items():
            if pin not in found:
                issues.append(f"Não fornecido pelo firmware: {item['physical']} / {item['tag']} em {pin}.")
        pressure = sum(item["kind"] == "PRESSAO" for item in self.mapped.values())
        flow = sum(item["kind"] == "VAZAO" for item in self.mapped.values())
        status = "incompatible" if critical else "unknown" if not complete else "compatible" if pressure == flow == 6 else "partial"
        self.compatibility.update(status=status, issues=issues, reported=reported, pressureCount=pressure, flowCount=flow)
        self.discovery["complete"] = True

    def snapshot(self):
        age = None if self.last_success is None else max(0, self.clock()-self.last_success)
        return copy.deepcopy(dict(firmware=self.firmware, discovery=self.discovery, compatibility=self.compatibility,
            acquisition=dict(active=age is not None and age <= TELEMETRY_TIMEOUT_S,
                             lastSuccessfulPollAt=self.last_success_at, ageSeconds=age, pollIntervalSeconds=POLL_INTERVAL_S),
            capabilities=dict(profile=self.profile,
                              pressureSampleIntervalMs=PLANTA1_PRESSURE_SAMPLE_MS if self.profile in {"PLANTA1-RO", "PLANTA1-CTRL"} else None,
                              pressureFilterSamples=PLANTA1_PRESSURE_FILTER_SAMPLES if self.profile in {"PLANTA1-RO", "PLANTA1-CTRL"} else None,
                              flowVerboseSupported=self.flow_verbose_supported,
                              flowSourceUnit="L/s" if self.profile in {"PLANTA1-RO", "PLANTA1-CTRL"} else None,
                              lastProtocolError=self.last_protocol_error),
            messages=self.messages, comm=self.comm, safety=self.safety))

    def readings(self):
        result = {}
        for key, origin in self.mapped.items():
            sample = self.samples.get(key)
            mean_fields = {}
            if key.startswith("PRESSAO"):
                history = self.raw_history.get(origin["tag"], ())
                mean = sum(history)/len(history) if history else None
                mean_fields = dict(rawMean50=mean, rawMeanCount=len(history), rawMeanWindow=RAW_MEAN_WINDOW,
                                   adcVoltageMean50=mean*5.0/1023.0 if mean is not None else None)
            if not sample:
                result[origin["tag"]] = dict(source={k: origin[k] for k in ("physical", "pin", "apiIndex")}, status="unavailable", **mean_fields)
                continue
            sample = dict(sample)
            expired = self.clock()-sample.pop("receivedMonotonic") > TELEMETRY_TIMEOUT_S
            sample["stale"] = sample["stale"] or expired
            sample["status"] = "stale" if sample["stale"] else "invalid" if not sample["valid"] or sample.get("outOfRange") else "uncalibrated" if key.startswith("PRESSAO") or sample.get("flow") is None else "available"
            if expired:
                # Nenhuma medição antiga reaparece como atual após timeout.
                for field in ("raw", "flow", "rawFlow", "pulses", "deltaPulses", "frequency", "calibrated", "filtered", "filteredRaw", "voltage"):
                    if field in sample:
                        sample[field] = None
            sample["source"] = {k: origin[k] for k in ("physical", "pin", "apiIndex")}
            sample.update(mean_fields)
            result[origin["tag"]] = sample
        return result
