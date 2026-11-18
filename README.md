# Planta Multivariável de Seis Tanques

Supervisório desenvolvido na Iniciação Científica da UFRGS para acompanhar a planta de seis tanques, simular seu comportamento e registrar ensaios.

A dinâmica e os controladores executam em duas FMUs Modelica. O backend Python publica o estado por WebSocket; a HMI apresenta o processo em JointJS e os gráficos em `trends.js`. O navegador não integra a dinâmica da planta.

## Estrutura

- `src/main.js`: inicialização da HMI.
- `src/connection/real.js` e `src/connection/backend-state.js`: conexão, comandos e normalização dos snapshots.
- `src/plant/plant-view.js`, `components.js` e `plant-config.js`: sinótico, componentes e layout.
- `src/trends/trends.js`, `trends-panel.js` e `trends.css`: tendências, navegação e registro CSV.
- `python/server.py`: servidor WebSocket nos modos MODELICA, MOCK e HARDWARE.
- `python/simulation/modelica_runtime.py`, `modelica_plant.py`, `controle.py` e `cenarios.py`: execução das FMUs e cenários.
- `modelica/`: modelos da planta e dos controladores.
- `arduino/`: sketches e documentação de aquisição; HARDWARE usa a API DEQUI do firmware mantido por Lucas.

## Instalação

No Windows, execute `bat_dependencias.bat`. Escolha **Verificar dependências** ou
**Instalar o que falta**. Cada etapa mostra destino, fonte e ação e exige `SIM`;
Enter, `NÃO` ou `PULAR` não autorizam instalação. Itens já validados são preservados.

O assistente oferece Node.js LTS pelo WinGet, quando disponível, e orienta a
instalação manual de [Miniforge](https://github.com/conda-forge/miniforge) (**Just Me**)
e [OpenModelica](https://openmodelica.org/download/download-windows/). Leia as
licenças nos instaladores; eventual UAC pertence ao instalador, não ao assistente.
Depois, escolha **Verificar novamente**. Se solicitado, reabra o terminal e execute
o BAT outra vez para atualizar a descoberta dos programas.

O ambiente `seistanques` usa Python 3.12 e PyFMI pelo conda-forge.
`SIX_TANK_PYTHON` pode selecionar outro ambiente isolado; o assistente não instala
em Python global. `OPENMODELICAHOME` indica a pasta que contém `bin/omc.exe`.
PyFMI executa as duas FMUs; OpenModelica, OMPython e pyzmq são necessários para
gerá-las. A geração pede confirmação e preserva FMUs existentes. Arquivos inválidos
são sinalizados para revisão manual. `modelica/build/` permanece fora do Git.

`bat_dependencias.bat -CheckOnly` apenas verifica, sem instalar nem abrir serviços.
O resumo distingue simulação pronta, geração disponível e software HARDWARE pronto;
este último não valida COM, firmware ou segurança física. Quando estiver pronto,
abra `bat_simulacao.bat` ou `bat_planta_real.bat`.

## Execução

No Windows, execute na pasta do projeto:

```bat
bat_dependencias.bat
bat_simulacao.bat
```

`bat_simulacao.bat` inicia MODELICA pausado, Vite e navegador. `bat_planta_real.bat`
seleciona/valida a COM e inicia HARDWARE, Vite e navegador; na HMI selecione
**Planta real**. Nenhum launcher faz upload ou envia comandos de atuação.

Os lançadores usam sua própria pasta e aceitam `SIX_TANK_PYTHON` (caminho do
executável, sem aspas no valor). Preferem o ambiente Conda `seistanques` quando
registrado. `-CheckOnly` verifica dependências sem instalar ou abrir serviços.
Use Ctrl+C na janela do launcher para encerrar seus serviços. Portas ocupadas
impedem a inicialização; processos externos não são encerrados.

A interface usa `http://127.0.0.1:5173`; WebSocket usa 8765 por padrão, ou
`SIX_TANK_WS_PORT` quando definido. Para uma porta HTTP diferente, defina
`SIX_TANK_HTTP_PORT`; o padrão continua 5173. Estes lançadores não são executáveis Linux/macOS.

Para iniciar o backend diretamente no PowerShell:

```powershell
$env:SIX_TANK_MODE = 'MODELICA'
$env:SIX_TANK_WS_PORT = '8765'
python python/server.py
```

`bat_planta_real.bat` inicia a aquisição da bancada. O firmware RO mantém somente leitura; a variante CTRL permite controle manual com ARM e confirmação do firmware. Configuração e procedimento estão em [HARDWARE.md](HARDWARE.md). Sensores ausentes permanecem sem dado. Para testar o backend MOCK sem bancada ou FMUs, use no PowerShell `$env:SIX_TANK_MODE="MOCK"; python python/server.py`; o MOCK avança em um único ciclo, independentemente do número de clientes conectados.

## Processo

A opção **Simulação** espera MODELICA; **Planta real** espera HARDWARE. MOCK não possui opção visual própria. A HMI não apresenta um backend de modo diferente como se fosse a planta selecionada.

Em MODELICA, os controles permitem iniciar, pausar, resetar, ajustar velocidade e níveis iniciais, comandar bombas e ajustar válvulas. Os valores exibidos aguardam confirmação do backend. Atuadores controlados por malhas em AUTO ficam bloqueados para comandos manuais. Em HARDWARE, o firmware RO permite somente leitura; o firmware CTRL permite controle manual protegido por ARM, intertravamentos e confirmação do firmware.

A fonte e a operação são independentes: o sistema inicia em **Manual**. Bombas
(PWM 0–255), LVs e OYs usam rascunho e **Aplicar** no painel comum. Clicar no
atuador do sinótico abre esse mesmo controle. Cenários e faceplates de malhas
possuem aplicação explícita e mantêm separado o valor confirmado.

**Aplicar cenário** em Manual prepara as malhas sem mover atuadores. **Ativar
automático** usa as MVs atuais, o tracking da FMU BancoControladores e as saídas
fixas do cenário. Voltar ao Manual retira autoridade automática sem apagar SPs,
sintonia ou modos solicitados. O mesmo banco serve MODELICA e HARDWARE; o AUTO
físico permanece bloqueado até validar sensores, atuadores e segurança CTRL.
A matemática Modelica continua nas FMUs, sem PID paralelo no navegador.

OY1/OY2 têm ramos A/B de um único equipamento; não há controles de relés
independentes. A/B manuais são possíveis em ambas as fontes; RELEASE é exclusivo
do hardware. Tempos automáticos tA/tB são aplicados explicitamente. LVs físicas
exigem configuração e sincronização sem pulsos, e usam rampa no CTRL. Servo1/D36
está indisponível. Consulte [HARDWARE.md](HARDWARE.md) para contrato e bloqueios.
Desconexão não ativa simulação local.

## Tendências

**Tendências e dados** abre os gráficos; **Processo** retorna ao sinótico. As duas telas usam os mesmos snapshots WebSocket.

- Níveis em centímetros, PV/SP nas unidades de cada malha e MV em percentual.
- Cursor e legendas para leitura; clique na malha para destacar suas curvas.
- Seletor de janela e roda do mouse para zoom; arraste para navegar pelo histórico; **Ao vivo** retorna ao instante atual.
- **Gravar** registra o ensaio; **Exportar CSV** salva as amostras com ponto e vírgula entre colunas e vírgula decimal. Campos ausentes ficam vazios.

MODELICA usa o tempo da simulação: pausa mantém o tempo e reset reinicia o histórico. HARDWARE usa o relógio de aquisição no navegador. O histórico guarda até 36.000 amostras e o registro até 400.000 linhas. A amostragem acompanha os snapshots, com intervalo mínimo de 0,1 s; não registra todos os passos internos do solver. Dados ausentes aparecem como lacunas e `—`, nunca como zero presumido.

## Limitações

Alguns parâmetros físicos e sintonias são provisórios e dependem de medições e calibração da bancada.

FI1 e FI2 medem antes de OY1/OY2, nos trechos de entrada de LV1/LV2. A quantidade de sensores físicos depende da configuração de hardware; a aquisição traduz os canais do Arduino para os IDs oficiais.

O mapeamento e a topologia física precisam de validação na bancada. Veja [aquisição HARDWARE](HARDWARE.md) para pinos LT/FT, calibração, diagnóstico de Serial/telemetria e registro CSV.

No modo MODELICA, o snapshot publica a capacidade volumétrica calculada a partir do perfil da FMU (`capacityL`). O transbordamento não é deduzido no navegador. Em HARDWARE, atuadores só exibem estado confirmado pelo firmware CTRL; RO ou perda de confirmação deixam esses estados indisponíveis. OY1/OY2 físicos usam mapeamento provisório explicitado em HARDWARE.md.

## Verificação

```sh
npm run build
python -m unittest discover -s python -p "test_*.py" -v
python -m websockets ws://localhost:8765
```

O WebSocket publica `{"type":"state","data":{...}}`, com `mode`, `sim`, `loops` e as leituras da planta. Os testes Modelica exigem PyFMI e ambas as FMUs; testes pulados por falta dessas dependências não validam sua execução.

## Identificação

Os tanques usam TQ1–TQ6 em toda a telemetria e nos comandos. As associações entre equipamentos, medições, variáveis das FMUs e tags oficiais estão em [Nomenclatura](NOMENCLATURA.md).

No modo MODELICA, o runtime inicia pausado no backend. Pausar/continuar seguem o
snapshot confirmado; reset retorna ao estado pausado. Os controles da simulação
ficam desabilitados até a conexão e o primeiro snapshot MODELICA válido.

O primeiro snapshot MODELICA habilita a HMI imediatamente, mesmo pausado. Use Iniciar para avançar o tempo.

Configurações reúne velocidade e níveis iniciais dos tanques. A capacidade é
somente leitura e vem do perfil geométrico confirmado da FMU. O modelo usa um
único perfil para os seis tanques; editar capacidades individuais exige ampliar
o modelo e não é oferecido pela HMI atual. Válvulas manuais permanecem na sidebar.
