# Firmware da Planta 1

O Mega 2560 comunica com o dashboard pelo caminho:

```text
Sensores LT/FT → Mega 2560 → USB/Serial → Python → WebSocket → HMI
```

## Variantes DEQUI

| Sketch | Identificação | Uso |
| --- | --- | --- |
| `ArduinoHardwareAPI_Planta1_ReadOnly/ArduinoHardwareAPI_Planta1_ReadOnly.ino` | `1.0.0-PLANTA1-RO` | Aquisição e diagnóstico, sem atuação |
| `ArduinoHardwareAPI_Planta1_Control/ArduinoHardwareAPI_Planta1_Control.ino` | `2.0.0-PLANTA1-CTRL` | Aquisição e atuação protegida |

Ambas usam Serial a 115200 baud, LT em A0–A5 e FT em D30–D35, amostrados
a 4 kHz pelo Timer1. O fator de vazão de 2580 pulsos/L é nominal e depende
de validação física. A aquisição responde às consultas GET com eco `@id`.
No CTRL, LV1=D36, LV2=D37, LV3=D38 e LV4=D39 iniciam sem pulsos e exigem ARM e SYNC antes de movimento. RO mantém seu comportamento de aquisição.

CTRL permite ARM/DISARM, comandos semânticos das bombas e LV configuradas,
Emergency Stop e Reset Fault. Não aceita testes LOW/HIGH de relés.
Não expõe SET PIN genérico. PID/AUTO executa exclusivamente no backend/FMU e depende
de comissionamento válido. OY1/OY2 usam pares provisórios D26/D27 e D28/D29. Confirmações e readback vêm do firmware, nunca de estado otimista.

As configurações físicas ficam em `ArduinoHardwareAPI_Planta1_Control/control_config.h`.
As três bombas usam RPWM (`forward=1`): Pump1 D9/D10, Pump2 D7/D8 e Pump3 D5/D6.
LV sem associação/limites configurados permanece bloqueada.
Servos usam Timer5, separado do Timer1 dos FT.

O `loop()` verifica os prazos mesmo com a Serial vazia: bombas param após
5 s sem HEARTBEAT. O backend
envia HEARTBEAT aproximadamente a cada segundo enquanto há bomba ativa.
GET não renova o watchdog. Falhas exigem reset explícito e novo ARM.

Com polaridade desconhecida, o boot e as paradas liberam os relés sem pull-up;
isso não confirma desenergização do módulo. As configurações, restrições e
a checklist de bancada estão em [HARDWARE.md](../HARDWARE.md).

## Executar

1. Abra o sketch RO ou CTRL na Arduino IDE e selecione **Arduino Mega 2560**.
2. Confira a configuração da variante, compile e selecione a COM correta antes de gravar.
3. Feche o Monitor Serial e execute `bat_planta_real.bat` na raiz do projeto.
4. Selecione **Planta real** na HMI. CTRL inicia desarmado; RO mantém atuação bloqueada.

O iniciador abre Python, Vite e navegador, mas não grava firmware. Uma COM só
pode ser ocupada por um programa. Sensores ausentes ou leituras expiradas
permanecem sem dado; zero não substitui ausência. Calibração e média RAW ficam
em `python/hardware/hardware_config.py`, conforme [HARDWARE.md](../HARDWARE.md).

## Diagnóstico de relés na bancada

Use `diagnostico_reles/diagnostico_reles.ino` separado do backend e da HMI.
Configure `RELAY_PIN` como 26, 27, 28 ou 29 e grave no Mega 2560.
Com a alimentação isolada, conecte somente esse canal ao Arduino e deixe
os outros três fisicamente desconectados. Não conecte bombas/servos para esse teste.
Para trocar de canal, isole a alimentação, altere `RELAY_PIN`, grave e refaça a conexão.

No Monitor Serial, selecione **115200 baud** e término de linha. Com `RELAY_PIN=26`:

```text
D26 LOW
D26 HIGH
STATUS
STOP
```

Somente o pino configurado aceita LOW/HIGH. `STOP`, boot e 5 s sem um novo
LOW/HIGH válido liberam esse pino em INPUT sem pull-up. `STATUS` não renova o prazo.
Comandos inválidos também liberam o pino. Os outros pinos não são escritos.
INPUT não garante desenergização do módulo: confira o estado físico e use o corte
de alimentação. LOW/HIGH representam níveis elétricos, não ligado/desligado.
Não há associação com OY, gravação de resultados ou restauração após reboot.
Anote a polaridade e o ramo observado; depois grave RO ou CTRL novamente para usar a HMI.
O backend e CTRL devem estar atualizados juntos: o readback CTRL contém apenas
`armed`, `fault`, `pumps`, `valves` e `oy`; veja o contrato 2.0 em HARDWARE.md.

## Sketch de telemetria espontânea

`six_tank_mega2560/` contém um sketch somente de aquisição com protocolo
`HELLO`/`TELEMETRY`, configurações de sensores e `TEST_MODE`. Ele não implementa
a API DEQUI consultada pelo backend HARDWARE; use uma das variantes acima para
essa conexão. A pinagem está registrada em
[CONEXOES_PLANTA_1.md](six_tank_mega2560/CONEXOES_PLANTA_1.md).

## Validação

Execute `python -m unittest discover -s python -p test_*.py`. Os testes de controle
usam g++ disponível no PATH ou em `CTRL_CXX`, com GPIO e Serial simulados.
Os testes do `loop()` compilam o `.ino` CTRL completo e verificam o watchdog
sem novos bytes Serial. Testes de software não substituem validação da bancada.
