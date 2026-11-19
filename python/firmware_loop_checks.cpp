#include <cassert>
#include <iostream>
// Inclui o firmware integral, inclusive loop(), parser Serial e timers.
#include "../arduino/ArduinoHardwareAPI_Planta1_Control/ArduinoHardwareAPI_Planta1_Control.ino"

void receive(const std::string &command) {
    Serial.tx.str(""); Serial.tx.clear();
    for (char c:command+"\n") Serial.rx.push_back(c);
    loop();
    assert(Serial.available()==0);
    assert(Serial.tx.str().find("ERR,")==std::string::npos);
}

void idleLoopUntil(unsigned long deadline) {
    const unsigned reads=Serial.readCount;
    while (simulatedMs < deadline) {
        ++simulatedMs;
        assert(Serial.available()==0);
        loop();
    }
    assert(Serial.readCount==reads);
}

void reject(const std::string &command) {
    Serial.tx.str(""); Serial.tx.clear();
    for(char c:command+"\n") Serial.rx.push_back(c);
    loop();
    assert(Serial.tx.str().find("ERR,")!=std::string::npos);
}

int main(int argc,char**argv) {
    assert(argc==2);
    setup();
    if (!strcmp(argv[1],"pump")) {
        // Somente configuração sintética do teste, sem mudar a configuração física.
        pumpConfigs[0].forward=1;
        receive("@1 ARM"); receive("@2 SET BOMBA 1 64");
        simulatedMs=1000;
        receive("@3 HEARTBEAT");
        const unsigned long lastHeartbeat=heartbeatAt;
        idleLoopUntil(lastHeartbeat+4999);
        assert(pumpPwm[0]==64 && controlArmed);
        idleLoopUntil(lastHeartbeat+5001);
        assert(!pumpsActive() && !controlArmed);
        for (const PumpConfig &p:pumpConfigs) assert(simulatedPins[p.rpwm]==0 && simulatedPins[p.lpwm]==0);
        assert(!strcmp(controlFault,"WATCHDOG"));
        assert(Serial.tx.str().find("ALERT,WATCHDOG")!=std::string::npos);
        assert(heartbeatAt==lastHeartbeat);
        std::cout << "PASS: pump timeout through real loop with empty Serial\n";
    } else if (!strcmp(argv[1],"servo") || !strcmp(argv[1],"oy")) {
        bool servo=!strcmp(argv[1],"servo");
        assert(simulatedModes[36]==OUTPUT && simulatedPins[36]==LOW);
        valveConfigs[1]={37,2,78,12,10,80,-1,600,2400};
        receive("ARM");
        if(servo) {
            receive("SET LVSYNC 2 70");
            assert(servoPulseTicks[1]==0);
            receive("SET VALVULA 2 100");
            assert(valveAngle[1]==12 && valveTarget[1]==12 && servoPulseTicks[1]==1440);
            idleLoopUntil(299); assert(valveAngle[1]==12);
            receive("SET LVANGLE 2 75");
            assert(valveAngle[1]==75 && servoPulseTicks[1]==2700);
        } else receive("SET OY 1 A");
        idleLoopUntil(5001);
        assert(!controlArmed && !controlOutputsActive());
        assert(!strcmp(controlFault,"WATCHDOG"));
        assert(servoPulseTicks[1]==0 && valveTarget[1]==-1);
        assert((DDRA&0xf0)==0 && (PORTA&0xf0)==0);
        receive("RESET FAULT"); receive("ARM");
        idleLoopUntil(6000); assert(!controlOutputsActive() && !valveSynced[1]);
        for(int i=0;i<10;++i) TIMER5_COMPA_vect();
        assert(simulatedModes[36]==OUTPUT && simulatedPins[36]==LOW);
        std::cout << "PASS: isolated servo/OY watchdog and safe reference\n";
    } else if (!strcmp(argv[1],"direct_limits")) {
        for(int i=0;i<4;++i) {
            const std::string id=std::to_string(i+1);
            assert(!valveSynced[i] && servoPulseTicks[i]==0);
            reject("SET LVANGLE "+id+" 80");
            receive("ARM");
            reject("SET LVANGLE "+id+" 80");
            reject("SET LVSYNC "+id+" 9");
            reject("SET LVSYNC "+id+" 81");
            receive("SET LVSYNC "+id+" 10");
            assert(servoPulseTicks[i]==0);
            receive("@42 SET LVANGLE "+id+" 80");
            assert(Serial.tx.str().find("@42 OK,")==0);
            const std::string readback="["+id+",1,100,80,80,1,1,0,10,80,10,80,100,"+std::to_string(36+i)+"]";
            assert(Serial.tx.str().find(readback)!=std::string::npos);
            assert(valveAngle[i]==80 && servoPulseTicks[i]==2888);
            for(const std::string &invalid:{"LVANGLE "+id+" 9","LVANGLE "+id+" 81","VALVULA "+id+" -1","VALVULA "+id+" 101","LVANGLE "+id+" abc"}) {
                reject("SET "+invalid);
                assert(valveAngle[i]==80 && servoPulseTicks[i]==2888);
            }
            receive("SET VALVULA "+id+" 0");
            assert(valveAngle[i]==10 && servoPulseTicks[i]==2110);
            receive("SET LVSTOP "+id+" 0");
            assert(servoPulseTicks[i]==0 && valveTarget[i]==-1 && valveAngle[i]==10);
            idleLoopUntil(simulatedMs+1);
            assert(servoPulseTicks[i]==0);
            receive("SET LVANGLE "+id+" 80");
            receive("EMERGENCY STOP");
            assert(!controlArmed && servoPulseTicks[i]==0);
            reject("ARM"); reject("SET LVANGLE "+id+" 10");
            receive("RESET FAULT");
            assert(!controlArmed && !valveSynced[i] && servoPulseTicks[i]==0);
        }
        std::cout << "PASS: direct targets, absolute limits, ACK/readback, SYNC, STOP and E-stop for four LV\n";
    } else if (!strcmp(argv[1],"four_servos")) {
        receive("ARM");
        for (int i=0;i<4;++i) {
            assert(valveConfigs[i].lv==i+1 && valveConfigs[i].pin==36+i);
            assert(servoPulseTicks[i]==0 && simulatedPins[36+i]==LOW);
            Serial.tx.str("");
            std::string cmd="SET LVANGLE "+std::to_string(i+1)+" 50\n";
            for(char c:cmd) Serial.rx.push_back(c);
            loop(); assert(Serial.tx.str().find("VALVE_NOT_SYNCED")!=std::string::npos);
            receive("SET LVSYNC "+std::to_string(i+1)+" 40");
            assert(servoPulseTicks[i]==0);
            receive("SET LVANGLE "+std::to_string(i+1)+" 50");
            assert(valveAngle[i]==50 && servoPulseTicks[i]==2554);
        }
        idleLoopUntil(300);
        unsigned frame=0;
        for(int phase=0;phase<5;++phase) {
            TIMER5_COMPA_vect(); frame+=OCR5A+1;
            for(int i=0;i<4;++i) assert(simulatedPins[36+i]==(phase==i?HIGH:LOW));
        }
        assert(frame==40000);
        for(int i=0;i<4;++i) assert(valveAngle[i]==50 && servoPulseTicks[i]==2554);
        receive("DISARM"); receive("ARM"); idleLoopUntil(900);
        for(int i=0;i<4;++i) assert(servoPulseTicks[i]==0 && valveTarget[i]==-1);
        for(int i=0;i<4;++i) receive("SET LVANGLE "+std::to_string(i+1)+" 50");
        idleLoopUntil(1200);
        for(int i=0;i<4;++i) assert(servoPulseTicks[i]>0);
        idleLoopUntil(5901);
        assert(!controlArmed && !strcmp(controlFault,"WATCHDOG"));
        for(int i=0;i<4;++i) assert(servoPulseTicks[i]==0 && valveTarget[i]==-1 && simulatedPins[36+i]==LOW);
        std::cout << "PASS: four LV channels, SYNC, Timer5, DISARM and watchdog\n";
    } else if (!strcmp(argv[1],"get_watchdog")) {
        pumpConfigs[0].forward=1;
        receive("@1 ARM"); receive("@2 SET BOMBA 1 64");
        const unsigned long lastHeartbeat=heartbeatAt;
        for (unsigned dt=1000;dt<=5000;dt+=1000) {
            simulatedMs=lastHeartbeat+dt;
            receive("@3 GET CONTROL");
            receive("@4 GET SAFETY");
            receive("@5 GET PRESSAO 1");
            assert(heartbeatAt==lastHeartbeat);
        }
        assert(!pumpsActive() && !controlArmed);
        assert(!strcmp(controlFault,"WATCHDOG"));
        std::cout << "PASS: GET does not renew heartbeat\n";
    } else if (!strcmp(argv[1],"pinmap")) {
        receive("@7 GET PINMAP");
        assert(Serial.tx.str()=="@7 OK,A0:PRESSAO1,A1:PRESSAO2,A2:PRESSAO3,A3:PRESSAO4,A4:PRESSAO5,A5:PRESSAO6,30:VAZAO1,31:VAZAO2,32:VAZAO3,33:VAZAO4,34:VAZAO5,35:VAZAO6,9:BOMBA1,10:BOMBA1,7:BOMBA2,8:BOMBA2,5:BOMBA3,6:BOMBA3,36:VALVULA1,26:RELE1,37:VALVULA2,27:RELE2,38:VALVULA3,28:RELE3,39:VALVULA4,29:RELE4\n");
        // Prova que a consulta lê os arrays, sem copiar números para o parser.
        pumpConfigs[0].rpwm=40; pumpConfigs[0].lpwm=41;
        valveConfigs[0].pin=42; relayConfigs[0].pin=43;
        receive("@8 GET PINMAP");
        assert(Serial.tx.str().find(",40:BOMBA1,41:BOMBA1,")!=std::string::npos);
        assert(Serial.tx.str().find(",42:VALVULA1,43:RELE1,")!=std::string::npos);
        std::cout << "PASS: PINMAP unchanged and sourced from configs\n";
    } else return 2;
}
