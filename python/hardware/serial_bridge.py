import math
import queue
import re
import threading
import time

import serial


class SerialBridge:
    """Serial com whitelist; escrita CTRL depende de descoberta validada."""

    def __init__(
        self,
        port,
        baud=115200,
        reconnect_seconds=2.0
    ):
        self.port = port
        self.baud = int(baud)
        self.reconnect_seconds = float(reconnect_seconds)

        self._serial = None
        self._thread = None
        self._stop_event = threading.Event()
        self._write_lock = threading.Lock()
        self._events = queue.Queue()

        self.connected = False
        self.control_enabled = False
        self.connection_id = 0
        self.last_error = None
        self.last_rx_time = None
        self.last_tx_time = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._worker,
            name="six-tank-serial",
            daemon=True
        )
        self._thread.start()

    def stop(self):
        self._stop_event.set()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)

        self._close_serial()

    def ping(self):
        return self.send_line("PING")

    def send_line(self, line):
        read_command = isinstance(line, str) and re.fullmatch(
            r"(?:@[A-Za-z0-9_-]{1,10} )?(?:PING|GET (?:ID|VERSION|COMPONENTS|ENABLED|PINMAP|COMM|SAFETY)|GET (?:PRESSAO|VAZAO) [1-9][0-9]{0,2}(?: VERBOSE)?)", line
        )
        control_command = self.control_enabled and isinstance(line, str) and re.fullmatch(
            r"@[0-9]{1,10} (?:GET CONTROL|ARM|DISARM|HEARTBEAT|EMERGENCY STOP|RESET FAULT|"
            r"SET BOMBA [1-3] (?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])|"
            r"SET VALVULA [1-4] (?:[0-9]|[1-9][0-9]|100)|SET (?:LVANGLE|LVSYNC) [1-4] (?:[0-9]|[1-9][0-9]|1[0-7][0-9]|180)|SET LVSTOP [1-4] 0|SET OY [12] (?:A|B|RELEASE))", line)
        if not (read_command or control_command):
            return False

        if not self.connected or self._serial is None:
            return False

        payload = (line.strip() + "\n").encode("utf-8")

        try:
            with self._write_lock:
                self._serial.write(payload)
                self._serial.flush()

            self.last_tx_time = time.monotonic()
            return True

        except (serial.SerialException, OSError) as exc:
            self.last_error = str(exc)
            self._events.put({
                "type": "serial_error",
                "message": self.last_error
            })
            self._close_serial()
            return False

    def poll_events(self, max_events=100):
        events = []

        for _ in range(max_events):
            try:
                events.append(self._events.get_nowait())
            except queue.Empty:
                break

        return events

    def _worker(self):
        while not self._stop_event.is_set():
            if self._serial is None:
                if not self._try_connect():
                    self._stop_event.wait(self.reconnect_seconds)
                    continue

            try:
                raw = self._serial.readline()

                if not raw:
                    continue

                line = raw.decode(
                    "utf-8",
                    errors="replace"
                ).strip()

                if not line:
                    continue

                self.last_rx_time = time.monotonic()
                event = self._parse_line(line)

                if event:
                    self._events.put(event)

            except (serial.SerialException, OSError) as exc:
                self.last_error = str(exc)
                self._events.put({
                    "type": "serial_error",
                    "message": self.last_error
                })
                self._close_serial()
                self._stop_event.wait(self.reconnect_seconds)

    def _try_connect(self):
        try:
            self._serial = serial.Serial(
                port=self.port,
                baudrate=self.baud,
                timeout=0.20,
                write_timeout=0.50
            )

            # O Mega 2560 costuma reiniciar ao abrir a porta Serial.
            time.sleep(2.0)

            self.connected = True
            self.connection_id += 1
            self.last_error = None

            self._events.put({
                "type": "serial_connected",
                "port": self.port,
                "baud": self.baud,
                "connection_id": self.connection_id
            })

            return True

        except (serial.SerialException, OSError) as exc:
            self.last_error = str(exc)
            self._close_serial()
            return False

    def _close_serial(self):
        self.control_enabled = False
        was_connected = self.connected
        self.connected = False

        serial_object = self._serial
        self._serial = None

        if serial_object is not None:
            try:
                serial_object.close()
            except Exception:
                pass

        if was_connected:
            self._events.put({
                "type": "serial_disconnected",
                "port": self.port
            })

    @staticmethod
    def _clamp(value, minimum=0.0, maximum=1.0):
        value = float(value)
        return max(minimum, min(maximum, value))

    @staticmethod
    def _parse_line(line):
        # Respostas DEQUI não passam pelo parser do protocolo espontâneo.
        match = re.fullmatch(r"(?:@([A-Za-z0-9_-]{1,10}) )?(.*)", line)
        request_id, body = match.groups() if match else (None, line)
        kind = body.split(",", 1)[0]
        if request_id or kind in {"READY", "OK", "ERR", "WARN", "ALERT", "END"}:
            return {"type": "dequi", "requestId": request_id, "kind": kind,
                    "fields": body.split(",")[1:], "body": body}
        parts = [part.strip() for part in line.split(",")]

        if not parts:
            return None

        message_type = parts[0].upper()

        if message_type == "HELLO":
            return {
                "type": "arduino_hello",
                "board": parts[1] if len(parts) > 1 else "",
                "application": parts[2] if len(parts) > 2 else "",
                "protocol": parts[3] if len(parts) > 3 else ""
            }

        if message_type == "ACK":
            return {
                "type": "arduino_ack",
                "command": parts[1:] if len(parts) > 1 else []
            }

        if message_type == "PONG":
            return {
                "type": "arduino_pong"
            }

        if message_type == "ERROR":
            return {
                "type": "arduino_error",
                "message": ",".join(parts[1:])
            }

        if message_type == "TELEMETRY":
            values = {}

            for item in parts[1:]:
                if "=" not in item:
                    continue

                key, value = item.split("=", 1)
                key = key.strip().upper()

                try:
                    number = float(value)
                    values[key] = number if math.isfinite(number) else None
                except ValueError:
                    values[key] = None

            recognized = any(key in values for i in range(1, 7) for key in
                             (f"LT{i}_RAW", f"FT{i}", f"FT{i}_RAW", f"FT{i}_HZ", f"FT{i}_PULSES"))
            return {"type": "telemetry", "values": values} if recognized else None

        return {
            "type": "serial_line",
            "line": line
        }
