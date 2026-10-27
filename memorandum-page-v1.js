/* One fitted A4 renderer shared by live preview, print and JPEG export. */
'use strict';
(() => {
const W=794,H=1123,M=57,R=W-M,CONTENT=W-2*M,cache=new Map();
function image(src){if(!src)return Promise.resolve(null);if(!cache.has(src))cache.set(src,new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=src;}));return cache.get(src);}
function wrap(ctx,text,width){
 const lines=[];for(const raw of String(text||'').split('\n')){if(!raw.trim()){lines.push('');continue;}let line='';for(const word of raw.trim().split(/\s+/)){const test=line?line+' '+word:word;if(ctx.measureText(test).width<=width){line=test;continue;}if(line){lines.push(line);line='';}if(ctx.measureText(word).width<=width){line=word;continue;}for(const char of word){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}}if(line)lines.push(line);}return lines;
}
function layout(ctx,d,font,leading,hasSignature){
 const ops=[];let y=182;const set=(size,bold=false)=>{ctx.font=(bold?'700 ':'400 ')+size+'px Arial, sans-serif';};
 const text=(txt,x,top,size,bold=false,color='#202833')=>ops.push({type:'text',txt,x,y:top,size,bold,color});
 const metaFont=Math.max(font,10);
 for(const [label,value] of [['TO',d.to],['FROM',d.from],['SUBJECT',d.subject],['EFFECTIVITY',d.effectivity],['BRANCH',d.branch]]){if(!String(value||'').trim())continue;set(metaFont,label==='SUBJECT');const lines=wrap(ctx,value,CONTENT-94);text(label,M,y,Math.min(metaFont,12),true,'#17344b');for(const line of lines){text(line,M+94,y,metaFont,label==='SUBJECT');y+=metaFont*1.24;}y+=4;}
 ops.push({type:'line',x:M,y:y+4,right:R,color:'#dce1e6'});y+=23;
 for(const raw of String(d.body||'').replace(/\r/g,'').split('\n')){
  if(!raw.trim()){y+=font*.55;continue;}
  const bold=raw.length<110&&/[A-Z]/.test(raw)&&raw===raw.toUpperCase();set(font,bold);const lines=wrap(ctx,raw,CONTENT);
  for(const line of lines){text(line,M,y,font,bold);y+=font*leading;}
 }
 y+=18;
 if(hasSignature){ops.push({type:'signature',x:M,y});y+=49;}
 set(font,true);for(const line of wrap(ctx,d.signatory||'',CONTENT)){text(line,M,y,font,true,'#17344b');y+=font*1.22;}
 set(font);for(const line of wrap(ctx,d.position||'',CONTENT)){text(line,M,y,font);y+=font*1.22;}
 return {ops,bottom:y};
}
function drawImageContain(ctx,img,x,y,w,h){const ratio=Math.min(w/img.naturalWidth,h/img.naturalHeight);ctx.drawImage(img,x,y,img.naturalWidth*ratio,img.naturalHeight*ratio);}
let generation=0;
async function paint(canvas,d){
 const ticket=++generation,[logo,signature]=await Promise.all([image('varda-logo.jpg'),image(d.signature)]);if(ticket!==generation)return null;
 const scale=3;canvas.width=W*scale;canvas.height=H*scale;const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,W,H);ctx.textBaseline='top';
 const preferred=['10','11','12'].includes(d.fontSize)?Number(d.fontSize)*4/3:44/3, leading=['1.25','1.4','1.6'].includes(d.lineHeight)?Number(d.lineHeight):1.4;
 let font=preferred,plan=layout(ctx,d,font,leading,!!signature);
 while(plan.bottom>H-66&&font>2){font=Math.max(2,font-.15);plan=layout(ctx,d,font,leading,!!signature);}
 if(plan.bottom>H-66)throw new Error('This memo is too long for one page. Shorten the message before exporting.');
 if(logo)drawImageContain(ctx,logo,M,48,76,76);
 ctx.fillStyle='#741d2a';ctx.font='700 22px Arial, sans-serif';ctx.fillText('VARDA GROUP',M+96,52);
 ctx.fillStyle='#17344b';ctx.font='9px Arial, sans-serif';ctx.fillText('NATIONAL RETAIL OPERATIONS',M+97,80);
 ctx.font='700 24px Arial, sans-serif';ctx.fillText('MEMORANDUM',M+96,99);
 ctx.strokeStyle='#c6a343';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(M,139);ctx.lineTo(R,139);ctx.stroke();
 ctx.fillStyle='#17344b';ctx.font='700 12px Arial, sans-serif';ctx.fillText(d.number||'MEMO NO. - DRAFT',M,155);
 ctx.font='12px Arial, sans-serif';const date=/^\d{4}-\d{2}-\d{2}$/.test(d.date)?new Date(d.date+'T12:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}):'';ctx.fillText(date,R-ctx.measureText(date).width,155);
 for(const op of plan.ops){if(op.type==='text'){ctx.fillStyle=op.color;ctx.font=(op.bold?'700 ':'400 ')+op.size+'px Arial, sans-serif';ctx.fillText(op.txt,op.x,op.y);}else if(op.type==='line'){ctx.strokeStyle=op.color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(op.x,op.y);ctx.lineTo(op.right,op.y);ctx.stroke();}else if(op.type==='signature'&&signature)drawImageContain(ctx,signature,op.x,op.y,160,45);}
 ctx.strokeStyle='#dce1e6';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(M,H-51);ctx.lineTo(R,H-51);ctx.stroke();ctx.fillStyle='#697687';ctx.font='8px Arial, sans-serif';ctx.fillText('VARDA GROUP · INTERNAL MEMORANDUM',M,H-38);ctx.fillText('1 / 1',R-20,H-38);
 canvas.setAttribute('aria-label','One A4 page: '+(d.number||'Draft')+' - '+(d.subject||'Memorandum'));
 canvas.dataset.fontPoints=(font*.75).toFixed(1);canvas.dataset.contentBottom=String(plan.bottom);canvas.dataset.pageHeight=String(H);
 return {fontPoints:font*.75,fitted:font<preferred-.1};
}
window.VGMemoPage={paint};
})();
