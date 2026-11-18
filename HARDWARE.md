# Planta 1 — aquisição e operação

HARDWARE usa a [API DEQUI](https://github.com/LucasRamos13/FirmwarePlanta6Tanques)
para aquisição, diagnóstico, Processo, Tendências e CSV. O firmware RO permite
somente leitura. A variante CTRL recebe comandos semânticos confirmados. A operação
MANUAL/AUTO usa os mesmos cenários e a mesma FMU BancoControladores da simulação;
AUTO físico permanece bloqueado sem validação dos sensores e atuadores. O dashboard não grava firmware.

## Firmware

- `arduino/ArduinoHardwareAPI_Planta1_ReadOnly/ArduinoHardwareAPI_Planta1_ReadOnly.ino`:
  cópia integral do firmware `1.0.0-PLANTA1-RO`. Preserva Timer1/FT e D36 em LOW.
- `arduino/ArduinoHardwareAPI_Planta1_Control/ArduinoHardwareAPI_Planta1_Control.ino`:
  `2.0.0-PLANTA1-CTRL`, com a mesma aquisição. Usa `control_config.h`,
  `manual_control.h` e `servo_timer5.h`. Os servos usam somente Timer5,
  preservando Timer1 dos FT e os timers PWM das bombas.

Compile selecionando Arduino Mega 2560. Não grave automaticamente após compilar.
O backend só libera o protocolo de escrita para a identificação CTRL exata;
compatibilidade dos pinos, SAFETY e readback também são obrigatórios para ARM.

## Executar

Use `bat_planta_real.bat` para selecionar a COM e abrir backend, Vite e
navegador. Feche o Monitor Serial e outros programas que ocupem a COM.
Na HMI, selecione **Planta real**. Alternativa manual em PowerShell:

```powershell
$env:SIX_TANK_MODE='HARDWARE'
$env:SIX_TANK_SERIAL_PORT='COM3' # substituir pela COM do Mega
$env:SIX_TANK_SERIAL_BAUD='115200'
$env:SIX_TANK_WS_PORT='8765'
python python/server.py
```

Em outro terminal na pasta do projeto: `npm run dev`; abra a URL informada.
Use Python com as dependências de `python/requirements.txt`. WebSocket e Serial
usam portas independentes. Abrir a COM pode reiniciar o Mega; o backend aguarda
dois segundos antes de iniciar identificação.

## Pinagem de referência

Esta é a referência física da Planta 1, não uma cópia da configuração publicada
do firmware. As associações FT → FI e a topologia hidráulica precisam de
validação física. A nomenclatura pública é a mesma de MODELICA.

| Canal físico | Pino Mega | Tag pública |
|---|---|---|
| LT1 | A0 | LI1 |
| LT2 | A1 | LI2 |
| LT3 | A2 | LI3 |
| LT4 | A3 | LI4 |
| LT5 | A4 | LI5 |
| LT6 | A5 | LI6 |
| FT1 | D30 | FI5 |
| FT2 | D31 | FI6 |
| FT3 | D32 | FI1 |
| FT4 | D33 | FI3 |
| FT5 | D34 | FI4 |
| FT6 | D35 | FI2 |

Servos 1–4: D36–D39. Bombas 1–3 RPWM/LPWM: D9/D10, D7/D8, D5/D6.
Relés 1–4: D26–D29. Anotação recebida: `GND: 6+8+9`, sem interpretação adicional.

O índice da API não é identidade física. `PRESSAO1` em `55` é normalizado para
A1 e associado a LT2/LI2. Os números 54–69 equivalem a A0–A15. Componentes fora
dos pinos esperados aparecem somente no inventário, sem tag pública inventada.

## Comunicação

`python/hardware/serial_bridge.py` mantém a whitelist de leitura para RO: PING, GET ID,
VERSION, COMPONENTS, ENABLED, PINMAP, COMM, SAFETY e GET PRESSAO/VAZAO com índice,
opcionalmente VERBOSE. Escrita só é liberada após identificar CTRL. Não há SET PIN,
SET ALL, comandos arbitrários ou linhas múltiplas.

`python/hardware/dequi_hardware.py` envia uma requisição por vez com `@id`, exige seu
eco e ignora respostas atrasadas de outra requisição. READY reinicia a
descoberta. WARN/ALERT são diagnósticos assíncronos, nunca resposta de aquisição.
VERBOSE começa com `@id OK` e termina em END; as linhas intermediárias não
repetem o ID, conforme a API.

A descoberta consulta ID, COMPONENTS, ENABLED, PINMAP, COMM e SAFETY. Só inicia
polling de sensores presentes no PINMAP que podem ser associados sem ambiguidade.
Contagens são cruzadas com os componentes habilitados. O PINMAP pode omitir
canais cuja inicialização falhou. Falhas de descoberta são repetidas após 5 s.

Cada sensor é elegível a novo poll após 1 s, com uma requisição pendente no
máximo e espaçamento mínimo de 50 ms. O ciclo atual do servidor é de 100 ms:
o limite efetivo é 10 GET/s e uma rodada com 12 sensores leva cerca de 1,2 s,
podendo demorar mais com timeouts. Timeout por request: 1 s; leitura expira em
2 s. Nenhum watchdog de atuação é alimentado pelo polling.

Os perfis `PLANTA1-RO` e `PLANTA1-CTRL` na versão DEQUI usam diretamente GET VAZAO
compacto, com unidade L/s definida pelo contrato dessa variante. Outros perfis
podem consultar VERBOSE inicialmente para descobrir a unidade. Falha dessa
consulta opcional desativa novas tentativas VERBOSE durante a sessão e continua
com consultas compactas, sem apagar a amostra por erro de descoberta de unidade.
Para `L/s`, aplica-se `L/min = valor × 60`; unidade desconhecida preserva valor
bruto/pulsos, mas deixa L/min vazio. READY/reconexão reinicia essa descoberta.

## Operação e segurança

A fonte (Simulação/Planta real) é independente do modo MANUAL/AUTO. Ambos iniciam
em MANUAL. O painel comum usa rascunhos e **Aplicar**; o estado confirmado não é
substituído pelo rascunho. Selecionar cenário apenas edita o dropdown; **Aplicar
cenário** prepara as malhas. Em MANUAL essa preparação não atua. Em AUTO, aplicar
cenário pode aplicar suas saídas fixas, após validação.

Na área **Segurança da planta real**, ARM permite atuação, mas não liga saídas.
Ao conectar, o backend exige DISARM confirmado. Só a sessão que armou pode
operar/renovar o lease; qualquer sessão pode pedir DISARM/Emergency Stop.
A troca de fonte e a desconexão dessa sessão desarmam. Reconexão não restaura
comandos. O lease expira em 3 s. HEARTBEAT é enviado aproximadamente a cada 1 s
com bomba, servo ou OY ativos; 5 s sem heartbeat provocam WATCHDOG no loop do
firmware, mesmo sem bytes Serial. GETs não renovam o heartbeat.

| Ação | Comando Serial CTRL (sempre com `@id`) |
|---|---|
| Habilitar/desarmar | `ARM` / `DISARM` |
| Bomba | `SET BOMBA <1–3> <PWM 0–255>` |
| LV por abertura | `SET VALVULA <2–4> <0–100>` |
| LV por ângulo | `SET LVANGLE <2–4> <graus>` |
| Referência LV sem pulsos | `SET LVSYNC <2–4> <graus>` |
| Cessar pulsos LV | `SET LVSTOP <2–4> 0` |
| Par OY | `SET OY <1–2> A\|B\|RELEASE` |
| Parada/reset | `EMERGENCY STOP` / `RESET FAULT` |
| Watchdog/readback | `HEARTBEAT` / `GET CONTROL` |

Os índices de LV na Serial são canais de servo, não IDs públicos LV. Backend
traduz a associação configurada. Não existe SET PIN ou teste LOW/HIGH individual
na HMI/CTRL. ERR, timeout, WARN sem OK válido ou ID/readback divergente não confirmam
atuação. Confirmação com mais de 2 s fica indisponível.

### Bombas

Pump1/JIC3 = D9/D10; Pump2/JIC4 = D7/D8; Pump3/JIC1 = D5/D6 (RPWM/LPWM).
A HMI usa PWM 0–255 e mostra também PWM/255 × 100%. No MODELICA, PWM é apenas
conversão de interface para entrada 0–1. **Zerar** envia zero. Não há mínimo
40 nem reversão pela HMI. `forward=0` bloqueia partida, 1 usa RPWM e 2 usa LPWM.
As três bombas usam RPWM (`forward=1`) na configuração atual. Após conexão
validada e ARM, ficam disponíveis no painel Manual HARDWARE.

### LV1–LV4

LV1=D36, LV2=D37, LV3=D38 e LV4=D39 podem atuar após ARM e SYNC,
com associação `lv`, ângulos `closed/open`, limites `minimum/maximum`
e limites de pulso `pulseMin/pulseMax` válidos. A faixa de diagnóstico 10–80°
não é uma calibração CTRL. Montagem invertida (fechado maior que aberto) é suportada.
O campo legado `safe` não provoca movimento nas paradas.

Após boot/reset, cada LV está **não sincronizada** e sem pulsos. O operador
informa o ângulo físico atual em **Sincronizar sem pulsos**, respeitando os
limites configurados. Isso registra referência, não mede nem movimenta o servo.
Somente um Aplicar posterior define o alvo. A rampa do firmware comanda no máximo
5° a cada 300 ms. Novo alvo mantém o intervalo e parte do último ângulo comandado.
DISARM, Emergency Stop, watchdog e Parar pulso cancelam a rampa imediatamente.
ARM não retoma alvos. DISARM preserva a referência informada; reset a invalida.
Se a posição tiver mudado externamente, sincronize novamente antes de atuar.
Não há feedback angular; ângulo comandado nunca significa posição medida.

### OY1/OY2

Associação **provisória**: OY1=D26/D27, OY2=D28/D29. A=HIGH/LOW,
B=LOW/HIGH. Cada par é atualizado em bloco atômico do PORTA. RELEASE coloca
ambos em INPUT sem pull-up. Isso não garante desenergização mecânica do módulo.
`activeHigh` não é usado para inferir outra associação/polaridade.
No MODELICA, A/B usam as entradas tA/tB existentes; RELEASE não existe na FMU.
Em AUTO, a FMU da planta temporiza OY na simulação; no HARDWARE, o backend
usa os mesmos tA/tB. Nenhuma temporização é executada pelo navegador.

### Automático físico

Usa `python/common/operation.py`, `hardware_operation.py`, `cenarios.py` e a FMU de
`controle.py`. PVs físicas alimentam o banco e MVs usam a mesma validação/ACK
Serial dos comandos manuais. Não existe PID no Arduino ou JavaScript.
`AUTO_VALIDATED_PVS` e `AUTO_VALIDATED_MANUAL_VALVES` estão vazios em
`hardware_config.py`: são liberações explícitas após validação física, não
calibrações novas. Também são obrigatórios ARM/readback, sentido de cada bomba
e configuração/sincronização de cada LV necessária. Os motivos aparecem na HMI.
Cenários que precisam das quatro LVs exigem configuração e sincronização válidas em todos os canais.

MANUAL retira autoridade das malhas, preservando modo solicitado, SP e sintonia.
AUTO prepara o tracking MAN da própria FMU a partir das MVs confirmadas, sem
escrever bias nos atuadores. A preparação avança somente o relógio interno do
controlador, com PV/MV constantes; não avança a planta. Depois ativa as malhas e
saídas fixas do cenário. AUTO→MANUAL preserva as saídas já confirmadas; cancela
novos alvos automáticos. Uma rampa já aceita pelo firmware permanece até seu
alvo ou Parar pulso/DISARM. Perda de validação em AUTO cancela o automático e
solicita Emergency Stop.

### Readback CTRL 2.0

`GET CONTROL` retorna JSON com `armed`, `fault`, `pumps`, `valves`, `oy`.
`pumps` contém três pares `[pwm, forward]`. `oy` contém dois estados
(0=RELEASE, 1=A, 2=B). Cada um dos quatro canais `valves` contém:

```text
[lv, configurado, percentual_comandado, referencia_ou_angulo_comandado,
 alvo_angulo, sincronizado, pulsos, rampa, fechado, aberto, minimo, maximo,
 percentual_alvo, pino]
```

Valores desconhecidos usam -1; flags usam 0/1. Um ACK de LV confirma o alvo,
não a chegada mecânica nem o fim da rampa. `hardware.control.requested` e
`confirmed` permanecem separados. Backend 2.0 não libera escrita com CTRL 1.0.

### Emergency Stop

Funciona sem ARM: zera bombas, cessa pulsos/cancela rampas, libera OYs e gera
fault. Exige Reset Fault e novo ARM, sem restaurar saídas; reset invalida SYNC.
Sem Serial não há confirmação de parada; o watchdog protege todas as saídas
ativas. A parada por software não substitui o corte físico da bancada.

## Diagnóstico

O painel Planta real separa backend conectado, Serial aberta, firmware
identificado, configuração descoberta, compatibilidade e aquisição ativa.
Mostra COM, baud, boardId, versão, board, contagens cadastradas e mapeadas,
última aquisição válida e detalhes do PINMAP/erros.

Compatibilidade: `compatible` exige seis pressões A0–A5 e seis vazões D30–D35;
`partial` permite subconjunto seguro; `incompatible` indica conflitos;
`unknown` indica descoberta insuficiente/inconsistente. Pinos de sensores
ocupados por atuadores são destacados como conflitos críticos. Se SAFETY
reportar configuração interna inválida, a aquisição é suspensa: o PINMAP
pode não revelar o segundo proprietário de um pino em conflito.

Diagnosticar um firmware incompatível não declara que é seguro gravá-lo ou
energizá-lo. O próprio firmware configura saídas no boot. Confira o firmware e
mantenha a potência dos atuadores isolada durante o diagnóstico de pinagem,
conforme o procedimento da bancada.

O firmware publicado consultado usa interrupções externas para vazão, que não
abrangem D30–D35. Trocar apenas constantes de pino nesse firmware não garante
aquisição nesses canais. O responsável pelo firmware deve confirmar o suporte
real a D30–D35; o dashboard não altera firmware.

O snapshot contém:

- `hardware.serial`: open/connected, port, baud;
- `hardware.firmware`: identified, boardId, version, board;
- `hardware.discovery`: complete, components, enabled;
- `hardware.compatibility`: status, issues, expected, reported e contagens;
- `hardware.acquisition`: active, lastSuccessfulPollAt, ageSeconds, pollIntervalSeconds;
- `hardware.telemetry`: status, lastReceivedAt, ageSeconds, derivados das aquisições;
- `hardware.messages`, `comm`, `safety`, `geometry`.
- `hardware.capabilities`: perfil, suporte VERBOSE, unidade do perfil e último erro de protocolo.

O horário só avança após resposta de aquisição válida, não stale e sem fora-de-faixa.
Identificação, porta aberta e erros não renovam esse horário. Cada sensor mantém
seu próprio timestamp/qualidade. Reset/reconexão limpa inventário, leituras e
referências de contador antes de descobrir novamente.

## Medições

Os níveis usam uma conversão linear temporária para teste visual, centralizada
em `LEVEL_CALIBRATION` de `python/hardware/hardware_config.py`. Não é calibração
metrológica final. A média usa as últimas 10 leituras RAW válidas
(`rawMean50`, `rawMeanCount`, `adcVoltageMean50`).

| Sensor | RAW médio de referência | Referência em cm |
|---|---:|---:|
| LI1 | 230 | 15,0 |
| LI2 | 215 | 0,0 |
| LI3 | 206 | 10,0 |
| LI4 | 258 | 14,0 |
| LI5 | 101 | 11,4 |
| LI6 | 125 | 9,1 |

A fórmula é `heightCm = max(0, slope × (rawMean50 − offset_raw) + offset)`.
Para LI1, LI3, LI4, LI5 e LI6, a inclinação é cm/RAW da tabela, com offsets
zero. LI2 usa temporariamente `LI2_VISUAL_SLOPE = 15/230` e `offset_raw = 215`;
falta medir um segundo ponto para determinar sua inclinação física.

Histórico de bancada, apenas para observação: LI6 138 → 9,5 cm; LI5 117 → 10,7 cm;
LI3 170 → 9,7 cm. As diferenças entre rodadas mostram variabilidade. Esses pontos
não são combinados em regressão e não constituem calibração metrológica final.

Passe o mouse no instrumento para ver o nível em cm, RAW atual, média e ADC médio.
Pressão preserva RAW, calibrado, filtrado, válido, fora de faixa, stale e idade
retornados pelo firmware. Calibrado/filtrado são diagnósticos de unidade não
informada na resposta compacta; não são automaticamente kPa ou nível cm.
O nível aparece diretamente em cm, sem textos de status de calibração.

Nos perfis PLANTA1-RO/CTRL, calibrado e filtrado são RAW, não pressão/nível.
O backend deriva `voltage = raw × 5 / 1023`, identificada na HMI como
**Tensão ADC estimada (5 V nominal)**. RAW 428 equivale a aproximadamente 2,09 V;
RAW zero válido equivale a 0 V. Essa estimativa não alimenta conversão de nível.
O RAW filtrado é preservado nos diagnósticos e CSV. Ausência/stale/timeout não
gera tensão zero como substituto para leitura.

`python/hardware/hardware_config.py` concentra calibrações e geometria física; dimensões
não medidas permanecem None. Pressão física, percentual físico e volume não são
inventados. RAW inválido/stale não alimenta conversões. O preenchimento da HMI
usa `heightCm` e a altura máxima visual já configurada (atualmente 100 cm por
tanque), limitado entre 0 e 100%. Essa escala visual não representa uma medição
da altura física. Ausência de leitura não vira nível zero.

Vazão preserva valor recebido, unidade, L/min, pulsos acumulados e qualidade.
O backend calcula delta de contador unsigned de 32 bits e Hz aproximado por
`delta_pulsos / delta_t` entre polls válidos. Não é a frequência interna do
firmware nem pulsos da janela de 500 ms. READY/reconexão/erro limpa a referência
do contador; queda unsigned é tratada como wrap. Reset de contador não
anunciado não pode ser distinguido de wrap só pela resposta compacta.

Ausência, timeout ou identificação insegura não viram zero. Nenhuma vazão de
ramo A/B ou central é reconstruída. Somente medições diretas alimentam os
instrumentos e seus trechos; a topologia continua pendente de validação física.
Sensor cadastrado não prova presença elétrica: entrada desconectada pode gerar
RAW flutuante ou vazão zero. Confira a instalação na bancada.

## Gravação e testes

Em Tendências, use **Gravar** e **Exportar CSV**. O download vai para a pasta
configurada no navegador; não há arquivo automático no backend. Exporte antes
de fechar/recarregar a página. O registro acompanha snapshots da HMI, podendo
repetir o mesmo timestamp de aquisição.

CSV HARDWARE inclui COM, baud, ID/versão do firmware, compatibilidade e dados
por sensor: origem física, índice API, pino, timestamp, RAW, diagnósticos de
pressão, média RAW de 10 amostras, contagem, ADC médio, altura em cm, vazão
bruta/unidade, L/min, pulsos acumulados, delta e Hz derivado.
Campos ausentes ficam vazios; CSV exclusivamente MODELICA mantém suas colunas.

```text
python -m unittest discover -s python -p test_*.py -v
npm run build
```

`python/test_dequi.py` contém firmware Serial simulado completo e incompatível,
testes de protocolo, pinagem, timeout, qualidade, unidade, contador e WebSocket.
Não abre COM nem substitui HARDWARE por MOCK. A regressão MODELICA requer
PyFMI e as duas FMUs.

`test_hardware_control.py` compila `firmware_control_checks.cpp` com g++
(PATH ou variável `CTRL_CXX`) e executa a lógica real de `manual_control.h` com
GPIO/Serial simulados. O backend usa esse firmware simulado para testar ACK,
readback, intertravamentos, falhas e reconexão. Sem compilador, esses testes são
explicitamente pulados. Software validado não significa atuador físico validado.

## Checklist da bancada

- [ ] Guardar a variante RO; selecionar COM e conferir a identificação da placa.
- [ ] Com potência isolada, conferir boot CTRL, D36 INPUT sem pull-up, bombas RPWM/LPWM zero e FT.
- [ ] Pump1/JIC3: verificar operação em RPWM D9, LPWM D10 em zero; registrar faixa útil observada.
- [ ] Pump2/JIC4: verificar operação em RPWM D7, LPWM D8 em zero; registrar faixa útil observada.
- [ ] Pump3/JIC1: verificar operação em RPWM D5, LPWM D6 em zero; registrar faixa útil observada.
- [ ] Manter Servo1/D36 fora dos testes: problema físico/possível curto.
- [ ] Servo2/D37: confirmar LV e os mesmos limites.
- [ ] Servo3/D38: confirmar LV e os mesmos limites.
- [ ] Servo4/D39: confirmar LV e os mesmos limites.
- [ ] No sketch de diagnóstico separado, conectar somente um canal por vez.
- [ ] Relay1/D26: observar LOW e HIGH; anotar polaridade e função física.
- [ ] Relay2/D27: observar LOW e HIGH; anotar polaridade e função física.
- [ ] Relay3/D28: observar LOW e HIGH; anotar polaridade e função física.
- [ ] Relay4/D29: observar LOW e HIGH; anotar polaridade e função física.
- [ ] Encerrar cada teste antes do próximo; verificar fisicamente o estado liberado.
- [ ] Validar Emergency Stop, perda de comunicação, watchdog e ausência de restauração.
- [ ] Validar na bancada a associação provisória dos pares OY e registrar observações.

### Zero de nível em campo

Na leitura do arquivo de zeros, as chaves antigas `LIC3/LIC4` são aceitas como `LI3/LI4`. Ao salvar, são usadas apenas as chaves novas. Valores divergentes entre as duas chaves interrompem a carga com erro, sem alterar o arquivo.

Os padrões ficam em `python/hardware/hardware_config.py`. A calibração ativa combina esses
padrões com os zeros individuais de `data/level-zero.json`, carregados no startup.
Cada gravação substitui somente o zero do sensor selecionado, de forma atômica;
restaurar remove esse ajuste e volta ao padrão. O ganho padrão permanece inalterado.
O arquivo atual e seus valores são preservados. Não há calibração multiponto.

O drawer mostra `Amostras: N/10`. Calibrar exige 10 leituras válidas, RAW entre
0 e 1023 e confirmação do operador. Após mudar fisicamente o nível, espere a
janela estabilizar: não existe detecção automática dessa mudança. O RAW capturado
no clique permanece fixo durante a confirmação. `rawMean50` é o nome de protocolo
mantido por compatibilidade; a janela real é informada por `rawMeanWindow=10`.

`SIX_TANK_LEVEL_ZERO_FILE` permite selecionar outro arquivo de campo. Os testes
usam exclusivamente um arquivo temporário, sem acessar a calibração da planta.

### Resetar comandos

O botão da seção Segurança envia `hardware/plant_reset`. O backend cancela AUTO,
limpa desejos e comandos na fila e envia DISARM com prioridade. Somente o ACK e
readback seguro confirmam “Comandos da planta zerados.”: bombas em zero, OY em
RELEASE, LVs sem alvo/rampa/pulsos e controle desarmado. As referências das LVs
são preservadas, sem movimentá-las para uma posição predefinida. Os rascunhos dos
faceplates são descartados após confirmação. Faults continuam exigindo Reset Fault.
Não há novo comando Serial nem alteração de firmware.
