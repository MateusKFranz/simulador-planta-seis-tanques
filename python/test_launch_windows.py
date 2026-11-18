"""Verifica os auxiliares PowerShell sem instalar pacotes nem iniciar a planta."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell ausente')
class WindowsLauncherTests(unittest.TestCase):
    def run_script(self, body, extra_env=None, main=False, arguments=()):
        source = Path(__file__).with_name('launch_windows.ps1').read_text(encoding='utf-8')
        functions = source.split('\ntry {', 1)[0]
        with tempfile.TemporaryDirectory(prefix='planta espaço ação ') as temp:
            path = Path(temp)/'python'
            path.mkdir()
            script = path/'check.ps1'
            script.write_text(functions+'\n'+body+('\n'+source[len(functions):] if main else ''), encoding='utf-8-sig')
            env = {**os.environ, **(extra_env or {})}
            return subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(script),*arguments],
                capture_output=True, text=True, env=env, timeout=30)

    def test_explicit_python_with_spaces_and_accents(self):
        with tempfile.TemporaryDirectory(prefix='ambiente ação ') as temp:
            executable=Path(temp)/'python.exe'
            executable.touch()
            result=self.run_script("$found = Find-Python 'nao-deve-ser-executado'; if ($found -ne $env:SIX_TANK_PYTHON) { exit 3 }; exit 0",
                {'SIX_TANK_PYTHON':str(executable)})
        self.assertEqual(result.returncode,0,result.stderr)

    def test_invalid_explicit_python_fails(self):
        result=self.run_script("Find-Python $null",{'SIX_TANK_PYTHON':'Z:/inexistente/python.exe'})
        self.assertNotEqual(result.returncode,0)

    def test_native_failure_propagates(self):
        result=self.run_script("Run-Checked 'powershell.exe' @('-NoProfile','-Command','exit 7')")
        self.assertNotEqual(result.returncode,0)
        self.assertIn('codigo 7',result.stderr)


FAKE_STATUS = r"""
function New-TestStatus {
    return @{Platform=$true;Node='node.exe';NodeOk=$true;Npm='npm.cmd';NpmOk=$true;Packages=$true;
        Conda='conda.exe';CondaOk=$true;Envs=@('C:/teste/seistanques');Seistanques='C:/teste/seistanques';
        Python='C:/teste/seistanques/python.exe';PythonOk=$true;InstallPython=$true;
        PythonInfo=@{prefix='C:/teste/seistanques'};Omc='C:/teste/bin/omc.exe';OmcOk=$true;
        Modules=@{pip=$true;pyfmi=$true;serial=$true;websockets=$true;OMPython=$true;zmq=$true};
        Fmus=@{SeisTanques_v13_SixTanks='OK';SeisTanques_Controle_Banco='OK'};Notes=@()}
}
$script:state = New-TestStatus
function Get-DependencyStatus { return $script:state }
function Open-OfficialPage($url) { Write-Host "PAGE:$url" }
function Run-Checked($program,$arguments) { throw 'Comando externo inesperado' }
"""


@unittest.skipUnless(shutil.which('powershell.exe'), 'Windows PowerShell ausente')
class AssistedInstallerTests(unittest.TestCase):
    run_script = WindowsLauncherTests.run_script
    def simulate(self, body, **kwargs):
        result = self.run_script(FAKE_STATUS + body, {'SIX_TANK_PYTHON': ''}, **kwargs)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_installed_does_not_prompt_or_install(self):
        self.simulate("function Read-Host { throw 'Nao deve perguntar' }; Install-MissingDependencies $state")

    def test_default_no_skip_and_unknown_never_authorize(self):
        for answer in ['', 'NAO', 'PULAR', 'yes', 'S']:
            with self.subTest(answer=answer):
                self.simulate("$script:ran=0; function Read-Host { return '"+answer+"' }; Invoke-InstallStep 'teste' 'uso' 'fonte' 'acao' { $script:ran++ }; if($ran){throw 'Executou sem SIM'}")

    def test_read_only_and_runtime_launchers_never_install(self):
        for mode in ['DEPENDENCIES', 'MODELICA', 'HARDWARE']:
            with self.subTest(mode=mode):
                self.simulate("function Read-Host { throw 'Prompt indevido' }; function Install-MissingDependencies { throw 'Instalacao indevida' }",
                    main=True, arguments=('-Mode', mode, '-CheckOnly'))
        for mode in ['MODELICA', 'HARDWARE']:
            result = self.simulate("""
function Read-Host { throw 'Prompt indevido' }
function Install-MissingDependencies { throw 'Instalacao indevida' }
function Use-Python { }
function Run-Checked($program,$arguments) { Write-Host ('LAUNCH:' + $arguments[0]) }
""", main=True, arguments=('-Mode', mode))
            self.assertIn('launch_hardware.py' if mode=='HARDWARE' else 'launch_simulation.py', result.stdout)

    def test_readiness_distinguishes_execution_generation_hardware(self):
        self.simulate("""
$state.OmcOk=$false
$r=Get-Readiness $state
if(-not $r.Simulation -or -not $r.Hardware -or $r.Build){throw 'Omc nao e necessario ao runtime'}
$state.Fmus.SeisTanques_v13_SixTanks='AUSENTE'
$r=Get-Readiness $state
if($r.Simulation -or -not $r.Hardware){throw 'FMU ausente'}
$state.Modules.serial=$false
if((Get-Readiness $state).Hardware){throw 'Serial ausente'}
""")

    def test_winget_failure_does_not_install_or_claim_success(self):
        result = self.simulate("""
$state.Node=$null;$state.NodeOk=$false;$state.NpmOk=$false
function Get-Command { return @{Source='winget.exe'} }
function Read-Host($prompt) { if($prompt -like 'Tentar*'){return 'NAO'};return 'SIM' }
function Invoke-Probe { return @{Ok=$false;Text='Rede indisponivel'} }
Install-MissingDependencies $state
""")
        self.assertIn('Origem do instalador nao confirmada', result.stdout)

    def test_node_install_exact_source_hash_and_second_consent(self):
        result = self.simulate("""
$state.Node=$null;$state.NodeOk=$false;$state.NpmOk=$false
function Get-Command { return @{Source='winget.exe'} }
function Read-Host { return 'SIM' }
function Invoke-Probe { return @{Ok=$true;Text='https://nodejs.org/dist/v24.11.1/node-v24.11.1-x64.msi'} }
function Run-Checked($program,$arguments) { Write-Host ('ARGS:' + ($arguments -join '|')) }
Install-MissingDependencies $state
""")
        self.assertIn('install|--id|OpenJS.NodeJS.LTS|--exact|--source|winget',result.stdout)
        self.assertIn('--interactive|--no-upgrade',result.stdout)
        self.assertNotIn('--ignore-security-hash',result.stdout)
        self.assertNotIn('--accept-package-agreements',result.stdout)

    def test_unverified_node_origin_blocks_execution(self):
        result = self.simulate("""
$state.Node=$null;$state.NodeOk=$false;$state.NpmOk=$false
function Get-Command { return @{Source='winget.exe'} }
function Read-Host($prompt) { if($prompt -like 'Tentar*'){return 'NAO'};return 'SIM' }
function Invoke-Probe { return @{Ok=$true;Text='https://untrusted.example/node.msi'} }
Install-MissingDependencies $state
""")
        self.assertIn('Origem do instalador nao confirmada',result.stdout)

    def test_missing_conda_and_openmodelica_offer_only_official_pages(self):
        result = self.simulate("""
$state.CondaOk=$false;$state.Conda=$null;$state.OmcOk=$false
function Read-Host { return 'SIM' }
Install-MissingDependencies $state
""")
        self.assertIn('PAGE:https://github.com/conda-forge/miniforge',result.stdout)
        self.assertIn('PAGE:https://openmodelica.org/download/download-windows/',result.stdout)

    def test_permission_failure_can_be_skipped_without_retry(self):
        result = self.simulate("""
function Read-Host($prompt) { if($prompt -like 'Tentar*'){return 'NAO'};return 'SIM' }
Invoke-InstallStep 'componente' 'uso' 'fonte' 'acao' { throw [UnauthorizedAccessException]::new('Sem permissao') }
""")
        self.assertIn('Sem permissao',result.stdout)
        self.assertIn('Nao eleve o assistente inteiro',result.stdout)

    def test_existing_environment_targets_prefix_never_recreates(self):
        result = self.simulate("""
$state.Modules.pyfmi=$false
function Read-Host { return 'SIM' }
function Run-Checked($program,$arguments) { Write-Host ('ARGS:' + ($arguments -join '|')) }
Install-MissingDependencies $state
""")
        self.assertIn('install|--prefix|C:/teste/seistanques',result.stdout)
        self.assertIn('--freeze-installed|pyfmi',result.stdout)
        self.assertNotIn('create|',result.stdout)

    def test_explicit_non_conda_does_not_receive_pyfmi_via_pip(self):
        result = self.simulate("""
$env:SIX_TANK_PYTHON='C:/venv/python.exe';$state.Modules.pyfmi=$false;$state.Envs=@()
function Read-Host { throw 'Instalacao indevida' }
Install-MissingDependencies $state
""")
        self.assertIn('nao sera substituido',result.stdout)

    def test_only_missing_fmu_is_built(self):
        result = self.simulate("""
$state.Fmus.SeisTanques_Controle_Banco='AUSENTE'
function Read-Host { return 'SIM' }
function Test-Fmu { return 'OK' }
function Run-Checked($program,$arguments) { Write-Host ('BUILD:' + $arguments[-1]) }
Install-MissingDependencies $state
""")
        self.assertIn('BUILD:controle',result.stdout)
        self.assertNotIn('BUILD:planta',result.stdout)

    def test_invalid_existing_fmu_is_preserved(self):
        result = self.simulate("""
$state.Fmus.SeisTanques_v13_SixTanks='INVALIDA'
function Read-Host { throw 'Nao pode substituir arquivo existente' }
Install-MissingDependencies $state
""")
        self.assertIn('invalida: preservada',result.stdout)

    def test_path_discovery_without_refreshed_terminal(self):
        result = self.run_script(r"""
$env:LOCALAPPDATA=$root;$env:USERPROFILE=$root;$env:CONDA_EXE='';$env:CONDA_PREFIX='';$env:OPENMODELICAHOME=''
function Get-Command { return $null }
foreach($relative in @('Programs/nodejs/node.exe','miniforge3/Scripts/conda.exe','Programs/OpenModelica-test/bin/omc.exe')) {
    $file=Join-Path $root $relative
    New-Item -ItemType Directory -Path (Split-Path $file -Parent) -Force > $null
    New-Item -ItemType File -Path $file > $null
}
if(-not (Find-Node)){throw 'Node nao encontrado'}
if(-not (Find-Conda)){throw 'Conda nao encontrado'}
if(-not (Find-OpenModelica)){throw 'Omc nao encontrado'}
""")
        self.assertEqual(result.returncode,0,result.stderr)


    def test_explicit_python_is_detected_with_spaces_without_global_install(self):
        with tempfile.TemporaryDirectory(prefix='python ação ') as temp:
            executable = Path(temp)/'python.exe'; executable.touch()
            result = self.run_script(r"""
function Find-Node { return $null }
function Find-Conda { return $null }
function Find-OpenModelica { return $null }
function Test-Fmu { return 'AUSENTE' }
function Invoke-Probe($program,$arguments) {
    if($program -ne $env:SIX_TANK_PYTHON){throw 'Python diferente do explicito'}
    return @{Ok=$true;Text='{"version":[3,12],"bits":64,"prefix":"C:/global","isolated":false,"modules":{"pip":{"ok":true,"version":"25"}}}'}
}
$s=Get-DependencyStatus
if($s.Python -ne $env:SIX_TANK_PYTHON -or -not $s.PythonOk -or $s.InstallPython){throw 'Selecao insegura'}
""", {'SIX_TANK_PYTHON': str(executable)})
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_create_environment_only_if_absent_and_no_override(self):
        result = self.simulate("""
$state.Seistanques=$null;$state.Python=$null;$state.PythonOk=$false;$state.InstallPython=$false;$state.Envs=@()
function Read-Host { return 'SIM' }
function Run-Checked($program,$arguments) { Write-Host ('ARGS:' + ($arguments -join '|')) }
Install-MissingDependencies $state
""")
        self.assertIn('create|--name|seistanques|--override-channels|-c|conda-forge|python=3.12|pip',result.stdout)
        result = self.simulate("""
$env:SIX_TANK_PYTHON='C:/global/python.exe';$state.Seistanques=$null;$state.InstallPython=$false
function Read-Host { throw 'Nao criar ambiente nem alterar global' }
Install-MissingDependencies $state
""")
        self.assertIn('Nenhum Python global sera alterado',result.stdout)

    def test_recheck_after_manual_installation(self):
        result = self.simulate("""
$script:reads=0
function Read-Host { $script:reads++; if($script:reads -eq 1){return '1'};return '0' }
$script:checks=0
function Get-DependencyStatus {
    $script:checks++;$s=New-TestStatus
    if($checks -eq 1){$s.OmcOk=$false}
    return $s
}
$result=Start-DependencyAssistant
if($result -ne 0 -or $checks -ne 2){throw 'Reverificacao nao executada'}
""")
        self.assertIn('OpenModelica (omc): PENDENTE',result.stdout)
        self.assertIn('OpenModelica (omc): OK',result.stdout)

    def test_missing_npm_packages_only_installs_when_authorized(self):
        result = self.simulate("""
$state.Packages=$false
function Read-Host { return 'SIM' }
function Run-Checked($program,$arguments) { Write-Host ('ARGS:' + $program + '|' + ($arguments -join '|')) }
Install-MissingDependencies $state
""")
        self.assertIn('ARGS:npm.cmd|install',result.stdout)
        self.assertNotIn('|ci',result.stdout)

    def test_readonly_incomplete_returns_nonzero_without_prompt(self):
        result = self.run_script(FAKE_STATUS+"""
$state.Modules.OMPython=$false
function Read-Host { throw 'Prompt indevido' }
function Install-MissingDependencies { throw 'Instalacao indevida' }
""",main=True,arguments=('-Mode','DEPENDENCIES','-CheckOnly'))
        self.assertEqual(result.returncode,1,result.stderr)
        self.assertIn('Simulacao com FMUs existentes: PRONTA',result.stdout)
        self.assertIn('Gerar novas FMUs: PENDENTE',result.stdout)

    def test_fmu_inspection_is_readonly_and_requires_correct_binary(self):
        import zipfile
        import hashlib
        with tempfile.TemporaryDirectory(prefix='FMU ação ') as temp:
            fmu=Path(temp)/'test.fmu'
            for xml, binary, expected in [
                ('<fmiModelDescription fmiVersion="2.0"><CoSimulation modelIdentifier="Test"/></fmiModelDescription>', 'binaries/win64/Test.dll', 'OK'),
                ('<fmiModelDescription fmiVersion="2.0"><CoSimulation modelIdentifier="Other"/></fmiModelDescription>', 'binaries/win64/Test.dll', 'INVALIDA'),
                ('<fmiModelDescription fmiVersion="2.0"><CoSimulation modelIdentifier="Test"/></fmiModelDescription>', 'binaries/linux64/Test.so', 'INVALIDA'),
            ]:
                with zipfile.ZipFile(fmu,'w') as z:
                    z.writestr('modelDescription.xml',xml);z.writestr(binary,b'test')
                before=hashlib.sha256(fmu.read_bytes()).hexdigest()
                result=self.run_script("$result=Test-Fmu $env:TEST_FMU 'Test'; Write-Host $result",{'TEST_FMU':str(fmu)})
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(result.stdout.strip(),expected)
                self.assertEqual(hashlib.sha256(fmu.read_bytes()).hexdigest(),before)


    def test_failure_can_exit_sequence_immediately(self):
        self.simulate("""
function Read-Host($prompt) { if($prompt -like 'Tentar*'){return 'SAIR'};return 'SIM' }
$cancelled=$false
try { Invoke-InstallStep 'teste' 'uso' 'fonte' 'acao' { throw 'Falha de rede' } }
catch [OperationCanceledException] { $cancelled=$true }
if(-not $cancelled){throw 'SAIR deve interromper a sequencia'}
""")

    def test_missing_fmu_prevents_runtime_from_building_implicitly(self):
        result = self.run_script(FAKE_STATUS+"$state.Fmus.SeisTanques_v13_SixTanks='AUSENTE'", main=True, arguments=('-Mode','MODELICA'))
        self.assertEqual(result.returncode,1,result.stderr)
        self.assertIn('nenhum servico foi iniciado',result.stdout)
        self.assertNotIn('Comando externo inesperado',result.stdout)
