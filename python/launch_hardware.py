"""Iniciador Windows do HARDWARE: aquisição RO ou controle manual CTRL, sem upload."""
import os
import sys
from launch_services import ROOT, check_ports, check_tools, run_services

def main():
    os.chdir(ROOT)
    check_tools()
    check_ports(int(os.environ.get("SIX_TANK_WS_PORT", "8765")), int(os.environ.get("SIX_TANK_HTTP_PORT", "5173")))
    try:
        import serial
        import websockets
    except ImportError as exc:
        raise RuntimeError("Faltam pyserial/websockets. Execute bat_dependencias.bat.") from exc
    from serial.tools import list_ports
    ports = sorted(list_ports.comports(), key=lambda p: p.device)
    if not ports:
        raise RuntimeError("Nenhuma porta serial encontrada. Conecte o Mega e confira cabo/driver.")
    compatible = [p for p in ports if (p.vid, p.pid) in {(0x2341,0x0042),(0x2A03,0x0042),(0x2341,0x0010)} or "mega" in p.description.lower()]
    if len(compatible) == 1:
        port = compatible[0].device
    else:
        print("Selecione a porta do Arduino (clones podem ter descrição USB Serial):")
        for i,p in enumerate(ports,1): print(f"{i}. {p.device} — {p.description}")
        while True:
            value = input("Número da porta: ").strip()
            if value.isdigit() and 1 <= int(value) <= len(ports):
                port = ports[int(value)-1].device
                break
            print("Escolha um número da lista.")
    try:
        with serial.Serial(port,115200,timeout=.2): pass
    except serial.SerialException as exc:
        raise RuntimeError(f"Não foi possível abrir {port}. Feche o Monitor Serial/IDE ou outro processo: {exc}") from exc
    print(f"Serial validada: {port}, 115200 baud. Na HMI selecione Planta real.")
    run_services("HARDWARE", {"SIX_TANK_SERIAL_PORT":port, "SIX_TANK_SERIAL_BAUD":"115200"})

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: pass
    except Exception as exc:
        print(f"ERRO: {exc}")
        sys.exit(1)
