"""Serviços locais pertencentes ao launcher, sem comandos de atuação."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlencode
import webbrowser

ROOT = Path(__file__).resolve().parent.parent


def check_ports(ws_port=8765, http_port=5173):
    if ws_port == http_port or not 1 <= ws_port <= 65535 or not 1 <= http_port <= 65535:
        raise RuntimeError("Portas inválidas ou iguais para WebSocket e Vite.")
    for port in (ws_port, http_port):
        with socket.socket() as probe:
            if os.name == "nt":
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            try:
                probe.bind(("", port))
            except OSError as exc:
                raise RuntimeError(f"Porta {port} ocupada/indisponível. Encerre a outra execução; nenhum processo externo será encerrado.") from exc


def check_tools():
    for tool in ("node", "npm"):
        if not shutil.which(tool):
            raise RuntimeError(f"{tool} não encontrado. Instale Node.js com npm e reabra o terminal.")
    if not (ROOT / "node_modules/vite/bin/vite.js").is_file():
        raise RuntimeError("Vite não instalado. Execute bat_dependencias.bat.")


def ready(mode, ws_port, http_port=5173):
    from websockets.sync.client import connect
    try:
        with socket.create_connection(("127.0.0.1", http_port), timeout=.3):
            pass
        with connect(f"ws://127.0.0.1:{ws_port}", open_timeout=1, close_timeout=.2) as ws:
            # O servidor publica hello antes do primeiro snapshot.
            for _ in range(5):
                message = json.loads(ws.recv(timeout=1))
                if message.get("type") == "state":
                    return message.get("data", {}).get("mode") == mode
            return False
    except (OSError, TimeoutError, ValueError):
        return False


def run_services(mode, extra_env=None, no_browser=False, smoke_test=False):
    check_tools()
    port = int(os.environ.get("SIX_TANK_WS_PORT", "8765"))
    http_port = int(os.environ.get("SIX_TANK_HTTP_PORT", "5173"))
    check_ports(port, http_port)
    env = dict(os.environ, SIX_TANK_MODE=mode, SIX_TANK_WS_PORT=str(port))
    env.update(extra_env or {})
    children = []
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    try:
        children.append(subprocess.Popen([sys.executable, "-u", str(ROOT / "python/server.py")], cwd=ROOT, env=env, creationflags=flags))
        children.append(subprocess.Popen([os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", f"npm run dev -- --host 127.0.0.1 --port {http_port} --strictPort"], cwd=ROOT, env=env, creationflags=flags))
        deadline = time.monotonic() + 90
        while True:
            if any(p.poll() is not None for p in children):
                raise RuntimeError("Um serviço encerrou. Confira o erro acima.")
            if ready(mode, port, http_port):
                if any(p.poll() is not None for p in children):
                    raise RuntimeError("Serviço encerrou durante a inicialização.")
                break
            if time.monotonic() > deadline:
                raise RuntimeError(f"Serviços não confirmaram {mode} em 90 segundos.")
            time.sleep(.25)
        url = f"http://127.0.0.1:{http_port}/?" + urlencode({"ws": f"ws://localhost:{port}"})
        print(f"{mode} confirmado pelo WebSocket. Interface: {url}", flush=True)
        if not no_browser:
            webbrowser.open(url)
        if smoke_test:
            return
        print("Mantenha esta janela aberta. Ctrl+C encerra somente os serviços desta execução.", flush=True)
        while all(p.poll() is None for p in children):
            time.sleep(.5)
        raise RuntimeError("Um serviço encerrou inesperadamente. Confira o erro acima.")
    finally:
        for process in reversed(children):
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
                else:
                    process.terminate()
                process.wait(timeout=10)
