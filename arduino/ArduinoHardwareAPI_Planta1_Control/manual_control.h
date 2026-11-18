#pragma once
#include <util/atomic.h>
// CONTROLE FÍSICO
bool controlArmed = false;
const char* controlFault = "NONE";
uint8_t pumpPwm[3] = {};
int valvePercent[4] = {-1,-1,-1,-1};
int valveAngle[4] = {-1,-1,-1,-1};
int valveTarget[4] = {-1,-1,-1,-1};
int valveTargetPercent[4] = {-1,-1,-1,-1};
bool valveSynced[4] = {}, valvePulsing[4] = {};
unsigned long valveStepAt[4] = {}, heartbeatAt = 0;
uint8_t oyState[2] = {}; // 0=RELEASE, 1=A, 2=B. Associação provisória.
const unsigned long VALVE_STEP_MS = 300;
const int VALVE_STEP_DEGREES = 5;

bool pumpsActive() { return pumpPwm[0] || pumpPwm[1] || pumpPwm[2]; }
bool valveRamping(uint8_t i) { return valveTarget[i]>=0 && valveTarget[i]!=valveAngle[i]; }
bool controlOutputsActive() {
  if (pumpsActive() || oyState[0] || oyState[1]) return true;
  for (uint8_t i=0;i<4;++i) if (valvePulsing[i] || valveTarget[i]>=0) return true;
  return false;
}
bool valveConfigured(uint8_t i) {
  if (i>=4) return false;
  const ValveConfig &c=valveConfigs[i];
  if (c.pin!=36+i || c.lv<1 || c.lv>4) return false;
  for(uint8_t j=0;j<4;++j) if(j!=i && valveConfigs[j].lv==c.lv) return false;
  return c.minimum>=0 && c.maximum<=180 && c.minimum<c.maximum &&
    c.closed>=c.minimum && c.closed<=c.maximum && c.open>=c.minimum && c.open<=c.maximum && c.open!=c.closed &&
    c.pulseMin>=500 && c.pulseMax<=2500 && c.pulseMin<c.pulseMax;
}
int anglePercent(uint8_t i,int angle) {
  const ValveConfig &c=valveConfigs[i];
  return constrain((long)(angle-c.closed)*100/(c.open-c.closed),0,100);
}
void stopPumps() {
  for(uint8_t i=0;i<3;++i) {
    analogWrite(pumpConfigs[i].rpwm,0); analogWrite(pumpConfigs[i].lpwm,0); pumpPwm[i]=0;
  }
}
void setOy(uint8_t i,uint8_t state) {
  const uint8_t shift=4+2*i, mask=3<<shift;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    // Retira as duas saídas antes de trocar o par, preservando os outros bits.
    DDRA &= (uint8_t)~mask;
    PORTA = (PORTA & (uint8_t)~mask) | (state==1 ? (1<<shift) : state==2 ? (2<<shift) : 0);
    if(state) DDRA |= mask;
  }
  oyState[i]=state;
}
void releaseRelays() { setOy(0,0); setOy(1,0); }
void stopValve(uint8_t i) {
  valveTarget[i]=valveTargetPercent[i]=-1;
  valvePulsing[i]=false;
  servoSignal(i,-1);
}
void safeControl() {
  controlArmed=false; stopPumps(); releaseRelays();
  for(uint8_t i=0;i<4;++i) stopValve(i);
}
void controlSetup() {
  for(uint8_t i=0;i<3;++i) {
    digitalWrite(pumpConfigs[i].rpwm,LOW); digitalWrite(pumpConfigs[i].lpwm,LOW);
    pinMode(pumpConfigs[i].rpwm,OUTPUT); pinMode(pumpConfigs[i].lpwm,OUTPUT);
  }
  for(uint8_t i=0;i<4;++i) { digitalWrite(36+i,LOW); pinMode(36+i,OUTPUT); }
  safeControl();
}
void controlTrip(const char* fault) {
  safeControl(); controlFault=fault;
  Serial.print(F("ALERT,")); Serial.println(fault);
}
void controlTick() {
  if(controlOutputsActive() && (unsigned long)(millis()-heartbeatAt)>=CONTROL_WATCHDOG_MS) controlTrip("WATCHDOG");
  if(!controlArmed) return;
  for(uint8_t i=0;i<4;++i) {
    if(valveTarget[i]<0 || !valveSynced[i] || !valveConfigured(i)) continue;
    if((unsigned long)(millis()-valveStepAt[i])<VALVE_STEP_MS) continue;
    int delta=valveTarget[i]-valveAngle[i];
    delta=constrain(delta,-VALVE_STEP_DEGREES,VALVE_STEP_DEGREES);
    valveAngle[i]+=delta; valveStepAt[i]=millis();
    servoSignal(i,valveAngle[i]); valvePulsing[i]=true;
    valvePercent[i]=anglePercent(i,valveAngle[i]);
  }
}
void printControl() {
  beginResponse(); Serial.print(F("OK,{\"armed\":")); Serial.print(controlArmed?"true":"false");
  Serial.print(F(",\"fault\":\"")); Serial.print(controlFault); Serial.print(F("\",\"pumps\":["));
  for(uint8_t i=0;i<3;++i) {
    if(i) Serial.print(','); Serial.print('['); Serial.print(pumpPwm[i]);
    Serial.print(','); Serial.print(pumpConfigs[i].forward); Serial.print(']');
  }
  Serial.print(F("],\"valves\":["));
  // lv,configurado,percentual comandado,referência,alvo,sync,pulsos,rampa,fechado,aberto,min,max,percentual alvo,pino
  for(uint8_t i=0;i<4;++i) {
    const ValveConfig &c=valveConfigs[i];
    const int values[]={c.lv,valveConfigured(i)?1:0,valvePercent[i],valveAngle[i],valveTarget[i],
      valveSynced[i]?1:0,valvePulsing[i]?1:0,valveRamping(i)?1:0,c.closed,c.open,c.minimum,c.maximum,valveTargetPercent[i],c.pin};
    if(i) Serial.print(','); Serial.print('[');
    for(uint8_t j=0;j<14;++j) { if(j) Serial.print(','); Serial.print(values[j]); }
    Serial.print(']');
  }
  Serial.print(F("],\"oy\":[")); Serial.print(oyState[0]); Serial.print(','); Serial.print(oyState[1]); Serial.println(F("]}"));
}
bool handleControl(char* tokens[],uint8_t argc) {
  const char* verb=tokens[0];
  if(!strcmp(verb,"GET") && argc==2 && !strcmp(tokens[1],"CONTROL")) { printControl(); return true; }
  if(!strcmp(verb,"GET") && argc==2 && !strcmp(tokens[1],"SAFETY")) {
    beginResponse(); Serial.print(!strcmp(controlFault,"NONE")?F("OK,READY,"):F("OK,FAULT,"));
    Serial.print(controlFault); Serial.println(F(",1")); return true;
  }
  if(!strcmp(verb,"EMERGENCY") && argc==2 && !strcmp(tokens[1],"STOP")) { controlTrip("EMERGENCY"); printControl(); return true; }
  if(!strcmp(verb,"DISARM") && argc==1) { safeControl(); printControl(); return true; }
  if(!strcmp(verb,"RESET") && argc==2 && !strcmp(tokens[1],"FAULT")) {
    safeControl(); controlFault="NONE";
    for(uint8_t i=0;i<4;++i) { valveSynced[i]=false; valveAngle[i]=valvePercent[i]=-1; }
    printControl(); return true;
  }
  if(!strcmp(verb,"ARM") && argc==1) {
    if(strcmp(controlFault,"NONE")) respondErr("FAULT_ACTIVE");
    else { controlArmed=true; printControl(); } return true;
  }
  if(!strcmp(verb,"HEARTBEAT") && argc==1) {
    if(!controlArmed || strcmp(controlFault,"NONE")) respondErr("NOT_ARMED");
    else { heartbeatAt=millis(); printControl(); } return true;
  }
  if(strcmp(verb,"SET")) return false;
  if(!controlArmed || strcmp(controlFault,"NONE")) { respondErr("NOT_ARMED"); return true; }
  long id,value;
  if(argc!=4 || !parseLongValue(tokens[2],&id)) { respondErr("INVALID_VALUE"); return true; }
  const bool wasActive=controlOutputsActive();
  if(!strcmp(tokens[1],"OY") && id>=1 && id<=2) {
    uint8_t state=!strcmp(tokens[3],"A")?1:!strcmp(tokens[3],"B")?2:!strcmp(tokens[3],"RELEASE")?0:255;
    if(state==255) { respondErr("INVALID_VALUE"); return true; }
    setOy(id-1,state);
  } else {
    if(!parseLongValue(tokens[3],&value)) { respondErr("INVALID_VALUE"); return true; }
    if(!strcmp(tokens[1],"BOMBA") && id>=1 && id<=3 && value>=0 && value<=255) {
      const PumpConfig &c=pumpConfigs[id-1];
      if(value && c.forward!=1 && c.forward!=2) { respondErr("PUMP_BLOCKED"); return true; }
      analogWrite(c.rpwm,0); analogWrite(c.lpwm,0);
      if(value) analogWrite(c.forward==1?c.rpwm:c.lpwm,value);
      pumpPwm[id-1]=value;
    } else if(id>=1 && id<=4 && (!strcmp(tokens[1],"VALVULA") || !strcmp(tokens[1],"LVANGLE") || !strcmp(tokens[1],"LVSYNC") || !strcmp(tokens[1],"LVSTOP"))) {
      uint8_t i=id-1;
      if(!valveConfigured(i)) { respondErr("VALVE_NOT_CONFIGURED"); return true; }
      if(!strcmp(tokens[1],"LVSTOP") && value==0) { stopValve(i); printControl(); return true; }
      if(!strcmp(tokens[1],"LVSTOP")) { respondErr("INVALID_VALUE"); return true; }
      const ValveConfig &c=valveConfigs[i];
      bool percent=!strcmp(tokens[1],"VALVULA"), sync=!strcmp(tokens[1],"LVSYNC");
      if((percent && (value<0 || value>100)) || (!percent && (value<c.minimum || value>c.maximum))) { respondErr("ANGLE_RANGE"); return true; }
      int angle=percent ? c.closed+(long)(c.open-c.closed)*value/100 : value;
      if(sync) {
        stopValve(i); valveAngle[i]=angle; valvePercent[i]=anglePercent(i,angle); valveSynced[i]=true; valveStepAt[i]=millis();
      } else {
        if(!valveSynced[i]) { respondErr("VALVE_NOT_SYNCED"); return true; }
        valveTarget[i]=angle; valveTargetPercent[i]=percent?value:anglePercent(i,angle);
      }
    } else { respondErr("FORBIDDEN_COMMAND"); return true; }
  }
  if(!wasActive && controlOutputsActive()) heartbeatAt=millis();
  printControl(); return true;
}
