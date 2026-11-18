"""Testes do modo MODELICA (planta + controladores em FMU).

Rodam só no ambiente com PyFMI e com as FMUs geradas (python/build_fmu.py);
fora dele são pulados, sem falhar.

    python -m unittest discover -s python -p test_modelica.py
"""

import _test_calibration  # Isola os dados de campo antes de importar server.
import os
import unittest

os.environ.setdefault("SIX_TANK_MODE", "MODELICA")

try:
    import pyfmi  # noqa: F401
    TEM_PYFMI = True
except ImportError:
    TEM_PYFMI = False

from simulation import cenarios
from simulation.modelica_plant import FMU_PLANTA
from simulation.controle import FMU_CONTROLE

TEM_FMUS = os.path.isfile(FMU_PLANTA) and os.path.isfile(FMU_CONTROLE)


def avancar(rt, segundos):
    """Avança a simulação em `segundos` de tempo simulado."""
    ticks = int(round(segundos / (0.1 * rt.speed)))
    for _ in range(ticks):
        rt.tick()


@unittest.skipUnless(TEM_PYFMI and TEM_FMUS, "PyFMI ou FMUs ausentes")
class RuntimeModelicaTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        import server
        from simulation.modelica_runtime import RuntimeModelica
        cls.server = server
        cls.state = server.state
        cls.rt = RuntimeModelica(server.state)

    def setUp(self):
        self.rt.handle_command({"type": "sim", "reset": True, "levels": {t: 0 for t in self.rt.niveis_iniciais}})
        self.rt.handle_command({"type": "scenario", "id": "nivel"})
        self.rt.handle_command({"type": "operation", "mode": "AUTO"})
        self.rt.handle_command({"type": "sim", "running": True, "speed": 10})

    def todas_man(self):
        for tag in list(self.state["loops"]):
            self.rt.handle_command({"type": "loop", "id": tag, "mode": "MAN"})

    def media_pv(self, tag, segundos=10):
        """Média da PV em um trecho (tira o dente de serra das válvulas de 3 vias)."""
        valores = []
        for _ in range(int(segundos / (0.1 * self.rt.speed))):
            self.rt.tick()
            valores.append(self.state["loops"][tag]["pv"])
        return sum(valores) / len(valores)

    def test_startup_paused_start_pause_continue_reset(self):
        import copy
        from simulation.modelica_runtime import RuntimeModelica
        state=copy.deepcopy(self.state)
        rt=RuntimeModelica(state)
        self.assertFalse(rt.running)
        self.assertFalse(state["sim"]["running"])
        start=state["sim"]["t"];rt.tick()
        self.assertEqual(state["sim"]["t"],start)
        rt.handle_command({"type":"sim","reset":True});rt.tick()
        self.assertFalse(rt.running)
        rt.handle_command({"type":"sim","running":True});rt.tick()
        self.assertGreater(state["sim"]["t"],start)
        rt.handle_command({"type":"sim","running":False});rt.tick()
        paused=state["sim"]["t"];rt.tick();self.assertEqual(state["sim"]["t"],paused)
        rt.handle_command({"type":"sim","running":True});rt.tick()
        self.assertGreater(state["sim"]["t"],paused)
        rt.handle_command({"type":"sim","reset":True});rt.tick()
        self.assertFalse(state["sim"]["running"])
        self.assertEqual(state["sim"]["t"],0)

    def test_capacity_readback_comes_from_fmu_profile(self):
        expected=self.rt.planta.volume_litros(self.rt.planta.altura_util_cm())
        self.assertGreater(expected,0)
        for tank in self.state["tanks"].values():
            self.assertAlmostEqual(tank["capacityL"],expected)
        self.assertFalse(self.rt.handle_command({"type":"capacity","id":"TQ1","capacityL":5}))
        self.rt.handle_command({"type":"sim","reset":True})
        self.assertAlmostEqual(self.state["tanks"]["TQ1"]["capacityL"],expected)

    def test_estado_publicado(self):
        s = self.state
        self.assertEqual(s["mode"], "MODELICA")
        self.assertEqual(s["scenario"], "nivel")
        self.assertEqual(set(s["loops"]), {"LIC1", "LIC2", "LIC3", "LIC4"})
        self.assertIn("sim", s)
        self.assertIn("segments", s)
        self.assertEqual(len(s["flows"]), 38)
        self.assertEqual(set(s["tanks"]), {f"TQ{i}" for i in range(1, 7)})
        self.assertEqual(set(s["sim"]["initialLevels"]), set(s["tanks"]))
        for malha in s["loops"].values():
            if malha["pvSource"]["tipo"] == "nivel":
                self.assertIn(malha["pvSource"]["id"], s["tanks"])
        for tid in ("TQ1", "TQ6"):
            self.assertIn("heightCm", s["tanks"][tid])
        import json
        json.dumps(s)

    def test_identificadores_publicos(self):
        from simulation.modelica_plant import SENSORES_VAZAO
        esperado = {"FI1": "FT101", "FI2": "FT102", "FI3": "FT105",
                    "FI4": "FT106", "FI5": "FT103", "FI6": "FT104"}
        self.assertEqual(SENSORES_VAZAO, esperado)
        snapshot = self.server.public_state()
        self.assertEqual(set(snapshot["flowSensors"]), set(esperado))
        self.assertEqual(set(snapshot["levelSensors"]), {"LI1", "LI2", "LI3", "LI4", "LI5", "LI6"})
        self.assertEqual(set(snapshot["pumps"]), {"JIC1", "JIC3", "JIC4"})
        self.assertEqual(set(snapshot["actuatedValves"]), {"LV1", "LV2", "LV3", "LV4"})
        self.assertEqual(set(snapshot["threeWayValves"]), {"OY1", "OY2"})
        for equipment in snapshot["threeWayValves"].values():
            self.assertEqual(set(equipment["branches"]), {"A", "B"})
        for tag, variable in esperado.items():
            self.assertAlmostEqual(snapshot["flowSensors"][tag]["flow"],
                                   float(self.rt.planta.fmu.get(variable)[0]))
        self.assertFalse(self.rt.handle_command({"type": "pump", "id": "P1", "power": True}))
        self.assertFalse(self.rt.handle_command({"type": "valve", "id": "V1", "opening": 0.5}))

    def test_loop_ids_and_level_ids_remain_distinct_in_all_scenarios(self):
        tags = set()
        for scenario in cenarios.CENARIOS:
            self.rt.handle_command({'type': 'scenario', 'id': scenario})
            snapshot = self.server.public_state()
            self.assertEqual(set(snapshot['levelSensors']), {f'LI{i}' for i in range(1, 7)})
            expected = {m['tag'] for m in cenarios.CENARIOS[scenario]['malhas']}
            self.assertEqual(set(snapshot['loops']), expected)
            tags.update(expected)
            for tag in expected:
                self.assertTrue(self.rt.handle_command({'type': 'loop', 'id': tag, 'mode': 'MAN', 'sp': 1, 'tuning': {'kp': .2}}))
                loop = self.state['loops'][tag]
                self.assertEqual(loop['mode'], 'MAN')
                self.assertEqual(loop['sp'], 1)
                self.assertEqual(loop['kp'], .2)
            self.assertNotIn('LI3', snapshot['loops'])
            self.assertNotIn('LIC3', snapshot['levelSensors'])
        self.assertEqual(tags, {'LIC1', 'LIC2', 'LIC3', 'LIC4', 'FIC1', 'FIC2', 'FIC3'})

    def test_malhas_comecam_no_modo_do_cenario(self):
        for malha in self.state["loops"].values():
            self.assertEqual(malha["mode"], "AUTO")

    def test_cenarios_funcionais_partindo_do_vazio(self):
        # Casos relatados: nível parado e tanques esvaziando. Rodar sem tocar em
        # nada, partindo dos tanques vazios: toda malha chega ao SP sem saturar
        # e nenhum tanque esvazia nem transborda.
        for nome in cenarios.CENARIOS:
            self.rt.handle_command({"type": "sim", "reset": True})
            self.rt.handle_command({"type": "scenario", "id": nome})
            self.rt.handle_command({"type": "sim", "running": True, "speed": 10})
            avancar(self.rt, 1500)
            for tag, malha in self.state["loops"].items():
                pv = self.media_pv(tag)
                tolerancia = 0.15 if malha["unit"] == "cm" else 0.05
                self.assertAlmostEqual(pv, malha["sp"], delta=tolerancia, msg=f"{nome} {tag}")
                self.assertTrue(0.02 < malha["mv"] < 0.98, f"{nome} {tag}: HV9 saturada em {malha['mv']:.2f}")
            for tid, tanque in self.state["tanks"].items():
                self.assertGreater(tanque["heightCm"], 3.0, f"{nome}: {tid} vazio")
                self.assertLess(tanque["heightCm"], 22.0, f"{nome}: {tid} quase transbordando")
            self.assertEqual(self.state["alarms"], [], nome)

    def test_degrau_de_sp_nivel(self):
        avancar(self.rt, 1500)
        self.rt.handle_command({"type": "loop", "id": "LIC1", "sp": 14.0})
        avancar(self.rt, 400)
        self.assertAlmostEqual(self.media_pv("LIC1"), 14.0, delta=0.15)

    def test_tempo_avanca_com_velocidade(self):
        t0 = self.state["sim"]["t"]
        avancar(self.rt, 20)
        self.assertAlmostEqual(self.state["sim"]["t"] - t0, 20.0, places=6)

    def test_pausa_congela(self):
        self.rt.handle_command({"type": "sim", "running": False})
        t0 = self.state["sim"]["t"]
        self.rt.tick()
        self.assertEqual(self.state["sim"]["t"], t0)

    def test_manual_atua_e_auto_recusa_comando_direto(self):
        self.todas_man()
        # LV-103 fechada: a B-101 não tira água de TQ-103 e ele acumula
        self.assertTrue(self.rt.handle_command({"type": "valve", "id": "LV3", "opening": 0.0}))
        self.assertTrue(self.rt.handle_command({"type": "valve", "id": "LV1", "opening": 0.6}))
        self.assertEqual(self.state["actuatedValves"]["LV1"]["opening"], 0.6)
        avancar(self.rt, 60)
        self.assertGreater(self.state["tanks"]["TQ3"]["heightCm"], 0.5)
        self.assertTrue(self.rt.handle_command({"type": "loop", "id": "LIC3", "mode": "AUTO"}))
        self.assertFalse(self.rt.handle_command({"type": "valve", "id": "LV1", "opening": 0.1}))

    def test_transferencia_sem_salto(self):
        self.todas_man()
        self.rt.handle_command({"type": "valve", "id": "LV1", "opening": 0.4})
        self.rt.handle_command({"type": "sim", "speed": 1})
        avancar(self.rt, 5)
        mv_antes = self.state["loops"]["LIC3"]["mv"]
        self.assertAlmostEqual(mv_antes, 0.4, places=3)
        self.rt.handle_command({"type": "loop", "id": "LIC3", "mode": "AUTO"})
        self.rt.tick()
        mv_depois = self.state["loops"]["LIC3"]["mv"]
        self.assertLess(abs(mv_depois - mv_antes), 0.02)

    def test_malha_de_vazao_converge(self):
        self.rt.handle_command({"type": "scenario", "id": "vazao_valvula"})
        for tag in list(self.state["loops"]):
            self.rt.handle_command({"type": "loop", "id": tag, "mode": "AUTO"})
        self.rt.handle_command({"type": "loop", "id": "FIC1", "sp": 2.0})
        avancar(self.rt, 120)
        malha = self.state["loops"]["FIC1"]
        self.assertAlmostEqual(malha["pv"], 2.0, delta=0.05)
        # a PV da malha é lida no início do subpasso; o FT, no fim
        self.assertAlmostEqual(self.state["flowSensors"]["FI1"]["flow"], malha["pv"], delta=0.01)

    def test_pi_zera_td_e_sintonia_em_execucao(self):
        self.rt.handle_command({"type": "loop", "id": "LIC1", "tuning": {"type": "PI", "td": 5, "kp": 0.2}})
        malha = self.state["loops"]["LIC1"]
        self.assertEqual(malha["type"], "PI")
        self.assertEqual(malha["td"], 0.0)
        self.assertEqual(malha["kp"], 0.2)
        self.rt.handle_command({"type": "loop", "id": "LIC1", "tuning": {"type": "PID_ISA", "td": 5}})
        self.assertEqual(self.state["loops"]["LIC1"]["td"], 5.0)

    def test_sp_respeita_limites(self):
        self.rt.handle_command({"type": "loop", "id": "LIC1", "sp": 99})
        self.assertEqual(self.state["loops"]["LIC1"]["sp"], 25.0)
        self.rt.handle_command({"type": "loop", "id": "LIC1", "sp": -3})
        self.assertEqual(self.state["loops"]["LIC1"]["sp"], 0.0)

    def test_valvula_manual_nao_perde_nivel(self):
        self.todas_man()
        self.rt.handle_command({"type": "valve", "id": "LV1", "opening": 0.6})
        avancar(self.rt, 60)
        h = self.state["tanks"]["TQ3"]["heightCm"]
        self.assertTrue(self.rt.handle_command({"type": "manual_valve", "id": "HV3", "opening": 0.4}))
        self.assertAlmostEqual(self.state["tanks"]["TQ3"]["heightCm"], h, places=3)
        self.assertEqual(self.state["manualValves"]["HV3"]["opening"], 0.4)

    def test_xv_temporizada_alterna(self):
        self.rt.handle_command({"type": "xv", "id": "OY1", "tA": 1, "tB": 1})
        self.rt.handle_command({"type": "sim", "speed": 1})
        estados = set()
        for _ in range(40):
            self.rt.tick()
            estados.add(self.state["threeWayValves"]["OY1_A"]["state"])
        self.assertEqual(estados, {True, False})
        self.assertNotEqual(self.state["threeWayValves"]["OY1_A"]["state"], self.state["threeWayValves"]["OY1_B"]["state"])

    def test_reset_volta_niveis_iniciais_e_modo_do_cenario(self):
        self.rt.handle_command({"type": "loop", "id": "LIC3", "mode": "MAN"})
        avancar(self.rt, 30)
        self.rt.handle_command({"type": "sim", "reset": True, "levels": {"TQ1": 4.0}})
        self.assertFalse(self.state["sim"]["running"])
        self.assertAlmostEqual(self.state["tanks"]["TQ1"]["heightCm"], 4.0, places=6)
        self.assertEqual(self.state["sim"]["t"], 0.0)
        self.assertEqual(self.state["loops"]["LIC3"]["mode"], "AUTO")
        self.rt.handle_command({"type": "sim", "reset": True, "levels": {"TQ1": 0.0}})

    def test_cenario_vazao_bomba_usa_soma(self):
        self.rt.handle_command({"type": "scenario", "id": "vazao_bomba"})
        self.assertEqual(self.state["loops"]["FIC3"]["pvSource"]["tipo"], "vazao_soma")
        for tag in list(self.state["loops"]):
            self.rt.handle_command({"type": "loop", "id": tag, "mode": "AUTO"})
        avancar(self.rt, 120)
        s = self.state
        self.assertAlmostEqual(s["loops"]["FIC3"]["pv"], s["flowSensors"]["FI1"]["flow"] + s["flowSensors"]["FI2"]["flow"], delta=0.01)
        self.assertAlmostEqual(s["loops"]["FIC3"]["pv"], 3.0, delta=0.05)

    def test_server_delegacao(self):
        from unittest.mock import patch
        with patch.object(self.server, "BACKEND_MODE", "MODELICA"), patch.object(self.server, "modelica_runtime", self.rt):
            self.assertTrue(self.server.handle_command({"type": "sim", "speed": 2}))
            self.assertEqual(self.state["sim"]["speed"], 2)
            self.assertFalse(self.server.handle_command({"type": "banana"}))


class CenariosTests(unittest.TestCase):
    def test_cenarios_bem_formados(self):
        for nome, c in cenarios.CENARIOS.items():
            tags = [m["tag"] for m in c["malhas"]]
            self.assertEqual(len(tags), len(set(tags)), nome)
            alvos = [(m["mv"]["tipo"], m["mv"]["id"]) for m in c["malhas"]]
            self.assertEqual(len(alvos), len(set(alvos)), f"{nome}: dois controladores no mesmo atuador")
            for m in c["malhas"]:
                self.assertLessEqual(m["sp_min"], m["sp"])
                self.assertLessEqual(m["sp"], m["sp_max"])

    def test_estimativas_isoladas(self):
        # As estimativas de operação ficam num bloco só, rotulado, fora do .mo
        self.assertTrue(all(k.startswith("CV_HV") for k in cenarios.PARAMETROS_PLANTA))
        self.assertEqual(cenarios.VALVULAS_MANUAIS_OPERACAO["HV1"], 1.0)
        self.assertEqual(cenarios.VALVULAS_MANUAIS_OPERACAO["HV2"], 1.0)

    def test_copia_independente(self):
        a = cenarios.obter_cenario("nivel")
        a["malhas"][0]["sp"] = 1234
        self.assertNotEqual(cenarios.CENARIOS["nivel"]["malhas"][0]["sp"], 1234)


if __name__ == "__main__":
    unittest.main()
