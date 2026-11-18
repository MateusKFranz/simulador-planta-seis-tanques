"""Adaptação do banco FMU às PVs físicas e ao protocolo CTRL confirmado."""
import math
import time
from simulation import cenarios
from simulation.controle import BancoControladores
from common.operation import Operation, valid_loop_command
from hardware.hardware_control import PUMP_CHANNELS
from hardware.hardware_config import AUTO_VALIDATED_PVS, AUTO_VALIDATED_MANUAL_VALVES
from common.instrument_ids import LEVEL_IDS


class HardwareOperation:
    def __init__(self, state, control):
        self.state, self.control = state, control
        self.operation = None
        self.error = None
        self.xv = {"OY1": {"tA": 3., "tB": 2.}, "OY2": {"tA": 2., "tB": 3.}}
        self.started = None
        self.desired = {}
        self.cursor = 0

    def initialize(self):
        if self.operation is None:
            try:
                operation = Operation(BancoControladores(), self.read_mv, self.read_pv)
                operation.prepare(cenarios.CENARIO_PADRAO)
            except Exception as exc:
                raise RuntimeError(f"BancoControladores indisponível: {exc}") from exc
            self.operation = operation

    def read_mv(self, target):
        value = self.confirmed_mv(target)
        return value if value is not None else 0.

    def confirmed_mv(self, target):
        data = self.control.confirmed if self.control.fresh() else None
        if not data:
            return None
        if target["tipo"] == "bomba":
            return data["pumps"][PUMP_CHANNELS[target["id"]]-1][0]/255
        valve = next((v for v in data["valves"] if v[1] and f"LV{v[0]}" == target["id"]), None)
        return valve[2]/100 if valve and valve[5] and valve[2]>=0 else None

    def read_pv(self, pv):
        if pv["tipo"] == "nivel":
            id = LEVEL_IDS[int(pv["id"][2:])-1]
            sensor = self.state["levelSensors"].get(id, {})
            value = sensor.get("heightCm")
            ids = [id]
        else:
            ids = pv.get("ids", [pv.get("id")])
            sensors = [self.state["flowSensors"].get(id, {}) for id in ids]
            if any(s.get("status") != "available" for s in sensors):
                return None
            values = [s.get("flow") for s in sensors]
            value = sum(values) if all(isinstance(v, (int, float)) for v in values) else None
            sensor = {"status": "available"}
        if (not all(AUTO_VALIDATED_PVS.get(id, False) for id in ids) or sensor.get("status") != "available"
                or not isinstance(value, (int, float)) or not math.isfinite(value)):
            return None
        return value

    def reasons(self):
        reasons = []
        c = self.control
        if not hasattr(c, "ready") or not c.ready() or not c.armed:
            reasons.append("CTRL precisa estar conectado, validado e armado, com readback recente")
        if self.operation is None:
            reasons.append(self.error or "BancoControladores não preparado")
            return reasons
        scenario = self.operation.scenario
        targets = [m["mv"] for m in scenario["malhas"]]
        fixed = scenario.get("fixos", {})
        targets += [{"tipo": "bomba", "id": id} for id in fixed.get("pumps", {})]
        targets += [{"tipo": "valvula", "id": id} for id in fixed.get("actuatedValves", {})]
        for m in scenario["malhas"]:
            if self.read_pv(m["pv"]) is None:
                reasons.append(f'{m["tag"]}: PV ausente, desatualizada ou sem calibração validada para AUTO')
        for id, value in fixed.get("valvulas_manuais", {}).items():
            if AUTO_VALIDATED_MANUAL_VALVES.get(id) != value:
                reasons.append(f'{id}: posição manual física do cenário não confirmada')
        data = c.confirmed if c.fresh() else None
        if data:
            for target in targets:
                id = target["id"]
                if target["tipo"] == "bomba":
                    if not data["pumps"][PUMP_CHANNELS[id]-1][1]:
                        reasons.append(f"{id}: sentido da bomba não configurado")
                elif not any(v[1] and v[5] and f"LV{v[0]}" == id for v in data["valves"]):
                    reasons.append(f"{id}: associação, limites ou referência ausentes")
        return list(dict.fromkeys(reasons))

    def cancel(self):
        self.desired.clear()
        self.control.queue[:] = [c for c in self.control.queue if not c.startswith("SET ")]
        self.started = None
        if self.operation:
            self.operation.mode = "MANUAL"
            for m in self.operation.banco.malhas.values():
                m.authority = False

    def handle(self, message, bridge, owner):
        c = self.control
        if message.get("type") == "hardware":
            action = message.get("action")
            if action == "plant_reset":
                if not c.request(message, bridge, owner):
                    return False
                self.cancel()
                return True
            if action in ("disarm", "estop", "reset"):
                self.cancel()
            if self.operation and self.operation.mode == "AUTO" and action in ("pump", "valve", "valve_angle", "valve_sync", "oy"):
                target = message.get("id")
                loop = self.operation.banco.malha_do_atuador("bomba" if action == "pump" else "valvula", target)
                if action == "oy" or (loop and loop.modo_efetivo() == "AUTO") or any(target in group for group in self.operation.scenario.get("fixos", {}).values()):
                    c.control_error = "Atuador sob autoridade automática; selecione Manual"
                    return False
            if action == "valve_stop":
                self.cancel()
            return c.request(message, bridge, owner)
        if c.owner is not None and c.owner is not owner:
            c.control_error = "Controle pertence a outra sessão HMI"
            return False
        kind = message.get("type")
        if kind not in ("operation", "scenario", "loop", "xv"):
            return False
        try:
            self.initialize()
            op = self.operation
            if kind == "operation":
                mode = message.get("mode")
                if mode == "AUTO" and self.reasons():
                    raise ValueError("; ".join(self.reasons()))
                changed = mode != op.mode
                op.set_mode(mode)
                if changed:
                    if mode == "MANUAL":
                        self.cancel()
                    self.desired.clear()
                    self.started = time.monotonic() if mode == "AUTO" else None
                    if mode == "AUTO":
                        self.fixed()
                return True
            if kind == "scenario":
                # Preparação não envia comandos. Reativação exige validação do novo cenário.
                cenarios.obter_cenario(str(message.get("id")))
                auto = op.mode == "AUTO"
                self.cancel()
                op.prepare(str(message.get("id")))
                if auto:
                    if self.reasons():
                        c.stop(True, "Novo cenário não validado")
                        raise ValueError("; ".join(self.reasons()))
                    op.set_mode("AUTO")
                    self.started = time.monotonic()
                    self.fixed()
                return True
            if kind == "xv":
                id = message.get("id")
                ta, tb = float(message["tA"]), float(message["tB"])
                if id not in self.xv or not all(math.isfinite(v) and v>=0 for v in (ta,tb)) or ta+tb<=0:
                    return False
                self.xv[id] = {"tA": ta, "tB": tb}
                return True
            if kind == "loop":
                if not valid_loop_command(message):
                    return False
                id = str(message.get("id"))
                m = op.banco.malhas.get(id)
                if not m:
                    return False
                if m.modo != "AUTO" and message.get("mode") == "AUTO" and op.mode == "AUTO":
                    op.align()
                tuning = message.get("tuning")
                if tuning and any(k not in ("kp","ti","td","b","c","n","ftt","u_bias","u_min","u_max") for k in tuning):
                    return False
                if not op.banco.ajustar(id, sp=message.get("sp"), modo=message.get("mode"), mv_manual=message.get("mv"), sintonia=tuning):
                    return False
                if m.modo_efetivo() == "MAN":
                    self.desired.pop(m.definicao["mv"]["id"], None)
                if message.get("mv") is not None and m.modo_efetivo() == "MAN":
                    return c.request(self.command(m.definicao["mv"], m.mv_manual), bridge, owner)
                return True
        except (ValueError, TypeError, KeyError, RuntimeError, ImportError, FileNotFoundError) as exc:
            self.error = c.control_error = str(exc)
        return False

    @staticmethod
    def command(target, value):
        if not math.isfinite(value):
            raise ValueError("MV não finita")
        value = max(0., min(1., value))
        return dict(type="hardware", action="pump", id=target["id"], pwm=int(value*255+.5)) if target["tipo"] == "bomba" else dict(type="hardware", action="valve", id=target["id"], percent=int(value*100+.5))

    def fixed(self):
        fixed = self.operation.scenario.get("fixos", {})
        for group, kind in (("pumps", "bomba"), ("actuatedValves", "valvula")):
            for id, value in fixed.get(group, {}).items():
                self.desired[id] = self.command({"tipo":kind, "id":id}, value)

    def tick(self, bridge, dt):
        c = self.control
        op = self.operation
        if not op:
            return
        if op.mode != "AUTO":
            try:
                op.track()
            except Exception as exc:
                self.error = str(exc)
            return
        if self.reasons():
            self.cancel()
            c.stop(True, "Automático perdeu validação de PV/CTRL")
            return
        try:
            for tag, value in op.step(max(.001, min(dt, .5))).items():
                target = op.banco.malhas[tag].definicao["mv"]
                self.desired[target["id"]] = self.command(target, value)
            elapsed = time.monotonic()-self.started
            for id, t in self.xv.items():
                branch = "A" if elapsed % (t["tA"]+t["tB"]) < t["tA"] else "B"
                self.desired[id] = dict(type="hardware",action="oy",id=id,state=branch)
            # Um comando por confirmação; heartbeat tem prioridade e não é renovado por SET.
            if c.busy() or c.pending or (c.outputs_active(c.confirmed) and c.clock()>=c.next_heartbeat):
                return
            commands = list(self.desired.values())
            for offset in range(len(commands)):
                index = (self.cursor+offset) % len(commands)
                cmd = commands[index]
                if self.matches(cmd):
                    continue
                if c.request(cmd, bridge, c.owner):
                    self.cursor = (index+1) % len(commands)
                break
        except Exception as exc:
            self.error = str(exc)
            self.cancel()
            c.stop(True, "Falha no banco de controle físico")

    def matches(self, cmd):
        data = self.control.confirmed
        if cmd["action"] == "pump":
            return data["pumps"][PUMP_CHANNELS[cmd["id"]]-1][0] == cmd["pwm"]
        if cmd["action"] == "oy":
            return data["oy"][int(cmd["id"][-1])-1] == {"A":1,"B":2,"RELEASE":0}[cmd["state"]]
        return any(v[1] and f"LV{v[0]}"==cmd["id"] and v[12]==cmd["percent"] for v in data["valves"])

    def snapshot(self):
        op = self.operation
        loops = op.banco.estado() if op else {}
        for tag, loop in loops.items():
            loop["mvRequested"] = loop["mv"]
            loop["mv"] = self.confirmed_mv(op.banco.malhas[tag].definicao["mv"])
        return dict(operation=op.snapshot(self.reasons()) if op else dict(mode="MANUAL", autoBlocked=self.reasons()),
                    loops=loops, scenario=op.scenario_id if op else None,
                    scenarios=cenarios.resumo_cenarios(), xv=self.xv)
