const puppeteer=require('puppeteer');
const U='file:///home/user/packpolymer-marketplace-roadmap.html';
(async()=>{
  const b=await puppeteer.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text().slice(0,100));});
  p.on('dialog',async d=>{await d.accept();});
  const R={};
  await p.setViewport({width:1500,height:950});
  await p.goto(U,{waitUntil:'load'}); await new Promise(r=>setTimeout(r,900));
  R.counts=await p.evaluate(()=>({phases:document.querySelectorAll('.phase').length,steps:document.querySelectorAll('.step').length,subs:document.querySelectorAll('.sub').length}));
  R.sideScroll=await p.evaluate(()=>{const s=document.querySelector('.side'),n=document.querySelector('.navlist');
     s.scrollTop=120;n.scrollTop=90;const r={side:s.scrollTop,nav:n.scrollTop};s.scrollTop=0;n.scrollTop=0;return r;});
  R.tick=await p.evaluate(()=>{document.querySelector('.step .st-head input[data-ck]').click();return document.querySelector('[data-stat="done"]').textContent;});
  R.edit=await p.evaluate(()=>{document.querySelector('[data-act="edit-mode"]').click();
     const t=document.querySelector('.step .st-title');t.innerText='عنوان تست نهایی';t.blur();
     document.querySelector('[data-act="edit-mode"]').click();
     return document.querySelector('.step .st-title').innerText;});
  R.search_en=await p.evaluate(async()=>{const i=document.querySelector('#q');i.value='фаз'.replace('фаз','فاز')+' 3';i.dispatchEvent(new Event('input',{bubbles:true}));
     await new Promise(r=>setTimeout(r,500));const n=document.querySelectorAll('.step').length;i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));return n;});
  await new Promise(r=>setTimeout(r,500));
  // print/pdf
  await p.pdf({path:'final-print.pdf',format:'A4',printBackground:false,margin:{top:'10mm',bottom:'10mm',left:'8mm',right:'8mm'}});
  R.pdf=require('fs').statSync('final-print.pdf').size;
  // overflow mobile
  await p.setViewport({width:414,height:900}); await new Promise(r=>setTimeout(r,400));
  R.overflow=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
  // sandbox iframe simulation (localStorage blocked)
  R.errs=errs.slice(0,5);
  console.log(JSON.stringify(R,null,1));
  await b.close();
})();
