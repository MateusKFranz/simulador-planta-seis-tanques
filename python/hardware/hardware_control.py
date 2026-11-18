"""Controle manual confirmado pela variante PLANTA1-CTRL; RO continua leitura."""

import copy
import uuid

import json

import math



from hardware.dequi_hardware import DequiHardware

from hardware.hardware_config import EXPECTED_OUTPUTS



# Pump1/P1=B101; Pump2/P2=B102; Pump3/P3=B103.

PUMP_CHANNELS = {"JIC3": 1, "JIC4": 2, "JIC1": 3}

CONTROL_VERSION = "2.0.0-PLANTA1-CTRL"





def is_control(command):

    return command in {"GET CONTROL", "ARM", "DISARM", "HEARTBEAT", "EMERGENCY STOP", "RESET FAULT"} or command.startswith("SET ")





class ManualHardware(DequiHardware):

    def reset(self):

        super().reset()

        self.armed = False

        self.confirmed = None

        self.confirmed_at = None

        self.confirmed_wall = None

        self.session_ready = False

        self.control_fault = None

        self.control_error = None

        self.requested = {}

        self.last_confirmation = None
        self.plant_reset = None

        self.next_readback = 0

        self.next_heartbeat = 0

        self.operator_at = 0

        self.owner = None

        self.response_id = None



    def identified_control(self):

        return (self.firmware.get("identified") is True and self.firmware.get("boardId") == "DEQUI_HW_API"

                and self.firmware.get("version") == CONTROL_VERSION and self.firmware.get("board") == "MEGA2560")



    def compatible_control(self):

        outputs = {item["pin"]: f'{item["kind"]}{item["apiIndex"]}' for item in self.compatibility["reported"]

                   if item["kind"] in {"BOMBA", "VALVULA", "RELE"}}

        return (self.identified_control() and self.discovery["complete"] and

                self.compatibility["status"] == "compatible" and outputs == EXPECTED_OUTPUTS)



    def fresh(self):

        return self.confirmed is not None and self.confirmed_at is not None and self.clock()-self.confirmed_at < 2



    def ready(self):

        return (self.compatible_control() and self.session_ready and self.fresh() and not self.control_fault

                and self.confirmed["fault"] == "NONE" and self.safety == dict(state="READY", fault="NONE", configValid=True))



    @staticmethod
    def _operator_command(command):
        # GET CONTROL e HEARTBEAT sao trafego interno de manutencao.
        # Eles continuam serializados pelo DequiHardware, mas nao devem
        # bloquear a HMI como se fossem um comando do operador.
        return is_control(command) and command not in {"GET CONTROL", "HEARTBEAT"}

    def busy(self):
        return bool(
            self.pending and self._operator_command(self.pending["command"])
        ) or any(self._operator_command(command) for command in self.queue)

    def maintenance_pending(self, command):
        return bool(self.pending and self.pending["command"] == command) or command in self.queue



    @staticmethod

    def outputs_active(data):

        return bool(data and (any(p[0] for p in data["pumps"]) or any(v[6] or v[4]>=0 for v in data["valves"]) or any(data["oy"])))



    def stop(self, emergency=False, reason=None):
        if self.plant_reset and self.plant_reset["status"] == "pending":
            self.plant_reset.update(status="failed", message="Reset físico não confirmado: parada interrompida.")

        self.armed = False

        self.owner = None

        if reason:

            self.control_fault = reason

            self.control_error = reason

        if self.identified_control():

            # Prioridade sobre aquisição e comandos ainda não confirmados.

            self.pending = None

            self.queue = ["EMERGENCY STOP" if emergency else "DISARM"]

            self.next_send = 0

            self.confirmed = None

            self.confirmed_at = None



    def tick(self, bridge):

        connected = bool(bridge and bridge.connected)

        if bridge:

            bridge.control_enabled = connected and self.identified_control()

        if not connected:

            if self.identified_control() or self.armed:

                self.reset()

            return

        if self.identified_control() and self.discovery["complete"]:

            if self.armed and self.clock()-self.operator_at >= 3:

                self.stop(True, "HMI sem renovação de sessão")

            if self.armed and (not self.ready()):

                self.stop(True, "Estado de controle indisponível ou inseguro")

            if not self.session_ready:

                if not self.pending and "DISARM" not in self.queue and "EMERGENCY STOP" not in self.queue:

                    self.queue.insert(0, "DISARM")

            elif not self.busy():

                now = self.clock()

                if (self.armed and self.confirmed and self.outputs_active(self.confirmed)
                        and now >= self.next_heartbeat and not self.maintenance_pending("HEARTBEAT")):

                    self.queue.insert(0, "HEARTBEAT")

                    self.next_heartbeat = now + 1

                elif (now >= self.next_readback
                        and not self.maintenance_pending("GET CONTROL")):

                    self.queue.insert(0, "GET CONTROL")

                    self.next_readback = now + .5

        super().tick(bridge)



    @staticmethod

    def validate_state(data):

        def integer(v, lo, hi):

            return type(v) is int and lo <= v <= hi

        if not isinstance(data, dict) or set(data) != {"armed", "fault", "pumps", "valves", "oy"}:

            raise ValueError("Estado CTRL incompleto")

        if type(data["armed"]) is not bool or data["fault"] not in {"NONE", "EMERGENCY", "WATCHDOG"}:

            raise ValueError("Estado CTRL inválido")

        if not isinstance(data["pumps"], list) or len(data["pumps"]) != 3:

            raise ValueError("Bombas ausentes")

        for p in data["pumps"]:

            if not isinstance(p, list) or len(p) != 2 or not integer(p[0], 0, 255) or not integer(p[1], 0, 2):

                raise ValueError("Bomba inválida")

            if p[0] and not p[1]:

                raise ValueError("Bomba sem sentido")

        if not isinstance(data["valves"], list) or len(data["valves"]) != 4:

            raise ValueError("Válvulas ausentes")

        mapped = set()

        for i, v in enumerate(data["valves"]):

            if not isinstance(v, list) or len(v)!=14 or any(type(x) is not int for x in v):

                raise ValueError("Readback LV inválido")

            lv, configured, percent, angle, target, synced, active, ramp, closed, opened, low, high, target_pct, pin = v

            if not (0<=lv<=4 and configured in (0,1) and -1<=percent<=100 and -1<=target_pct<=100 and

                    -1<=angle<=180 and -1<=target<=180 and synced in (0,1) and active in (0,1) and ramp in (0,1) and pin==36+i):

                raise ValueError("LV fora de faixa")

            if configured:

                if not lv or lv in mapped or not (0<=low<=closed<=high<=180 and low<=opened<=high and closed!=opened):

                    raise ValueError("Configuração LV inválida")

                mapped.add(lv)

            if synced and (not configured or not low<=angle<=high):

                raise ValueError("Referência LV inválida")

            if not synced and angle!=-1:

                raise ValueError("Referência não sincronizada")

            if (active or target>=0) and (not configured or not synced):

                raise ValueError("LV sem configuração/referência")

            if target>=0 and not low<=target<=high:

                raise ValueError("Alvo LV fora dos limites")

            if bool(ramp) != (target>=0 and target!=angle):

                raise ValueError("Rampa incoerente")

            if active and target<0:

                raise ValueError("Pulsos sem alvo")

        if not isinstance(data["oy"],list) or len(data["oy"])!=2 or any(not integer(v,0,2) for v in data["oy"]):

            raise ValueError("OY inválida")

        if (not data["armed"] or data["fault"]!="NONE") and ManualHardware.outputs_active(data):

            raise ValueError("Saída ativa sem ARM")

        return data



    def consume(self, command, fields):

        if not is_control(command):

            return super().consume(command, fields)

        data = self.validate_state(json.loads(",".join(fields)))

        parts = command.split()

        if command == "ARM" and (not data["armed"] or data["fault"] != "NONE"):

            raise ValueError("ARM não confirmado")

        if command in {"DISARM", "EMERGENCY STOP", "RESET FAULT"} and data["armed"]:

            raise ValueError("Parada não confirmada")

        if command == "EMERGENCY STOP" and data["fault"] != "EMERGENCY":

            raise ValueError("Emergência não confirmada")

        if command == "RESET FAULT" and data["fault"] != "NONE":

            raise ValueError("Reset não confirmado")

        if parts[:2] == ["SET", "BOMBA"] and data["pumps"][int(parts[2])-1][0] != int(parts[3]):

            raise ValueError("PWM divergente")

        if parts[:2] == ["SET", "VALVULA"] and data["valves"][int(parts[2])-1][12] != int(parts[3]):

            raise ValueError("Abertura divergente")

        if parts[:2] in (["SET","LVANGLE"], ["SET","LVSYNC"]):

            v=data["valves"][int(parts[2])-1]

            if parts[1]=="LVSYNC":

                if v[3]!=int(parts[3]) or not v[5] or v[6] or v[4]!=-1:

                    raise ValueError("SYNC não confirmado")

            elif v[4]!=int(parts[3]):

                raise ValueError("Alvo não confirmado")

        if parts[:2]==["SET","LVSTOP"]:

            v=data["valves"][int(parts[2])-1]

            if v[6] or v[7] or v[4]!=-1: raise ValueError("Parada LV não confirmada")

        if parts[:2]==["SET","OY"] and data["oy"][int(parts[2])-1]!={"RELEASE":0,"A":1,"B":2}[parts[3]]:

            raise ValueError("OY não confirmada")

        if command == "DISARM" and self.plant_reset and self.plant_reset["status"] == "pending":
            if data["armed"] or self.outputs_active(data) or any(v[7] or v[12] != -1 for v in data["valves"]):
                raise ValueError("Reset físico não confirmado")
            self.plant_reset.update(status="confirmed", message="Comandos da planta zerados.", requestId=self.response_id)

        self.confirmed = data

        self.confirmed_at = self.clock()

        self.confirmed_wall = self.wall_clock()*1000

        self.safety = dict(state="READY" if data["fault"] == "NONE" else "FAULT", fault=data["fault"], configValid=True)

        if command == "DISARM":

            self.session_ready = True

        if command == "RESET FAULT":

            self.control_fault = None

            self.control_error = None

            self.session_ready = True

        if command == "ARM":

            self.armed = True

            self.operator_at = self.clock()

            self.next_heartbeat = self.clock()

        if not data["armed"] or data["fault"] != "NONE":

            self.armed = False

        if command not in {"GET CONTROL", "HEARTBEAT"}:

            self.last_confirmation = dict(command=command, at=self.confirmed_wall, requestId=self.response_id)



    def failed(self, command, reason):

        if self.plant_reset and self.plant_reset["status"] == "pending":
            self.plant_reset.update(status="failed", message=f"Reset físico não confirmado: {reason}")
        super().failed(command, reason)

        if is_control(command):

            self.control_error = f"{command}: {reason}"

            self.armed = False

            self.confirmed = None

            self.confirmed_at = None

            self.control_fault = self.control_error

            if command != "EMERGENCY STOP":

                self.stop(True, self.control_error)



    def handle(self, event):

        if self.pending and event.get("requestId") == self.pending["id"] and event.get("kind") == "OK":

            self.response_id = event["requestId"]

        if event.get("kind") == "ALERT" and self.identified_control():

            if self.pending and self.pending["command"] == "EMERGENCY STOP":

                self.armed = False

                self.control_fault = event.get("body", "FAULT")

            else:

                self.stop(True, event.get("body", "FAULT"))

        # JSON inválido também precisa invalidar a confirmação.

        try:

            super().handle(event)

        except (TypeError, json.JSONDecodeError) as exc:

            self.stop(True, str(exc))



    def request(self, message, bridge, owner=None):

        def reject(reason):

            self.control_error = reason

            return False

        if not bridge or not bridge.connected or not self.identified_control():

            return reject("Firmware RO ou indisponível: somente leitura")

        if not isinstance(message, dict) or message.get("type") != "hardware":

            return reject("Comando físico desconhecido")

        action = message.get("action")

        if not isinstance(action, str):

            return reject("Ação HARDWARE inválida")

        if self.owner is not None and owner is not self.owner and action not in {"estop", "disarm", "plant_reset"}:

            return reject("Controle pertence a outra sessão HMI")

        if action != "lease":

            self.control_error = None

        if action == "plant_reset" and set(message) == {"type", "action"}:
            if not self.compatible_control():
                return reject("Reset físico indisponível: CTRL/PINMAP incompatível")
            self.requested.clear()
            self.stop()
            self.plant_reset = dict(id=uuid.uuid4().hex, status="pending", message="Aguardando confirmação do reset físico.")
            return True

        if action == "lease" and set(message) == {"type", "action"}:

            if not self.armed or not self.ready():

                return reject("Sessão de controle inativa")

            self.operator_at = self.clock()

            return True

        if action in {"estop", "disarm"} and set(message) == {"type", "action"}:

            self.stop(action == "estop", "Emergency Stop solicitado" if action == "estop" else None)

            return True

        if self.busy():

            return reject("Aguarde a confirmação do comando pendente")

        if action == "reset" and set(message) == {"type", "action"}:

            if not self.compatible_control():

                return reject("Configuração incompatível")

            self.armed = False

            self.queue.insert(0, "RESET FAULT")

            return True

        if not self.ready():

            return reject("Controle indisponível: confirme Serial, PINMAP, SAFETY e readback")

        if action == "arm" and set(message) == {"type", "action"}:

            self.owner = owner

            self.queue.insert(0, "ARM")

            return True

        if not self.armed:

            return reject("HARDWARE não armado")

        data = self.confirmed

        if action == "pump" and set(message)=={"type","action","id","pwm"}:

            idx=PUMP_CHANNELS.get(message["id"]) if isinstance(message["id"],str) else None

            pwm=message["pwm"]

            if not idx or type(pwm) is not int or not 0<=pwm<=255 or (pwm and not data["pumps"][idx-1][1]):

                return reject("Bomba bloqueada: PWM inválido ou sentido não configurado")

            command=f"SET BOMBA {idx} {pwm}"

        elif action == "pump" and set(message)=={"type","action","id","percent"}:

            pct=message["percent"]

            if type(pct) not in (int,float) or not math.isfinite(pct) or not 0<=pct<=100: return reject("Percentual inválido")

            return self.request({"type":"hardware","action":"pump","id":message["id"],"pwm":int(pct*255/100+.5)},bridge,owner)

        elif action in {"valve","valve_angle","valve_sync","valve_stop"}:

            key="percent" if action=="valve" else "angle"

            required={"type","action","id"} | (set() if action=="valve_stop" else {key})

            if set(message)!=required: return reject("Comando LV inválido")

            candidates=[(i,v) for i,v in enumerate(data["valves"],1) if v[1] and message["id"]==f"LV{v[0]}"]

            if len(candidates)!=1: return reject("LV sem associação/limites válidos")

            idx,v=candidates[0]

            value=0 if action=="valve_stop" else message[key]

            lo,hi=(0,100) if action=="valve" else (v[10],v[11])

            if action!="valve_stop" and (type(value) not in (int,float) or not math.isfinite(value) or not lo<=value<=hi):

                return reject("LV fora dos limites físicos")

            if action in {"valve","valve_angle"} and not v[5]: return reject("LV não sincronizada")

            verb={"valve":"VALVULA","valve_angle":"LVANGLE","valve_sync":"LVSYNC","valve_stop":"LVSTOP"}[action]

            command=f"SET {verb} {idx} {int(value+.5)}"

        elif action=="oy" and set(message)=={"type","action","id","state"}:

            if message["id"] not in ("OY1","OY2") or message["state"] not in ("A","B","RELEASE"):

                return reject("OY inválida")

            command=f"SET OY {message['id'][-1]} {message['state']}"

        else:

            return reject("Comando físico proibido")

        self.requested[message["id"]] = dict(message)

        self.queue.insert(0, command)

        return True



    def snapshot(self):

        result = super().snapshot()

        data = copy.deepcopy(self.confirmed) if self.fresh() else None

        result["control"] = dict(supported=self.identified_control(), ready=bool(self.ready()),

            armed=bool(self.armed and self.ready()), busy=self.busy(), confirmed=data,

            confirmedAt=self.confirmed_wall if data else None, requested=copy.deepcopy(self.requested),

            lastConfirmation=self.last_confirmation, lastError=self.control_error, fault=self.control_fault,

            pumpChannels=PUMP_CHANNELS, compatible=self.compatible_control(), plantReset=copy.deepcopy(self.plant_reset))

        return result
