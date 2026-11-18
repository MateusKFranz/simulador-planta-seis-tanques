/*
  ============================================================================
  DIAGNOSTICO DE RELES EM PARES - PLANTA 1
  Arduino Mega 2560
  ============================================================================

  Pares:
    P12 -> D26 + D27
    P34 -> D28 + D29

  Regra:
    Cada par e sempre comandado em estado complementar:
      HIGH / LOW
      LOW  / HIGH

  Comandos (Serial 115200):
    P12 HL     -> D26 HIGH, D27 LOW
    P12 LH     -> D26 LOW,  D27 HIGH

    P34 HL     -> D28 HIGH, D29 LOW
    P34 LH     -> D28 LOW,  D29 HIGH

    STATUS
    HELP

  IMPORTANTE:
    - No boot os quatro pinos ficam INPUT sem pull-up.
    - Este sketch NAO assume qual estado corresponde a OY-A/OY-B.
    - Este sketch NAO assume qual estado e "seguro".
    - Nao existe STOP automatico porque ainda nao sabemos qual estado fisico
      deve ser aplicado ao parar.
    - As trocas dos dois pinos de cada par sao feitas no mesmo registrador
      (PORTA), evitando comandar um pino isoladamente.
  ============================================================================
*/

#include <Arduino.h>
#include <string.h>
#include <ctype.h>

// Arduino Mega 2560:
// D26 = PA4
// D27 = PA5
// D28 = PA6
// D29 = PA7

const uint8_t MASK_P12 = _BV(PA4) | _BV(PA5);
const uint8_t MASK_P34 = _BV(PA6) | _BV(PA7);

enum PairState : uint8_t {
  PAIR_RELEASED = 0,
  PAIR_HL,
  PAIR_LH
};

PairState stateP12 = PAIR_RELEASED;
PairState stateP34 = PAIR_RELEASED;

char lineBuffer[48];
uint8_t lineLength = 0;

void releaseAllAtBoot() {
  noInterrupts();

  // Sem pull-up e como entrada.
  PORTA &= ~(MASK_P12 | MASK_P34);
  DDRA  &= ~(MASK_P12 | MASK_P34);

  interrupts();
}

void applyP12(bool d26High) {
  noInterrupts();

  // Prepara os dois bits do par no mesmo byte.
  uint8_t value = PORTA;
  value &= ~MASK_P12;

  if (d26High) {
    value |= _BV(PA4);   // D26 HIGH, D27 LOW
    stateP12 = PAIR_HL;
  } else {
    value |= _BV(PA5);   // D26 LOW, D27 HIGH
    stateP12 = PAIR_LH;
  }

  // Se ainda eram INPUT, primeiro prepara o latch e depois habilita ambos.
  PORTA = value;
  DDRA |= MASK_P12;

  interrupts();
}

void applyP34(bool d28High) {
  noInterrupts();

  uint8_t value = PORTA;
  value &= ~MASK_P34;

  if (d28High) {
    value |= _BV(PA6);   // D28 HIGH, D29 LOW
    stateP34 = PAIR_HL;
  } else {
    value |= _BV(PA7);   // D28 LOW, D29 HIGH
    stateP34 = PAIR_LH;
  }

  PORTA = value;
  DDRA |= MASK_P34;

  interrupts();
}

const char* stateTextP12() {
  switch (stateP12) {
    case PAIR_HL: return "D26 HIGH / D27 LOW";
    case PAIR_LH: return "D26 LOW / D27 HIGH";
    default:      return "INPUT / referencia nao aplicada";
  }
}

const char* stateTextP34() {
  switch (stateP34) {
    case PAIR_HL: return "D28 HIGH / D29 LOW";
    case PAIR_LH: return "D28 LOW / D29 HIGH";
    default:      return "INPUT / referencia nao aplicada";
  }
}

void printStatus() {
  Serial.print(F("P12: "));
  Serial.println(stateTextP12());

  Serial.print(F("P34: "));
  Serial.println(stateTextP34());
}

void printHelp() {
  Serial.println(F("Comandos:"));
  Serial.println(F("  P12 HL  -> D26 HIGH / D27 LOW"));
  Serial.println(F("  P12 LH  -> D26 LOW  / D27 HIGH"));
  Serial.println(F("  P34 HL  -> D28 HIGH / D29 LOW"));
  Serial.println(F("  P34 LH  -> D28 LOW  / D29 HIGH"));
  Serial.println(F("  STATUS"));
  Serial.println(F("  HELP"));
}

void trimAndUpper(char* s) {
  // Remove espacos iniciais.
  char* start = s;
  while (*start && isspace((unsigned char)*start)) {
    ++start;
  }

  if (start != s) {
    memmove(s, start, strlen(start) + 1);
  }

  // Remove espacos finais.
  size_t len = strlen(s);
  while (len > 0 && isspace((unsigned char)s[len - 1])) {
    s[--len] = '\0';
  }

  // Caixa alta.
  for (size_t i = 0; s[i]; ++i) {
    s[i] = (char)toupper((unsigned char)s[i]);
  }
}

void handleCommand(char* command) {
  trimAndUpper(command);

  if (strcmp(command, "P12 HL") == 0) {
    applyP12(true);
    Serial.println(F("OK: D26 HIGH / D27 LOW"));
    return;
  }

  if (strcmp(command, "P12 LH") == 0) {
    applyP12(false);
    Serial.println(F("OK: D26 LOW / D27 HIGH"));
    return;
  }

  if (strcmp(command, "P34 HL") == 0) {
    applyP34(true);
    Serial.println(F("OK: D28 HIGH / D29 LOW"));
    return;
  }

  if (strcmp(command, "P34 LH") == 0) {
    applyP34(false);
    Serial.println(F("OK: D28 LOW / D29 HIGH"));
    return;
  }

  if (strcmp(command, "STATUS") == 0) {
    printStatus();
    return;
  }

  if (strcmp(command, "HELP") == 0) {
    printHelp();
    return;
  }

  Serial.println(F("ERRO: comando invalido. Use HELP."));
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r' || c == '\n') {
      if (lineLength > 0) {
        lineBuffer[lineLength] = '\0';
        handleCommand(lineBuffer);
        lineLength = 0;
      }
      continue;
    }

    if (lineLength < sizeof(lineBuffer) - 1) {
      lineBuffer[lineLength++] = c;
    } else {
      lineLength = 0;
      Serial.println(F("ERRO: linha muito longa."));
    }
  }
}

void setup() {
  releaseAllAtBoot();

  Serial.begin(115200);

  Serial.println();
  Serial.println(F("Diagnostico de reles em pares - Planta 1"));
  Serial.println(F("P12 = D26/D27 | P34 = D28/D29"));
  Serial.println(F("Cada comando sempre aplica HIGH/LOW ou LOW/HIGH ao par inteiro."));
  Serial.println(F("Nenhum estado seguro/desligado foi assumido."));
  printHelp();
  printStatus();
}

void loop() {
  readSerial();
}
