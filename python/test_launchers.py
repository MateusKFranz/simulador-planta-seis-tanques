"""Launchers sem bancada: conflitos, preparação e propriedade dos processos."""
import unittest
from unittest.mock import Mock, patch
import launch_services as launcher
import launch_simulation


class LauncherTests(unittest.TestCase):
    def test_readiness_skips_hello_and_checks_mode(self):
        from websockets.sync import client
        connection = Mock()
        connection.recv.side_effect = ['{"type":"hello"}', '{"type":"state","data":{"mode":"MODELICA"}}']
        with patch.object(launcher.socket, 'create_connection'), patch.object(client, 'connect') as connect:
            connect.return_value.__enter__.return_value = connection
            self.assertTrue(launcher.ready('MODELICA', 8765))
            self.assertEqual(connection.recv.call_count, 2)

    def test_missing_serial_never_opens_services(self):
        import launch_hardware
        with patch.object(launch_hardware, 'check_ports'), patch.object(launch_hardware, 'check_tools'), patch('serial.tools.list_ports.comports', return_value=[]), patch.object(launch_hardware, 'run_services') as run:
            with self.assertRaisesRegex(RuntimeError, 'Nenhuma porta serial'):
                launch_hardware.main()
            run.assert_not_called()

    def test_conflict_does_not_start_or_stop_anything(self):
        with patch.object(launcher, 'check_tools'), patch.object(launcher, 'check_ports', side_effect=RuntimeError('ocupada')), patch.object(launcher.subprocess, 'Popen') as start, patch.object(launcher.subprocess, 'run') as stop:
            with self.assertRaisesRegex(RuntimeError, 'ocupada'):
                launcher.run_services('MODELICA')
            start.assert_not_called()
            stop.assert_not_called()

    def test_existing_fmus_do_not_build(self):
        with patch.object(launch_simulation, 'check_tools'), patch.object(launch_simulation, 'check_ports'), patch.object(launch_simulation.Path, 'is_file', return_value=True), patch.object(launch_simulation.subprocess, 'check_call') as build, patch.dict('sys.modules', {'pyfmi': Mock(), 'serial': Mock(), 'websockets': Mock()}):
            launch_simulation.prepare()
            build.assert_not_called()

    def test_failed_child_prevents_browser_and_stops_only_owned(self):
        backend = Mock(pid=101); backend.poll.return_value = None
        frontend = Mock(pid=102); frontend.poll.return_value = 1
        with patch.object(launcher, 'check_tools'), patch.object(launcher, 'check_ports'), patch.object(launcher.subprocess, 'Popen', side_effect=[backend, frontend]), patch.object(launcher.subprocess, 'run') as stop, patch.object(launcher.webbrowser, 'open') as browser:
            with self.assertRaisesRegex(RuntimeError, 'encerrou'):
                launcher.run_services('MODELICA')
            browser.assert_not_called()
            if launcher.os.name == 'nt':
                stop.assert_called_once_with(['taskkill','/PID','101','/T','/F'],capture_output=True)
            backend.wait.assert_called_once()

    def test_ports_must_be_distinct(self):
        with self.assertRaises(RuntimeError):
            launcher.check_ports(5173)


if __name__ == '__main__':
    unittest.main()
