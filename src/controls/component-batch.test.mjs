import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('./component-batch.js', import.meta.url), 'utf8');
const {ComponentBatch} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const items = ['JIC1','LV1','OY1'].map((id,i)=>({id,value:i+1}));
function setup() {
    const batch = new ComponentBatch(), sent = [];
    const env = {context:'MODELICA/manual/cenario',ready:true,revision:1,now:0,error:null,
        validate:()=>'',confirmed:()=>null,send:item=>{sent.push(item.id);return true;}};
    batch.start(items, env.context, 0);
    return {batch,env,sent};
}
test('lote valida todos os itens antes de enviar',()=>{
    const batch = new ComponentBatch();
    assert.equal(batch.start([...items,{id:'LV2',error:'Fora da faixa'}],'x',0),false);
    assert.equal(batch.active,false); assert.match(batch.message,/LV2/);
});
test('envio sequencial aguarda readback novo; send não confirma',()=>{
    const {batch,env,sent}=setup();
    batch.tick(env); batch.tick(env);
    assert.deepEqual(sent,['JIC1']); assert.equal(batch.items[0].status,'Aguardando readback');
    env.confirmed=i=>i.value; batch.tick(env);
    assert.equal(batch.index,0);
    for(let i=0;i<3;i++) { env.revision++; batch.tick(env); batch.tick(env); }
    assert.deepEqual(sent,['JIC1','LV1','OY1']);
    assert.ok(batch.items.every(i=>i.status==='Confirmado')); assert.equal(batch.active,false);
});
test('confirmação parcial e desconexão preservam restante sem envio',()=>{
    const {batch,env,sent}=setup(); batch.tick(env);
    env.revision++;env.confirmed=i=>i.value;batch.tick(env);
    env.ready=false;batch.tick(env);
    assert.deepEqual(sent,['JIC1']); assert.equal(batch.items[0].status,'Confirmado');
    assert.equal(batch.items[1].status,'Pendente'); assert.equal(batch.active,false);
});
test('mudança de fonte/cenário/autoridade, erro e timeout interrompem',()=>{
    for(const change of [{context:'HARDWARE'},{context:'outro cenário'},{context:'AUTO'},{error:'Rejeitado'},{now:8001}]) {
        const {batch,env,sent}=setup();batch.tick(env);Object.assign(env,change);batch.tick(env);
        assert.equal(batch.active,false); assert.deepEqual(sent,['JIC1']);
        assert.equal(batch.items[0].status,'Sem confirmação');
    }
});
test('revalida permissões entre comandos e não envia item bloqueado',()=>{
    const {batch,env,sent}=setup();batch.tick(env);
    env.revision++;env.confirmed=i=>i.value;batch.tick(env);
    env.validate=()=> 'Bloqueado';batch.tick(env);
    assert.deepEqual(sent,['JIC1']);assert.match(batch.message,/LV1: Bloqueado/);
});
