"""Contrato WebSocket e ciclo único, sem depender de FMUs ou Arduino."""

import _test_calibration  # Isola os dados de campo antes de importar server.
import asyncio
import copy
import json
import unittest
from unittest.mock import Mock, patch

import server
import websockets

INITIAL_STATE = copy.deepcopy(server.state)


class BackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_level_ids_in_mock_and_hardware(self):
        from test_dequi import Harness
        harness = Harness(); harness.advance()
        for mode in ['MOCK', 'HARDWARE']:
            with patch.object(server, 'BACKEND_MODE', mode), patch.object(server, 'dequi_hardware', harness.api):
                if mode == 'HARDWARE':
                    server.apply_dequi_readings()
                snapshot = server.public_state()
                self.assertEqual(set(snapshot['levelSensors']), {f'LI{i}' for i in range(1, 7)})
                self.assertNotIn('LIC3', snapshot['levelSensors'])
                self.assertNotIn('LIC4', snapshot['levelSensors'])

    async def test_mock_commands_never_reach_serial(self):
        bridge = Mock()
        with patch.object(server, 'BACKEND_MODE', 'MOCK'), patch.object(server, 'serial_bridge', bridge):
            server.handle_command({'type': 'pump', 'id': 'JIC3', 'power': True, 'command': .3})
            server.handle_command({'type': 'valve', 'id': 'LV1', 'opening': .4})
            server.handle_command({'type': 'relay', 'id': 'OY1', 'branch': 'A', 'state': True})
        self.assertEqual(server.state['pumps']['JIC3']['command'], .3)
        self.assertEqual(server.state['actuatedValves']['LV1']['opening'], .4)
        self.assertEqual(bridge.mock_calls, [])

    async def asyncSetUp(self):
        self.saved_state = copy.deepcopy(server.state)
        server.state.clear()
        server.state.update(copy.deepcopy(INITIAL_STATE))

    async def asyncTearDown(self):
        server.state.clear()
        server.state.update(self.saved_state)

    async def test_mock_single_clock_without_clients(self):
        clock = [0.0]
        steps = []

        async def sleep(delay):
            clock[0] += delay
            if len(steps) == 4:
                raise asyncio.CancelledError

        with patch.object(server, "BACKEND_MODE", "MOCK"), \
             patch.object(server.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(server.asyncio, "sleep", side_effect=sleep), \
             patch.object(server, "update_mock_plant", side_effect=steps.append):
            with self.assertRaises(asyncio.CancelledError):
                await server.process_loop()
        self.assertEqual(len(steps), 4)
        self.assertAlmostEqual(sum(steps), 0.3)

    async def test_two_clients_only_receive_without_advancing_mock(self):
        with patch.object(server, "BACKEND_MODE", "MOCK"), \
             patch.object(server, "update_mock_plant") as advance:
            async with websockets.serve(server.client_handler, "127.0.0.1", 0) as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                async with websockets.connect(f"ws://127.0.0.1:{port}") as a, \
                           websockets.connect(f"ws://127.0.0.1:{port}") as b:
                    for client in (a, b):
                        self.assertEqual(json.loads(await client.recv())["type"], "hello")
                        self.assertEqual(json.loads(await client.recv())["type"], "state")
                        self.assertEqual(json.loads(await client.recv())["type"], "state")
            advance.assert_not_called()

    async def test_shared_clock_runs_with_two_clients(self):
        with patch.object(server, "BACKEND_MODE", "MOCK"), \
             patch.object(server, "update_mock_plant", wraps=server.update_mock_plant) as advance:
            async with websockets.serve(server.client_handler, "127.0.0.1", 0) as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                task = asyncio.create_task(server.process_loop())
                try:
                    async with websockets.connect(f"ws://127.0.0.1:{port}") as a, \
                               websockets.connect(f"ws://127.0.0.1:{port}") as b:
                        for client in (a, b):
                            async with asyncio.timeout(2):
                                self.assertEqual(json.loads(await client.recv())["type"], "hello")
                                self.assertEqual(json.loads(await client.recv())["type"], "state")
                        self.assertGreaterEqual(advance.call_count, 1)
                        # Somente process_loop é autorizado a integrar a planta.
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                        count = advance.call_count
                        for client in (a, b):
                            async with asyncio.timeout(2):
                                self.assertEqual(json.loads(await client.recv())["type"], "state")
                        self.assertEqual(advance.call_count, count)
                finally:
                    if not task.done():
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task

    async def test_hello_is_transport_only_in_all_modes(self):
        for mode in ("HARDWARE", "MODELICA", "MOCK"):
            with self.subTest(mode=mode), patch.object(server, "BACKEND_MODE", mode), \
                 patch.object(server, "handle_command") as command:
                async with websockets.serve(server.client_handler, "127.0.0.1", 0) as ws_server:
                    port = ws_server.sockets[0].getsockname()[1]
                    async with websockets.connect(f"ws://127.0.0.1:{port}") as client:
                        await client.send(json.dumps({"type": "hello", "client": "hmi"}))
                        # A próxima mensagem marca que hello já foi processado.
                        await client.send("invalid-json")
                        async with asyncio.timeout(2):
                            while True:
                                message = json.loads(await client.recv())
                                if message["type"] == "error":
                                    self.assertEqual(message["message"], "JSON inválido.")
                                    break
                command.assert_not_called()

    async def test_hardware_websocket_rejects_write(self):
        with patch.object(server, "BACKEND_MODE", "HARDWARE"), \
             patch.object(server, "handle_command") as command:
            async with websockets.serve(server.client_handler, "127.0.0.1", 0) as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                async with websockets.connect(f"ws://127.0.0.1:{port}") as client:
                    await client.send(json.dumps({"type": "pump", "id": "JIC3", "power": True}))
                    async with asyncio.timeout(2):
                        while True:
                            message = json.loads(await client.recv())
                            if message["type"] == "error":
                                self.assertIn("somente leitura", message["message"])
                                break
            command.assert_not_called()

    async def test_modelica_routes_commands_and_tick_only_to_runtime(self):
        runtime = Mock()
        runtime.handle_command.return_value = True
        runtime.tick.side_effect = asyncio.CancelledError
        with patch.object(server, "BACKEND_MODE", "MODELICA"), \
             patch.object(server, "modelica_runtime", runtime), \
             patch.object(server, "update_mock_plant") as mock_step:
            message = {"type": "sim", "running": True}
            self.assertTrue(server.handle_command(message))
            runtime.handle_command.assert_called_once_with(message)
            with self.assertRaises(asyncio.CancelledError):
                await server.process_loop()
            runtime.tick.assert_called_once()
            mock_step.assert_not_called()


if __name__ == "__main__":
    unittest.main()
