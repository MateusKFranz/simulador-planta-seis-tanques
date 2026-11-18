"""Autoridade operacional comum às plantas simulada e física; PID permanece na FMU."""
from simulation import cenarios
import math


class Operation:
    def __init__(self, banco, read_mv, read_pv):
        self.banco = banco
        self.read_mv = read_mv
        self.read_pv = read_pv
        self.mode = "MANUAL"
        self.scenario_id = None
        self.scenario = None

    def prepare(self, scenario_id):
        scenario = cenarios.obter_cenario(scenario_id)
        initial = {m["tag"]: self.read_mv(m["mv"]) for m in scenario["malhas"]}
        self.banco.configurar(scenario["malhas"], initial)
        self.scenario_id, self.scenario = scenario_id, scenario
        for m in self.banco.malhas.values():
            m.modo = m.definicao.get("modo_inicial", "MAN")
            m.authority = False
        self.track()

    def pvs(self):
        return {tag: self.read_pv(m.definicao["pv"]) for tag, m in self.banco.malhas.items()}

    def track(self):
        for m in self.banco.malhas.values():
            m.mv_manual = self.read_mv(m.definicao["mv"])
        self.banco.atualizar_pvs(self.pvs())

    def align(self):
        """Assenta o tracking MAN da FMU com PV/MV constantes, sem atuar na planta."""
        authorities = {tag: m.authority for tag, m in self.banco.malhas.items()}
        try:
            for m in self.banco.malhas.values():
                m.authority = False
            self.track()
            for _ in range(60):
                self.banco.passo(self.pvs(), .1)
        finally:
            for tag, m in self.banco.malhas.items():
                m.authority = authorities[tag]
            self.banco.atualizar_pvs(self.pvs())

    def set_mode(self, mode):
        if mode not in ("MANUAL", "AUTO"):
            raise ValueError("Modo operacional inválido")
        if mode == self.mode:
            return
        if mode == "AUTO":
            self.align()
        else:
            self.track()
        self.mode = mode
        for m in self.banco.malhas.values():
            m.authority = mode == "AUTO"
        self.banco.atualizar_pvs(self.pvs())

    def step(self, dt):
        for m in self.banco.malhas.values():
            if self.mode != "AUTO" or m.modo_efetivo() != "AUTO":
                m.mv_manual = self.read_mv(m.definicao["mv"])
        values = self.banco.passo(self.pvs(), dt)
        return {tag: value for tag, value in values.items()
                if self.mode == "AUTO" and self.banco.malhas[tag].modo_efetivo() == "AUTO"}

    def snapshot(self, reasons=()):
        return dict(mode=self.mode, autoBlocked=list(reasons),
                    fixed=self.scenario.get("fixos", {}) if self.scenario else {})


def valid_loop_command(message):
    if message.get("mode") is not None and message["mode"] not in ("AUTO", "MAN"):
        return False
    values = [message[k] for k in ("sp", "mv") if k in message]
    tuning = message.get("tuning", {})
    if not isinstance(tuning, dict):
        return False
    if "type" in tuning and tuning["type"] not in ("PI", "PID_ISA"):
        return False
    values.extend(value for key, value in tuning.items() if key != "type")
    return all(type(value) in (int, float) and math.isfinite(value) for value in values)
