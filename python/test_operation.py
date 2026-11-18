"""Operação comum: FMUs reais para simulação, sem conectar à bancada."""
import _test_calibration  # Isola os dados de campo antes de importar server.
import copy
import unittest
from unittest.mock import patch
from test_modelica import TEM_PYFMI, TEM_FMUS


@unittest.skipUnless(TEM_PYFMI and TEM_FMUS, "PyFMI ou FMUs ausentes")
class OperationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import server
        from simulation.modelica_runtime import RuntimeModelica
        cls.state = copy.deepcopy(server.state)
        cls.runtime = RuntimeModelica(cls.state)
        cls.initial = copy.deepcopy(cls.state)

    def setUp(self):
        rt = self.runtime
        rt.handle_command(dict(type="operation", mode="MANUAL"))
        rt.handle_command(dict(type="scenario", id="nivel"))
        rt.handle_command(dict(type="sim", running=False, reset=True, speed=1))
        for id in self.state["pumps"]:
            rt.handle_command(dict(type="pump", id=id, power=False, command=0))

    def test_initial_state_is_manual_with_zero_pumps(self):
        self.assertEqual(self.initial["operation"]["mode"], "MANUAL")
        self.assertTrue(all(p["command"]==0 and not p["power"] for p in self.initial["pumps"].values()))
        self.assertTrue(all(v["opening"]==0 for v in self.initial["actuatedValves"].values()))
        self.assertTrue(all(m["effectiveMode"]=="MAN" for m in self.initial["loops"].values()))

    def test_manual_scenario_no_output_and_requested_modes_preserved(self):
        rt = self.runtime
        self.assertEqual(self.state["operation"]["mode"], "MANUAL")
        self.assertTrue(all(p["command"]==0 and not p["power"] for p in self.state["pumps"].values()))
        before = copy.deepcopy((self.state["pumps"], self.state["actuatedValves"]))
        rt.handle_command(dict(type="scenario", id="vazao_bomba"))
        self.assertEqual(before, (self.state["pumps"], self.state["actuatedValves"]))
        self.assertTrue(all(m["mode"]=="AUTO" and m["effectiveMode"]=="MAN" for m in self.state["loops"].values()))

    def test_global_transfer_tracks_current_mv_and_preserves_loop_setup(self):
        rt = self.runtime
        rt.handle_command(dict(type="valve",id="LV1",opening=.42))
        rt.handle_command(dict(type="loop",id="LIC4",mode="MAN",sp=11))
        rt.handle_command(dict(type="operation",mode="AUTO"))
        self.assertEqual(self.state["actuatedValves"]["LV1"]["opening"],.42)
        rt.handle_command(dict(type="sim",running=True))
        rt.tick()
        self.assertLess(abs(self.state["actuatedValves"]["LV1"]["opening"]-.42),.02)
        before=copy.deepcopy((self.state["pumps"],self.state["actuatedValves"]))
        rt.handle_command(dict(type="operation",mode="MANUAL"))
        self.assertEqual(before,(self.state["pumps"],self.state["actuatedValves"]))
        self.assertEqual(self.state["loops"]["LIC4"]["mode"],"MAN")
        self.assertEqual(self.state["loops"]["LIC4"]["sp"],11)
        for _ in range(10): rt.tick()
        self.assertEqual(before,(self.state["pumps"],self.state["actuatedValves"]))

    def test_manual_pump_valve_and_oy(self):
        rt=self.runtime
        self.assertTrue(rt.handle_command(dict(type="pump",id="JIC1",power=True,command=150/255)))
        self.assertTrue(rt.handle_command(dict(type="valve",id="LV1",opening=.6)))
        times=copy.deepcopy(rt.xv)
        for branch in ("A","B"):
            self.assertTrue(rt.handle_command(dict(type="oy",id="OY1",state=branch)))
            rt.handle_command(dict(type="sim",running=True))
            rt.tick()
            self.assertTrue(self.state["threeWayValves"][f"OY1_{branch}"]["state"])
        self.assertEqual(times,rt.xv)
        self.assertFalse(rt.handle_command(dict(type="oy",id="OY1",state="RELEASE")))

    def test_manual_preserves_active_oy_branch(self):
        rt=self.runtime
        rt.handle_command(dict(type="xv",id="OY1",tA=0,tB=1))
        rt.handle_command(dict(type="operation",mode="AUTO"))
        rt.handle_command(dict(type="sim",running=True))
        rt.tick()
        self.assertTrue(self.state["threeWayValves"]["OY1_B"]["state"])
        rt.handle_command(dict(type="operation",mode="MANUAL"))
        rt.tick()
        self.assertTrue(self.state["threeWayValves"]["OY1_B"]["state"])
        rt.handle_command(dict(type="xv",id="OY1",tA=3,tB=2))

    def test_invalid_loop_edit_does_not_apply_partial_changes(self):
        rt=self.runtime
        before=copy.deepcopy(self.state["loops"]["LIC3"])
        self.assertFalse(rt.handle_command(dict(type="loop",id="LIC3",sp=11,tuning={"kp":float("nan")})))
        self.assertEqual(self.state["loops"]["LIC3"],before)

    def test_hardware_auto_blocked_without_commissioning_no_commands(self):
        from hardware.hardware_operation import HardwareOperation
        from hardware.hardware_control import ManualHardware
        hw=ManualHardware()
        op=HardwareOperation(self.state,hw)
        initial_queue=list(hw.queue)
        self.assertTrue(op.handle(dict(type="scenario",id="nivel"),None,None))
        self.assertEqual(hw.queue,initial_queue)
        self.assertFalse(op.handle(dict(type="operation",mode="AUTO"),None,None))
        self.assertEqual(op.operation.mode,"MANUAL")
        self.assertTrue(any("calibração" in reason for reason in op.reasons()))
        self.assertEqual(hw.queue,initial_queue)

    def test_hardware_uses_same_fmu_with_synthetic_pvs_and_semantic_outputs(self):
        from hardware.hardware_operation import HardwareOperation
        from hardware.hardware_control import ManualHardware
        hw=ManualHardware()
        hw.armed=True
        hw.confirmed={"pumps":[[100,1]]*3,"valves":[],"oy":[0,0]}
        op=HardwareOperation(self.state,hw)
        op.initialize()
        # Fixture operacional mínima para exercitar a mesma FMU sem configuração física.
        definition=copy.deepcopy(op.operation.scenario)
        definition["malhas"]=definition["malhas"][:1]
        definition["malhas"][0]["mv"]={"tipo":"bomba","id":"JIC1"}
        definition["fixos"]={}
        sent=[]
        with patch('common.operation.cenarios.obter_cenario',return_value=definition), patch.object(hw,'fresh',return_value=True), patch.object(hw,'ready',return_value=True), patch.object(op,'read_pv',return_value=10.):
            op.operation.read_pv=op.read_pv
            op.operation.prepare('nivel')
            self.assertTrue(op.handle(dict(type='operation',mode='AUTO'),None,None))
            hw.next_heartbeat=hw.clock()+10
            with patch.object(hw,'request',side_effect=lambda cmd,*args:sent.append(cmd) or True):
                for _ in range(6): op.tick(None,.1)
            self.assertTrue(sent)
            self.assertTrue(all(c['type']=='hardware' and c['action'] in ('pump','oy') for c in sent))
            self.assertGreater(op.operation.banco.t,0)
            op.cancel()
            self.assertEqual(op.operation.mode,'MANUAL')
            self.assertEqual(op.desired,{})
