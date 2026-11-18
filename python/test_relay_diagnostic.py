"""Sketch de bancada com GPIO e Serial simulados; nunca acessa uma COM."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get("CTRL_CXX") or shutil.which("g++"), "Compilador C++ ausente")
class RelayDiagnosticTests(unittest.TestCase):
    def test_single_pin_commands_and_idle_timeout(self):
        root = Path(__file__).resolve().parents[1]
        sketch = (root / "arduino/diagnostico_reles/diagnostico_reles.ino").read_text(encoding="utf-8")
        compiler = os.environ.get("CTRL_CXX") or shutil.which("g++")
        env = dict(os.environ, PATH=str(Path(compiler).parent) + os.pathsep + os.environ["PATH"])
        checks = r'''
#include <cassert>
void send(const std::string &s) {
    for (char c:s+"\n") Serial.rx.push_back(c);
    loop();
}
int main() {
    for (int p=0;p<70;++p) simulatedModes[p]=simulatedPins[p]=-7;
    setup();
    assert(simulatedModes[RELAY_PIN]==INPUT && simulatedPins[RELAY_PIN]==LOW);
    const std::string prefix="D"+std::to_string(RELAY_PIN);
    for (const std::string level:{"LOW","HIGH"}) {
        send(prefix+" "+level);
        assert(simulatedModes[RELAY_PIN]==OUTPUT);
        assert(simulatedPins[RELAY_PIN]==(level=="HIGH" ? HIGH : LOW));
        const auto reads=Serial.readCount;
        simulatedMs=commandAt+4999; loop(); assert(appliedLevel>=0);
        simulatedMs=commandAt+5000; loop();
        assert(Serial.readCount==reads && appliedLevel==-1);
        assert(simulatedModes[RELAY_PIN]==INPUT && simulatedPins[RELAY_PIN]==LOW);
    }
    send(prefix+" HIGH"); send("STATUS");
    simulatedMs=commandAt+5000; loop(); assert(appliedLevel==-1);
    send(prefix+" HIGH"); send("STOP"); assert(appliedLevel==-1);
    send(prefix+" HIGH"); setup(); assert(appliedLevel==-1);
    for (int p=26;p<=29;++p) if (p!=RELAY_PIN) {
        send("D"+std::to_string(p)+" HIGH"); assert(appliedLevel==-1);
    }
    send(prefix+" HIGH"); send("D5 HIGH"); assert(appliedLevel==-1);
    send(prefix+" HIGH"); send(std::string(60,'X')+prefix+" HIGH"); assert(appliedLevel==-1);
    for (int p=0;p<70;++p) if (p!=RELAY_PIN) {
        assert(simulatedModes[p]==-7 && simulatedPins[p]==-7);
    }
    assert(Serial.tx.str().find("TIMEOUT")!=std::string::npos);
}
'''
        with tempfile.TemporaryDirectory() as tmp:
            source, exe = Path(tmp)/"diagnostic.cpp", Path(tmp)/"diagnostic.exe"
            for pin in range(26, 30):
                with self.subTest(pin=pin):
                    source.write_text(sketch.replace("RELAY_PIN = 26;", f"RELAY_PIN = {pin};") + checks, encoding="utf-8")
                    subprocess.run([compiler, "-std=c++11", "-I", str(root/"python/firmware_stubs"),
                                    str(source), "-o", str(exe)], check=True, capture_output=True, env=env)
                    subprocess.run([str(exe)], check=True, capture_output=True, env=env, timeout=10)
