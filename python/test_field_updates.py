import _test_calibration
import asyncio
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import websockets
import server
from hardware.level_zero import LevelZeroCalibration


class MultipointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = LevelZeroCalibration(Path(self.tmp.name)/'points.json')

    def add(self, raw, height, sensor='LI1'):
        self.store.save(sensor,raw,height=height,action='add')

    def test_counts_offset_fit_all_points_inverse_and_range(self):
        self.assertEqual(self.store.info('LI1')['calibrationMode'],'provisional')
        self.add(100,0)
        self.assertEqual(self.store.convert('LI1',100),(0,None))
        self.assertEqual(self.store.info('LI1')['calibrationMode'],'offset')
        self.add(200,5.7)
        self.assertAlmostEqual(self.store.convert('LI1',150)[0],2.85)
        self.assertEqual(self.store.convert('LI1',99),(0,'extrapolated'))
        self.assertAlmostEqual(self.store.convert('LI1',250)[0],8.55)
        self.assertEqual(self.store.convert('LI1',250)[1],'extrapolated')
        self.add(300,11.5)
        expected = LevelZeroCalibration.fit(self.store.points['LI1'])
        self.assertAlmostEqual(self.store.info('LI1')['slope'],expected[0])
        self.assertNotEqual(self.store.info('LI1')['intercept'],-expected[0]*100)
        self.add(400,17.1);self.add(500,22.8)
        self.assertEqual(len(self.store.points['LI1']),5)
        with self.assertRaises(ValueError): self.add(600,28.5)
        self.add(100,0,'LI2')
        before = self.store.path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'aumentar'):
            self.add(60,10,'LI2')
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.store.points['LI2'], [{'heightCm': 0, 'raw': 100}])
        self.assertFalse(self.store.info('LI1')['calibrationValidated'])

    def test_invalid_duplicates_and_quality(self):
        for raw,height in [(float('nan'),0),(float('inf'),0),(-1,0),(1024,0),(True,0),(1,-1),(1,float('nan')),(1,float('inf')),(1,True)]:
            with self.assertRaises(ValueError): self.add(raw,height)
        self.add(100,0)
        for raw,height in [(100,5),(100+1e-8,5),(200,0)]:
            with self.assertRaises(ValueError): self.add(raw,height)
        self.add(200,20)
        with self.assertRaises(ValueError): self.add(300,5)
        self.store.save('LI1',restore=True)
        self.add(100,0);self.add(200,10);self.add(300,100)
        self.assertEqual(self.store.info('LI1')['calibrationQuality'],'warning')
        self.assertEqual(self.store.convert('LI1',200),(None,'calibration_warning'))
        with self.assertRaises(ValueError): LevelZeroCalibration.fit([{'raw':1,'heightCm':0},{'raw':2,'heightCm':0}])

    def test_replace_delete_restore_restart_atomic_and_aliases(self):
        self.store.path.write_text(json.dumps({'version':1,'zeros':{'LIC3':100,'LI2':120}}))
        original = self.store.path.read_bytes()
        self.store = LevelZeroCalibration(self.store.path)
        self.assertEqual(self.store.path.read_bytes(),original)
        self.add(200,10,'LI3')
        self.assertEqual(self.store.zeros['LI3'],100)
        self.assertNotIn('LIC3',self.store.path.read_text())
        p = copy.deepcopy(self.store.points['LI3'][1])
        self.store.save('LI3',210,height=10,action='replace',point=p)
        self.assertEqual(self.store.points['LI3'][1], {'heightCm': 10, 'raw': 210})
        with self.assertRaises(ValueError): self.store.save('LI3',action='delete',point=p)
        before = self.store.path.read_bytes(); memory = copy.deepcopy(self.store.points)
        with patch('hardware.level_zero.os.replace',side_effect=OSError('disco')):
            with self.assertRaises(OSError): self.store.save('LI3',action='delete',point=memory['LI3'][1])
        self.assertEqual(self.store.points,memory);self.assertEqual(self.store.path.read_bytes(),before)
        restarted = LevelZeroCalibration(self.store.path)
        restarted.save('LI3',action='delete',point=memory['LI3'][1])
        self.assertEqual(restarted.zeros,{'LI3':100,'LI2':120})
        restarted.save('LI3',restore=True)
        self.assertEqual(LevelZeroCalibration(self.store.path).zeros,{'LI2':120})

    def test_backend_capture_validation_geometry_and_no_serial(self):
        bridge = Mock(connected=True)
        sample = dict(status='uncalibrated',valid=True,stale=False,rawMean50=101,rawMeanCount=10,rawMeanWindow=10)
        api=Mock();api.readings.return_value={'LI1':sample}
        msg=dict(type='level_zero',requestId='p',id='LI1',action='add',rawMean50=100,heightCm=5.7)
        with patch.object(server,'BACKEND_MODE','HARDWARE'),patch.object(server,'serial_bridge',bridge),patch.object(server,'dequi_hardware',api),patch.object(server,'level_zero',self.store),patch.object(server,'apply_dequi_readings'):
            for field,value in [('valid',False),('stale',True),('outOfRange',True),('rawMeanCount',9),('rawMeanWindow',50),('rawMean50',float('nan')),('status','invalid')]:
                with patch.dict(sample,{field:value}): self.assertFalse(server.handle_level_zero(msg)['success'])
            bridge.connected=False;self.assertFalse(server.handle_level_zero(msg)['success']);bridge.connected=True
            with patch.dict(server.TANK_GEOMETRY['TQ1'],heightM=.05): self.assertFalse(server.handle_level_zero(msg)['success'])
            self.assertTrue(server.handle_level_zero(msg)['success'])
            self.assertEqual(self.store.points['LI1'],[{'raw':100,'heightCm':5.7}])
            for bad in [-1,float('nan'),float('inf'),'5,7',True]: self.assertFalse(server.handle_level_zero({**msg,'heightCm':bad})['success'])
            self.assertFalse(server.handle_level_zero({**msg,'unexpected':1})['success'])
            point=self.store.points['LI1'][0]
            bridge.connected=False
            self.assertTrue(server.handle_level_zero(dict(type='level_zero',id='LI1',action='delete',point=point))['success'])
        self.assertEqual(bridge.mock_calls,[])

    def test_snapshot_uses_single_conversion_and_invalid_is_not_zero(self):
        from test_dequi import Harness
        h=Harness();h.advance();h.api.raw_history.clear()
        saved=copy.deepcopy(server.state)
        try:
            with patch.object(server,'dequi_hardware',h.api),patch.object(server,'serial_bridge',h.bridge),patch.object(server,'level_zero',self.store):
                self.add(100,0);self.add(200,5.7)
                h.api.consume('GET PRESSAO 4',['150','150','150','1','0','0','10'])
                server.apply_dequi_readings()
                sensor=server.state['levelSensors']['LI1']
                self.assertAlmostEqual(sensor['heightCm'],2.85)
                self.assertAlmostEqual(server.state['tanks']['TQ1']['height'],.0285)
                h.api.raw_history.clear();h.api.consume('GET PRESSAO 4',['250','250','250','1','0','0','10'])
                server.apply_dequi_readings()
                self.assertAlmostEqual(sensor['heightCm'],8.55)
                self.assertTrue(sensor['diagnostics']['extrapolated'])
                self.assertEqual(sensor['diagnostics']['rawMean50'],250)
                self.assertEqual(len(sensor['diagnostics']['calibrationPoints']),2)
                h.api.raw_history.clear();h.api.consume('GET PRESSAO 4',['1000','1000','1000','1','0','0','10'])
                server.apply_dequi_readings()
                self.assertEqual(sensor['heightCm'],30)
                self.assertTrue(sensor['diagnostics']['aboveLevelLimit'])
                h.now+=10;server.apply_dequi_readings();self.assertIsNone(sensor['heightCm'])
                self.assertEqual(sensor['status'],'stale')
                h.api.consume('GET PRESSAO 4',['1000','1000','1000','1','0','0','10'])
                h.bridge.connected=False
                server.apply_dequi_readings()
                self.assertIsNone(sensor['heightCm'])
                self.assertIsNone(sensor['raw'])
        finally: server.state.clear();server.state.update(saved)


class ManualPositionTests(unittest.IsolatedAsyncioTestCase):
    async def test_ro_ctrl_disarmed_reconnection_and_other_clients_no_serial(self):
        from test_dequi import Harness
        from hardware.hardware_control import ManualHardware
        old=copy.deepcopy(server.manual_positions)
        self.addCleanup(lambda: (server.manual_positions.clear(),server.manual_positions.update(old)))
        server.manual_positions.clear()
        h=Harness();h.advance(seconds=20)
        for api in [h.api,ManualHardware()]:
            before=list(h.device.tx)
            with patch.object(server,'BACKEND_MODE','HARDWARE'),patch.object(server,'serial_bridge',h.bridge),patch.object(server,'dequi_hardware',api):
                for value in [0,50,100]:
                    result=server.handle_manual_position(dict(type='manual_position',requestId='x',id='HV1',percent=value))
                    self.assertTrue(result['success'])
                    self.assertEqual(server.public_state()['manualValves']['HV1']['opening'],value/100)
                for bad in [float('nan'),float('inf'),-1,101,True,None,'50']:
                    self.assertFalse(server.handle_manual_position(dict(type='manual_position',requestId='x',id='HV1',percent=bad))['success'])
                for tag in ['HV10','JIC1',None,[]]:
                    self.assertFalse(server.handle_manual_position(dict(type='manual_position',requestId='x',id=tag,percent=50))['success'])
                self.assertFalse(server.handle_manual_position(dict(type='manual_position',requestId='x',id='HV1',percent=50,pin=26))['success'])
                self.assertEqual(h.device.tx,before)
        with patch.object(server,'BACKEND_MODE','HARDWARE'),patch.object(server,'serial_bridge',h.bridge),patch.object(server,'dequi_hardware',h.api):
            async with websockets.serve(server.client_handler,'127.0.0.1',0) as srv:
                url=f'ws://127.0.0.1:{srv.sockets[0].getsockname()[1]}'
                async with websockets.connect(url) as observer:
                    async with websockets.connect(url) as client:
                        await client.send(json.dumps(dict(type='manual_position',requestId='test',id='HV9',percent=50)))
                        while True:
                            msg=json.loads(await asyncio.wait_for(client.recv(),2))
                            if msg['type']=='manual_position_result': break
                        self.assertTrue(msg['success'])
                    async with websockets.connect(url) as reconnect:
                        for socket in [observer,reconnect]:
                            while True:
                                msg=json.loads(await asyncio.wait_for(socket.recv(),2))
                                if msg['type']=='state' and msg['data']['mainValve']['opening']==.5: break
                            self.assertEqual(msg['data']['mainValve']['positionSource'],'operator')
            self.assertEqual(h.device.tx,before)
