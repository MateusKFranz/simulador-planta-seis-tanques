#pragma once

/*
  CONFIGURAÇÃO FÍSICA
  0 = sentido não confirmado; 1 = RPWM forward; 2 = LPWM forward.
*/
struct PumpConfig { uint8_t rpwm, lpwm, forward; };
PumpConfig pumpConfigs[3] = {{9, 10, 1}, {7, 8, 1}, {5, 6, 1}};

/*
  Configuração provisória para habilitar LV1..LV4 durante os testes de bancada.
  Associação física: LV1=D36, LV2=D37, LV3=D38, LV4=D39.
  Faixa provisória: 10..80 graus, igual à faixa usada no diagnóstico manual.
  closed/open ainda NÃO são uma calibração mecânica final: 0%=10° e 100%=80°
  somente para permitir o teste. Use LVSYNC antes de qualquer movimento.
  pulseMin/pulseMax: largura em microssegundos correspondente a 0/180 graus.
*/
struct ValveConfig { uint8_t pin, lv; int closed, open, minimum, maximum, safe, pulseMin, pulseMax; };
ValveConfig valveConfigs[4] = {
  {36, 1, 10, 80, 10, 80, -1, 1000, 2000},
  {37, 2, 10, 80, 10, 80, -1, 1000, 2000},
  {38, 3, 10, 80, 10, 80, -1, 1000, 2000},
  {39, 4, 10, 80, 10, 80, -1, 1000, 2000}
};

/*
  activeHigh=-1: polaridade desconhecida; não há estado lógico confirmado.
  Pares provisórios: OY1=D26/D27, OY2=D28/D29. A=HIGH/LOW, B=LOW/HIGH.
  RELEASE usa INPUT sem pull-up; activeHigh não define a atuação dos pares.
*/
struct RelayConfig { uint8_t pin; int8_t activeHigh; };
RelayConfig relayConfigs[4] = {{26, -1}, {27, -1}, {28, -1}, {29, -1}};
const unsigned long CONTROL_WATCHDOG_MS = 5000;
