"""Firmware Serial simulado; nunca abre uma COM ou atua na bancada."""
import _test_calibration  # Isola os dados de campo antes de importar server.
import asyncio
import copy
import json
import unittest
from unittest.mock import Mock, patch

import websockets
import server
from hardware.dequi_hardware import DequiHardware, normalize_pin
from hardware.serial_bridge import SerialBridge


class FirmwareSerial:
    def __init__(self, profile="complete"):
        self.profile = profile
        self.tx = []
        self.rx = []
        self.overrides = {}
        self.pulses = 0
        self.pressure_raw = 428
        self.flow = .025
        self.valid = 1
        self.stale = 0
        self.pinmap = ([f"{54+i}:PRESSAO{i+1}" for i in range(6)] + [f"{30+i}:VAZAO{i+1}" for i in range(6)]) if profile == "complete" else ["5:BOMBA1", "8:BOMBA1", "55:PRESSAO1", "56:PRESSAO2", "57:PRESSAO3", "2:VAZAO1", "9:VALVULA1", "30:RELE1", "32:RELE2"]

    def write(self, payload):
        line = payload.decode().strip()
        self.tx.append(line)
        prefix, command = line.split(" ", 1) if line.startswith("@") else ("", line)
        response = self.response(command)
        if response is not None:
            lines = response.splitlines()
            self.rx.extend([(prefix+" "+lines[0]).strip(), *lines[1:]])

    def flush(self):
        pass

    def response(self, command):
        if command in self.overrides:
            return self.overrides[command]
        responses = {"GET ID": "OK,DEQUI_HW_API,1.0.0,MEGA2560", "GET COMPONENTS": "OK,0,6,6,0,0" if self.profile == "complete" else "OK,1,3,1,1,2",
            "GET ENABLED": "OK,0,6,6,0,0" if self.profile == "complete" else "OK,1,3,1,1,2",
            "GET PINMAP": "OK,"+",".join(self.pinmap), "GET COMM": "OK,115200,1234,10,0", "GET SAFETY": "OK,READY,NONE,1"}
        if command in responses:
            return responses[command]
        if command.startswith("GET PRESSAO "):
            return f"OK,{self.pressure_raw},2.1,2.0,{self.valid},0,{self.stale},10"
        if command.startswith("GET VAZAO "):
            self.pulses = (self.pulses+10) % (2**32)
            if command.endswith(" VERBOSE"):
                return f"OK\nNome: Vazao\nVazao instantanea: {self.flow} L/s\nVolume total: 1 L\nPulsos acumulados: {self.pulses}\nValido: {'sim' if self.valid else 'nao'}\nDesatualizado: {'sim' if self.stale else 'nao'}\nEND"
            return f"OK,{self.flow},{self.pulses},{self.valid},{self.stale}"
        return "ERR,UNKNOWN_COMMAND"


class Harness:
    def __init__(self, profile="complete"):
        self.now = 0.0
        self.device = FirmwareSerial(profile)
        self.bridge = SerialBridge("COM_TEST")
        self.bridge.connected = True
        self.bridge._serial = self.device
        self.api = DequiHardware(lambda: self.now, lambda: 1700000000+self.now)

    def drain(self):
        while self.device.rx:
            event = SerialBridge._parse_line(self.device.rx.pop(0))
            if event["type"] == "serial_line":
                event = {"kind": "text", "body": event["line"]}
            self.api.handle(event)

    def advance(self, seconds=4):
        for _ in range(round(seconds/.05)):
            self.api.tick(self.bridge)
            self.drain()
            self.now += .05


class DequiTests(unittest.TestCase):
    def test_complete_profile_and_units(self):
        h = Harness(); h.advance()
        self.assertEqual(h.api.compatibility["status"], "compatible")
        self.assertEqual(len(h.api.readings()), 12)
        for tag, pin in {"FI5": "D30", "FI6": "D31", "FI1": "D32", "FI3": "D33", "FI4": "D34", "FI2": "D35"}.items():
            s = h.api.readings()[tag]
            self.assertEqual(s["source"]["pin"], pin)
            self.assertAlmostEqual(s["flow"], 1.5)
            self.assertEqual(s["unit"], "L/s")
            self.assertGreater(s["frequency"], 0)
        self.assertTrue(h.api.snapshot()["acquisition"]["active"])
        self.assertFalse(any("SET" in line for line in h.device.tx))

    def test_incompatible_profile_maps_by_pin(self):
        h = Harness("incompatible"); h.advance()
        self.assertTrue(h.api.firmware["identified"])
        self.assertEqual(h.api.compatibility["status"], "incompatible")
        self.assertEqual(set(h.api.readings()), {"LI2", "LI3", "LI4"})
        self.assertEqual(h.api.readings()["LI2"]["source"], dict(physical="LT2", pin="A1", apiIndex=1))
        for pin in ("D9", "D30", "D32"):
            self.assertTrue(any(pin in issue for issue in h.api.compatibility["issues"]))
        self.assertFalse(any("VAZAO" in line or "SET" in line for line in h.device.tx))

    def test_partial_without_conflicts(self):
        h = Harness("incompatible")
        h.device.pinmap = ["55:PRESSAO1", "56:PRESSAO2", "57:PRESSAO3"]
        h.device.overrides.update({"GET COMPONENTS": "OK,0,3,0,0,0", "GET ENABLED": "OK,0,3,0,0,0"})
        h.advance()
        self.assertEqual(h.api.compatibility["status"], "partial")

    def test_analog_pin_normalization(self):
        for i in range(16):
            self.assertEqual(normalize_pin(str(54+i)), f"A{i}")
            self.assertEqual(normalize_pin(f"A{i}"), f"A{i}")

    def test_reversed_indices_not_used_as_identity(self):
        h = Harness()
        h.device.pinmap = [f"A{i}:PRESSAO{6-i}" for i in range(6)] + [f"D{30+i}:VAZAO{6-i}" for i in range(6)]
        h.advance()
        self.assertEqual(h.api.readings()["LI1"]["source"]["apiIndex"], 6)
        self.assertEqual(h.api.readings()["FI5"]["source"]["apiIndex"], 6)

    def test_no_serial(self):
        h = Harness(); h.bridge.connected = False; h.advance()
        self.assertFalse(h.device.tx)
        self.assertFalse(h.api.firmware["identified"])
        self.assertFalse(h.api.snapshot()["acquisition"]["active"])

    def test_not_dequi(self):
        h = Harness(); h.device.overrides["GET ID"] = "OK,OTHER,1,MEGA2560"; h.advance()
        self.assertFalse(h.api.firmware["identified"])
        self.assertFalse(h.api.readings())

    def test_discovery_timeout_and_retry(self):
        for command in ("GET ID", "GET COMPONENTS", "GET ENABLED", "GET PINMAP"):
            with self.subTest(command=command):
                h = Harness(); h.device.overrides[command] = None; h.advance()
                self.assertEqual(h.api.compatibility["status"], "unknown")
                self.assertFalse(h.api.readings())
                del h.device.overrides[command]; h.advance(9)
                self.assertEqual(h.api.compatibility["status"], "compatible")

    def test_incomplete_pinmap_safe_subset(self):
        h = Harness(); h.device.pinmap.pop(); h.advance()
        self.assertEqual(h.api.compatibility["status"], "unknown")
        self.assertNotIn("FI2", h.api.readings())
        self.assertEqual(len(h.api.readings()), 11)

    def test_ambiguous_pin_and_index_not_mapped(self):
        h = Harness(); h.device.pinmap += ["54:PRESSAO2"]; h.advance()
        self.assertEqual(h.api.compatibility["status"], "incompatible")
        self.assertNotIn("LI1", h.api.readings())
        self.assertNotIn("LI2", h.api.readings())

    def test_ready_reset_and_reconnect(self):
        h = Harness(); h.api.handle(SerialBridge._parse_line("READY,DEQUI_HW_API,1.0.0")); h.advance()
        h.api.handle(SerialBridge._parse_line("READY,DEQUI_HW_API,1.0.0"))
        self.assertFalse(h.api.readings()); self.assertIsNone(h.api.last_success_at)
        h.advance(); self.assertEqual(len(h.api.readings()), 12)
        h.api.reset(); h.advance(); self.assertEqual(len(h.api.readings()), 12)

    def test_request_ids_and_async_events(self):
        h = Harness(); h.api.tick(h.bridge)
        pending = h.api.pending
        for line in ("@999 OK,DEQUI_HW_API,1,MEGA2560", "OK,DEQUI_HW_API,1,MEGA2560", "ALERT,FAULT", "WARN,EXAMPLE", f"@{pending['id']} ALERT,FAULT"):
            h.api.handle(SerialBridge._parse_line(line))
            self.assertIs(h.api.pending, pending)
        h.drain(); self.assertTrue(h.api.firmware["identified"])
        self.assertEqual(len(h.api.messages), 3)

    def test_err_and_malformed_response(self):
        for response in ("ERR,UNKNOWN_ID", "OK,nan,2,3,1,0,0,2", "OK,1,2"):
            h = Harness(); h.device.overrides["GET PRESSAO 1"] = response; h.advance()
            self.assertEqual(h.api.readings()["LI1"]["status"], "unavailable")
            self.assertTrue(h.api.messages)

    def test_zero_is_valid_and_level_uncalibrated(self):
        h = Harness(); h.device.flow = 0; h.device.pressure_raw = 0; h.advance()
        self.assertEqual(h.api.readings()["LI1"]["raw"], 0)
        self.assertEqual(h.api.readings()["LI1"]["status"], "uncalibrated")
        self.assertEqual(h.api.readings()["FI5"]["flow"], 0)

    def test_stale_and_invalid_do_not_renew_success(self):
        h = Harness(); h.advance(); stamp = h.api.last_success_at
        h.device.stale = 1; h.advance()
        self.assertEqual(h.api.last_success_at, stamp)
        self.assertFalse(h.api.snapshot()["acquisition"]["active"])
        self.assertEqual(h.api.readings()["FI5"]["status"], "stale")
        h.device.stale = 0; h.device.valid = 0; h.advance()
        self.assertEqual(h.api.readings()["LI1"]["status"], "invalid")

    def test_timeout_clears_measurement(self):
        h = Harness(); h.advance(); stamp = h.api.last_success_at
        h.now += 3
        self.assertIsNone(h.api.readings()["LI1"]["raw"])
        self.assertIsNone(h.api.readings()["FI5"]["flow"])
        self.assertEqual(h.api.last_success_at, stamp)

    def test_overflow_and_hz(self):
        h = Harness(); h.advance()
        h.api.previous_pulses["VAZAO 1"] = (2**32-3, h.now-2)
        h.api.consume("GET VAZAO 1", ["0", "2", "1", "0"])
        s = h.api.readings()["FI5"]
        self.assertEqual(s["deltaPulses"], 5)
        self.assertEqual(s["frequency"], 2.5)

    def test_unknown_unit_never_converted_as_liters(self):
        h = Harness(); h.advance(); h.api.units["VAZAO 1"] = "mL/s"
        h.api.consume("GET VAZAO 1", ["1", "200", "1", "0"])
        s = h.api.readings()["FI5"]
        self.assertIsNone(s["flow"])
        self.assertEqual(s["rawFlow"], 1)

    def test_firmware_internal_pin_conflict_suspends_polling(self):
        h = Harness(); h.device.overrides["GET SAFETY"] = "OK,FAULT,PIN_CONFLICT,0"; h.advance()
        self.assertFalse(h.api.mapped)
        self.assertEqual(h.api.compatibility["status"], "incompatible")

    def test_serial_whitelist(self):
        h = Harness()
        for command in ("SET BOMBA 1 1", "SET BOMBAS 1", "SET VALVULA 1 1", "SET VALVULAS 1", "SET RELE 1 1", "SET RELES 1", "SET PIN 30 1", "SET ALL 1", "@abc SET ALL 1", "PING\nSET ALL 1", "GET ID\rSET ALL 1", "HEARTBEAT", "RESET FAULT", "GET PIN 30"):
            self.assertFalse(h.bridge.send_line(command), command)
        self.assertFalse(h.device.tx)
        for command in ("@id GET ID", "GET VERSION", "GET PRESSAO 6", "GET VAZAO 6 VERBOSE"):
            self.assertTrue(h.bridge.send_line(command))

    def test_snapshot_no_geometry_or_topological_inference(self):
        h = Harness(); h.advance()
        saved = copy.deepcopy(server.state)
        try:
            with patch.object(server, "dequi_hardware", h.api), patch.object(server, "BACKEND_MODE", "HARDWARE"), patch.object(server, "serial_bridge", h.bridge):
                server.apply_dequi_readings()
                s = server.public_state()
                self.assertIsNone(s["tanks"]["TQ1"]["level"])
                self.assertIsNone(s["levelSensors"]["LI1"]["pressure"])
                self.assertEqual(s["levelSensors"]["LI1"]["raw"], 428)
                self.assertEqual(s["flowSensors"]["FI5"]["flow"], 1.5)
                self.assertIsNone(s["flows"]["RES_JIC1"])
                self.assertIsNone(s["flows"]["LV1_OY1_A"])
                self.assertEqual(s["flows"]["HV9_LV1"], 1.5)
                self.assertIsNone(s["pumps"]["JIC1"]["command"])
                self.assertTrue(s["hardware"]["firmware"]["identified"])
        finally:
            server.state.clear(); server.state.update(saved)


class Planta1ReadOnlyTests(unittest.TestCase):
    def hardware(self, version="1.0.0-PLANTA1-RO"):
        h = Harness()
        h.device.overrides["GET ID"] = f"OK,DEQUI_HW_API,{version},MEGA2560"
        for i in range(1, 7):
            h.device.overrides[f"GET PRESSAO {i}"] = "OK,428,428.000,425.500,1,0,0,12"
            h.device.overrides[f"GET VAZAO {i}"] = "OK,0.000000,0,1,0"
            h.device.overrides[f"GET VAZAO {i} VERBOSE"] = "ERR,ARG_COUNT"
        return h

    def test_ro_profile_compact_zero_all_sensors(self):
        h = self.hardware(); h.advance()
        self.assertEqual(h.device.tx[0], "@1 GET ID")
        self.assertEqual(h.api.firmware["version"], "1.0.0-PLANTA1-RO")
        self.assertFalse(any("VERBOSE" in line for line in h.device.tx))
        self.assertEqual(len(h.api.readings()), 12)
        for tag in server.FLOW_CHANNEL_IDS:
            s = h.api.readings()[tag]
            self.assertEqual(s["status"], "available")
            for key in ("rawFlow", "flow", "pulses", "frequency", "deltaPulses"):
                self.assertEqual(s[key], 0)
            self.assertEqual(s["sourceUnit"], "L/s")
        self.assertFalse(h.api.messages)

    def test_pressure_metadata_and_filtered_raw_ro_ctrl(self):
        for version in ("1.0.0-PLANTA1-RO", "1.0.0-PLANTA1-CTRL"):
            with self.subTest(version=version):
                h = self.hardware(version); h.advance()
                metadata = h.api.snapshot()
                self.assertEqual(metadata["capabilities"]["pressureFilterSamples"], 4)
                self.assertEqual(metadata["capabilities"]["pressureSampleIntervalMs"], 50)
                self.assertEqual(metadata["acquisition"]["pollIntervalSeconds"], 1.0)
                self.assertEqual(h.api.readings()["LI1"]["filteredRaw"], 425.5)
                saved = copy.deepcopy(server.state)
                try:
                    with patch.object(server, "dequi_hardware", h.api):
                        server.apply_dequi_readings()
                        self.assertEqual(server.state["levelSensors"]["LI1"]["diagnostics"]["filteredRaw"], 425.5)
                finally:
                    server.state.clear(); server.state.update(saved)

    def test_pressure_voltage_and_visual_level_in_snapshot(self):
        h = self.hardware(); h.advance()
        saved = copy.deepcopy(server.state)
        try:
            with patch.object(server, "dequi_hardware", h.api):
                server.apply_dequi_readings()
                sensor = server.state["levelSensors"]["LI1"]
                self.assertEqual(sensor["raw"], 428)
                self.assertEqual(sensor["diagnostics"]["filteredRaw"], 425.5)
                self.assertAlmostEqual(sensor["voltage"], 428*5/1023)
                self.assertEqual(sensor["status"], "available")
                self.assertAlmostEqual(sensor["heightCm"], 428*15/230)
                for field in ("pressure", "level"):
                    self.assertIsNone(sensor[field])
                for field in ("level", "volume"):
                    self.assertIsNone(server.state["tanks"]["TQ1"][field])
                h.api.consume("GET PRESSAO 1", ["0", "0", "0", "1", "0", "0", "12"])
                server.apply_dequi_readings()
                self.assertEqual(sensor["voltage"], 0)
                h.api.failed("GET PRESSAO 1", "Timeout")
                server.apply_dequi_readings()
                self.assertIsNone(sensor["voltage"])
                self.assertIsNone(sensor["raw"])
        finally:
            server.state.clear(); server.state.update(saved)

    def test_ro_flow_and_stale_timeout(self):
        h = self.hardware(); h.advance()
        h.api.consume("GET VAZAO 1", ["0.025000", "258", "1", "0"])
        s = h.api.readings()["FI5"]
        self.assertEqual((s["rawFlow"], s["flow"], s["pulses"]), (.025, 1.5, 258))
        h.api.consume("GET VAZAO 1", ["0", "258", "1", "1"])
        self.assertEqual(h.api.readings()["FI5"]["status"], "stale")
        h.api.failed("GET VAZAO 1", "Timeout")
        self.assertEqual(h.api.readings()["FI5"]["status"], "unavailable")
        self.assertIsNone(h.api.readings()["FI5"].get("flow"))

    def test_profile_suffix_and_session_reset(self):
        h = self.hardware("1.1.2-PLANTA1-RO-build2"); h.advance()
        self.assertEqual(h.api.profile, "PLANTA1-RO")
        h.api.reset()
        self.assertIsNone(h.api.flow_verbose_supported)
        self.assertIsNone(h.api.profile)
        self.assertFalse(h.api.units)

    def test_generic_verbose_rejection_falls_back_once_per_session(self):
        for error in ("ARG_COUNT", "UNKNOWN_COMMAND", "UNKNOWN_NOUN", "NOT_SUPPORTED"):
            with self.subTest(error=error):
                h = self.hardware("2.0.0")
                for i in range(1, 7):
                    h.device.overrides[f"GET VAZAO {i} VERBOSE"] = f"ERR,{error}"
                    h.device.overrides[f"GET VAZAO {i}"] = "OK,0.020000,100,1,0"
                h.advance(10)
                self.assertEqual(sum("VERBOSE" in line for line in h.device.tx), 1)
                self.assertFalse(h.api.flow_verbose_supported)
                self.assertEqual(len(h.api.messages), 1)
                s = h.api.readings()["FI5"]
                self.assertEqual((s["rawFlow"], s["pulses"]), (.02, 100))
                self.assertIsNone(s["sourceUnit"])
                self.assertIsNone(s["flow"])
                self.assertEqual(s["status"], "uncalibrated")

    def test_optional_discovery_failure_preserves_sample_and_counter(self):
        h = Harness(); h.advance()
        sample = dict(h.api.samples["VAZAO 1"])
        previous = h.api.previous_pulses["VAZAO 1"]
        h.api.failed("GET VAZAO 1 VERBOSE", "ERR,ARG_COUNT")
        self.assertEqual(h.api.samples["VAZAO 1"], sample)
        self.assertEqual(h.api.previous_pulses["VAZAO 1"], previous)
        h.advance()
        self.assertEqual(h.api.readings()["FI5"]["flow"], 1.5)

    def test_optional_timeout_falls_back_and_readings_expire(self):
        h = self.hardware("2.0.0")
        h.device.overrides["GET VAZAO 1 VERBOSE"] = None
        h.advance(8)
        self.assertFalse(h.api.flow_verbose_supported)
        self.assertEqual(h.api.readings()["FI5"]["pulses"], 0)
        self.assertEqual(sum("VERBOSE" in line for line in h.device.tx), 1)
        h = self.hardware(); h.advance(); h.now += 3
        for field in ("raw", "filteredRaw", "voltage"):
            self.assertIsNone(h.api.readings()["LI1"][field])

    def test_original_verbose_still_discovers_unit(self):
        h = Harness(); h.advance()
        self.assertTrue(h.api.flow_verbose_supported)
        self.assertEqual(sum("VERBOSE" in line for line in h.device.tx), 6)
        self.assertEqual(h.api.readings()["FI5"]["sourceUnit"], "L/s")
        self.assertEqual(h.api.readings()["FI5"]["flow"], 1.5)


class RawMeanTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        for command in ("GET ID", "GET COMPONENTS", "GET ENABLED", "GET PINMAP"):
            self.h.api.consume(command, self.h.device.response(command).split(",")[1:])

    def feed(self, raw, index=1, valid="1", stale="0", outside="0"):
        self.h.api.consume(f"GET PRESSAO {index}", [str(raw), "0", "0", valid, outside, stale, "12"])

    def reading(self, tag="LI1"):
        return self.h.api.readings()[tag]

    def test_empty_and_partial_window_preserves_raw(self):
        self.assertIsNone(self.reading()["rawMean50"])
        self.assertEqual(self.reading()["rawMeanCount"], 0)
        self.assertIsNone(self.reading()["adcVoltageMean50"])
        for value in (100, 200, 300): self.feed(value)
        self.assertEqual(self.reading()["raw"], 300)
        self.assertEqual(self.reading()["rawMean50"], 200)
        self.assertEqual(self.reading()["rawMeanCount"], 3)

    def test_full_and_sliding_window(self):
        for value in range(1, 11): self.feed(value)
        self.assertEqual(self.reading()["rawMean50"], 5.5)
        self.feed(11)
        self.assertEqual(self.reading()["rawMean50"], 6.5)
        self.assertEqual(self.reading()["rawMeanCount"], 10)
        self.assertEqual(list(self.h.api.raw_history["LI1"]), list(range(2, 12)))

    def test_valid_zero_and_voltage(self):
        self.feed(0); self.feed(1023)
        self.assertEqual(self.reading()["rawMean50"], 511.5)
        self.assertAlmostEqual(self.reading()["adcVoltageMean50"], 2.5)

    def test_invalid_stale_timeout_and_null_do_not_enter(self):
        self.feed(100)
        self.feed(900, valid="0"); self.feed(800, stale="1"); self.feed(700, outside="1")
        for value in ("null", "nan", "inf", -1, 1024):
            with self.assertRaises(ValueError): self.feed(value)
        self.h.api.failed("GET PRESSAO 1", "Timeout")
        self.assertEqual(self.reading()["rawMeanCount"], 1)
        self.assertEqual(self.reading()["rawMean50"], 100)
        self.assertIsNone(self.reading().get("raw"))
        self.feed(200)
        self.assertEqual(self.reading()["rawMean50"], 150)

    def test_independent_buffers_and_snapshot_not_a_new_sample(self):
        for i in range(1, 7): self.feed(i*100, index=i)
        for _ in range(20): self.h.api.snapshot(); self.h.api.readings()
        for i, tag in enumerate(server.LEVEL_IDS, 1):
            self.assertEqual(self.reading(tag)["rawMean50"], i*100)
            self.assertEqual(self.reading(tag)["rawMeanCount"], 1)

    def test_reset_ready_and_new_discovery_clear_history(self):
        self.feed(100)
        self.h.api.discover(self.h.device.pinmap)
        self.assertEqual(self.reading()["rawMeanCount"], 0)
        self.feed(200)
        self.h.api.handle(SerialBridge._parse_line("READY,DEQUI_HW_API,1.0.0"))
        self.assertFalse(self.h.api.raw_history)
        self.h.advance()
        self.assertTrue(self.h.api.raw_history)
        self.h.api.reset()
        self.assertFalse(self.h.api.raw_history)

    def test_snapshot_diagnostics_and_no_physical_level(self):
        saved = copy.deepcopy(server.state)
        try:
            with patch.object(server, "dequi_hardware", self.h.api), patch.object(server, "BACKEND_MODE", "HARDWARE"):
                self.feed(100); self.feed(200); self.feed(300)
                server.apply_dequi_readings()
                sensor = server.public_state()["levelSensors"]["LI1"]
                self.assertEqual(sensor["raw"], 300)
                self.assertEqual(sensor["diagnostics"]["rawMean50"], 200)
                self.assertEqual(sensor["diagnostics"]["rawMeanCount"], 3)
                self.assertIsNone(sensor["level"])
                self.h.api.reset(); server.apply_dequi_readings()
                self.assertEqual(sensor["diagnostics"]["rawMeanCount"], 0)
                self.assertIsNone(sensor["diagnostics"]["rawMean50"])
        finally:
            server.state.clear(); server.state.update(saved)


class ProvisionalCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.saved = copy.deepcopy(server.state)
        self.h = Harness()
        for command in ("GET ID", "GET COMPONENTS", "GET ENABLED", "GET PINMAP"):
            self.h.api.consume(command, self.h.device.response(command).split(",")[1:])
        self.patcher = patch.object(server, "dequi_hardware", self.h.api)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        server.state.clear(); server.state.update(self.saved)

    def feed(self, index, raw, valid="1", stale="0"):
        self.h.api.consume(f"GET PRESSAO {index}", [str(raw), str(raw), str(raw), valid, "0", stale, "10"])
        server.apply_dequi_readings()
        return server.state["levelSensors"][server.LEVEL_IDS[index-1]]

    def test_six_points_produce_visual_level(self):
        for index, raw, cm in ((1, 230, 15), (2, 215, 0), (3, 206, 10), (4, 258, 14), (5, 101, 11.4), (6, 125, 9.1)):
            sensor = self.feed(index, raw)
            self.assertAlmostEqual(sensor["heightCm"], cm)
            self.assertNotIn("levelCalibration", sensor)
            self.assertIsNone(sensor["level"])
            self.assertIsNone(server.state["tanks"][f"TQ{index}"]["level"])
            self.assertIsNone(sensor["pressure"])

    def test_mean_not_instantaneous_and_ten_samples(self):
        for value in range(151, 201): self.feed(6, value)
        sensor = self.feed(6, 210)
        expected_mean = (sum(range(192, 201))+210)/10
        self.assertEqual(sensor["raw"], 210)
        self.assertEqual(sensor["diagnostics"]["rawMeanCount"], 10)
        self.assertAlmostEqual(sensor["diagnostics"]["rawMean50"], expected_mean)
        self.assertAlmostEqual(sensor["heightCm"], expected_mean*9.1/125)

    def test_li2_zero_offset_and_negative_clamping(self):
        self.assertEqual(self.feed(2, 200)["heightCm"], 0)
        self.h.api.raw_history.clear()
        self.assertEqual(self.feed(2, 215)["heightCm"], 0)
        self.h.api.raw_history.clear()
        self.assertAlmostEqual(self.feed(2, 245)["heightCm"], 30*15/230)

    def test_invalid_stale_timeout_and_reset_clear_level(self):
        self.feed(6, 138)
        self.assertIsNone(self.feed(6, 200, valid="0")["heightCm"])
        self.assertIsNone(self.feed(6, 200, stale="1")["heightCm"])
        self.h.now += 3; server.apply_dequi_readings()
        self.assertIsNone(server.state["levelSensors"]["LI6"]["heightCm"])
        self.h.api.reset(); server.apply_dequi_readings()
        self.assertIsNone(server.state["levelSensors"]["LI6"]["heightCm"])

    def test_height_units_and_no_invented_volume(self):
        with patch.dict(server.TANK_GEOMETRY, {"TQ6": {"heightM": .1, "capacityL": None}}):
            sensor = self.feed(6, 200)
            self.assertIsNone(sensor["level"])
            self.assertAlmostEqual(sensor["heightCm"], 200*9.1/125)
            self.assertAlmostEqual(server.state["tanks"]["TQ6"]["height"], sensor["heightCm"]/100)
            self.assertIsNone(server.state["tanks"]["TQ6"]["volume"])
            self.assertIsNone(server.state["tanks"]["TQ6"]["level"])


class DequiWebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_both_profiles_over_actual_websocket_and_commands_blocked(self):
        saved = copy.deepcopy(server.state)
        try:
            for profile in ("complete", "incompatible"):
                h = Harness(profile); h.advance()
                with patch.object(server, "BACKEND_MODE", "HARDWARE"), patch.object(server, "dequi_hardware", h.api), patch.object(server, "serial_bridge", h.bridge):
                    server.apply_dequi_readings()
                    async with websockets.serve(server.client_handler, "127.0.0.1", 0) as ws_server:
                        port = ws_server.sockets[0].getsockname()[1]
                        async with websockets.connect(f"ws://127.0.0.1:{port}") as client:
                            packet = json.loads(await asyncio.wait_for(client.recv(), 2))
                            while "data" not in packet:
                                packet = json.loads(await asyncio.wait_for(client.recv(), 2))
                            data = packet["data"]
                            self.assertEqual(data["hardware"]["compatibility"]["status"], "compatible" if profile == "complete" else "incompatible")
                            for kind in ("pump", "valve", "relay", "loop", "scenario", "sim"):
                                await client.send(json.dumps(dict(type=kind, id="JIC1", power=1, mode="AUTO", sp=10)))
                            await asyncio.sleep(.15)
                            self.assertFalse(any("SET" in line for line in h.device.tx))
        finally:
            server.state.clear(); server.state.update(saved)


if __name__ == "__main__":
    unittest.main()
