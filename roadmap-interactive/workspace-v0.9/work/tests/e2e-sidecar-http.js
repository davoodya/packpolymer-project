const puppeteer=require('puppeteer');
(async()=>{
  const srv=require('child_process').spawn('python3',['-m','http.server','8899','--bind','127.0.0.1','-d','/home/user'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,900));
  const b=await puppeteer.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  p.on('dialog',async d=>{await d.accept();});
  await p.setViewport({width:1500,height:950});
  await p.goto('http://127.0.0.1:8899/packpolymer-marketplace-roadmap.html',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,1800));
  const R=await p.evaluate(()=>({
    done:document.querySelector('[data-stat="done"]').textContent,
    notes:document.querySelector('[data-stat="notes"]').textContent,
    nbLen:document.querySelector('#nbEdit').value.length,
    nbText:document.querySelector('#nbEdit').value.slice(0,20),
    toast:document.querySelector('#toast').textContent.slice(0,60),
    storeLabel:document.querySelector('[data-store-label]').textContent.trim().slice(0,60),
    hasConnectBtn:!!document.querySelector('[data-act="file-connect"]'),
    savedAt:(JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')||'{}').savedAt||'')
  }));
  console.log('SIDECAR AUTO-LOAD:',JSON.stringify(R,null,1));
  console.log('errors:',errs.length);
  srv.kill(); await b.close();
})();
