"""Regressão do loop real do .ino CTRL sem chegada de bytes Serial."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get("CTRL_CXX") or shutil.which("g++"), "Compilador C++ ausente")
class FirmwareLoopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.exe=Path(cls.temp.name)/"firmware-loop.exe"
        source=Path(__file__).with_name("firmware_loop_checks.cpp")
        compiler=os.environ.get("CTRL_CXX") or shutil.which("g++")
        cls.env=dict(os.environ, PATH=str(Path(compiler).parent)+os.pathsep+os.environ["PATH"])
        subprocess.run([compiler,"-std=c++11","-I",str(source.parent/"firmware_stubs"),
                        str(source),"-o",str(cls.exe)],check=True,capture_output=True,text=True,env=cls.env)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_case(self, case):
        result=subprocess.run([str(self.exe),case],check=True,capture_output=True,text=True,env=self.env,timeout=10)
        self.assertIn("PASS:",result.stdout)

    def test_pump_watchdog_without_serial_bytes(self):
        self.run_case("pump")

    def test_four_servos_timer5_and_interlocks(self):
        self.run_case("four_servos")

    def test_get_does_not_renew_heartbeat(self):
        self.run_case("get_watchdog")

    def test_pinmap_protocol_and_component_configs(self):
        self.run_case("pinmap")

    def test_servo_ramp_and_watchdog_without_serial(self):
        self.run_case("servo")

    def test_oy_watchdog_without_serial(self):
        self.run_case("oy")
