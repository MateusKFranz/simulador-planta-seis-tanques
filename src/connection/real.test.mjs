import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Carrega os módulos ESM do frontend sem navegador ou conexão de rede.
function moduleUrl(url) {
    const source = readFileSync(url, 'utf8').replace(/from '(\.\.?\/[^']+)'/g,
        (_, path) => `from '${moduleUrl(new URL(path, url))}'`);
    return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

test('hello imediato, separação MODELICA/HARDWARE e sintonia sem type', async t => {
    const previousSocket = globalThis.WebSocket;
    const previousInterval = globalThis.setInterval;
    let socket;
    class Socket {
        static OPEN = 1;
        static CONNECTING = 0;
        readyState = 0;
        listeners = {};
        sent = [];
        constructor() { socket = this; }
        addEventListener(name, fn) { this.listeners[name] = fn; }
        send(data) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(data)); }
    }
    globalThis.WebSocket = Socket;
    globalThis.setInterval = () => 0;
    t.after(() => { globalThis.WebSocket = previousSocket; globalThis.setInterval = previousInterval; });
    const real = await import(moduleUrl(new URL('./real.js', import.meta.url)));
    for (const mode of ['MODELICA', 'HARDWARE']) {
        real.selectBackendMode(mode);
        await real.connectRealPlant('ws://localhost:1');
        assert.deepEqual(socket.sent, []);
        assert.equal(real.sendSimulationCommand({ running: true }), false);
        socket.readyState = Socket.OPEN;
        socket.listeners.open();
        assert.equal(socket.sent[0].type, 'hello');
        assert.equal(real.realRuntime.backendMode, null);
        assert.equal(real.sendSimulationCommand({ running: true }), false);
        assert.equal(real.sendHardwareCommand('arm'), false);
        real.realRuntime.backendMode = mode;
        assert.equal(real.canSendModelicaCommand(), false);
        real.applyRealData({ mode, sim: { running: false, t: 0 } });
        if (mode === 'MODELICA') {
            real.applyRealData({mode,sim:{running:false,t:0},operation:{mode:'MANUAL'},
                manualValves:Object.fromEntries([1,2,3,4,5,6].map(i=>[`HV${i}`,{opening:.4}])),
                recycleValves:{HV7:{opening:.4},HV8:{opening:.4}},mainValve:{opening:.4}});
            for(let i=1;i<=9;i++) {
                const id=`HV${i}`;
                assert.equal(real.applyManualActuator(id,55),true);
                assert.deepEqual(socket.sent.at(-1),{type:i===9?'valve':'manual_valve',id,opening:.55});
            }
            assert.equal(real.applyManualActuator('HV1',101),false);
            assert.equal(real.applyManualActuator('HV1',50,'angle'),false);
            const loopIds = ['LIC1','LIC2','LIC3','LIC4','FIC1','FIC2','FIC3'];
            real.applyRealData({mode, sim:{running:false,t:0},
                levelSensors: {LI3:{heightCm:13,status:'available'},LI4:{heightCm:14,status:'available'}},
                loops:Object.fromEntries(loopIds.map(id=>[id,{mode:'MAN'}]))});
            assert.deepEqual(real.realPlant.levelSensors.map(s=>s.id), ['LI1','LI2','LI3','LI4','LI5','LI6']);
            assert.equal(real.realPlant.levelSensors.find(s=>s.id==='LI3').heightCm,13);
            assert.equal(real.realPlant.levelSensors.find(s=>s.id==='LI4').heightCm,14);
            for (const id of loopIds) {
                assert.equal(real.sendLoopCommand(id,{sp:10,mode:'MAN'}),true);
                assert.equal(socket.sent.at(-1).id,id);
            }
            assert.equal(real.sendSimulationCommand({ running: true }), true);
            assert.equal(real.sendHardwareCommand('arm'), false);
            assert.equal(real.sendLoopCommand('LIC3', { tuning: { type: 'PI' } }), false);
            const tuning = { kp: 1, ti: 2, td: 3, b: 1, c: 1, n: 10, ftt: 1, u_bias: 0, u_min: 0, u_max: 1 };
            assert.equal(real.sendLoopCommand('LIC3', { tuning: { ...tuning, type: 'PI' } }), true);
            assert.deepEqual(socket.sent.at(-1).tuning, tuning);
        } else {
            const before=socket.sent.length;
            for(let i=1;i<=9;i++) {
                assert.equal(real.applyManualActuator(`HV${i}`,50),true);
                assert.equal(socket.sent.at(-1).type,'manual_position');
            }
            assert.equal(socket.sent.length,before+9);
            const annotation = socket.sent.at(-1);
            socket.listeners.message({data:JSON.stringify({...annotation,type:'manual_position_result',requestId:'wrong',success:true})});
            assert.equal(real.manualPositionResult('HV9').pending,true);
            socket.listeners.message({data:JSON.stringify({...annotation,type:'manual_position_result',success:true})});
            assert.equal(real.manualPositionResult('HV9').success,true);
            assert.equal(real.realPlant.mainValve.opening,null);
            for (const value of [NaN,Infinity,-1,101]) assert.equal(real.applyManualActuator('HV1',value),false);
            real.realRuntime.lastUpdate = Date.now();
            const control = { supported: true, ready: true, armed: false, busy: false };
            real.realRuntime.hardware = { serial: { connected: true }, control };
            assert.equal(real.sendHardwareCommand('pump', { id: 'JIC1', percent: 25 }), false);
            assert.equal(real.sendSimulationCommand({ running: true }), false);
            assert.equal(real.sendHardwareCommand('relay_test', { id: 1, level: 1 }), false);
            assert.equal(real.sendHardwareCommand('relay_end'), false);
            assert.equal(real.sendHardwareCommand('estop'), true);
            assert.equal(socket.sent.at(-1).action, 'estop');
            assert.equal(socket.sent.at(-1).type, 'hardware');
            const sensor = real.realPlant.levelSensors.find(s => s.id === 'LI1');
            Object.assign(sensor, { status: 'available', heightCm: 10,
                diagnostics: { rawMean50: 100, rawMeanCount: 50, valid: true, stale: false } });
            const result = real.sendLevelZeroCommand('calibrate', 'LI1', 100);
            const request = socket.sent.at(-1);
            assert.equal(request.type, 'level_zero');
            assert.equal(request.rawMean50, 100);
            assert.equal(sensor.heightCm, 10);
            socket.listeners.message({ data: JSON.stringify({ type: 'level_zero_result', requestId: request.requestId, id: 'LI1', success: true, message: 'Salvo' }) });
            assert.equal((await result).message, 'Salvo');
            assert.equal(sensor.heightCm, 10);
        }
        socket.readyState = 3;
        socket.listeners.close({ code: 1000 });
        assert.equal(real.sendHardwareCommand('arm'), false);
        assert.equal(real.hardwareCommandPending(), false);
    }
});


test('MODELICA reconecta com backoff, ignora sockets antigos e respeita desconexão manual/HARDWARE', async t => {
    const saved = { WebSocket: globalThis.WebSocket, setTimeout, clearTimeout, setInterval };
    const sockets = [], timers = new Map(); let timerId = 0;
    class Socket {
        static OPEN=1; static CONNECTING=0;
        readyState=0; listeners={}; sent=[];
        constructor(url) { this.url=url; sockets.push(this); }
        addEventListener(name,fn) { this.listeners[name]=fn; }
        send(raw) { this.sent.push(JSON.parse(raw)); }
        close() { this.readyState=3; this.listeners.close({code:1000}); }
        open() { this.readyState=1; this.listeners.open(); }
        fail() { this.listeners.error(); this.readyState=3; this.listeners.close({code:1006}); }
        snapshot(data) { this.listeners.message({data:JSON.stringify({type:'state',data})}); }
    }
    Object.assign(globalThis,{WebSocket:Socket,setInterval:()=>0,
        setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
    t.after(()=>Object.assign(globalThis,saved));
    const real=await import(moduleUrl(new URL('./real.js',import.meta.url))+'#reconnect');
    const advance=async expected=>{
        assert.equal(timers.size,1);
        const [id,{fn,ms}]=[...timers][0];assert.equal(ms,expected);timers.delete(id);fn();
    };
    await real.connectRealPlant('ws://localhost:8876');
    for(const delay of [500,1000,2000,3000,3000]) {
        sockets.at(-1).fail();
        assert.equal(real.realRuntime.connectionLabel,'Aguardando backend...');
        await advance(delay);
        assert.equal(sockets.at(-1).url,'ws://localhost:8876');
    }
    const current=sockets.at(-1),old=sockets[0];current.open();
    assert.equal(real.canSendModelicaCommand(),false);
    current.snapshot({mode:'MODELICA',sim:{running:false,t:0}});
    assert.equal(real.canSendModelicaCommand(),true);
    assert.equal(real.realRuntime.sim.running,false);
    old.listeners.close({code:1006});old.snapshot({mode:'HARDWARE'});old.listeners.open();old.listeners.error();
    assert.equal(real.realRuntime.backendMode,'MODELICA');assert.equal(real.realRuntime.connected,true);
    assert.equal(timers.size,0);
    current.fail();await advance(500);sockets.at(-1).open();
    sockets.at(-1).snapshot({mode:'MOCK',sim:{running:false,t:0}});
    assert.equal(real.canSendModelicaCommand(),false);assert.match(real.realRuntime.lastError,/MOCK/);
    sockets.at(-1).snapshot({mode:'MODELICA',sim:{running:false,t:0}});
    assert.equal(real.canSendModelicaCommand(),true);
    await real.disconnectRealPlant();assert.equal(timers.size,0);
    await real.connectRealPlant();sockets.at(-1).fail();
    real.selectBackendMode('HARDWARE');assert.equal(timers.size,0);
    await real.connectRealPlant();sockets.at(-1).fail();assert.equal(timers.size,0);
    real.selectBackendMode('MODELICA');await real.connectRealPlant();sockets.at(-1).fail();assert.equal(timers.size,1);
    await real.disconnectRealPlant();assert.equal(timers.size,0);
    assert.ok(sockets.every(socket=>socket.sent.every(message=>message.type==='hello')));
});
