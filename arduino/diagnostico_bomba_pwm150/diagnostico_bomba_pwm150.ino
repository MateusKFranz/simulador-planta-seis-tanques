/*
  ============================================================================
  DIAGNOSTICO DE BOMBA 1 - PLANTA 1
  Arduino Mega 2560
  ============================================================================

  Bomba 1:
    RPWM = D9
    LPWM = D10

  Monitor Serial: 115200 baud

  COMANDOS:
    RPWM <0..255>
    LPWM <0..255>
    STOP
    STATUS
    HELP

  Exemplos:
    RPWM 150
    RPWM 200
    RPWM 255

    LPWM 150
    LPWM 200
    LPWM 255

    STOP

  SEGURANCA:
    - Antes de aplicar um canal, ambos sao zerados.
    - RPWM e LPWM nunca ficam ativos ao mesmo tempo.
    - Timeout de 5 s: ambas as saidas voltam automaticamente a zero.
    - 0 significa bomba parada.
    - 255 corresponde a 100% de duty cycle do analogWrite().
  ============================================================================
*/

#include <Arduino.h>
#include <ctype.h>
#include <string.h>
#include <stdlib.h>

const uint8_t RPWM_PIN = 5;
const uint8_t LPWM_PIN = 6;

const int MAX_PWM = 255;
const unsigned long COMMAND_TIMEOUT_MS = 1000UL;

enum ActiveChannel : uint8_t {
  CHANNEL_NONE = 0,
  CHANNEL_RPWM,
  CHANNEL_LPWM
};

ActiveChannel activeChannel = CHANNEL_NONE;
int appliedPwm = 0;
unsigned long lastCommandMs = 0;
bool commandActive = false;

char lineBuffer[48];
uint8_t lineLength = 0;

void stopPump() {
  analogWrite(RPWM_PIN, 0);
  analogWrite(LPWM_PIN, 0);

  activeChannel = CHANNEL_NONE;
  appliedPwm = 0;
  commandActive = false;
}

const char* channelName() {
  switch (activeChannel) {
    case CHANNEL_RPWM: return "RPWM";
    case CHANNEL_LPWM: return "LPWM";
    default: return "nenhum";
  }
}

void printStatus() {
  Serial.print(F("RPWM D"));
  Serial.print(RPWM_PIN);

  Serial.print(F(" / LPWM D"));
  Serial.print(LPWM_PIN);

  Serial.print(F(" | Canal: "));
  Serial.print(channelName());

  Serial.print(F(" | PWM: "));
  Serial.print(appliedPwm);
  Serial.println(F("/255"));
}

void applyPumpCommand(ActiveChannel channel, int pwm) {
  // Garante que nunca haja os dois canais ativos.
  analogWrite(RPWM_PIN, 0);
  analogWrite(LPWM_PIN, 0);

  if (pwm <= 0) {
    stopPump();
    printStatus();
    return;
  }

  if (channel == CHANNEL_RPWM) {
    analogWrite(RPWM_PIN, pwm);
  } else if (channel == CHANNEL_LPWM) {
    analogWrite(LPWM_PIN, pwm);
  }

  activeChannel = channel;
  appliedPwm = pwm;
  commandActive = true;
  lastCommandMs = millis();

  printStatus();
}

void trimAndUpper(char* s) {
  char* start = s;

  while (*start && isspace((unsigned char)*start)) {
    ++start;
  }

  if (start != s) {
    memmove(s, start, strlen(start) + 1);
  }

  size_t len = strlen(s);

  while (len > 0 && isspace((unsigned char)s[len - 1])) {
    s[--len] = '\0';
  }

  for (size_t i = 0; s[i]; ++i) {
    s[i] = (char)toupper((unsigned char)s[i]);
  }
}

bool parsePwmValue(const char* text, int& value) {
  if (text == nullptr || *text == '\0') {
    return false;
  }

  char* endPtr = nullptr;
  long parsed = strtol(text, &endPtr, 10);

  while (endPtr && *endPtr && isspace((unsigned char)*endPtr)) {
    ++endPtr;
  }

  if (endPtr == text || (endPtr && *endPtr != '\0')) {
    return false;
  }

  if (parsed < 0 || parsed > MAX_PWM) {
    return false;
  }

  value = (int)parsed;
  return true;
}

void printHelp() {
  Serial.println(F("Comandos:"));
  Serial.println(F("  RPWM <0..255>"));
  Serial.println(F("  LPWM <0..255>"));
  Serial.println(F("  STOP"));
  Serial.println(F("  STATUS"));
  Serial.println(F("  HELP"));
}

void handleCommand(char* command) {
  trimAndUpper(command);

  if (strcmp(command, "STOP") == 0) {
    stopPump();
    Serial.println(F("OK: ambas as saidas em zero"));
    printStatus();
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

  if (strncmp(command, "RPWM ", 5) == 0) {
    int pwm = 0;

    if (!parsePwmValue(command + 5, pwm)) {
      stopPump();
      Serial.println(F("ERRO: use RPWM com valor inteiro de 0 a 255"));
      return;
    }

    applyPumpCommand(CHANNEL_RPWM, pwm);
    return;
  }

  if (strncmp(command, "LPWM ", 5) == 0) {
    int pwm = 0;

    if (!parsePwmValue(command + 5, pwm)) {
      stopPump();
      Serial.println(F("ERRO: use LPWM com valor inteiro de 0 a 255"));
      return;
    }

    applyPumpCommand(CHANNEL_LPWM, pwm);
    return;
  }

  stopPump();
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
      stopPump();
      Serial.println(F("ERRO: linha muito longa; bomba parada."));
    }
  }
}

void checkTimeout() {
  if (
    commandActive &&
    (millis() - lastCommandMs >= COMMAND_TIMEOUT_MS)
  ) {
    stopPump();
    Serial.println(F("TIMEOUT: ambas as saidas em zero"));
    printStatus();
  }
}

void setup() {
  pinMode(RPWM_PIN, OUTPUT);
  pinMode(LPWM_PIN, OUTPUT);

  stopPump();

  Serial.begin(115200);

  Serial.println();
  Serial.println(F("Diagnostico Bomba 1 - PWM bruto 0..255"));
  Serial.println(F("RPWM = D9 | LPWM = D10 | timeout = 5 s"));
  printHelp();
  printStatus();
}

void loop() {
  readSerial();
  checkTimeout();
}
