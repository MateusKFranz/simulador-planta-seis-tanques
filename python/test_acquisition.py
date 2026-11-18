import _test_calibration  # Isola os dados de campo antes de importar server.
import unittest
import copy
from unittest.mock import Mock, patch
import server
from hardware.serial_bridge import SerialBridge

class AcquisitionTests(unittest.TestCase):
    def test_absent_is_not_zero_and_clears_previous(self):
        server.apply_hardware_telemetry({"FT1":0.0,"FT2":1.5})
        self.assertEqual(server.state["flowSensors"]["FI5"]["flow"],0)
        self.assertIsNone(server.state["flowSensors"]["FI1"]["flow"])
        server.apply_hardware_telemetry({"FT2_RAW":523})
        self.assertIsNone(server.state["flowSensors"]["FI5"]["flow"])
        self.assertEqual(server.state["flowSensors"]["FI6"]["raw"],523)
        self.assertEqual(server.state["flowSensors"]["FI6"]["status"],"uncalibrated")
    def test_parser(self):
        bridge=SerialBridge("unused")
        values=bridge._parse_line("TELEMETRY,FT1=0,FT2=null,FT3_RAW=523,FT4=nan")["values"]
        self.assertEqual(values["FT1"],0)
        self.assertIsNone(values["FT2"])
        self.assertIsNone(values["FT4"])
        self.assertEqual(values["FT3_RAW"],523)
    def test_serial_rejects_actuation(self):
        bridge=SerialBridge("unused"); bridge.connected=True; bridge._serial=Mock()
        for cmd in ["PUMP,P1,1,1", "VALVE,V1,1", "RELAY,X1A,1", "PING\nPUMP,P1,1,1"]:
            self.assertFalse(bridge.send_line(cmd))
        bridge._serial.write.assert_not_called()
        self.assertTrue(bridge.ping())
    def test_hardware_rejects_commands(self):
        with patch.object(server,"BACKEND_MODE","HARDWARE"):
            self.assertFalse(server.handle_command({"type":"pump","id":"JIC3","power":1}))
    def test_calibration_and_invalid(self):
        with patch.dict(server.FT_ANALOG_CALIBRATION,{"FI6":(100,900,8)}):
            server.apply_hardware_telemetry({"FT2_RAW":500,"FT1":float("inf")})
            self.assertEqual(server.state["flowSensors"]["FI6"]["flow"],4)
            self.assertIsNone(server.state["flowSensors"]["FI5"]["flow"])

class HardwareDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.saved = copy.deepcopy(server.state)
        self.patchers = [patch.object(server, "BACKEND_MODE", "HARDWARE"),
                         patch.object(server, "last_telemetry_time", None),
                         patch.object(server, "last_telemetry_received_at", None),
                         patch.object(server, "telemetry_valid", False),
                         patch.object(server, "serial_bridge", Mock(connected=True, port="COM_TEST", baud=115200))]
        for p in self.patchers:
            p.start()

    def tearDown(self):
        for p in reversed(self.patchers):
            p.stop()
        server.state.clear()
        server.state.update(self.saved)

    def test_mapping_and_diagnostics_all_channels(self):
        line = "TELEMETRY" + "".join(f",LT{i}_RAW={400+i},FT{i}={i},FT{i}_HZ={43*i},FT{i}_PULSES={i*10}" for i in range(1, 7))
        server.apply_hardware_telemetry(SerialBridge._parse_line(line)["values"])
        for i, id in enumerate(server.LEVEL_IDS, 1):
            sensor = server.state["levelSensors"][id]
            self.assertEqual(sensor["source"], {"physical": f"LT{i}", "pin": f"A{i-1}"})
            self.assertEqual(sensor["raw"], 400+i)
            self.assertEqual(sensor["status"], "uncalibrated")
            for field in ("voltage", "pressure", "level", "heightCm"):
                self.assertIsNone(sensor[field])
            for field in ("height", "volume", "heightCm"):
                self.assertIsNone(server.state["tanks"][f"TQ{i}"][field])
        for i, id in enumerate(server.FLOW_CHANNEL_IDS, 1):
            sensor = server.state["flowSensors"][id]
            self.assertEqual(sensor["source"], {"physical": f"FT{i}", "pin": f"D{29+i}"})
            self.assertEqual((sensor["flow"], sensor["frequency"], sensor["pulses"]), (i, i*43, i*10))

    def test_timestamp_invalidation_and_separate_connection_states(self):
        self.assertEqual(server.public_state()["hardware"]["telemetry"]["status"], "absent")
        with patch.object(server.time, "monotonic", return_value=10), patch.object(server.time, "time", return_value=100):
            server.apply_hardware_telemetry({"FT1": 0, "FT1_PULSES": 0})
            self.assertEqual(server.public_state()["hardware"]["telemetry"]["status"], "receiving")
        with patch.object(server.time, "monotonic", return_value=13):
            server.apply_hardware_telemetry({}, received=False)
            snapshot = server.public_state()
            self.assertTrue(snapshot["hardware"]["serial"]["connected"])
            self.assertEqual(snapshot["hardware"]["telemetry"]["status"], "expired")
            self.assertEqual(server.last_telemetry_time, 10)
            self.assertEqual(snapshot["hardware"]["telemetry"]["lastReceivedAt"], 100000)
            self.assertIsNone(snapshot["flowSensors"]["FI5"]["flow"])
            self.assertIsNone(snapshot["flowSensors"]["FI5"]["pulses"])
            server.serial_bridge.connected = False
            self.assertFalse(server.public_state()["hardware"]["serial"]["connected"])
            self.assertEqual(server.last_telemetry_time, 10)

    def test_missing_and_invalid_diagnostics_clear_previous(self):
        server.apply_hardware_telemetry({"FT3": 2, "FT3_HZ": 86, "FT3_PULSES": 30, "LT1_RAW": 428})
        server.apply_hardware_telemetry({"FT3_HZ": float("inf"), "FT3_PULSES": -1, "FT1": 0})
        for field in ("flow", "frequency", "pulses", "raw"):
            self.assertIsNone(server.state["flowSensors"]["FI1"][field])
        self.assertIsNone(server.state["levelSensors"]["LI1"]["raw"])
        self.assertEqual(server.state["flowSensors"]["FI5"]["flow"], 0)
        self.assertIsNone(SerialBridge._parse_line("TELEMETRY"))
        self.assertIsNone(SerialBridge._parse_line("TELEMETRY,garbage=1"))

    def test_calibration_does_not_inherit_mock_geometry(self):
        with patch.dict(server.LT_CALIBRATION, {"LI1": (100, 900)}):
            server.apply_hardware_telemetry({"LT1_RAW": 500})
            self.assertEqual(server.state["levelSensors"]["LI1"]["level"], 50)
            self.assertIsNone(server.state["tanks"]["TQ1"]["height"])
            self.assertIsNone(server.state["tanks"]["TQ1"]["volume"])

    def test_all_actuation_refused_and_unknown_in_snapshot(self):
        for kind in ("pump", "valve", "manual_valve", "relay", "xv", "loop", "scenario", "sim"):
            self.assertFalse(server.handle_command({"type": kind, "id": "JIC1", "mode": "AUTO", "sp": 1, "mv": 1}))
        snapshot = server.public_state()
        self.assertIsNone(snapshot["pumps"]["JIC1"]["power"])
        self.assertIsNone(snapshot["actuatedValves"]["LV1"]["opening"])
        self.assertIsNone(snapshot["threeWayValves"]["OY1"]["branches"]["A"]["state"])

if __name__ == "__main__": unittest.main()
