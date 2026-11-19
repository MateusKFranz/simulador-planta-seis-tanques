"""Modo MODELICA do backend: planta (FMU v13) + banco de controladores (FMU)
executados em tempo real (ou acelerado) e publicados no mesmo `state` que
os modos MOCK e HARDWARE usam.

Laço (chamado pelo server.py a cada 100 ms de relógio):
    para cada subpasso de 0,1 s de simulação (speed subpassos por chamada):
        PV  <- últimas saídas da planta
        MV  <- banco.passo(PV)
        atuadores <- MV das malhas em AUTO (as em MAN seguem o operador)
        planta.passo(0,1 s)
    state <- saídas da planta, malhas, alarmes, relógio

Comandos aceitos (além de pump/valve/manual_valve/relay dos outros modos):
    {"type": "scenario", "id": "nivel"}
    {"type": "loop", "id": "LIC1", "sp": 9, "mode": "AUTO"|"MAN", "mv": 0.4,
                     "tuning": {"type": "PI"|"PID_ISA", "kp":..., "ti":..., "td":..., ...}}
    {"type": "xv", "id": "OY1"|"OY2", "tA": 3, "tB": 2}
    {"type": "sim", "running": true|false, "speed": 1|2|5|10, "reset": true,
                    "levels": {"TQ1": 0, ...}}   # níveis iniciais (cm) usados no reset
"""

from common.instrument_ids import LEVEL_IDS, FLOW_CHANNEL_IDS

import time

from simulation import cenarios
from simulation.controle import BancoControladores
from common.operation import Operation, valid_loop_command
from simulation.modelica_plant import PlantaModelica, VALVULAS_CONTROLE, VALVULAS_MANUAIS, VALVULAS_3VIAS, BOMBAS

PASSO_S = 0.1
VELOCIDADES = (0.25, 0.5, 1, 2, 5, 10)

# Limites de alarme de nível, em fração da altura útil
NIVEL_ALTO = 0.90
NIVEL_MUITO_ALTO = 0.99
NIVEL_BAIXO_SUCCAO_CM = 0.5


class RuntimeModelica:
    def __init__(self, state, cenario=cenarios.CENARIO_PADRAO):
        self.state = state
        self.planta = PlantaModelica()
        self.banco = BancoControladores()
        self.operation = Operation(self.banco, self._valor_atuador, self._ler_pv)
        self.manual_oy = {"OY1": "A", "OY2": "A"}
        self.running = False
        self.speed = 1
        self.niveis_iniciais = {t: 0.0 for t in ("TQ1", "TQ2", "TQ3", "TQ4", "TQ5", "TQ6")}
        self.xv = {"OY1": {"tA": 3.0, "tB": 2.0}, "OY2": {"tA": 2.0, "tB": 3.0}}
        self.cenario_id = None
        self.cenario = None
        self.razao_tempo_real = 1.0
        self._cpu_por_tick = 0.0
        self.ultimo_erro = None

        self._preparar_estado_inicial()
        self.planta.iniciar(self.niveis_iniciais)
        self._aplicar_atuadores_na_planta()
        self.definir_cenario(cenario)
        self._publicar()

    # ------------------------------------------------------------- estado
    def _preparar_estado_inicial(self):
        s = self.state
        for p in s["pumps"].values():
            p["power"] = False
            p["command"] = 0.0
        for v in s["actuatedValves"].values():
            v["opening"] = 0.0
        for sensor in s["levelSensors"].values():
            sensor.update(raw=None, status="available")
        for sensor in s["flowSensors"].values():
            sensor.update(raw=None, frequency=None, status="available")
        s["mode"] = "MODELICA"
        s["scenarios"] = cenarios.resumo_cenarios()
        s["loops"] = {}
        s["alarms"] = []
        # Estimativas de operação da planta (cenarios.PARAMETROS_PLANTA), por cima
        # dos padrões da FMU; valem até haver medições da bancada.
        for nome, valor in cenarios.PARAMETROS_PLANTA.items():
            self.planta.parametros[nome] = float(valor)
        self._aplicar_valvulas_manuais(dict.fromkeys(VALVULAS_MANUAIS, 0.0), reiniciar=False)

    def _aplicar_atuadores_na_planta(self):
        s = self.state
        for pid in BOMBAS:
            p = s["pumps"][pid]
            self.planta.definir_bomba(pid, bool(p["power"]), float(p["command"]))
        for vid in VALVULAS_CONTROLE:
            self.planta.definir_valvula_controle(vid, float(s["actuatedValves"][vid]["opening"]))
        for xid, t in self.xv.items():
            self._apply_oy(xid)

    # ----------------------------------------------------------- cenários
    def definir_cenario(self, cenario_id):
        was_auto = self.operation.mode == "AUTO"
        self.operation.prepare(cenario_id)
        self.cenario_id = cenario_id
        self.cenario = self.operation.scenario
        if was_auto:
            self.operation.mode = "MANUAL"
            self.operation.set_mode("AUTO")
            self._apply_fixed()
        self._publicar()
        return True

    def _apply_fixed(self):
        fixed = self.cenario.get("fixos", {})
        for pid, value in fixed.get("pumps", {}).items():
            self._escrever_atuador({"tipo": "bomba", "id": pid}, float(value))
        for vid, value in fixed.get("actuatedValves", {}).items():
            self._escrever_atuador({"tipo": "valvula", "id": vid}, float(value))
        self._aplicar_valvulas_manuais(fixed.get("valvulas_manuais", {}))

    def _apply_oy(self, xid):
        times = self.xv[xid] if self.operation.mode == "AUTO" else (
            {"tA": 1., "tB": 0.} if self.manual_oy[xid] == "A" else {"tA": 0., "tB": 1.})
        self.planta.definir_3vias(xid, times["tA"], times["tB"])

    def _aplicar_valvulas_manuais(self, aberturas, *, reiniciar=True):
        s = self.state
        mudou = False
        for vid, abertura in aberturas.items():
            abertura = _clamp(float(abertura))
            if vid == "HV9":
                s["mainValve"]["opening"] = abertura
            elif vid in s["recycleValves"]:
                s["recycleValves"][vid]["opening"] = abertura
            elif vid in s["manualValves"]:
                s["manualValves"][vid]["opening"] = abertura
            else:
                continue
            nome = VALVULAS_MANUAIS[vid]
            if self.planta.parametros.get(nome) != abertura:
                self.planta.parametros[nome] = abertura
                mudou = True
        if reiniciar and mudou and self.planta.inicializada:
            self.planta.reiniciar_mantendo_niveis()

    def _aplicar_modos_iniciais(self):
        for m in self.cenario["malhas"]:
            if m.get("modo_inicial", "MAN") == "AUTO":
                self.banco.ajustar(m["tag"], modo="AUTO")

    def _pvs(self):
        return {tag: self._ler_pv(m.definicao["pv"]) for tag, m in self.banco.malhas.items()}

    def _atualizar_pvs(self):
        self.banco.atualizar_pvs(self._pvs())

    def _valor_atuador(self, mv):
        s = self.state
        if mv["tipo"] == "valvula":
            return float(s["actuatedValves"][mv["id"]]["opening"])
        if mv["tipo"] == "bomba":
            p = s["pumps"][mv["id"]]
            return float(p["command"]) if p["power"] else 0.0
        return 0.0

    def _ler_pv(self, pv):
        niveis = self.planta.niveis_cm()
        vazoes = self.planta.vazoes_l_min()
        if pv["tipo"] == "nivel":
            return niveis.get(pv["id"])
        if pv["tipo"] == "vazao":
            return vazoes.get(pv["id"])
        if pv["tipo"] == "vazao_soma":
            valores = [vazoes.get(i) for i in pv["ids"]]
            if any(v is None for v in valores):
                return None
            return sum(valores)
        return None

    # ---------------------------------------------------------------- laço
    def tick(self):
        """Avança a simulação o equivalente a 100 ms de relógio vezes a velocidade."""
        if not self.running:
            self._atualizar_pvs()
            self._publicar()
            return
        inicio = time.perf_counter()
        subpassos = max(1, int(round(self.speed)))
        passo = PASSO_S if self.speed >= 1 else PASSO_S * self.speed
        try:
            for _ in range(subpassos):
                mvs = self.operation.step(passo)
                self._aplicar_mvs(mvs)
                self.planta.passo(passo)
            self.ultimo_erro = None
        except RuntimeError as exc:
            self.ultimo_erro = str(exc)
            self.running = False
        self._cpu_por_tick = time.perf_counter() - inicio
        if self._cpu_por_tick > 0:
            self.razao_tempo_real = min(99.0, 0.1 / self._cpu_por_tick)
        self._publicar()

    def _aplicar_mvs(self, mvs):
        """MV das malhas em AUTO vão para os atuadores; em MAN o atuador segue a HMI
        (e o banco acompanha para a transferência ser sem salto)."""
        s = self.state
        for tag, mv in mvs.items():
            malha = self.banco.malhas[tag]
            alvo = malha.definicao["mv"]
            if malha.modo_efetivo() == "AUTO":
                if alvo["tipo"] == "valvula":
                    s["actuatedValves"][alvo["id"]]["opening"] = mv
                    self.planta.definir_valvula_controle(alvo["id"], mv)
                elif alvo["tipo"] == "bomba":
                    p = s["pumps"][alvo["id"]]
                    p["power"] = True
                    p["command"] = mv
                    self.planta.definir_bomba(alvo["id"], True, mv)
            else:
                valor = self._valor_atuador(alvo)
                if abs(valor - malha.mv_manual) > 1e-9:
                    self.banco.ajustar(tag, mv_manual=valor)

    # ------------------------------------------------------------ comandos
    def handle_command(self, message):
        tipo = message.get("type")
        s = self.state
        try:
            if tipo == "hello":
                return True

            if tipo == "operation":
                mode = message.get("mode")
                changed = mode != self.operation.mode
                if changed and mode == "MANUAL":
                    branches = self.planta.reles()
                    for xid in self.xv:
                        self.manual_oy[xid] = "A" if branches[f"{xid}_A"] else "B"
                self.operation.set_mode(mode)
                if changed and mode == "AUTO":
                    self._apply_fixed()
                for xid in self.xv:
                    self._apply_oy(xid)
                return True

            if tipo == "pump":
                pid = message.get("id")
                if self.operation.mode == "AUTO" and pid in self.cenario.get("fixos", {}).get("pumps", {}):
                    return False
                if pid not in s["pumps"]:
                    return False
                malha = self.banco.malha_do_atuador("bomba", pid)
                if malha is not None and malha.modo_efetivo() == "AUTO":
                    return False            # em AUTO o controlador manda
                p = s["pumps"][pid]
                if "power" in message:
                    p["power"] = bool(message["power"])
                if "command" in message:
                    p["command"] = _clamp(float(message["command"]))
                self.planta.definir_bomba(pid, p["power"], p["command"])
                return True

            if tipo == "valve":
                vid = message.get("id")
                abertura = _clamp(float(message.get("opening", 0.0)))
                if vid == "HV9":
                    s["mainValve"]["opening"] = abertura
                    self.planta.definir_valvula_manual("HV9", abertura)
                    return True
                if self.operation.mode == "AUTO" and vid in self.cenario.get("fixos", {}).get("actuatedValves", {}):
                    return False
                if vid in s["actuatedValves"]:
                    malha = self.banco.malha_do_atuador("valvula", vid)
                    if malha is not None and malha.modo_efetivo() == "AUTO":
                        return False
                    s["actuatedValves"][vid]["opening"] = abertura
                    self.planta.definir_valvula_controle(vid, abertura)
                    return True
                return False

            if tipo == "manual_valve":
                vid = message.get("id")
                abertura = _clamp(float(message.get("opening", 0.0)))
                if vid in s["recycleValves"]:
                    s["recycleValves"][vid]["opening"] = abertura
                elif vid in s["manualValves"]:
                    s["manualValves"][vid]["opening"] = abertura
                else:
                    return False
                self.planta.definir_valvula_manual(vid, abertura)
                return True

            if tipo == "oy":
                xid, branch = message.get("id"), message.get("state")
                if self.operation.mode != "MANUAL" or xid not in self.xv or branch not in ("A", "B"):
                    return False
                self.manual_oy[xid] = branch
                self._apply_oy(xid)
                return True

            if tipo == "xv":
                xid = message.get("id")
                if xid not in self.xv:
                    return False
                import math
                ta, tb = float(message["tA"]), float(message["tB"])
                if not all(math.isfinite(v) and v >= 0 for v in (ta, tb)) or ta+tb <= 0:
                    return False
                self.xv[xid] = {"tA": ta, "tB": tb}
                self._apply_oy(xid)
                return True

            if tipo == "scenario":
                return self.definir_cenario(str(message.get("id")))

            if tipo == "loop":
                if not valid_loop_command(message):
                    return False
                current = self.banco.malhas.get(str(message.get("id")))
                if current and current.modo != "AUTO" and message.get("mode") == "AUTO" and self.operation.mode == "AUTO":
                    self.operation.align()
                sintonia = message.get("tuning")
                if isinstance(sintonia, dict):
                    sintonia = {("tipo" if k == "type" else k): v for k, v in sintonia.items()}
                ok = self.banco.ajustar(
                    str(message.get("id")),
                    sp=message.get("sp"),
                    modo=message.get("mode"),
                    mv_manual=message.get("mv"),
                    sintonia=sintonia,
                )
                if ok and message.get("mv") is not None:
                    malha = self.banco.malhas[str(message.get("id"))]
                    if malha.modo_efetivo() == "MAN":
                        self._escrever_atuador(malha.definicao["mv"], malha.mv_manual)
                return ok

            if tipo == "sim":
                if "speed" in message:
                    velocidade = float(message["speed"])
                    if velocidade in VELOCIDADES:
                        self.speed = velocidade
                if isinstance(message.get("levels"), dict):
                    for tid, valor in message["levels"].items():
                        if tid in self.niveis_iniciais and valor is not None:
                            self.niveis_iniciais[tid] = max(0.0, min(self.planta.altura_util_cm(), float(valor)))
                if message.get("reset"):
                    self.reset()
                if "running" in message:
                    self.running = bool(message["running"])
                return True

            return False
        except (TypeError, ValueError, KeyError):
            return False
        finally:
            self._publicar()

    def _escrever_atuador(self, alvo, valor):
        s = self.state
        if alvo["tipo"] == "valvula":
            s["actuatedValves"][alvo["id"]]["opening"] = valor
            self.planta.definir_valvula_controle(alvo["id"], valor)
        elif alvo["tipo"] == "bomba":
            p = s["pumps"][alvo["id"]]
            p["power"] = valor > 0
            p["command"] = valor
            self.planta.definir_bomba(alvo["id"], p["power"], valor)

    def reset(self):
        self.running = False
        self._aplicar_valvulas_manuais(dict.fromkeys(VALVULAS_MANUAIS, 0.0), reiniciar=False)
        self.planta.iniciar(self.niveis_iniciais)
        self._aplicar_atuadores_na_planta()
        self.banco.reiniciar()
        self._atualizar_pvs()
        self._aplicar_modos_iniciais()
        self.ultimo_erro = None

    # ------------------------------------------------------------ publicar
    def _publicar(self):
        s = self.state
        niveis = self.planta.niveis_cm()
        h_max = self.planta.altura_util_cm()
        sensores = self.planta.sensores_nivel()
        capacity_l = self.planta.volume_litros(h_max)
        for i in range(1, 7):
            tid = f"TQ{i}"
            lid = LEVEL_IDS[i - 1]
            h = niveis[tid]
            pct = max(0.0, min(100.0, h / h_max * 100.0)) if h_max > 0 else 0.0
            s["tanks"][tid].update(
                level=pct,
                height=h / 100.0,
                heightCm=h,
                volume=self.planta.volume_litros(h),
                capacityL=capacity_l,
            )
            s["levelSensors"][lid].update(
                level=pct,
                heightCm=h,
                pressure=sensores[lid]["pressure"],
                voltage=sensores[lid]["voltage"],
                raw=None,
                status="available",
            )
        for fid, vazao in self.planta.vazoes_l_min().items():
            s["flowSensors"][fid].update(flow=vazao, raw=None, frequency=None, status="available")
        for rid, ligado in self.planta.reles().items():
            s["threeWayValves"][rid]["state"] = ligado

        trechos = self.planta.trechos_l_min()
        s["segments"] = trechos
        s["flows"] = _flows_legado(trechos)
        s["xv"] = {k: dict(v) for k, v in self.xv.items()}
        s["loops"] = self.banco.estado()
        s["scenario"] = self.cenario_id
        s["operation"] = self.operation.snapshot()
        s["sim"] = {
            "t": self.planta.t,
            "running": self.running,
            "speed": self.speed,
            "realtimeRatio": self.razao_tempo_real,
            "cpuMs": self._cpu_por_tick * 1000.0,
            "initialLevels": dict(self.niveis_iniciais),
            "tankHeightCm": h_max,
            "error": self.ultimo_erro,
        }
        s["alarms"] = self._alarmes(niveis, h_max)

    def _alarmes(self, niveis, h_max):
        s = self.state
        alarmes = []
        for i in range(1, 7):
            tid = f"TQ{i}"
            h = niveis[tid]
            if h >= NIVEL_MUITO_ALTO * h_max:
                alarmes.append({"tag": LEVEL_IDS[i - 1], "priority": 1, "text": "nível muito alto (transbordo)"})
            elif h >= NIVEL_ALTO * h_max:
                alarmes.append({"tag": LEVEL_IDS[i - 1], "priority": 2, "text": "nível alto"})
        for pid, tid in (("JIC3", "TQ3"), ("JIC4", "TQ4")):
            p = s["pumps"][pid]
            if p["power"] and p["command"] > 0 and niveis[tid] < NIVEL_BAIXO_SUCCAO_CM:
                alarmes.append({"tag": pid, "priority": 3, "text": "bomba sem sucção (tanque vazio)"})
        for tag, m in self.banco.malhas.items():
            if m.qualidade != "good":
                alarmes.append({"tag": tag, "priority": 2, "text": "PV sem dado; malha em MAN"})
        if self.ultimo_erro:
            alarmes.append({"tag": "SIM", "priority": 1, "text": self.ultimo_erro})
        return alarmes


def _flows_legado(t):
    """Mapa de trechos no formato usado pelo MOCK/HARDWARE (L/min)."""
    return {
        "RES_JIC1": t["JIC1"], "JIC1_HV9": t["JIC1"],
        "HV9_LV1": t["LV1"], "HV9_LV2": t["LV2"],
        "LV1_OY1_A": t["OY1_A"], "OY1_A_OUT": t["OY1_A"], "OY1_A_TQ3": t["OY1_A"],
        "LV1_OY1_B": t["OY1_B"], "OY1_B_FI6": t["OY1_B"], "FI6_TQ6": t["OY1_B"],
        "LV2_OY2_A": t["OY2_A"], "OY2_A_FI5": t["OY2_A"], "FI5_TQ5": t["OY2_A"],
        "LV2_OY2_B": t["OY2_B"], "OY2_B_OUT": t["OY2_B"], "OY2_B_TQ4": t["OY2_B"],
        "JIC3_LV3": t["LV3"], "LV3_FI3": t["LV3"], "FI3_TQ1": t["LV3"],
        "JIC4_LV4": t["LV4"], "LV4_FI4": t["LV4"], "FI4_TQ2": t["LV4"],
        "TQ5_HV5": t["HV5"], "HV5_TQ3": t["HV5"],
        "JIC3_HV7": t["HV7"], "HV7_TQ3": t["HV7"],
        "TQ3_HV3": t["JIC3"], "HV3_JIC3": t["JIC3"],
        "TQ6_HV6": t["HV6"], "HV6_TQ4": t["HV6"],
        "JIC4_HV8": t["HV8"], "HV8_TQ4": t["HV8"],
        "TQ4_HV4": t["JIC4"], "HV4_JIC4": t["JIC4"],
        "TQ1_HV1": t["HV1"], "HV1_RES": t["HV1"],
        "TQ2_HV2": t["HV2"], "HV2_RES": t["HV2"],
    }


def _clamp(valor, minimo=0.0, maximo=1.0):
    return max(minimo, min(maximo, valor))
