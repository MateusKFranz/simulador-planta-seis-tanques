// Executa a lógica real do firmware com GPIO/relógio simulados, nunca uma COM.
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#define F(x) x
#define constrain(v,lo,hi) ((v)<(lo)?(lo):((v)>(hi)?(hi):(v)))
volatile uint8_t DDRA=0, PORTA=0;
enum { LOW=0, HIGH=1, INPUT=0, OUTPUT=1 };
int pins[70]={}, modes[70]={}, servoAngles[4]={-1,-1,-1,-1};
unsigned long nowMs=0;
unsigned long millis() { return nowMs; }
void digitalWrite(int p,int v) { pins[p]=v; }
void analogWrite(int p,int v) { pins[p]=v; }
void pinMode(int p,int v) { modes[p]=v; }
void servoSignal(uint8_t i,int a) { servoAngles[i]=a; }
std::string requestId;
struct SerialMock {
  std::ostringstream out;
  template<class T> void print(T v) { out << v; }
  void print(uint8_t v) { out << int(v); }
  template<class T> void println(T v) { print(v); out << '\n'; }
} Serial;
void beginResponse() { if (!requestId.empty()) Serial.out << requestId << ' '; }
void respondErr(const char* code) { beginResponse(); Serial.print("ERR,"); Serial.println(code); }
bool parseLongValue(const char* s,long* v) { char* end; *v=strtol(s,&end,10); return *s && !*end; }
#include "../arduino/ArduinoHardwareAPI_Planta1_Control/control_config.h"
#include "../arduino/ArduinoHardwareAPI_Planta1_Control/manual_control.h"

std::string command(std::string text) {
  Serial.out.str(""); Serial.out.clear(); requestId="";
  if (text[0]=='@') { auto split=text.find(' '); requestId=text.substr(0,split); text=text.substr(split+1); }
  std::istringstream input(text); std::vector<std::string> words;
  std::string word; while (input >> word) words.push_back(word);
  std::vector<char*> tokens; for (auto &w:words) tokens.push_back(&w[0]);
  if (!tokens.empty() && !handleControl(tokens.data(),tokens.size())) respondErr("UNKNOWN_COMMAND");
  return Serial.out.str();
}
void ok(const std::string &s) { assert(command(s).find("ERR")==std::string::npos); }
void denied(const std::string &s) { assert(command(s).find("ERR")!=std::string::npos); }
int main(int argc,char**argv) {
  controlSetup();
  for(int i=0;i<3;++i) {
    assert(pumpConfigs[i].rpwm==9-2*i && pumpConfigs[i].lpwm==10-2*i);
    assert(pumpConfigs[i].forward==1);
  }
  if (argc>1 && !strcmp(argv[1],"--serial")) {
    // Configurações sintéticas de bancada, nunca copiadas para control_config.h.
    valveConfigs[0]={36,1,20,140,10,150,-1,600,2400};
    std::string line;
    while (std::getline(std::cin,line)) {
      if (line.rfind("#TIME ",0)==0) { nowMs=std::stoul(line.substr(6)); Serial.out.str(""); controlTick(); std::cout<<Serial.out.str(); }
      else std::cout<<command(line);
      std::cout<<"#END\n"<<std::flush;
    }
    return 0;
  }
  for(int p=5;p<=10;++p) assert(pins[p]==0 && modes[p]==OUTPUT);
  for(int p=26;p<=29;++p) assert(modes[p]==INPUT && pins[p]==LOW);
  assert(modes[36]==OUTPUT && pins[36]==LOW && servoAngles[0]==-1);
  denied("SET BOMBA 1 64"); denied("SET RELAYTEST 1 1"); ok("ARM");
  pumpConfigs[0].forward=0; // Exercita bloqueio de uma configuração inválida.
  denied("SET BOMBA 1 64"); denied("SET VALVULA 1 50"); denied("SET PIN 26 1");
  pumpConfigs[0].forward=1;
  for(int i=0;i<3;++i) {
    for(int pwm:{0,1,39,40,64,128,255}) {
      ok("SET BOMBA "+std::to_string(i+1)+" "+std::to_string(pwm));
      assert(pumpPwm[i]==pwm);
      assert(pins[pumpConfigs[i].forward==1?pumpConfigs[i].rpwm:pumpConfigs[i].lpwm]==pwm);
      assert(pins[pumpConfigs[i].forward==1?pumpConfigs[i].lpwm:pumpConfigs[i].rpwm]==0);
    }
    ok("SET BOMBA "+std::to_string(i+1)+" 0");
  }
  denied("SET BOMBA 1 -1"); denied("SET BOMBA 1 256");
  ok("SET BOMBA 1 64"); denied("SET RELAYTEST 1 1");
  nowMs=4999; ok("GET CONTROL"); controlTick(); assert(pumpPwm[0]==64);
  nowMs=5000; controlTick(); assert(!controlArmed && !pumpsActive() && !strcmp(controlFault,"WATCHDOG"));
  denied("ARM"); denied("HEARTBEAT"); ok("RESET FAULT"); assert(!controlArmed); ok("ARM");
  ok("SET BOMBA 1 64"); nowMs=9000; ok("HEARTBEAT"); nowMs=12000; controlTick(); assert(pumpPwm[0]==64);
  ok("EMERGENCY STOP"); assert(!pumpsActive() && !controlArmed); ok("RESET FAULT"); ok("ARM");
  for(int i=1;i<=4;++i) for(int level:{0,1}) {
    denied("SET RELAYTEST "+std::to_string(i)+" "+std::to_string(level));
    assert(modes[25+i]==INPUT && pins[25+i]==LOW);
  }
  denied("SET RELAYTEST END");
  releaseRelays(); assert((DDRA & 0xf0)==0 && (PORTA & 0xf0)==0);
  ok("RESET FAULT"); ok("ARM");
  valveConfigs[0]={36,4,20,140,10,150,-1,600,2400};
  denied("SET LVSYNC 1 30"); denied("SET VALVULA 1 50");
  valveConfigs[0]={36,1,10,80,10,80,-1,1000,2000};
  valveConfigs[1]={37,2,20,140,10,150,-1,600,2400};
  denied("SET VALVULA 2 50");
  ok("SET LVSYNC 2 30"); assert(servoAngles[1]==-1 && valveAngle[1]==30);
  ok("SET VALVULA 2 100"); assert(servoAngles[1]==-1 && valveTarget[1]==140);
  nowMs+=299; controlTick(); assert(valveAngle[1]==30);
  ++nowMs; controlTick(); assert(valveAngle[1]==35);
  ok("SET VALVULA 2 0"); nowMs+=300; controlTick(); assert(valveAngle[1]==30);
  ok("DISARM"); assert(valveTarget[1]==-1 && servoAngles[1]==-1);
  ok("ARM"); nowMs+=300; controlTick(); assert(servoAngles[1]==-1);
  ok("SET OY 1 A"); assert((DDRA&0x30)==0x30 && (PORTA&0x30)==0x10);
  ok("SET OY 1 B"); assert((PORTA&0x30)==0x20);
  ok("SET OY 2 A"); assert((PORTA&0xc0)==0x40);
  ok("EMERGENCY STOP"); assert((DDRA&0xf0)==0 && (PORTA&0xf0)==0);
  ok("RESET FAULT"); assert(!valveSynced[1] && valveAngle[1]==-1);
  assert(modes[36]==OUTPUT && pins[36]==LOW && servoAngles[0]==-1);
  std::cout<<"Firmware CTRL: boot, PWM, relays, LV, watchdog and stop PASS\n";
}
