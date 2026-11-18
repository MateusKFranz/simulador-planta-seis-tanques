export function editorPosition(anchor, size, viewport) {
    const margin = 8, gap = 14;
    const right = anchor ? anchor.right + gap : viewport.width - size.width - margin;
    const left = anchor ? anchor.left - size.width - gap : right;
    return {
        x: Math.max(margin, Math.min(right + size.width <= viewport.width - margin ? right : left, viewport.width - size.width - margin)),
        y: Math.max(margin, Math.min(anchor ? anchor.top + (anchor.height - size.height) / 2 : 80, viewport.height - size.height - margin))
    };
}

export function setupFloatingEditor(editor) {
    const header = editor.querySelector('header');
    header.title = 'Arraste para mover';
    const viewport = () => ({width:window.innerWidth, height:window.innerHeight});
    function clamp() {
        if (editor.hidden) return;
        const {width,height} = viewport();
        editor.style.maxWidth = Math.max(0,width-16)+'px';
        editor.style.maxHeight = Math.max(0,height-16)+'px';
        const rect = editor.getBoundingClientRect();
        editor.style.left = Math.max(8,Math.min(rect.left,width-rect.width-8))+'px';
        editor.style.top = Math.max(8,Math.min(rect.top,height-rect.height-8))+'px';
    }
    function open(anchor) {
        editor.style.width = ''; editor.style.height = '';
        editor.style.right = 'auto'; editor.style.left = '8px'; editor.style.top = '8px';
        clamp();
        const position = editorPosition(anchor,editor.getBoundingClientRect(),viewport());
        editor.style.left = position.x+'px'; editor.style.top = position.y+'px';
    }
    let gesture = null;
    header.addEventListener('pointerdown',event=>{
        if (event.button !== 0 || event.target.closest('button,input,select')) return;
        event.preventDefault(); event.stopPropagation();
        gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,rect:editor.getBoundingClientRect()};
        header.setPointerCapture(event.pointerId);
    });
    header.addEventListener('pointermove',event=>{
        if (!gesture || event.pointerId !== gesture.id) return;
        editor.style.left = gesture.rect.left + event.clientX - gesture.x + 'px';
        editor.style.top = gesture.rect.top + event.clientY - gesture.y + 'px';
        clamp();
    });
    const stop=event=>{
        if (gesture?.id !== event.pointerId) return;
        gesture=null;
        if(header.hasPointerCapture(event.pointerId))header.releasePointerCapture(event.pointerId);
    };
    for(const name of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(name,stop);
    // Reposiciona tambem quando os controles alteram a altura do conteudo.
    new ResizeObserver(clamp).observe(editor);
    window.addEventListener('resize',clamp);
    return {open};
}
