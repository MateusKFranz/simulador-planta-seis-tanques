#pragma once
// Pulsos dos quatro servos exclusivamente no Timer5. Timer1 pertence aos FT.
volatile uint16_t servoPulseTicks[4] = {};
volatile uint8_t servoPhase = 0;
volatile uint16_t servoFrameTicks = 0;
bool servoTimerStarted = false;

ISR(TIMER5_COMPA_vect) {
  // Ao avançar de fase, encerra o pulso do servo anterior.
  if (servoPhase > 0) {
    const uint8_t previous = servoPhase - 1;
    if (servoPulseTicks[previous]) digitalWrite(valveConfigs[previous].pin, LOW);
  }

  if (servoPhase == 4) {
    OCR5A = 40000 - servoFrameTicks - 1;
    servoPhase = 0;
    servoFrameTicks = 0;
  } else {
    uint16_t ticks = servoPulseTicks[servoPhase];
    if (ticks) digitalWrite(valveConfigs[servoPhase].pin, HIGH);
    else ticks = 100;
    OCR5A = ticks - 1;
    servoFrameTicks += ticks;
    ++servoPhase;
  }
}

void servoSignal(uint8_t index, int angle) {
  if (index >= 4) return;
  uint16_t ticks = 0;
  if (angle >= 0) {
    const ValveConfig &c = valveConfigs[index];
    ticks = 2 * (c.pulseMin + (long)(c.pulseMax-c.pulseMin)*angle/180);
  }
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    servoPulseTicks[index] = ticks;
    if (ticks && !servoTimerStarted) {
      TCCR5A = 0; TCCR5B = 0; TCNT5 = 0; OCR5A = 99;
      TCCR5B = _BV(WGM52) | _BV(CS51);
      TIMSK5 |= _BV(OCIE5A);
      servoTimerStarted = true;
    }
    if (!ticks) digitalWrite(valveConfigs[index].pin, LOW);
  }
}
