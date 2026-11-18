import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./operation-draft.js',import.meta.url),'utf8');
const {Draft}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('editar, receber snapshot e descartar não enviam; somente Aplicar envia',()=>{
    const draft=new Draft(), sent=[];
    draft.receive(20); draft.edit(150); draft.receive(25);
    assert.equal(draft.value,150); assert.equal(draft.confirmed,25); assert.deepEqual(sent,[]);
    draft.apply(value=>sent.push(value));
    assert.deepEqual(sent,[150]); assert.equal(draft.confirmed,25);
    draft.discard(); assert.equal(draft.value,25); assert.equal(draft.dirty,false);
});
