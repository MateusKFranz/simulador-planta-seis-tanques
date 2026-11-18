import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./floating-editor.js',import.meta.url),'utf8');
const {editorPosition,setupFloatingEditor}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('editor prefere direita ou esquerda e respeita telas menores',()=>{
    const size={width:240,height:300},viewport={width:1000,height:700};
    assert.equal(editorPosition({left:100,right:150,top:200,height:40},size,viewport).x,164);
    assert.equal(editorPosition({left:850,right:900,top:200,height:40},size,viewport).x,596);
    for(const anchor of [null,{left:0,right:40,top:0,height:20},{left:280,right:320,top:470,height:30}]) {
        const p=editorPosition(anchor,size,{width:320,height:500});
        assert.ok(p.x>=8 && p.x+size.width<=312);assert.ok(p.y>=8 && p.y+size.height<=492);
    }
});

test('cabeçalho move sem alterar tamanho; reabrir limpa dimensões antigas',t=>{
    const savedWindow=globalThis.window, savedObserver=globalThis.ResizeObserver;
    t.after(()=>{globalThis.window=savedWindow;globalThis.ResizeObserver=savedObserver;});
    const events={},windowEvents={};let observed;
    globalThis.window={innerWidth:600,innerHeight:400,addEventListener:(name,fn)=>windowEvents[name]=fn};
    globalThis.ResizeObserver=class {constructor(fn){observed=fn;}observe(){}};
    const header={addEventListener:(name,fn)=>events[name]=fn,setPointerCapture(){},hasPointerCapture:()=>false};
    const editor={hidden:false,style:{width:'900px',height:'900px'},querySelector:()=>header,
        getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:280,height:200};}};
    const layout=setupFloatingEditor(editor);
    layout.open({left:10,right:30,top:10,height:20});
    const rect=editor.getBoundingClientRect();
    const event={button:0,pointerId:1,clientX:50,clientY:50,target:{closest:()=>null},preventDefault(){},stopPropagation(){}};
    events.pointerdown(event);events.pointermove({...event,clientX:70,clientY:70});
    assert.equal(editor.getBoundingClientRect().left,rect.left+20);
    assert.equal(editor.style.width,'');assert.equal(editor.style.height,'');
    events.pointerup(event);
    assert.equal(events.keydown,undefined);
    window.innerWidth=320;window.innerHeight=240;windowEvents.resize();observed();
    assert.ok(parseFloat(editor.style.left)+280<=312);
    assert.ok(parseFloat(editor.style.top)+200<=232);
    layout.open({left:290,right:310,top:220,height:20});
    assert.equal(editor.style.width,'');assert.equal(editor.style.height,'');
});
