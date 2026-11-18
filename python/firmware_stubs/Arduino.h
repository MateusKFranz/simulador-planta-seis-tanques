#pragma once
// Periféricos simulados para compilar o .ino completo no computador.
#include <cstdint>
#include <deque>
#include <iomanip>
#include <sstream>
#include <string>
#define F(x) x
#define constrain(v,lo,hi) ((v)<(lo)?(lo):((v)>(hi)?(hi):(v)))
volatile uint8_t DDRA=0, PORTA=0;
#define F_CPU 16000000UL
#define _BV(x) (1U << (x))
enum { LOW=0, HIGH=1, INPUT=0, OUTPUT=1, INPUT_PULLUP=2, NOT_A_PIN=255 };
enum { A0=54, A1, A2, A3, A4, A5 };
enum { WGM12=3, CS11=1, OCIE1A=1, WGM52=3, CS51=1, OCIE5A=1 };
unsigned long simulatedMs=0;
int simulatedPins[70]={}, simulatedModes[70]={};
volatile uint8_t simulatedPort=0;
volatile uint16_t TCCR1A=0,TCCR1B=0,TCNT1=0,OCR1A=0,TIMSK1=0;
volatile uint16_t TCCR5A=0,TCCR5B=0,TCNT5=0,OCR5A=0,TIMSK5=0;
unsigned long millis() { return simulatedMs; }
void digitalWrite(uint8_t p,int v) { simulatedPins[p]=v; }
void analogWrite(uint8_t p,int v) { simulatedPins[p]=v; }
void pinMode(uint8_t p,int v) { simulatedModes[p]=v; }
int analogRead(uint8_t) { return 428; }
uint8_t digitalPinToPort(uint8_t p) { return p<70 ? 1 : NOT_A_PIN; }
uint8_t digitalPinToBitMask(uint8_t p) { return 1U << (p%8); }
volatile uint8_t* portInputRegister(uint8_t) { return &simulatedPort; }
void noInterrupts() {}
void interrupts() {}
struct SerialStub {
    std::deque<char> rx;
    std::ostringstream tx;
    unsigned readCount=0;
    void begin(unsigned long) {}
    int available() { return rx.size(); }
    int read() { ++readCount; const char c=rx.front(); rx.pop_front(); return c; }
    template<class T> void print(T v) { tx << v; }
    void print(uint8_t v) { tx << int(v); }
    void print(float v,int digits) { tx << std::fixed << std::setprecision(digits) << v; }
    void println() { tx << '\n'; }
    template<class T> void println(T v) { print(v); println(); }
} Serial;
