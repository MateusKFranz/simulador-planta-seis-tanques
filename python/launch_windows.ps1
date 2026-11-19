param(
    [ValidateSet('MODELICA','HARDWARE','DEPENDENCIES')][string]$Mode,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

function Find-Conda {
    if ($env:CONDA_EXE -and (Test-Path -LiteralPath $env:CONDA_EXE)) { return $env:CONDA_EXE }
    $command = Get-Command conda.exe,conda.bat -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $bases = @($env:CONDA_PREFIX, "$env:USERPROFILE\miniforge3", "$env:USERPROFILE\miniconda3", "$env:USERPROFILE\anaconda3", "$env:LOCALAPPDATA\miniforge3")
    $registry = "$env:USERPROFILE\.conda\environments.txt"
    if (Test-Path -LiteralPath $registry) {
        foreach ($entry in Get-Content -LiteralPath $registry) {
            $bases += $entry
            if ((Split-Path (Split-Path $entry -Parent) -Leaf) -eq 'envs') { $bases += Split-Path (Split-Path $entry -Parent) -Parent }
        }
    }
    foreach ($base in $bases) {
        if ($base -and (Test-Path -LiteralPath "$base\Scripts\conda.exe")) { return "$base\Scripts\conda.exe" }
    }
}

function Find-Python($conda) {
    if ($env:SIX_TANK_PYTHON) {
        if (-not (Test-Path -LiteralPath $env:SIX_TANK_PYTHON -PathType Leaf)) { throw 'SIX_TANK_PYTHON nao aponta para um executavel existente.' }
        return $env:SIX_TANK_PYTHON
    }
    $environments = @()
    if ($conda) {
        $info = & $conda env list --json
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar os ambientes Conda.' }
        $environments += ($info | ConvertFrom-Json).envs
    }
    $registry = "$env:USERPROFILE\.conda\environments.txt"
    if (Test-Path -LiteralPath $registry) { $environments += Get-Content -LiteralPath $registry }
    foreach ($entry in $environments) {
        if ((Split-Path $entry -Leaf) -eq 'seistanques' -and (Test-Path -LiteralPath "$entry\python.exe")) { return "$entry\python.exe" }
    }
    if ($env:CONDA_PREFIX -and (Test-Path -LiteralPath "$env:CONDA_PREFIX\python.exe")) { return "$env:CONDA_PREFIX\python.exe" }
    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notlike '*\WindowsApps\*') { return $command.Source }
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $found = & $py.Source -3 -c 'import sys; print(sys.executable)'
        if ($LASTEXITCODE -eq 0) { return $found }
    }
}

function Use-Python($python) {
    # DLLs do ambiente Conda somente neste processo e nos seus filhos.
    $prefix = Split-Path $python -Parent
    $env:PATH = (@($prefix, "$prefix\Library\bin", "$prefix\Scripts") + ($env:PATH -split ';') | Select-Object -Unique) -join ';'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONDONTWRITEBYTECODE = '1'
}

function Run-Checked($program, $arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha ao executar $program (codigo $LASTEXITCODE)." }
}

function Find-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($base in @("$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\nodejs", "$env:LOCALAPPDATA\nodejs")) {
        if (Test-Path -LiteralPath "$base\node.exe") { return "$base\node.exe" }
    }
}

function Find-OpenModelica {
    if ($env:OPENMODELICAHOME -and (Test-Path -LiteralPath "$env:OPENMODELICAHOME\bin\omc.exe")) { return "$env:OPENMODELICAHOME\bin\omc.exe" }
    $command = Get-Command omc.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) {
        if (-not $base -or -not (Test-Path -LiteralPath $base)) { continue }
        foreach ($dir in Get-ChildItem -LiteralPath $base -Filter 'OpenModelica*' -Directory) {
            if (Test-Path -LiteralPath "$($dir.FullName)\bin\omc.exe") { return "$($dir.FullName)\bin\omc.exe" }
        }
    }
}

function Invoke-Probe($program, $arguments) {
    try {
        $output = & $program @arguments 2>&1 | Out-String
        return @{ Ok = ($LASTEXITCODE -eq 0); Text = $output.Trim() }
    } catch { return @{ Ok = $false; Text = $_.Exception.Message } }
}

function Test-Platform {
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    return [Environment]::OSVersion.Platform -eq 'Win32NT' -and [Environment]::OSVersion.Version.Major -ge 10 -and $arch -eq 'AMD64'
}

function Test-Fmu($path, $identifier) {
    if (-not (Test-Path -LiteralPath $path)) { return 'AUSENTE' }
    $zip = $null; $reader = $null
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($path)
        $entry = $zip.GetEntry('modelDescription.xml')
        if (-not $entry) { return 'INVALIDA' }
        $reader = [IO.StreamReader]::new($entry.Open())
        $settings = [Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = 'Prohibit'; $settings.XmlResolver = $null
        $xmlReader = [Xml.XmlReader]::Create($reader, $settings)
        try { $xml = [Xml.XmlDocument]::new(); $xml.XmlResolver = $null; $xml.Load($xmlReader) } finally { $xmlReader.Dispose() }
        if ($xml.fmiModelDescription.fmiVersion -ne '2.0' -or $xml.fmiModelDescription.CoSimulation.modelIdentifier -ne $identifier) { return 'INVALIDA' }
        if (-not $zip.GetEntry("binaries/win64/$identifier.dll")) { return 'INVALIDA' }
        return 'OK'
    } catch { return 'INVALIDA' }
    finally { if ($reader) { $reader.Dispose() }; if ($zip) { $zip.Dispose() } }
}

function Get-DependencyStatus {
    $s = @{ Platform = (Test-Platform); Node = $null; NodeOk = $false; Npm = $null; NpmOk = $false; Packages = $false
        Conda = $null; CondaOk = $false; Envs = @(); Seistanques = $null; Python = $null; PythonOk = $false
        PythonInfo = $null; InstallPython = $false; Omc = $null; OmcOk = $false; Modules = @{}; Fmus = @{}; Notes = @() }
    $s.Node = Find-Node
    if ($s.Node) {
        $probe = Invoke-Probe $s.Node @('--version')
        if ($probe.Ok -and $probe.Text -match '^v(\d+)\.(\d+)\.') {
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]
            $s.NodeOk = ($major -eq 20 -and $minor -ge 19) -or ($major -eq 22 -and $minor -ge 12) -or $major -gt 22
        }
        $s.Notes += "Node: $($s.Node) - $($probe.Text)"
        # Somente o PATH deste processo; permite npm funcionar apos instalacao manual.
        $env:PATH = (@((Split-Path $s.Node -Parent)) + ($env:PATH -split ';') | Select-Object -Unique) -join ';'
        $npm = Join-Path (Split-Path $s.Node -Parent) 'npm.cmd'
        if (Test-Path -LiteralPath $npm) { $s.Npm = $npm }
        else { $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue; if ($cmd) { $s.Npm = $cmd.Source } }
        if ($s.Npm) {
            $s.NpmOk = (Invoke-Probe $s.Npm @('--version')).Ok
            if ($s.NpmOk -and $s.NodeOk) {
                $s.Packages = (Invoke-Probe $s.Npm @('ls','--depth=0','--offline','--ignore-scripts','--logs-max=0','--json')).Ok
            }
        }
    }
    $s.Conda = Find-Conda
    if ($s.Conda) {
        $probe = Invoke-Probe $s.Conda @('env','list','--json')
        if ($probe.Ok) {
            try {
                $s.Envs = @(($probe.Text | ConvertFrom-Json).envs)
                $s.CondaOk = $true
                $s.Seistanques = $s.Envs | Where-Object { (Split-Path $_ -Leaf) -eq 'seistanques' } | Select-Object -First 1
            } catch { $s.Notes += 'Conda retornou uma lista de ambientes invalida.' }
        } else { $s.Notes += "Conda: $($probe.Text)" }
    }
    $registry = "$env:USERPROFILE\.conda\environments.txt"
    if (-not $s.Seistanques -and (Test-Path -LiteralPath $registry)) {
        $s.Seistanques = Get-Content -LiteralPath $registry | Where-Object {
            (Split-Path $_ -Leaf) -eq 'seistanques' -and (Test-Path -LiteralPath "$_\python.exe")
        } | Select-Object -First 1
    }
    if ($env:SIX_TANK_PYTHON) {
        try { $s.Python = Find-Python $null }
        catch { $s.Notes += $_.Exception.Message }
    }
    elseif ($s.Seistanques) { $s.Python = Join-Path $s.Seistanques 'python.exe' }
    if ($s.Python -and (Test-Path -LiteralPath $s.Python -PathType Leaf)) {
        Use-Python $s.Python
        $code = @'
import sys, struct, json, importlib, importlib.metadata, re
modules = {}
for name, dist, low, high in [('serial','pyserial',(3,5),(4,)), ('websockets','websockets',(13,),(16,)), ('pyfmi','PyFMI',None,None), ('OMPython','OMPython',(3,5),None), ('zmq','pyzmq',None,None), ('pip','pip',None,None)]:
    try:
        importlib.import_module(name)
        version = importlib.metadata.version(dist)
        numbers = tuple(int(x) for x in re.match(r'\d+(?:\.\d+)*', version)[0].split('.'))
        modules[name] = dict(ok=(low is None or numbers >= low) and (high is None or numbers < high), version=version)
    except Exception as exc: modules[name] = dict(ok=False, version=str(exc))
print(json.dumps(dict(version=list(sys.version_info[:2]), bits=struct.calcsize('P')*8, prefix=sys.prefix, isolated=sys.prefix != sys.base_prefix, modules=modules)))
'@
        $probe = Invoke-Probe $s.Python @('-B','-c',$code)
        if ($probe.Ok) {
            try {
                $info = $probe.Text | ConvertFrom-Json; $s.PythonInfo = $info
                $s.PythonOk = $info.version[0] -eq 3 -and $info.version[1] -eq 12 -and $info.bits -eq 64
                foreach ($prop in $info.modules.PSObject.Properties) { $s.Modules[$prop.Name] = $prop.Value.ok }
                $condaBase = if ($s.Conda) { Split-Path (Split-Path $s.Conda -Parent) -Parent } else { $null }
                $isBase = $condaBase -and ([IO.Path]::GetFullPath($info.prefix) -eq [IO.Path]::GetFullPath($condaBase))
                $s.InstallPython = $s.PythonOk -and ((($s.Envs -contains $info.prefix) -and -not $isBase) -or $info.isolated)
                $s.Notes += "Python: $($s.Python) - $($info.version -join '.') / $($info.bits) bits"
                foreach ($prop in $info.modules.PSObject.Properties) { if (-not $prop.Value.ok) { $s.Notes += "$($prop.Name): $($prop.Value.version)" } }
            } catch { $s.Notes += "Python: resposta de diagnostico invalida. $($probe.Text)" }
        } else { $s.Notes += "Python: $($probe.Text)" }
    } else { $s.Notes += 'Defina SIX_TANK_PYTHON para um ambiente isolado existente ou crie seistanques.' }
    $s.Omc = Find-OpenModelica
    if ($s.Omc) { $s.OmcOk = (Invoke-Probe $s.Omc @('--version')).Ok }
    foreach ($name in @('SeisTanques_v13_SixTanks','SeisTanques_Controle_Banco')) {
        $s.Fmus[$name] = Test-Fmu (Join-Path $root "modelica/build/$name.fmu") $name
    }
    return $s
}

function Get-Readiness($s) {
    $hardware = $s.Platform -and $s.NodeOk -and $s.NpmOk -and $s.Packages -and $s.PythonOk -and $s.Modules.serial -and $s.Modules.websockets
    $build = $s.Platform -and $s.PythonOk -and $s.Modules.OMPython -and $s.Modules.zmq -and $s.OmcOk
    $simulation = $hardware -and $s.Modules.pyfmi -and $s.Fmus.Count -eq 2 -and @($s.Fmus.Values | Where-Object { $_ -ne 'OK' }).Count -eq 0
    return @{ Hardware = [bool]$hardware; Build = [bool]$build; Simulation = [bool]$simulation }
}

function Show-DependencyStatus($s) {
    $checks = [ordered]@{ 'Windows 10+/x64 (FMUs win64)'=$s.Platform; 'Node compativel com Vite'=$s.NodeOk; 'npm'=$s.NpmOk
        'Pacotes package.json'=$s.Packages; 'Conda'=$s.CondaOk; 'Ambiente seistanques'=[bool]$s.Seistanques; 'Python 3.12/64 bits'=$s.PythonOk
        'PyFMI'=$s.Modules.pyfmi; 'websockets'=$s.Modules.websockets; 'pyserial'=$s.Modules.serial; 'pip'=$s.Modules.pip
        'OMPython'=$s.Modules.OMPython; 'pyzmq'=$s.Modules.zmq; 'OpenModelica (omc)'=$s.OmcOk }
    foreach ($key in $checks.Keys) { $value = if ($checks[$key]) { 'OK' } else { 'PENDENTE' }; Write-Host "$key`: $value" }
    foreach ($name in $s.Fmus.Keys) { Write-Host "$name.fmu: $($s.Fmus[$name])" }
    Write-Host 'FMUs: verificacao estrutural FMI 2.0 / co-simulacao / DLL win64; sem executar modelos.'
    foreach ($note in $s.Notes) { Write-Host $note }
    $ready = Get-Readiness $s
    Write-Host ('Simulacao com FMUs existentes: ' + $(if ($ready.Simulation) { 'PRONTA' } else { 'PENDENTE' }))
    Write-Host ('Gerar novas FMUs: ' + $(if ($ready.Build) { 'PRONTO' } else { 'PENDENTE' }))
    Write-Host ('Planta real: ' + $(if ($ready.Hardware) { 'SOFTWARE PRONTO' } else { 'SOFTWARE PENDENTE' }))
    Write-Host 'COM, firmware e seguranca fisica nao foram verificados. Nenhum servico ou hardware iniciado.'
}

function Confirm-Step($component, $purpose, $source, $action) {
    Write-Host "`n$component - $purpose`nFonte/licencas: $source`nAcao: $action"
    $answer = Read-Host 'Autoriza? SIM / NAO / PULAR [NAO]'
    return $null -ne $answer -and $answer.Trim().ToUpperInvariant() -eq 'SIM'
}

function Invoke-InstallStep($component, $purpose, $source, $description, [scriptblock]$action) {
    while (Confirm-Step $component $purpose $source $description) {
        try { & $action | Out-Host; return }
        catch {
            Write-Host "ERRO em $component`: $($_.Exception.Message)"
            Write-Host 'Confira rede, espaco, permissoes e a ferramenta indicada. Nao eleve o assistente inteiro; use o instalador oficial se houver UAC.'
            $retry = Read-Host 'Tentar novamente? SIM / PULAR / SAIR [PULAR]'
            if ($retry -eq 'SAIR') { throw [OperationCanceledException]::new('Instalacao interrompida pelo usuario; etapas anteriores preservadas.') }
            if ($retry -ne 'SIM') { return }
        }
    }
}

function Open-OfficialPage($url) {
    if ($url -notin @('https://nodejs.org/en/download','https://github.com/conda-forge/miniforge','https://openmodelica.org/download/download-windows/')) { throw 'Pagina nao autorizada.' }
    Start-Process $url
    Write-Host 'Conclua no instalador oficial e leia a licenca. Depois escolha Verificar novamente. Reabra o terminal se o PATH nao for reconhecido.'
}

function Install-MissingDependencies($s) {
    if (-not $s.Platform) { Write-Host 'Este fluxo requer Windows 10+ x64. Nenhuma instalacao foi iniciada.'; return }
    if (-not $s.NodeOk -or -not $s.NpmOk) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($winget -and -not $s.Node) {
            Invoke-InstallStep 'Node.js LTS + npm' 'Executar e compilar a HMI' 'https://nodejs.org/; catalogo Microsoft WinGet (OpenJS.NodeJS.LTS)' 'Consultar pacote exato; depois confirmar instalacao interativa. O MSI instala para a maquina e pode solicitar UAC.' {
                $details = Invoke-Probe $winget.Source @('show','--id','OpenJS.NodeJS.LTS','--exact','--source','winget','--installer-type','wix','--architecture','x64')
                Write-Host $details.Text
                if (-not $details.Ok -or $details.Text -notmatch 'https://nodejs\.org/dist/[^\s]+\.msi') { throw 'Origem do instalador nao confirmada. Use https://nodejs.org/en/download e verifique novamente.' }
                if (Confirm-Step 'Instalar Node.js LTS' 'HMI' 'MSI nodejs.org; hash verificado pelo WinGet; licenca exibida pelo instalador' 'Baixar e executar MSI; autorizar UAC do Windows se solicitado') {
                    Run-Checked $winget.Source @('install','--id','OpenJS.NodeJS.LTS','--exact','--source','winget','--installer-type','wix','--architecture','x64','--interactive','--no-upgrade')
                }
            }
        } else {
            Invoke-InstallStep 'Node.js/npm' 'HMI; versao existente nao sera atualizada automaticamente' 'https://nodejs.org/en/download' 'Abrir pagina oficial. Escolha LTS compativel e conclua manualmente.' { Open-OfficialPage 'https://nodejs.org/en/download' }
        }
    }
    if (-not $s.CondaOk) {
        Invoke-InstallStep 'Miniforge/Conda' 'Python isolado e PyFMI pelo conda-forge' 'https://github.com/conda-forge/miniforge' 'Abrir instrucoes oficiais. Baixe o instalador Windows x86_64, confira SHA256 da release e escolha Just Me no seu perfil. Nao registrar como Python global.' { Open-OfficialPage 'https://github.com/conda-forge/miniforge' }
    }
    if (-not $s.OmcOk) {
        Invoke-InstallStep 'OpenModelica' 'Gerar FMUs; dispensavel para executar FMUs existentes' 'https://openmodelica.org/download/download-windows/' 'Abrir pagina oficial. Use release estavel 64 bits e leia licenca/UAC. Defina OPENMODELICAHOME para a pasta com bin/omc.exe se nao for detectada.' { Open-OfficialPage 'https://openmodelica.org/download/download-windows/' }
    }
    $s = Get-DependencyStatus
    if ($s.CondaOk -and -not $s.Seistanques -and -not $env:SIX_TANK_PYTHON) {
        Invoke-InstallStep 'Ambiente seistanques' 'Python 3.12 isolado para este projeto' 'https://conda.anaconda.org/conda-forge; licencas dos pacotes no plano Conda' 'Criar ambiente seistanques com Python 3.12. Nenhum outro ambiente sera alterado.' {
            Run-Checked $s.Conda @('create','--name','seistanques','--override-channels','-c','conda-forge','python=3.12','pip','--yes')
        }
        $s = Get-DependencyStatus
    }
    if ($s.InstallPython) {
        if (-not $s.Modules.pip -and $s.CondaOk -and $s.Envs -contains $s.PythonInfo.prefix) {
            Invoke-InstallStep 'pip' 'Instalar bibliotecas no ambiente selecionado' 'https://conda.anaconda.org/conda-forge' "Instalar pip somente em $($s.PythonInfo.prefix), preservando pacotes existentes." {
                Run-Checked $s.Conda @('install','--prefix',$s.PythonInfo.prefix,'--override-channels','-c','conda-forge','--freeze-installed','pip','--yes')
            }
            $s = Get-DependencyStatus
        }
        foreach ($item in @(@('pyfmi','pyfmi','Executar FMUs'), @('serial','pyserial>=3.5,<4','Aquisicao Serial'), @('websockets','websockets>=13,<16','Comunicacao HMI'), @('OMPython','OMPython>=3.5','Gerar FMUs'), @('zmq','pyzmq','Comunicacao com OpenModelica'))) {
            # Uma etapa anterior pode ter instalado esta biblioteca como dependencia.
            $s = Get-DependencyStatus
            if (-not $s.InstallPython) { break }
            $module, $package, $purpose = $item
            if ($s.Modules[$module]) { continue }
            if ($module -eq 'pyfmi') {
                if (-not $s.CondaOk -or $s.Envs -notcontains $s.PythonInfo.prefix) { Write-Host 'PyFMI exige ambiente Conda registrado. SIX_TANK_PYTHON nao sera substituido nem recebera PyFMI via pip.'; continue }
                Invoke-InstallStep 'PyFMI' $purpose 'https://conda.anaconda.org/conda-forge' "Instalar somente pacotes faltantes no ambiente $($s.PythonInfo.prefix); manter instalados congelados. Revise o plano Conda." {
                    Run-Checked $s.Conda @('install','--prefix',$s.PythonInfo.prefix,'--override-channels','-c','conda-forge','--freeze-installed','pyfmi','--yes')
                }
            } elseif ($s.Modules.pip) {
                Invoke-InstallStep $package $purpose 'https://pypi.org/ (metadados/licencas de cada pacote)' "Instalar $package e dependencias necessarias com $($s.Python) -m pip, sem --upgrade." {
                    Run-Checked $s.Python @('-m','pip','--isolated','install','--index-url','https://pypi.org/simple',$package)
                }
            } else { Write-Host 'pip ausente. Repare o ambiente pelo Conda/venv e verifique novamente; nenhum Python global sera modificado.' }
        }
    } else { Write-Host 'Instalacao Python bloqueada: selecione seistanques ou SIX_TANK_PYTHON de ambiente isolado Python 3.12/64 bits. Nenhum Python global sera alterado.' }
    if ($s.NodeOk -and $s.NpmOk -and -not $s.Packages) {
        Invoke-InstallStep 'Pacotes npm' 'JointJS e Vite' 'package.json/package-lock.json; registro npm e licencas dos pacotes' 'Executar npm install no projeto (inclui scripts dos pacotes). Pode reconciliar node_modules e lockfile; nao usa npm ci nem apaga dados locais.' {
            Run-Checked $s.Npm @('install')
        }
    }
    $s = Get-DependencyStatus
    $ready = Get-Readiness $s
    foreach ($entry in @(@('planta','SeisTanques_v13_SixTanks'), @('controle','SeisTanques_Controle_Banco'))) {
        $model, $name = $entry
        if ($s.Fmus[$name] -eq 'INVALIDA') { Write-Host "$name.fmu invalida: preservada. Revise o arquivo manualmente antes de gerar novamente."; continue }
        if ($s.Fmus[$name] -ne 'AUSENTE' -or -not $ready.Build) { continue }
        Invoke-InstallStep "FMU $model" 'Executar simulacao' 'Modelos .mo locais e OpenModelica instalado' "Gerar somente $name.fmu ausente. Pode demorar varios minutos; nao altera a outra FMU." {
            $target = Join-Path $root "modelica/build/$name.fmu"
            if (Test-Path -LiteralPath $target) { throw 'FMU apareceu durante a verificacao; arquivo preservado. Verifique novamente.' }
            $env:OPENMODELICAHOME = Split-Path (Split-Path $s.Omc -Parent) -Parent
            Run-Checked $s.Python @('-B',(Join-Path $PSScriptRoot 'build_fmu.py'),$model)
            if ((Test-Fmu $target $name) -ne 'OK') { throw 'Geracao nao produziu FMU valida para Windows x64.' }
        }
    }
}

function Start-DependencyAssistant([switch]$ReadOnly) {
    $s = Get-DependencyStatus
    Show-DependencyStatus $s
    if ($ReadOnly) {
        $ready = Get-Readiness $s
        if ($ready.Simulation -and $ready.Build) { return 0 }; return 1
    }
    while ($true) {
        Write-Host "`n1 - Verificar dependencias / Verificar novamente`n2 - Instalar o que falta (confirmar cada etapa)`n0 - Sair"
        $choice = Read-Host 'Opcao [0]'
        if ($choice -eq '2') { Install-MissingDependencies $s }
        elseif ($choice -ne '1') { $ready = Get-Readiness $s; if ($ready.Simulation -and $ready.Build) { return 0 }; return 1 }
        $s = Get-DependencyStatus
        Show-DependencyStatus $s
    }
}

try {
    if ($Mode -eq 'DEPENDENCIES') {
        $result = Start-DependencyAssistant -ReadOnly:$CheckOnly
        exit $result
    }
    $s = Get-DependencyStatus
    Show-DependencyStatus $s
    $ready = Get-Readiness $s
    $canRun = if ($Mode -eq 'HARDWARE') { $ready.Hardware } else { $ready.Simulation }
    if (-not $canRun) { throw 'Software pendente para este modo. Execute bat_dependencias.bat; nenhum servico foi iniciado.' }
    if ($CheckOnly) { exit 0 }
    Use-Python $s.Python
    if ($s.OmcOk) { $env:OPENMODELICAHOME = Split-Path (Split-Path $s.Omc -Parent) -Parent }
    $script = if ($Mode -eq 'HARDWARE') { 'launch_hardware.py' } else { 'launch_simulation.py' }
    Run-Checked $s.Python @((Join-Path $PSScriptRoot $script))
    exit 0
} catch [OperationCanceledException] {
    Write-Host $_.Exception.Message
    exit 1
} catch {
    Write-Host "ERRO: $($_.Exception.Message)"
    exit 1
}
