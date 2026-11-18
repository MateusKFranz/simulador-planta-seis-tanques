/* Planta 1: aquisição DEQUI e controle manual. Ver HARDWARE.md. */
#include <Arduino.h>
#include <avr/interrupt.h>
#include <util/atomic.h>
#include <ctype.h>
#include <string.h>
#include <stdlib.h>
#include "control_config.h"
// COMUNICACAO / PROTOCOLO
#define FIRMWARE_VERSION       "2.0.0-PLANTA1-CTRL"
#define BOARD_ID               "DEQUI_HW_API"
#define SERIAL_BAUDRATE        115200UL
#define SERIAL_LINE_MAX        96
#define MAX_TOKENS             16
#define MAX_REQID_LEN          10

#define ADC_REF_VOLTAGE        5.0f
#define ADC_MAX_COUNTS         1023.0f

#define STALE_READING_FACTOR   3UL
// CONFIGURACAO DA PLANTA 1
#define NUM_PRESSURE_SENSORS   6
#define NUM_FLOW_SENSORS       6

struct PressureSensorConfig {
  const char* name;
  uint8_t analogPin;
  uint16_t sampleIntervalMs;
  uint8_t filterSamples;
};

const PressureSensorConfig pressureConfigs[NUM_PRESSURE_SENSORS] = {
  { "Pressao 1", A0, 50, 4 },
  { "Pressao 2", A1, 50, 4 },
  { "Pressao 3", A2, 50, 4 },
  { "Pressao 4", A3, 50, 4 },
  { "Pressao 5", A4, 50, 4 },
  { "Pressao 6", A5, 50, 4 }
};

struct FlowSensorConfig {
  const char* name;
  uint8_t pin;
  float pulsesPerLiter;
  uint16_t windowMs;
};

const FlowSensorConfig flowConfigs[NUM_FLOW_SENSORS] = {
  { "Vazao 1", 30, 2580.0f, 500 },
  { "Vazao 2", 31, 2580.0f, 500 },
  { "Vazao 3", 32, 2580.0f, 500 },
  { "Vazao 4", 33, 2580.0f, 500 },
  { "Vazao 5", 34, 2580.0f, 500 },
  { "Vazao 6", 35, 2580.0f, 500 }
};
// ESTADO DOS SENSORES
#define MAX_FILTER_SAMPLES 8

struct PressureSensorState {
  int rawADC;
  float filteredRaw;
  unsigned long lastUpdateMs;
  bool valid;
};

PressureSensorState pressureStates[NUM_PRESSURE_SENSORS];
unsigned long pressureLastSampleMs[NUM_PRESSURE_SENSORS] = {};
float pressureFilterBuf[NUM_PRESSURE_SENSORS][MAX_FILTER_SAMPLES] = {};
uint8_t pressureFilterIdx[NUM_PRESSURE_SENSORS] = {};
uint8_t pressureFilterCount[NUM_PRESSURE_SENSORS] = {};

struct FlowSensorState {
  uint32_t lastPulseSnapshot;
  unsigned long lastWindowMs;
  float instantFlowLs;       // L/s, como no firmware DEQUI original
  float totalVolumeL;
  unsigned long lastUpdateMs;
  bool valid;
};

FlowSensorState flowStates[NUM_FLOW_SENSORS];

// Contadores totais desde o boot.
volatile uint32_t flowPulseCount[NUM_FLOW_SENSORS] = {};

// Leitura direta dos registradores para manter a ISR curta.
volatile uint8_t* flowInputRegister[NUM_FLOW_SENSORS] = {};
uint8_t flowBitMask[NUM_FLOW_SENSORS] = {};
volatile bool flowLastHigh[NUM_FLOW_SENSORS] = {};
/*
  TIMER1 - AQUISICAO DOS FT EM D30..D35
  16 MHz / 8 / 500 = 4 kHz
*/
constexpr unsigned long FLOW_POLL_HZ = 4000UL;
constexpr unsigned long TIMER1_PRESCALER = 8UL;
constexpr unsigned long TIMER1_COUNTS =
    F_CPU / (TIMER1_PRESCALER * FLOW_POLL_HZ);

static_assert(TIMER1_COUNTS >= 1 && TIMER1_COUNTS <= 65536UL,
              "Configuracao Timer1 fora da faixa");

constexpr uint16_t TIMER1_OCR =
    static_cast<uint16_t>(TIMER1_COUNTS - 1UL);

bool configureFlowInput(uint8_t index, uint8_t pin) {
  const uint8_t port = digitalPinToPort(pin);
  if (port == NOT_A_PIN) return false;

  // Pull-up ajuda a evitar entrada flutuante quando o sensor estiver ausente.
  pinMode(pin, INPUT_PULLUP);

  flowInputRegister[index] = portInputRegister(port);
  flowBitMask[index] = digitalPinToBitMask(pin);

  if (flowInputRegister[index] == nullptr || flowBitMask[index] == 0) {
    return false;
  }

  flowLastHigh[index] =
      ((*flowInputRegister[index]) & flowBitMask[index]) != 0;

  return true;
}

void startFlowSamplerTimer1() {
  noInterrupts();

  TCCR1A = 0;
  TCCR1B = 0;
  TCNT1 = 0;
  OCR1A = TIMER1_OCR;

  TCCR1B |= _BV(WGM12);   // CTC
  TCCR1B |= _BV(CS11);    // prescaler 8
  TIMSK1 |= _BV(OCIE1A);  // Compare Match A

  interrupts();
}

ISR(TIMER1_COMPA_vect) {
  for (uint8_t i = 0; i < NUM_FLOW_SENSORS; ++i) {
    volatile uint8_t* reg = flowInputRegister[i];
    const uint8_t mask = flowBitMask[i];

    if (reg == nullptr || mask == 0) continue;

    const bool high = ((*reg) & mask) != 0;

    // Uma contagem por pulso: borda LOW -> HIGH.
    if (high && !flowLastHigh[i]) {
      ++flowPulseCount[i];
    }

    flowLastHigh[i] = high;
  }
}
// AQUISICAO
void setupPressureSensors() {
  for (uint8_t i = 0; i < NUM_PRESSURE_SENSORS; ++i) {
    pressureStates[i].rawADC = 0;
    pressureStates[i].filteredRaw = 0.0f;
    pressureStates[i].lastUpdateMs = 0;
    pressureStates[i].valid = false;
  }
}

void setupFlowSensors() {
  bool allOk = true;

  for (uint8_t i = 0; i < NUM_FLOW_SENSORS; ++i) {
    flowStates[i].lastPulseSnapshot = 0;
    flowStates[i].lastWindowMs = millis();
    flowStates[i].instantFlowLs = 0.0f;
    flowStates[i].totalVolumeL = 0.0f;
    flowStates[i].lastUpdateMs = 0;
    flowStates[i].valid = false;

    if (!configureFlowInput(i, flowConfigs[i].pin)) {
      allOk = false;
    }
  }

  if (allOk) {
    startFlowSamplerTimer1();
  }
}

void updatePressureSensors() {
  const unsigned long now = millis();

  for (uint8_t i = 0; i < NUM_PRESSURE_SENSORS; ++i) {
    if ((unsigned long)(now - pressureLastSampleMs[i]) <
        pressureConfigs[i].sampleIntervalMs) {
      continue;
    }

    pressureLastSampleMs[i] = now;

    const int raw = analogRead(pressureConfigs[i].analogPin);

    uint8_t n = pressureConfigs[i].filterSamples;
    if (n < 1) n = 1;
    if (n > MAX_FILTER_SAMPLES) n = MAX_FILTER_SAMPLES;

    pressureFilterBuf[i][pressureFilterIdx[i]] = (float)raw;
    pressureFilterIdx[i] = (pressureFilterIdx[i] + 1) % n;

    if (pressureFilterCount[i] < n) {
      ++pressureFilterCount[i];
    }

    float sum = 0.0f;
    for (uint8_t k = 0; k < pressureFilterCount[i]; ++k) {
      sum += pressureFilterBuf[i][k];
    }

    pressureStates[i].rawADC = raw;
    pressureStates[i].filteredRaw =
        sum / (float)pressureFilterCount[i];
    pressureStates[i].lastUpdateMs = now;
    pressureStates[i].valid = true;
  }
}

void updateFlowSensors() {
  const unsigned long now = millis();

  for (uint8_t i = 0; i < NUM_FLOW_SENSORS; ++i) {
    if ((unsigned long)(now - flowStates[i].lastWindowMs) <
        flowConfigs[i].windowMs) {
      continue;
    }

    uint32_t pulsesNow;
    ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
      pulsesNow = flowPulseCount[i];
    }

    const uint32_t delta =
        pulsesNow - flowStates[i].lastPulseSnapshot;

    const unsigned long elapsedMs =
        now - flowStates[i].lastWindowMs;

    flowStates[i].lastPulseSnapshot = pulsesNow;
    flowStates[i].lastWindowMs = now;

    if (elapsedMs == 0 || flowConfigs[i].pulsesPerLiter <= 0.0f) {
      flowStates[i].valid = false;
      continue;
    }

    const float elapsedSec = elapsedMs / 1000.0f;
    const float deltaVolumeL =
        delta / flowConfigs[i].pulsesPerLiter;

    flowStates[i].instantFlowLs =
        deltaVolumeL / elapsedSec;
    flowStates[i].totalVolumeL += deltaVolumeL;
    flowStates[i].lastUpdateMs = now;
    flowStates[i].valid = true;
  }
}

unsigned long readingAgeMs(unsigned long lastUpdateMs) {
  return millis() - lastUpdateMs;
}

bool isPressureStale(uint8_t i) {
  if (!pressureStates[i].valid) return true;

  const unsigned long limit =
      (unsigned long)pressureConfigs[i].sampleIntervalMs *
      STALE_READING_FACTOR;

  return readingAgeMs(pressureStates[i].lastUpdateMs) > limit;
}

bool isFlowStale(uint8_t i) {
  if (!flowStates[i].valid) return true;

  const unsigned long limit =
      (unsigned long)flowConfigs[i].windowMs *
      STALE_READING_FACTOR;

  return readingAgeMs(flowStates[i].lastUpdateMs) > limit;
}
// 6. PARSER SERIAL
char serialLineBuf[SERIAL_LINE_MAX];
uint8_t serialLineLen = 0;
bool serialOverflow = false;
unsigned long serialLinesReceived = 0;
unsigned long serialErrorsCount = 0;
char currentReqId[MAX_REQID_LEN + 1] = "";

void beginResponse() {
  if (currentReqId[0] != '\0') {
    Serial.print('@');
    Serial.print(currentReqId);
    Serial.print(' ');
  }
}

void respondErr(const char* code) {
  beginResponse();
  Serial.print(F("ERR,"));
  Serial.println(code);
  ++serialErrorsCount;
}

void respondErrDetail(const char* code, const char* detail) {
  beginResponse();
  Serial.print(F("ERR,"));
  Serial.print(code);
  Serial.print(',');
  Serial.println(detail);
  ++serialErrorsCount;
}

bool parseLongValue(const char* s, long* out) {
  if (s == nullptr || *s == '\0') return false;

  char* endp;
  const long v = strtol(s, &endp, 10);

  if (*endp != '\0') return false;

  *out = v;
  return true;
}

uint8_t tokenize(char* line, char* tokens[], uint8_t maxTokens) {
  uint8_t count = 0;
  char* saveptr = nullptr;
  char* tok = strtok_r(line, " ", &saveptr);

  while (tok != nullptr && count < maxTokens) {
    tokens[count++] = tok;
    tok = strtok_r(nullptr, " ", &saveptr);
  }

  return count;
}

void uppercaseInPlace(char* s) {
  while (*s) {
    *s = (char)toupper((unsigned char)*s);
    ++s;
  }
}

void printPressureGroup() {
  beginResponse();
  Serial.print(F("OK"));

  for (uint8_t i = 0; i < NUM_PRESSURE_SENSORS; ++i) {
    Serial.print(',');
    Serial.print(pressureStates[i].filteredRaw, 3);
  }

  Serial.println();
}

void printFlowGroup() {
  beginResponse();
  Serial.print(F("OK"));

  for (uint8_t i = 0; i < NUM_FLOW_SENSORS; ++i) {
    Serial.print(',');
    Serial.print(flowStates[i].instantFlowLs, 6);
  }

  Serial.println();
}

void getPressureSingle(long idx) {
  if (idx < 0 || idx >= NUM_PRESSURE_SENSORS) {
    respondErr("UNKNOWN_ID");
    return;
  }

  const PressureSensorState& s = pressureStates[idx];

  beginResponse();
  Serial.print(F("OK,"));

  /*
    Mantem o formato da API do Lucas:
    raw, calibrado, filtrado, valido, fora_faixa, stale, idade_ms

    Como ainda nao ha calibracao fisica:
    "calibrado" = RAW e "filtrado" = media de RAW.
  */
  Serial.print(s.rawADC);
  Serial.print(',');
  Serial.print((float)s.rawADC, 3);
  Serial.print(',');
  Serial.print(s.filteredRaw, 3);
  Serial.print(',');
  Serial.print(s.valid ? 1 : 0);
  Serial.print(',');
  Serial.print(0);  // fora_faixa: ainda nao aplicavel sem calibracao
  Serial.print(',');
  Serial.print(isPressureStale(idx) ? 1 : 0);
  Serial.print(',');
  Serial.println(s.valid ? readingAgeMs(s.lastUpdateMs) : 0);
}

void getFlowSingle(long idx) {
  if (idx < 0 || idx >= NUM_FLOW_SENSORS) {
    respondErr("UNKNOWN_ID");
    return;
  }

  uint32_t pulses;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    pulses = flowPulseCount[idx];
  }

  const FlowSensorState& s = flowStates[idx];

  beginResponse();
  Serial.print(F("OK,"));

  /*
    Formato da API Lucas:
    vazao_instantanea, pulsos_acumulados, valido, stale

    A vazao permanece em L/s. O dashboard pode converter para L/min.
  */
  Serial.print(s.instantFlowLs, 6);
  Serial.print(',');
  Serial.print(pulses);
  Serial.print(',');
  Serial.print(s.valid ? 1 : 0);
  Serial.print(',');
  Serial.println(isFlowStale(idx) ? 1 : 0);
}

void getPinMap() {
  beginResponse();
  Serial.print(F("OK"));

  for (uint8_t i = 0; i < NUM_PRESSURE_SENSORS; ++i) {
    Serial.print(',');
    Serial.print('A');
    Serial.print(i);
    Serial.print(F(":PRESSAO"));
    Serial.print(i + 1);
  }

  for (uint8_t i = 0; i < NUM_FLOW_SENSORS; ++i) {
    Serial.print(',');
    Serial.print(flowConfigs[i].pin);
    Serial.print(F(":VAZAO"));
    Serial.print(i + 1);
  }

  for (uint8_t i=0; i<3; ++i) {
    Serial.print(','); Serial.print(pumpConfigs[i].rpwm); Serial.print(F(":BOMBA")); Serial.print(i+1);
    Serial.print(','); Serial.print(pumpConfigs[i].lpwm); Serial.print(F(":BOMBA")); Serial.print(i+1);
  }
  for (uint8_t i=0; i<4; ++i) {
    Serial.print(','); Serial.print(valveConfigs[i].pin); Serial.print(F(":VALVULA")); Serial.print(i+1);
    Serial.print(','); Serial.print(relayConfigs[i].pin); Serial.print(F(":RELE")); Serial.print(i+1);
  }
  Serial.println();
}

void getAllCompact() {
  beginResponse();

  /*
    Mesmo esquema conceitual do firmware original:
    OK,<bombas>;<pressoes>;<vazoes>;<valvulas>;<reles>

    Esta consulta preserva o formato de aquisicao. Atuadores usam GET CONTROL.
  */
  Serial.print(F("OK,;"));

  for (uint8_t i = 0; i < NUM_PRESSURE_SENSORS; ++i) {
    if (i) Serial.print(',');
    Serial.print(pressureStates[i].filteredRaw, 3);
  }

  Serial.print(';');

  for (uint8_t i = 0; i < NUM_FLOW_SENSORS; ++i) {
    if (i) Serial.print(',');
    Serial.print(flowStates[i].instantFlowLs, 6);
  }

  Serial.println(F(";;"));
}

#include "servo_timer5.h"
#include "manual_control.h"

void handleGet(char* tokens[], uint8_t argc) {
  if (argc < 2) {
    respondErr("ARG_COUNT");
    return;
  }

  const char* noun = tokens[1];

  if (!strcmp(noun, "ID")) {
    beginResponse();
    Serial.print(F("OK,"));
    Serial.print(F(BOARD_ID));
    Serial.print(',');
    Serial.print(F(FIRMWARE_VERSION));
    Serial.println(F(",MEGA2560"));
    return;
  }

  if (!strcmp(noun, "VERSION")) {
    beginResponse();
    Serial.print(F("OK,"));
    Serial.println(F(FIRMWARE_VERSION));
    return;
  }

  if (!strcmp(noun, "UPTIME")) {
    beginResponse();
    Serial.print(F("OK,"));
    Serial.println(millis());
    return;
  }

  if (!strcmp(noun, "COMM")) {
    beginResponse();
    Serial.print(F("OK,"));
    Serial.print(SERIAL_BAUDRATE);
    Serial.print(',');
    Serial.print(millis());
    Serial.print(',');
    Serial.print(serialLinesReceived);
    Serial.print(',');
    Serial.println(serialErrorsCount);
    return;
  }

  if (!strcmp(noun, "SAFETY")) {
    beginResponse();
    Serial.println(F("OK,READY,NONE,1"));
    return;
  }

  if (!strcmp(noun, "COMPONENTS")) {
    // bombas, pressoes, vazoes, valvulas, reles
    beginResponse();
    Serial.print(F("OK,3,"));
    Serial.print(NUM_PRESSURE_SENSORS);
    Serial.print(',');
    Serial.print(NUM_FLOW_SENSORS);
    Serial.println(F(",4,4"));
    return;
  }

  if (!strcmp(noun, "ENABLED")) {
    beginResponse();
    Serial.print(F("OK,3,"));
    Serial.print(NUM_PRESSURE_SENSORS);
    Serial.print(',');
    Serial.print(NUM_FLOW_SENSORS);
    Serial.println(F(",4,4"));
    return;
  }

  if (!strcmp(noun, "PINMAP")) {
    getPinMap();
    return;
  }

  if (!strcmp(noun, "ALL")) {
    getAllCompact();
    return;
  }

  if (!strcmp(noun, "PRESSOES")) {
    printPressureGroup();
    return;
  }

  if (!strcmp(noun, "VAZOES")) {
    printFlowGroup();
    return;
  }

  if (!strcmp(noun, "PRESSAO")) {
    if (argc != 3) {
      respondErr("ARG_COUNT");
      return;
    }

    long id;
    if (!parseLongValue(tokens[2], &id)) {
      respondErrDetail("INVALID_VALUE", tokens[2]);
      return;
    }

    getPressureSingle(id - 1);
    return;
  }

  if (!strcmp(noun, "VAZAO")) {
    if (argc != 3) {
      respondErr("ARG_COUNT");
      return;
    }

    long id;
    if (!parseLongValue(tokens[2], &id)) {
      respondErrDetail("INVALID_VALUE", tokens[2]);
      return;
    }

    getFlowSingle(id - 1);
    return;
  }

  respondErrDetail("UNKNOWN_NOUN", noun);
}

void handleCommand(char* line) {
  currentReqId[0] = '\0';

  // @id opcional.
  if (line[0] == '@') {
    char* space = strchr(line, ' ');
    if (space == nullptr) {
      respondErr("INVALID_REQID");
      return;
    }

    *space = '\0';

    strncpy(currentReqId, line + 1, MAX_REQID_LEN);
    currentReqId[MAX_REQID_LEN] = '\0';

    line = space + 1;
  }

  uppercaseInPlace(line);

  char* tokens[MAX_TOKENS];
  const uint8_t argc = tokenize(line, tokens, MAX_TOKENS);

  if (argc == 0) return;
  if (handleControl(tokens, argc)) return;

  if (!strcmp(tokens[0], "PING")) {
    beginResponse();
    Serial.println(F("OK,PONG"));
    return;
  }

  if (!strcmp(tokens[0], "GET")) {
    handleGet(tokens, argc);
    return;
  }

  // Os comandos SET semanticos sao tratados por handleControl acima.
  if (!strcmp(tokens[0], "SET")) {
    respondErr("READ_ONLY");
    return;
  }

  if (!strcmp(tokens[0], "HEARTBEAT")) {
    // HEARTBEAT valido e tratado por handleControl, incluindo ARM e watchdog.
    beginResponse();
    Serial.println(F("OK,HEARTBEAT"));
    return;
  }

  respondErrDetail("UNKNOWN_COMMAND", tokens[0]);
}

void readSerialNonBlocking() {
  while (Serial.available() > 0) {
    // Tambem verifica os prazos durante um fluxo continuo de bytes.
    controlTick();
    const char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      ++serialLinesReceived;

      if (serialOverflow) {
        serialOverflow = false;
        serialLineLen = 0;
        respondErr("LINE_OVERFLOW");
        continue;
      }

      serialLineBuf[serialLineLen] = '\0';

      if (serialLineLen > 0) {
        handleCommand(serialLineBuf);
      }

      serialLineLen = 0;
      continue;
    }

    if (serialOverflow) continue;

    if (serialLineLen >= SERIAL_LINE_MAX - 1) {
      serialOverflow = true;
      continue;
    }

    serialLineBuf[serialLineLen++] = c;
  }
}
// SETUP / LOOP
void setup() {
  controlSetup();
  // Inicializacao dos sensores.
  setupPressureSensors();
  setupFlowSensors();

  Serial.begin(SERIAL_BAUDRATE);

  Serial.print(F("READY,"));
  Serial.print(F(BOARD_ID));
  Serial.print(',');
  Serial.println(F(FIRMWARE_VERSION));
}

void loop() {
  controlTick();
  readSerialNonBlocking();
  updatePressureSensors();
  updateFlowSensors();
}
