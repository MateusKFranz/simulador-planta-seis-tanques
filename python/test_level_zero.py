import _test_calibration  # Isola os dados de campo antes de importar server.
import copy
import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import server
from hardware.hardware_config import LEVEL_CALIBRATION
from hardware.level_zero import LevelZeroCalibration
import websockets


class ZeroTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'zero.json'
        self.store = LevelZeroCalibration(self.path)

    def test_offset_gain_isolation_restart_restore(self):
        defaults = copy.deepcopy(LEVEL_CALIBRATION)
        for sensor in defaults:
            with self.subTest(sensor=sensor):
                self.store.save(sensor, 170.4)
                p = self.store.parameters(sensor)
                self.assertEqual(p['slope'], defaults[sensor]['slope'])
                self.assertAlmostEqual(p['slope'] * (170.4-p['offset_raw']) + p['offset'], 0)
                for other in defaults:
                    if other != sensor:
                        self.assertEqual(self.store.parameters(other), defaults[other])
                restarted = LevelZeroCalibration(self.path)
                self.assertEqual(restarted.info(sensor)['zeroRaw'], 170.4)
                restarted.save(sensor, restore=True)
                self.assertEqual(LevelZeroCalibration(self.path).parameters(sensor), defaults[sensor])
                self.store = restarted
        self.assertEqual(LEVEL_CALIBRATION, defaults)

    def test_atomic_failure_does_not_change_memory_or_file(self):
        self.store.save('LI1', 100)
        before = self.path.read_text()
        with patch('hardware.level_zero.os.replace', side_effect=OSError('disco indisponível')):
            with self.assertRaises(OSError): self.store.save('LI1', 200)
        self.assertEqual(self.store.zeros['LI1'], 100)
        self.assertEqual(self.path.read_text(), before)

    def test_invalid_persistent_data_fails_explicitly(self):
        self.path.write_text(json.dumps({'version': 1, 'zeros': {'FI1': 100}}))
        with self.assertRaises(ValueError): LevelZeroCalibration(self.path)

    def test_legacy_zeros_migrate_in_memory_and_save_new_ids(self):
        original = {'version': 1, 'zeros': {'LIC3': 170.625, 'LIC4': 215, 'LI1': 123.5}}
        self.path.write_text(json.dumps(original), encoding='utf-8')
        before = self.path.read_bytes()
        store = LevelZeroCalibration(self.path)
        self.assertEqual(store.zeros, {'LI3': 170.625, 'LI4': 215, 'LI1': 123.5})
        self.assertEqual(self.path.read_bytes(), before)
        with patch('hardware.level_zero.os.replace', side_effect=OSError('falha')):
            with self.assertRaises(OSError): store.save('LI2', 100)
        self.assertEqual(self.path.read_bytes(), before)
        store.save('LI2', 100)
        self.assertEqual(json.loads(self.path.read_text()), {'version':2, 'points':store.points})
        self.assertNotIn('LIC3', store.zeros)
        restarted = LevelZeroCalibration(self.path)
        self.assertEqual(restarted.info('LI3')['zeroRaw'], 170.625)
        restarted.save('LI3', restore=True)
        self.assertFalse(restarted.info('LI3')['zeroIsField'])
        self.assertEqual(restarted.info('LI4')['zeroRaw'], 215)

    def test_legacy_conflicts_preserve_file_in_both_orders(self):
        for pairs in [(('LIC3', 100), ('LI3', 101)), (('LI4', 101), ('LIC4', 100))]:
            self.path.write_text(json.dumps({'version': 1, 'zeros': dict(pairs)}))
            before = self.path.read_bytes()
            with self.assertRaisesRegex(ValueError, 'Conflito de calibração'):
                LevelZeroCalibration(self.path)
            self.assertEqual(self.path.read_bytes(), before)

    def test_equal_aliases_merge_but_invalid_legacy_values_fail(self):
        self.path.write_text(json.dumps({'version': 1, 'zeros': {'LIC3': 100, 'LI3': 100.0}}))
        self.assertEqual(LevelZeroCalibration(self.path).zeros, {'LI3': 100})
        for raw in [True, -1, 1024, '100', None, float('nan')]:
            self.path.write_text(json.dumps({'version': 1, 'zeros': {'LIC4': raw}}))
            before = self.path.read_bytes()
            with self.assertRaises(ValueError): LevelZeroCalibration(self.path)
            self.assertEqual(self.path.read_bytes(), before)

    def test_backend_validates_and_never_sends_serial(self):
        bridge = Mock(connected=True)
        sample = {'status': 'uncalibrated', 'valid': True, 'stale': False, 'rawMean50': 170.4, 'rawMeanCount': 10}
        api = Mock()
        api.readings.return_value = {'LI2': sample}
        message = {'type': 'level_zero', 'action': 'calibrate', 'id': 'LI2', 'rawMean50': 170.4, 'requestId': 'test'}
        with patch.object(server, 'level_zero', self.store), patch.object(server, 'BACKEND_MODE', 'HARDWARE'), patch.object(server, 'serial_bridge', bridge), patch.object(server, 'dequi_hardware', api), patch.object(server, 'apply_dequi_readings'):
            result = server.handle_level_zero(message)
            self.assertTrue(result['success'])
            self.assertEqual(result['requestId'], 'test')
            sample['rawMean50'] = 171.1
            result = server.handle_level_zero({**message, 'rawMean50': 170.6})
            self.assertTrue(result['success'])
            self.assertEqual(self.store.info('LI2')['zeroRaw'], 170.6)
            for bad in (None, float('nan'), float('inf'), '170.4', True, -1, 1024):
                self.assertFalse(server.handle_level_zero({**message, 'rawMean50': bad})['success'])
            for field, value in [('status', 'stale'), ('stale', True), ('valid', False), ('rawMeanCount', 0), ('rawMeanCount', 9), ('rawMean50', None), ('outOfRange', True)]:
                with patch.dict(sample, {field: value}): self.assertFalse(server.handle_level_zero(message)['success'])
            bridge.connected = False
            self.assertFalse(server.handle_level_zero(message)['success'])
            bridge.connected = True
            with patch.object(server, 'BACKEND_MODE', 'MODELICA'):
                self.assertFalse(server.handle_level_zero(message)['success'])
            with patch.object(self.store, 'save', side_effect=OSError('falha ao salvar')):
                result = server.handle_level_zero(message)
                self.assertFalse(result['success']); self.assertIn('falha ao salvar', result['message'])
            self.assertTrue(server.handle_level_zero({**message, 'action': 'restore'})['success'])
        self.assertEqual(bridge.mock_calls, [])
        self.assertTrue(all(call[0] == 'readings' for call in api.mock_calls))

    def test_snapshot_recalculates_zero_without_changing_mean(self):
        from test_dequi import Harness
        harness = Harness()
        # Descoberta e aquisição simuladas, sem COM.
        harness.advance()
        harness.api.raw_history.clear()
        saved = copy.deepcopy(server.state)
        try:
            with patch.object(server, 'dequi_hardware', harness.api), patch.object(server, 'level_zero', self.store):
                harness.api.consume('GET PRESSAO 1', ['100', '100', '100', '1', '0', '0', '10'])
                self.store.save('LI1', 100)
                server.apply_dequi_readings()
                sensor = server.state['levelSensors']['LI1']
                self.assertEqual(sensor['heightCm'], 0)
                self.assertEqual(sensor['diagnostics']['rawMean50'], 100)
                self.assertEqual(sensor['diagnostics']['zeroRaw'], 100)
                self.assertTrue(sensor['diagnostics']['zeroIsField'])
        finally:
            server.state.clear(); server.state.update(saved)


class ZeroWebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_readonly_api_saves_and_confirms_without_serial_write(self):
        from test_dequi import Harness
        h = Harness(); h.advance(seconds=20)
        saved = copy.deepcopy(server.state)
        before = list(h.device.tx)
        try:
            with tempfile.TemporaryDirectory() as directory:
                store = LevelZeroCalibration(Path(directory) / 'zero.json')
                with patch.object(server, 'BACKEND_MODE', 'HARDWARE'), patch.object(server, 'dequi_hardware', h.api), patch.object(server, 'serial_bridge', h.bridge), patch.object(server, 'level_zero', store):
                    server.apply_dequi_readings()
                    raw = h.api.readings()['LI1']['rawMean50']
                    async with websockets.serve(server.client_handler, '127.0.0.1', 0) as ws_server:
                        port = ws_server.sockets[0].getsockname()[1]
                        async with websockets.connect(f'ws://127.0.0.1:{port}') as client:
                            for action in ('calibrate', 'add', 'restore'):
                                await client.send(json.dumps({'type': 'level_zero', 'action': action, 'id': 'LI1', 'rawMean50': raw+10 if action=='add' else raw, 'heightCm':5.7, 'requestId': action}))
                                while True:
                                    response = json.loads(await asyncio.wait_for(client.recv(), 2))
                                    if response['type'] == 'level_zero_result': break
                                self.assertTrue(response['success'], response)
                                self.assertEqual(response['requestId'], action)
                                if action == 'calibrate':
                                    self.assertEqual(server.state['levelSensors']['LI1']['heightCm'], 0)
                                self.assertEqual(h.device.tx, before)
                    self.assertEqual(LevelZeroCalibration(store.path).zeros, {})
        finally:
            server.state.clear(); server.state.update(saved)
