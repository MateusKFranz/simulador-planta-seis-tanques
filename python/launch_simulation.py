"""MODELICA com as duas FMUs, Vite e navegador; nunca usa MOCK."""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from launch_services import ROOT, check_ports, check_tools, run_services


def prepare():
    for module in ("pyfmi", "websockets", "serial"):
        try:
            __import__(module)
        except ImportError as exc:
            raise RuntimeError(f"Python {sys.executable}: falta {module}. Execute bat_dependencias.bat.") from exc
    check_tools()
    check_ports(int(os.environ.get("SIX_TANK_WS_PORT", "8765")), int(os.environ.get("SIX_TANK_HTTP_PORT", "5173")))
    names = ("SeisTanques_v13_SixTanks.fmu", "SeisTanques_Controle_Banco.fmu")
    if all((ROOT / "modelica/build" / name).is_file() for name in names):
        return
    try:
        import OMPython
    except ImportError as exc:
        raise RuntimeError("FMUs ausentes: instale OMPython com bat_dependencias.bat.") from exc
    from build_fmu import localizar_openmodelica
    home = localizar_openmodelica()
    omc = shutil.which("omc")
    if not home and omc:
        home = str(Path(omc).resolve().parent.parent)
    if not home:
        raise RuntimeError("FMUs ausentes: instale OpenModelica e configure OPENMODELICAHOME (pasta que contém bin/omc.exe) ou omc no PATH.")
    subprocess.check_call([sys.executable, str(ROOT / "python/build_fmu.py")], cwd=ROOT, env=dict(os.environ, OPENMODELICAHOME=home))
    if not all((ROOT / "modelica/build" / name).is_file() for name in names):
        raise RuntimeError("A geração não produziu as duas FMUs esperadas.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--smoke-test", action="store_true")
    args = parser.parse_args()
    try:
        prepare()
        run_services("MODELICA", no_browser=args.no_browser, smoke_test=args.smoke_test)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f"ERRO: {exc}")
        sys.exit(1)
