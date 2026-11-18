#include <Arduino.h>
#include <stdio.h>
#include <string.h>

// DIAGNÓSTICO DE UM CANAL
// Conecte fisicamente somente este canal; desconecte os outros três.
const uint8_t RELAY_PIN = 26;
static_assert(RELAY_PIN >= 26 && RELAY_PIN <= 29, "Use somente D26 a D29");
const unsigned long TIMEOUT_MS = 5000;
int appliedLevel = -1;
unsigned long commandAt = 0;
char commandBuffer[32];
uint8_t commandLength = 0;
bool discardLine = false;

void printStatus() {
  Serial.print(F("D")); Serial.print(RELAY_PIN); Serial.print(F(": "));
  Serial.println(appliedLevel < 0 ? F("INPUT sem pull-up; desenergizacao nao confirmada") :
                 appliedLevel == LOW ? F("LOW aplicado") : F("HIGH aplicado"));
}

void releasePin() {
  pinMode(RELAY_PIN, INPUT);
  digitalWrite(RELAY_PIN, LOW);
  appliedLevel = -1;
}

void checkTimeout() {
  if (appliedLevel >= 0 && (unsigned long)(millis() - commandAt) >= TIMEOUT_MS) {
    releasePin();
    Serial.println(F("TIMEOUT"));
    printStatus();
  }
}

void handleCommand(char* command) {
  if (!strcmp(command, "STOP")) {
    releasePin(); printStatus(); return;
  }
  if (!strcmp(command, "STATUS")) {
    printStatus(); return;
  }
  char low[12], high[12];
  snprintf(low, sizeof(low), "D%u LOW", (unsigned)RELAY_PIN);
  snprintf(high, sizeof(high), "D%u HIGH", (unsigned)RELAY_PIN);
  const int level = !strcmp(command, low) ? LOW : !strcmp(command, high) ? HIGH : -1;
  if (level < 0) {
    releasePin();
    Serial.println(F("ERRO: comando invalido ou pino nao configurado"));
    printStatus(); return;
  }
  digitalWrite(RELAY_PIN, level);
  pinMode(RELAY_PIN, OUTPUT);
  appliedLevel = level;
  commandAt = millis();
  printStatus();
}

void setup() {
  releasePin();
  Serial.begin(115200);
  Serial.println(F("Diagnostico: apenas um canal fisicamente conectado."));
  Serial.println(F("LOW/HIGH nao significam ligado/desligado. Timeout: 5 s."));
  Serial.println(F("Comandos: D<pino configurado> LOW, D<pino configurado> HIGH, STOP, STATUS."));
  printStatus();
}

void loop() {
  checkTimeout();
  while (Serial.available() > 0) {
    checkTimeout();
    const char c = Serial.read();
    if (c == '\r' || c == '\n') {
      if (!discardLine && commandLength) {
        commandBuffer[commandLength] = '\0';
        handleCommand(commandBuffer);
      }
      commandLength = 0;
      discardLine = false;
    } else if (!discardLine) {
      if (commandLength < sizeof(commandBuffer) - 1) commandBuffer[commandLength++] = c;
      else {
        discardLine = true;
        releasePin();
        Serial.println(F("ERRO: linha longa"));
        printStatus();
      }
    }
  }
}
