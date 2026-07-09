// Injected into every doc-gen artifact iframe so the model can produce a REAL,
// directly-downloadable Chinese PDF client-side (like Excel/Word) — no print
// dialog, no server, no security compromise.
//
// Why this exists: html2canvas (image PDFs) needs allow-same-origin, which the
// artifact sandbox forbids (enabling it would let generated JS steal the login
// session). Vector PDFs need an embedded CJK font. pdf-lib SUBSETS the font, so
// only the glyphs actually used are embedded → a 5-row table is ~18KB, not MBs.
//
// The font MUST be a static TrueType-glyf CJK font: pdf-lib's CFF and variable-
// font subsetting drop glyphs (verified — most characters vanished). WenQuanYi
// Micro Hei (static glyf, 4.1MB, pinned commit, browser-cached after first use)
// subsets cleanly and renders every glyph.
//
// Exposes window.kyberBuildPdf(spec) -> Promise<Blob(application/pdf)>, where
//   spec = { title?, subtitle?, blocks: [
//     { type:'heading',   text },
//     { type:'paragraph', text },
//     { type:'table', headers:[...], rows:[[...],[...]] } ] }
// The doc-gen skill builds a spec and pipes the Blob into kyberSend() so the
// persistent in-chat Download button appears.
export const KYBER_PDF_HELPER = `(function(){
  if (window.kyberBuildPdf) return;
  var PDFLIB_URL='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  var FONTKIT_URL='https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
  var FONT_URL='https://cdn.jsdelivr.net/gh/layerssss/wqy@c808324d36e9836bb4c9052e27e7db99633673ff/fonts/WenQuanYiMicroHei.ttf';
  var _p=null;
  function _load(src){return new Promise(function(res,rej){var s=document.createElement('script');s.src=src;s.onload=function(){res();};s.onerror=function(){rej(new Error('load '+src));};document.head.appendChild(s);});}
  function _ensure(){
    if(_p) return _p;
    _p=(async function(){
      if(!window.PDFLib) await _load(PDFLIB_URL);
      if(!window.fontkit) await _load(FONTKIT_URL);
      var r=await fetch(FONT_URL); if(!r.ok) throw new Error('font '+r.status);
      var fb=await r.arrayBuffer();
      return {PDFLib:window.PDFLib, fontkit:window.fontkit, fontBytes:fb};
    })();
    return _p;
  }
  async function _layout(PDFLib, fontkit, fontBytes, spec){
    var PDFDocument=PDFLib.PDFDocument, rgb=PDFLib.rgb;
    var pdf=await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    var font=await pdf.embedFont(fontBytes,{subset:true});
    var PW=595.28, PH=841.89, M=42, CW=PW-M*2;
    var page=pdf.addPage([PW,PH]), y=PH-M;
    var ink=rgb(0.13,0.13,0.15), line=rgb(0.8,0.82,0.86), head=rgb(0.94,0.96,0.99), sub=rgb(0.4,0.42,0.46);
    function newPage(){ page=pdf.addPage([PW,PH]); y=PH-M; }
    function need(h){ if(y-h<M) newPage(); }
    function wrap(text,size,maxW){
      var s=(text==null?'':String(text)); var out=[]; var cur='';
      for(var i=0;i<s.length;i++){ var ch=s[i];
        if(ch==='\\n'){ out.push(cur); cur=''; continue; }
        var t=cur+ch;
        if(font.widthOfTextAtSize(t,size)>maxW && cur){ out.push(cur); cur=ch; } else { cur=t; }
      }
      out.push(cur); return out.length?out:[''];
    }
    function drawLines(lines,x,size,lh,color){ for(var i=0;i<lines.length;i++){ need(lh); page.drawText(lines[i],{x:x,y:y-size,size:size,font:font,color:color||ink}); y-=lh; } }
    if(spec.title) drawLines(wrap(spec.title,20,CW),M,20,28);
    if(spec.subtitle){ drawLines(wrap(spec.subtitle,11,CW),M,11,18,sub); y-=4; }
    var blocks=spec.blocks||[];
    for(var b=0;b<blocks.length;b++){
      var blk=blocks[b];
      if(blk.type==='heading'){ y-=6; drawLines(wrap(blk.text,15,CW),M,15,22); }
      else if(blk.type==='paragraph'){ drawLines(wrap(blk.text,11,CW),M,11,17); y-=4; }
      else if(blk.type==='table'){
        var headers=blk.headers||[], rows=blk.rows||[];
        var ncol=headers.length; for(var r0=0;r0<rows.length;r0++) ncol=Math.max(ncol, rows[r0].length); ncol=Math.max(ncol,1);
        var colW=CW/ncol, pad=5, size=10, lh=14;
        function drawRow(cells,isHead){
          var wrapped=[], maxLines=1;
          for(var c=0;c<ncol;c++){ var w=wrap(cells[c]==null?'':cells[c],size,colW-pad*2); wrapped.push(w); if(w.length>maxLines) maxLines=w.length; }
          var rowH=maxLines*lh+pad*2; need(rowH); var top=y;
          if(isHead) page.drawRectangle({x:M,y:top-rowH,width:CW,height:rowH,color:head});
          for(var c2=0;c2<=ncol;c2++) page.drawLine({start:{x:M+c2*colW,y:top},end:{x:M+c2*colW,y:top-rowH},thickness:0.5,color:line});
          page.drawLine({start:{x:M,y:top},end:{x:M+CW,y:top},thickness:0.5,color:line});
          page.drawLine({start:{x:M,y:top-rowH},end:{x:M+CW,y:top-rowH},thickness:0.5,color:line});
          for(var c3=0;c3<ncol;c3++){ var ty=top-pad-size; var lines=wrapped[c3]; for(var li=0;li<lines.length;li++){ page.drawText(lines[li],{x:M+c3*colW+pad,y:ty,size:size,font:font,color:ink}); ty-=lh; } }
          y=top-rowH;
        }
        if(headers.length) drawRow(headers,true);
        for(var rr=0;rr<rows.length;rr++) drawRow(rows[rr],false);
        y-=8;
      }
    }
    return await pdf.save();
  }
  window.kyberBuildPdf=async function(spec){
    var L=await _ensure();
    var bytes=await _layout(L.PDFLib,L.fontkit,L.fontBytes,spec||{});
    return new Blob([bytes],{type:'application/pdf'});
  };
})();`;
