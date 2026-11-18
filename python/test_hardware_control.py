"""CTRL: backend e firmware real compilado para GPIO/Serial simulados."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from hardware.hardware_control import ManualHardware
from hardware.serial_bridge import SerialBridge
from test_dequi import FirmwareSerial, Harness


class CtrlSerial(FirmwareSerial):
    def __init__(self, executable):
        super().__init__()
        self.native = subprocess.Popen([str(executable), "--serial"], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, text=True, bufsize=1)
        self.pinmap += [f"{p}:BOMBA{i+1}" for i in range(3) for p in (9-2*i, 10-2*i)]
        self.pinmap += [f"{36+i}:VALVULA{i+1}" for i in range(4)] + [f"{26+i}:RELE{i+1}" for i in range(4)]

    def exchange(self, text):
        self.native.stdin.write(text+"\n")
        self.native.stdin.flush()
        lines=[]
        for line in self.native.stdout:
            if line.strip()=="#END":
                return lines
            lines.append(line.strip())
        raise RuntimeError("Firmware simulado encerrou")

    def response(self, command):
        if command in self.overrides:
            return self.overrides[command]
        if command == "GET ID":
            return "OK,DEQUI_HW_API,2.0.0-PLANTA1-CTRL,MEGA2560"
        if command in {"GET COMPONENTS", "GET ENABLED"}:
            return "OK,3,6,6,4,4"
        if command in {"GET CONTROL", "GET SAFETY", "ARM", "DISARM", "RESET FAULT", "EMERGENCY STOP", "HEARTBEAT"} or command.startswith("SET "):
            return "\n".join(self.exchange(command))
        return super().response(command)

    def write(self, payload):
        # ALERT não recebe @id. A resposta final mantém o ID original.
        line=payload.decode().strip(); self.tx.append(line)
        prefix, command=line.split(" ",1)
        response=self.response(command)
        if response is not None:
            self.rx.extend(s if s.startswith("ALERT,") else prefix+" "+s for s in response.splitlines())

    def close(self):
        self.native.stdin.close()
        self.native.wait(timeout=3)
        self.native.stdout.close()


@unittest.skipUnless(os.environ.get("CTRL_CXX") or shutil.which("g++"), "Compilador C++ ausente para executar firmware com GPIO simulado")
class ManualControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.exe=Path(cls.temp.name)/"firmware-check.exe"
        compiler=os.environ.get("CTRL_CXX") or shutil.which("g++")
        # DLLs do compilador também são necessárias para executar o teste nativo no Windows.
        cls.old_path=os.environ["PATH"]
        os.environ["PATH"]=str(Path(compiler).parent)+os.pathsep+cls.old_path
        subprocess.run([compiler,"-std=c++11","-I",str(Path(__file__).with_name("firmware_stubs")),str(Path(__file__).with_name("firmware_control_checks.cpp")),"-o",str(cls.exe)],check=True,capture_output=True,text=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
        os.environ["PATH"]=cls.old_path

    def setUp(self):
        self.now=0
        self.device=CtrlSerial(self.exe)
        self.bridge=SerialBridge("COM_TEST")
        self.bridge.connected=True; self.bridge._serial=self.device
        self.hw=ManualHardware(clock=lambda:self.now,wall_clock=lambda:1000+self.now)
        for _ in range(100):
            self.step()
            if self.hw.ready(): break
        self.assertTrue(self.hw.ready(),self.hw.snapshot())
        self.assertFalse(self.hw.armed)

    def tearDown(self):
        self.device.close()

    def step(self, dt=.1, replies=True):
        self.now+=dt
        self.device.rx.extend(self.device.exchange(f"#TIME {int(self.now*1000)}"))
        self.hw.tick(self.bridge)
        if replies:
            while self.device.rx:
                self.hw.handle(SerialBridge._parse_line(self.device.rx.pop(0)))

    def request(self, action, **values):
        return self.hw.request(dict(type="hardware",action=action,**values), self.bridge)

    def apply(self, action, **values):
        self.assertTrue(self.request(action,**values),self.hw.control_error)
        for _ in range(30):
            self.step()
            if not self.hw.busy(): break
        self.assertFalse(self.hw.busy())

    def test_serial_lv_whitelist(self):
        for channel in range(1,5):
            for verb,value in (("LVSYNC",45),("LVANGLE",50),("VALVULA",50),("LVSTOP",0)):
                self.assertTrue(self.bridge.send_line(f"@99 SET {verb} {channel} {value}"))
        for channel in (0,5):
            for verb in ("LVSYNC","LVANGLE","VALVULA","LVSTOP"):
                self.assertFalse(self.bridge.send_line(f"@99 SET {verb} {channel} 0"))
        for command in ("SET VALVULA 1 101", "SET LVSYNC 1 181", "SET LVSTOP 1 1"):
            self.assertFalse(self.bridge.send_line("@99 "+command))

    def test_plant_reset_cancels_auto_and_preserves_lv_reference(self):
        from hardware.hardware_operation import HardwareOperation
        from types import SimpleNamespace
        from unittest.mock import Mock
        self.apply("arm")
        for id,pwm in (("JIC3",150),("JIC4",80),("JIC1",40)):
            self.apply("pump",id=id,pwm=pwm)
        self.apply("oy",id="OY1",state="A");self.apply("oy",id="OY2",state="B")
        self.apply("valve_sync",id="LV1",angle=45)
        self.apply("valve_sync",id="LV2",angle=47)
        self.apply("valve_angle",id="LV1",angle=70)
        op=HardwareOperation({},self.hw)
        loop=SimpleNamespace(authority=True)
        op.operation=SimpleNamespace(mode="AUTO",banco=SimpleNamespace(malhas={"loop":loop}),track=Mock())
        op.desired={"JIC3":{"pwm":200}}
        self.assertTrue(op.handle({"type":"hardware","action":"plant_reset"},self.bridge,None))
        self.assertEqual(op.operation.mode,"MANUAL");self.assertFalse(loop.authority)
        self.assertEqual(op.desired,{})
        self.assertEqual(self.hw.requested,{})
        self.assertEqual(self.hw.queue,["DISARM"])
        self.assertEqual(self.hw.plant_reset["status"],"pending")
        self.assertIsNone(self.hw.confirmed)
        for _ in range(5):self.step();op.tick(self.bridge,.1)
        data=self.hw.confirmed
        self.assertEqual(self.hw.plant_reset["status"],"confirmed")
        self.assertFalse(data["armed"])
        self.assertEqual([p[0] for p in data["pumps"]],[0,0,0])
        self.assertEqual(data["oy"],[0,0])
        self.assertGreaterEqual(data["valves"][0][3],45)
        self.assertEqual(data["valves"][1][3],47)
        self.assertEqual([v[5] for v in data["valves"][:2]],[1,1])
        for v in data["valves"]:self.assertEqual([v[4],v[6],v[7],v[12]],[-1,0,0,-1])
        self.apply("arm")
        self.assertFalse(self.hw.outputs_active(self.hw.confirmed))

    def test_plant_reset_wins_over_queued_and_inflight_sets(self):
        from hardware.hardware_operation import HardwareOperation
        for inflight in (False,True):
            for action,values in (("pump",dict(id="JIC3",pwm=200)),("oy",dict(id="OY1",state="A")),("valve_angle",dict(id="LV1",angle=60))):
                self.apply("arm");self.apply("valve_sync",id="LV1",angle=30)
                self.assertTrue(self.request(action,**values))
                if inflight:self.step(replies=False)
                op=HardwareOperation({},self.hw)
                self.assertTrue(op.handle(dict(type="hardware",action="plant_reset"),self.bridge,None))
                self.assertIsNone(self.hw.pending)
                self.assertEqual(self.hw.queue,["DISARM"])
                for _ in range(6):self.step()
                self.assertEqual(self.hw.plant_reset["status"],"confirmed")
                self.assertFalse(self.hw.armed)
                self.assertFalse(self.hw.outputs_active(self.hw.confirmed))
                self.assertFalse(any(c.startswith("SET ") for c in self.hw.queue))

    def test_plant_reset_preserves_fault_and_requires_confirmation(self):
        self.apply("estop")
        self.assertTrue(self.request("plant_reset"))
        self.assertEqual(self.hw.plant_reset["status"],"pending")
        for _ in range(4):self.step()
        self.assertEqual(self.hw.plant_reset["status"],"confirmed")
        self.assertEqual(self.hw.confirmed["fault"],"EMERGENCY")
        self.assertFalse(self.request("arm"))
        self.apply("reset")
        self.device.overrides["DISARM"]="ERR,TEST_FAILURE"
        self.assertTrue(self.request("plant_reset"))
        self.step()
        self.assertEqual(self.hw.plant_reset["status"],"failed")
        self.bridge.connected=False
        self.assertFalse(self.request("plant_reset"))

    def test_native_firmware_interlocks(self):
        result=subprocess.run([str(self.exe)],capture_output=True,text=True,check=True)
        self.assertIn("PASS",result.stdout)

    def test_no_arm_no_serial_and_injection(self):
        count=len(self.device.tx)
        for action,args in [("pump",dict(id="JIC3",percent=25)),("relay_test",dict(id=1,level=1)),("valve",dict(id="LV1",percent=50))]:
            self.assertFalse(self.request(action,**args))
        self.assertEqual(len(self.device.tx),count)
        for action in [None, [], {}, True, 1]:
            self.assertFalse(self.request(action))
        for text in ["@1 SET PIN 26 1","@1 SET ALL 1","@1 SET BOMBA 1 256","@1 ARM\nSET BOMBA 1 1"]:
            self.assertFalse(self.bridge.send_line(text))

    def test_arm_requires_all_readiness_checks(self):
        changes = [
            (self.bridge, "connected", False),
            (self.hw, "firmware", {**self.hw.firmware, "identified": False}),
            (self.hw, "compatibility", {**self.hw.compatibility, "status": "incompatible"}),
            (self.hw, "discovery", {**self.hw.discovery, "complete": False}),
            (self.hw, "safety", dict(state="FAULT", fault="UNKNOWN", configValid=False)),
            (self.hw, "confirmed", None),
            (self.hw, "confirmed_at", self.now-3),
        ]
        for target, name, value in changes:
            with self.subTest(check=name):
                previous = getattr(target, name)
                setattr(target, name, value)
                self.assertFalse(self.request("arm"))
                self.assertNotIn("ARM", self.hw.queue)
                setattr(target, name, previous)
        self.apply("arm")

    def test_disarm_and_emergency_without_arm(self):
        self.apply("arm")
        self.apply("pump", id="JIC3", percent=25)
        self.apply("disarm")
        self.assertFalse(self.hw.armed)
        self.assertEqual(self.hw.confirmed["pumps"][0][0], 0)
        self.assertFalse(self.request("pump", id="JIC3", percent=25))
        self.apply("estop")
        self.assertEqual(self.hw.confirmed["fault"], "EMERGENCY")
        self.assertTrue(all(p[0] == 0 for p in self.hw.confirmed["pumps"]))
        self.assertFalse(self.request("arm"))
        self.apply("reset")
        self.assertFalse(self.hw.armed)
        self.assertFalse(self.request("pump", id="JIC3", percent=25))

    def test_pump_percent_ack_and_readback(self):
        self.apply("arm")
        for pct,pwm in [(0,0),(25,64),(50,128),(100,255)]:
            self.assertTrue(self.request("pump",id="JIC3",percent=pct))
            previous=copy.deepcopy(self.hw.confirmed)
            self.step(replies=False)
            self.assertEqual(self.hw.confirmed,previous)
            while self.device.rx: self.hw.handle(SerialBridge._parse_line(self.device.rx.pop(0)))
            for _ in range(5):
                if not self.hw.busy(): break
                self.step()
            self.assertEqual(self.hw.confirmed["pumps"][0][0],pwm)
        for pct in [-1,101,True,float("nan"),"25"]:
            self.assertFalse(self.request("pump",id="JIC3",percent=pct))
        self.assertFalse(self.request("pump",id="OY1",percent=10))

    def test_relay_diagnostics_are_forbidden(self):
        self.apply("arm")
        self.assertFalse(self.request("relay_test",id=1,level=0))
        self.assertFalse(self.request("relay_end"))
        for command in ["@1 SET RELAYTEST 1 0", "@2 SET RELAYTEST END"]:
            self.assertFalse(self.bridge.send_line(command))
        self.assertNotIn("relay", self.hw.confirmed)

    def test_valve_limits_and_mapping(self):
        self.apply("arm")
        self.assertFalse(self.request("valve",id="LV2",percent=50))
        self.assertFalse(self.request("valve",id="LV1",percent=50))
        self.apply("valve_sync",id="LV1",angle=30)
        self.assertEqual(self.hw.confirmed["valves"][0][3:7],[30,-1,1,0])
        self.apply("valve",id="LV1",percent=50)
        self.assertEqual(self.hw.confirmed["valves"][0][4],80)
        self.assertEqual(self.hw.confirmed["valves"][0][12],50)
        self.assertLess(self.hw.confirmed["valves"][0][3],80)
        self.assertFalse(self.request("valve",id="LV1",percent=101))

    def test_error_and_inconsistent_ack_invalidate_confirmation(self):
        for response in ["WARN,BLOCKED", "ERR,BLOCKED", 'OK,{"armed":true,"fault":"NONE","pumps":[[0,1],[0,2],[0,1]],"valves":[[1,1,-1,-1],[0,0,-1,-1],[0,0,-1,-1],[0,0,-1,-1]]}']:
            self.apply("reset"); self.apply("arm")
            self.device.overrides["SET BOMBA 1 64"]=response
            self.assertTrue(self.request("pump",id="JIC3",percent=25))
            for _ in range(15): self.step()
            self.assertFalse(self.hw.armed)
            self.assertTrue(self.hw.control_fault)
            self.assertEqual(self.hw.confirmed["pumps"][0][0],0)

    def test_only_owner_can_operate_and_other_session_can_stop(self):
        owner,other=object(),object()
        self.assertTrue(self.hw.request(dict(type="hardware",action="arm"),self.bridge,owner=owner))
        for _ in range(10): self.step()
        self.assertTrue(self.hw.armed)
        self.assertFalse(self.hw.request(dict(type="hardware",action="lease"),self.bridge,owner=other))
        self.assertFalse(self.hw.request(dict(type="hardware",action="pump",id="JIC3",percent=25),self.bridge,owner=other))
        self.assertTrue(self.hw.request(dict(type="hardware",action="estop"),self.bridge,owner=other))
        for _ in range(10): self.step()
        self.assertFalse(self.hw.armed)

    def test_safety_and_pinmap_fault_disarm(self):
        self.apply("arm")
        self.hw.safety["state"]="FAULT"
        for _ in range(10): self.step()
        self.assertFalse(self.hw.armed)
        self.apply("reset"); self.apply("arm")
        pinmap=list(self.device.pinmap)
        pinmap[0]="D36:PRESSAO1"
        self.hw.discover(pinmap)
        for _ in range(10): self.step()
        self.assertFalse(self.hw.armed)

    def test_emergency_cancels_pending_and_requires_reset(self):
        self.apply("arm")
        self.apply("pump",id="JIC3",percent=25)
        self.assertTrue(self.request("pump",id="JIC3",percent=0))
        self.apply("estop")
        self.assertFalse(self.hw.armed)
        self.assertEqual(self.hw.confirmed["pumps"][0][0],0)
        self.assertEqual(self.hw.confirmed["fault"],"EMERGENCY")
        self.assertFalse(self.request("arm"))
        self.apply("reset")
        self.assertFalse(self.hw.armed)
        self.apply("arm")

    def test_timeout_wrong_id_and_no_optimistic_confirmation(self):
        self.apply("arm")
        self.device.overrides["SET BOMBA 1 64"]=None
        self.assertTrue(self.request("pump",id="JIC3",percent=25))
        for _ in range(5):
            self.step()
            if self.hw.pending and self.hw.pending["command"]=="SET BOMBA 1 64": break
        self.assertIsNotNone(self.hw.pending)
        state=copy.deepcopy(self.hw.confirmed); state["pumps"][0][0]=64
        self.hw.handle(SerialBridge._parse_line("@999999 OK,"+json.dumps(state)))
        self.assertEqual(self.hw.confirmed["pumps"][0][0],0)
        for _ in range(16): self.step()
        self.assertFalse(self.hw.armed)
        self.assertTrue(self.hw.control_fault)
        self.assertNotEqual((self.hw.confirmed or {}).get("pumps",[[None]])[0][0],64)

    def test_heartbeat_and_hmi_lease(self):
        self.apply("arm"); self.apply("pump",id="JIC3",percent=25)
        for i in range(80):
            if i%5==0: self.assertTrue(self.request("lease"))
            self.step()
        self.assertTrue(self.hw.armed)
        self.assertTrue(any("HEARTBEAT" in t for t in self.device.tx))
        for _ in range(35): self.step()
        self.assertFalse(self.hw.armed)
        self.assertEqual(self.hw.confirmed["pumps"][0][0],0)

    def test_disconnect_reboot_never_restores(self):
        self.apply("arm"); self.apply("pump",id="JIC3",percent=25)
        self.bridge.connected=False; self.hw.tick(self.bridge)
        self.assertFalse(self.hw.armed); self.assertIsNone(self.hw.confirmed)
        self.bridge.connected=True
        for _ in range(40): self.step()
        self.assertFalse(self.hw.armed)
        self.assertEqual(self.hw.confirmed["pumps"][0][0],0)
        self.hw.handle(SerialBridge._parse_line("READY,DEQUI_HW_API,2.0.0-PLANTA1-CTRL"))
        self.assertIsNone(self.hw.confirmed)

    def test_oy_and_servo_only_heartbeat_and_stop(self):
        for action, values in (("oy", {"id":"OY1","state":"B"}), ("valve", {"id":"LV1","percent":100})):
            self.apply("reset"); self.apply("arm")
            if action=="valve": self.apply("valve_sync",id="LV1",angle=30)
            self.apply(action,**values)
            before=sum("HEARTBEAT" in line for line in self.device.tx)
            for i in range(65):
                if i%5==0: self.assertTrue(self.request("lease"))
                self.step()
            self.assertTrue(self.hw.armed)
            self.assertGreater(sum("HEARTBEAT" in line for line in self.device.tx),before)
            self.apply("disarm")
            self.assertFalse(self.hw.outputs_active(self.hw.confirmed))
            self.apply("arm")
            self.assertFalse(self.hw.outputs_active(self.hw.confirmed))

    def test_sync_stop_and_reset_reference(self):
        self.apply("arm")
        self.apply("valve_sync",id="LV1",angle=30)
        self.assertEqual(self.hw.confirmed["valves"][0][5:8],[1,0,0])
        self.apply("valve",id="LV1",percent=100)
        self.apply("valve_stop",id="LV1")
        self.assertEqual(self.hw.confirmed["valves"][0][4:8],[-1,1,0,0])
        self.apply("estop")
        self.assertFalse(self.hw.outputs_active(self.hw.confirmed))
        self.apply("reset"); self.apply("arm")
        self.assertFalse(self.hw.confirmed["valves"][0][5])
        self.assertFalse(self.request("valve",id="LV1",percent=50))

    def test_hardware_snapshot_mv_is_readback_not_fmu_request(self):
        from hardware.hardware_operation import HardwareOperation
        self.apply("arm"); self.apply("pump",id="JIC1",pwm=100)
        op=HardwareOperation({},self.hw)
        self.assertAlmostEqual(op.confirmed_mv({"tipo":"bomba","id":"JIC1"}),100/255)
        self.assertTrue(self.request("pump",id="JIC1",pwm=200))
        self.assertAlmostEqual(op.confirmed_mv({"tipo":"bomba","id":"JIC1"}),100/255)
        self.assertIsNone(op.confirmed_mv({"tipo":"valvula","id":"LV1"}))

    def test_ro_and_incompatible_remain_blocked(self):
        self.hw.firmware["version"]="1.0.0-PLANTA1-RO"
        self.assertFalse(self.request("arm"))
        self.hw.tick(self.bridge)
        self.assertFalse(self.bridge.control_enabled)
        self.hw.firmware["version"]="2.0.0-PLANTA1-CTRL"
        self.hw.compatibility["status"]="incompatible"
        self.assertFalse(self.request("arm"))


class AcquisitionPreservationTests(unittest.TestCase):
    def test_ctrl_preserves_ro_acquisition_functions(self):
        root=Path(__file__).resolve().parents[1]/"arduino"
        ro=(root/"ArduinoHardwareAPI_Planta1_ReadOnly"/"ArduinoHardwareAPI_Planta1_ReadOnly.ino").read_text()
        ctrl=(root/"ArduinoHardwareAPI_Planta1_Control"/"ArduinoHardwareAPI_Planta1_Control.ino").read_text()
        start="bool configureFlowInput("
        end="// 6. PARSER SERIAL"
        self.assertEqual(ro[ro.index(start):ro.index(end)],ctrl[ctrl.index(start):ctrl.index(end)])


class MaintenanceTrafficTests(unittest.TestCase):
    def test_heartbeat_and_readback_do_not_publish_busy(self):
        hw = ManualHardware(clock=lambda: 10.0, wall_clock=lambda: 20.0)
        hw.pending = {"id": "1", "command": "HEARTBEAT", "deadline": 11.0, "lines": None}
        self.assertFalse(hw.busy())
        hw.pending = {"id": "2", "command": "GET CONTROL", "deadline": 11.0, "lines": None}
        self.assertFalse(hw.busy())
        hw.pending = {"id": "3", "command": "SET BOMBA 1 64", "deadline": 11.0, "lines": None}
        self.assertTrue(hw.busy())

    def test_maintenance_in_queue_does_not_publish_busy(self):
        hw = ManualHardware()
        hw.pending = None
        hw.queue = ["HEARTBEAT", "GET CONTROL"]
        self.assertFalse(hw.busy())
        hw.queue.insert(0, "SET OY 1 A")
        self.assertTrue(hw.busy())
