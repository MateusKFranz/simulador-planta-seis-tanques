#include <Arduino.h>
#include <string.h>

// BOMBA EM TESTE
// Pump1: 9/10; Pump2: 7/8; Pump3: 5/6. Apenas uma bomba conectada.
const int RPWM_PIN = 7;
const int LPWM_PIN = 8;
static_assert((RPWM_PIN == 5 && LPWM_PIN == 6) ||
              (RPWM_PIN == 7 && LPWM_PIN == 8) ||
              (RPWM_PIN == 9 && LPWM_PIN == 10), "Use um dos pares da Planta 1");
const int MAX_PERCENT = 30;
static_assert(MAX_PERCENT > 0 && MAX_PERCENT <= 30, "Limite de bancada: ate 30%");
int activePin = -1;
int appliedPercent = 0;
int appliedPwm = 0;

const unsigned long TIMEOUT_MS = 5000;
unsigned long commandAt = 0;
char commandBuffer[32];
uint8_t commandLength = 0;
bool discardLine = false;

// Aceita apenas um inteiro decimal, sem sufixos ou sinais.
bool readValue(const char* text, int &value) {
  if (!*text) return false;
  value = 0;
  for (; *text; ++text) {
    if (*text < '0' || *text > '9') return false;
    value = value*10 + (*text-'0');
    if (value > 180) return false;
  }
  return true;
}

void stopOutput() {
  analogWrite(RPWM_PIN, 0);
  analogWrite(LPWM_PIN, 0);
  activePin = -1;
  appliedPercent = appliedPwm = 0;
}

void printStatus() {
  Serial.print(F("RPWM D")); Serial.print(RPWM_PIN);
  Serial.print(F(" / LPWM D")); Serial.print(LPWM_PIN);
  Serial.print(F(" | Canal: "));
  Serial.print(activePin < 0 ? F("nenhum") : activePin == RPWM_PIN ? F("RPWM") : F("LPWM"));
  Serial.print(F(" | Comando: ")); Serial.print(appliedPercent);
  Serial.print(F("% | PWM: ")); Serial.print(appliedPwm); Serial.println(F("/255"));
}

void checkTimeout() {
  if (activePin >= 0 && (unsigned long)(millis()-commandAt) >= TIMEOUT_MS) {
    stopOutput(); Serial.println(F("TIMEOUT: ambas as saidas em zero")); printStatus();
  }
}

void handleCommand(char* command) {
  if (!strcmp(command, "STATUS")) { printStatus(); return; }
  // Zera ambos antes de qualquer nova atuação, STOP ou comando inválido.
  stopOutput();
  if (!strcmp(command, "STOP")) { printStatus(); return; }
  int percent;
  const int pin = !strncmp(command, "RPWM ", 5) ? RPWM_PIN :
                  !strncmp(command, "LPWM ", 5) ? LPWM_PIN : -1;
  if (pin < 0 || !readValue(command+5, percent) || percent > MAX_PERCENT) {
    Serial.println(F("ERRO: use RPWM/LPWM com percentual inteiro de 0 a 30"));
    printStatus(); return;
  }
  // Arredonda para baixo para nunca exceder 30% do PWM total.
  appliedPwm = (long)percent*255/100;
  appliedPercent = percent;
  activePin = appliedPwm ? pin : -1;
  analogWrite(pin, appliedPwm);
  commandAt = millis();
  printStatus();
}

void setup() {
  digitalWrite(RPWM_PIN, LOW); digitalWrite(LPWM_PIN, LOW);
  pinMode(RPWM_PIN, OUTPUT); pinMode(LPWM_PIN, OUTPUT);
  stopOutput();
  Serial.begin(115200);
  Serial.println(F("Uma bomba por upload. Sentido util ainda desconhecido."));
  Serial.println(F("RPWM 20 / LPWM 20 / STOP / STATUS. Percentual maximo: 30; timeout: 5 s."));
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
      if (commandLength < sizeof(commandBuffer)-1) commandBuffer[commandLength++] = c;
      else {
        discardLine = true;
        stopOutput();
        Serial.println(F("ERRO: linha longa; comando cessado"));
        printStatus();
      }
    }
  }
}
