const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const BASE='/home/user';
const HTML='/packpolymer-marketplace-roadmap.html';
const PORT=8897;
const failures=[];
function check(name, ok, detail) {
  console.log(`${ok?'PASS':'FAIL'} | ${name}${detail===undefined?'':' | '+JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}
const wait=(ms=300)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
    const rel=pathname==='/'?HTML:pathname;
    const full=path.resolve(BASE,'.'+rel);
    if(!full.startsWith(BASE)){res.writeHead(403);return res.end();}
    fs.readFile(full,(err,data)=>{
      if(err){res.writeHead(404);return res.end('not found');}
      const type=full.endsWith('.json')?'application/json; charset=utf-8':full.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
    });
  });
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/scrollTo|not implemented/i.test(m.text()))errors.push(m.text());});
  await page.evaluateOnNewDocument(()=>{
    window.__copiedText='';
    try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copiedText=String(t);}}});}catch(e){}
  });
  await page.setViewport({width:1280,height:900});
  await page.goto('http://127.0.0.1:'+PORT+HTML,{waitUntil:'load',timeout:60000});
  await wait(900);

  // Dual sidebar is desktop-only, and each column has only its own responsibility.
  let layout=await page.evaluate(()=>{
    const lay=document.querySelector('.layout'),r=document.querySelector('.side-right'),l=document.querySelector('.side-left'),m=lay.querySelector('.phases');
    const rb=r.getBoundingClientRect(),lb=l.getBoundingClientRect(),mb=m.getBoundingClientRect();
    return {display:getComputedStyle(lay).display,columns:getComputedStyle(lay).gridTemplateColumns.split(' ').length,
      rightCards:r.querySelectorAll('.side-card').length,rightOnlyPhases:r.querySelectorAll('.side-card').length===1&&!!r.querySelector('.phases-card'),
      leftHasOverview:!!l.querySelector('.side-card-overview'),leftHasDeveloper:!!l.querySelector('.side-card-dev'),leftHasPhases:!!l.querySelector('.phases-card'),
      geometricOrder:rb.left>mb.left&&mb.left>lb.left,sticky:getComputedStyle(r).position,button:!!document.querySelector('#phaseFab')};
  });
  check('desktop uses three-column layout with a phase-only right rail and other cards on the left',layout.display==='grid'&&layout.columns===3&&layout.rightOnlyPhases&&layout.leftHasOverview&&layout.leftHasDeveloper&&!layout.leftHasPhases&&layout.geometricOrder&&layout.sticky==='sticky',layout);
  check('sticky phase-list access control exists',await page.evaluate(()=>getComputedStyle(document.querySelector('#phaseFab')).position==='fixed'));
  const fullPhaseTitles=await page.evaluate(()=>{
    const es=[...document.querySelectorAll('.side-right .phases-card .navitem .tt')];
    return {count:es.length,whiteSpace:es.map(x=>getComputedStyle(x).whiteSpace),textOverflow:es.map(x=>getComputedStyle(x).textOverflow),
      hasEllipsis:es.some(x=>/[…]$|\.\.\.$/.test(x.textContent.trim())),withinWidth:es.every(x=>x.scrollWidth<=x.clientWidth+1),
      wrapped:es.some(x=>x.getBoundingClientRect().height>24)};
  });
  check('right phase rail shows all 13 complete titles with wrapping instead of truncation',fullPhaseTitles.count===13&&fullPhaseTitles.whiteSpace.every(x=>x==='normal')&&fullPhaseTitles.textOverflow.every(x=>x==='clip')&&!fullPhaseTitles.hasEllipsis&&fullPhaseTitles.withinWidth&&fullPhaseTitles.wrapped,fullPhaseTitles);

  // Combined query + Review + stack + completion filter (AND across filter groups).
  await page.evaluate(()=>{
    const q=document.querySelector('#q');q.value='فاز ۳';q.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await wait(700);
  const target=await page.evaluate(()=>{
    const p=[...document.querySelectorAll('.phase')].find(x=>x.querySelector('.ph-num')?.textContent.trim()==='فاز ۳');
    const s=p?.querySelector('.step'),sub=s?.querySelector('.sub');
    return {phase:p?.id,step:s?.id,sub:sub?.id,stack:s?.querySelector('.tag.stk')?.textContent.trim()||''};
  });
  check('Phase 3 search finds a concrete Step/Sub-step target',!!target.phase&&!!target.step&&!!target.sub,target);
  await page.evaluate(id=>{
    const b=document.querySelector('[data-act="entity-menu"][data-etype="sub"][data-eid="'+id+'"]');b.click();
  },target.sub);
  await wait(120);
  await page.evaluate(()=>document.querySelector('#entityMenu [data-entact="review"]').click());
  await wait(400);
  await page.evaluate(()=>document.querySelector('.mark-chips [data-act="mark-filter"][data-id="review"]').click());
  await wait(500);
  let filtered=await page.evaluate(id=>({q:document.querySelector('#q').value,phases:[...document.querySelectorAll('.phase .ph-num')].map(x=>x.textContent.trim()),
    reviewOn:document.querySelector('.mark-chips [data-id="review"]').classList.contains('on'),sub:!!document.getElementById(id),shownSubs:[...document.querySelectorAll('.sub')].length}),target.sub);
  check('search stays active when Review filter is enabled; only the matching Phase 3 item remains',filtered.q==='فاز ۳'&&filtered.phases.length===1&&filtered.phases[0]==='فاز ۳'&&filtered.reviewOn&&filtered.sub,filtered);
  if(target.stack){
    const stackButton=await page.evaluate(st=>!!document.querySelector('.side-card-stack [data-act="stack-filter"][data-id="'+st+'"]'),target.stack);
    if(stackButton) await page.evaluate(st=>document.querySelector('.side-card-stack [data-act="stack-filter"][data-id="'+st+'"]').click(),target.stack);
    await wait(450);
    filtered=await page.evaluate(id=>({q:document.querySelector('#q').value,phaseCount:document.querySelectorAll('.phase').length,sub:!!document.getElementById(id),stack:document.querySelector('.side-card-stack .schip.on:not(.mk)')?.dataset.id||''}),target.sub);
    check('stack filter combines with the existing search and Review filter',stackButton&&filtered.q==='فاز ۳'&&filtered.phaseCount===1&&filtered.sub&&filtered.stack===target.stack,filtered);
    const visual=await page.evaluate(()=>{
      const review=document.querySelector('.tag.review-tag'),hl=document.querySelector('mark.hl-stack'),chip=document.querySelector('.side-card-stack .schip.on:not(.mk)');
      const menu=document.querySelector('.phase .ent-btn'),note=document.querySelector('.sub .note-ind');
      return {reviewColor:review?getComputedStyle(review).color:'',reviewBackground:review?getComputedStyle(review).backgroundColor:'',
        stackHighlight:hl?getComputedStyle(hl).backgroundColor:'',stackChip:chip?getComputedStyle(chip).backgroundImage:'',
        menuIsThreeDots:!!menu&&!menu.querySelector('input')&&menu.querySelector('use')?.getAttribute('href')==='#i-more',
        noteLabel:note?.querySelector('.note-label')?.textContent.trim()||''};
    });
    check('Review flags use a rose color; active Stack highlight uses indigo, not yellow',visual.reviewColor==='rgb(255, 217, 231)'&&visual.stackHighlight.includes('123, 127, 212')&&visual.stackChip.includes('123, 127, 212'),visual);
    check('operations are clearly an ellipsis menu and Sub-step note action has a readable label',visual.menuIsThreeDots&&visual.noteLabel==='یادداشت',visual);
  }
  // Mark the matched Step complete, then intersect with Done status.
  await page.evaluate(id=>document.querySelector('.step#'+CSS.escape(id)+' input[data-ck]').click(),target.step);
  await wait(250);
  await page.evaluate(()=>document.querySelector('.chips [data-act="filter"][data-id="done"]').click());
  await wait(450);
  const doneFilter=await page.evaluate(id=>({q:document.querySelector('#q').value,filterOn:document.querySelector('.chips [data-id="done"]').classList.contains('on'),
    phases:[...document.querySelectorAll('.phase .ph-num')].map(x=>x.textContent.trim()),step:!!document.getElementById(id)}),target.step);
  check('Done filter also intersects with Phase 3 search and Review/stack filters',doneFilter.q==='فاز ۳'&&doneFilter.filterOn&&doneFilter.phases.length===1&&doneFilter.phases[0]==='فاز ۳'&&doneFilter.step,doneFilter);

  // Clear filter groups before phase checkboxes.
  await page.evaluate(()=>{
    document.querySelector('.chips [data-act="filter"][data-id="all"]').click();
    document.querySelector('[data-act="mark-clear"]')?.click();
    const s=document.querySelector('.side-card-stack .schip.on:not(.mk)'); if(s)s.click();
    const q=document.querySelector('#q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await wait(700);
  await page.evaluate(()=>document.querySelector('[data-act="expand-all"]').click());
  await wait(450);
  const phaseId=await page.evaluate(()=>document.querySelector('.phase')?.id);
  await page.evaluate(id=>document.querySelector('.phase#'+CSS.escape(id)+' .ph-ck input').click(),phaseId);
  await wait(450);
  const allChecked=await page.evaluate(id=>{
    const ph=document.querySelector('.phase#'+CSS.escape(id));
    return {phase:ph.querySelector('.ph-ck input').checked,steps:[...ph.querySelectorAll('.step input[data-ck]')].every(x=>x.checked),
      subs:[...ph.querySelectorAll('.sub input[data-ck]')].every(x=>x.checked),doneClass:ph.classList.contains('done')};
  },phaseId);
  check('Phase checkbox completes every Step and Sub-step in its phase',allChecked.phase&&allChecked.steps&&allChecked.subs&&allChecked.doneClass,allChecked);
  await page.evaluate(id=>document.querySelector('.phase#'+CSS.escape(id)+' .ph-ck input').click(),phaseId);
  await wait(300);
  let cleared=await page.evaluate(id=>({phase:document.querySelector('.phase#'+CSS.escape(id)+' .ph-ck input').checked,
    descendants:[...document.querySelectorAll('.phase#'+CSS.escape(id)+' input[data-ck]')].some(x=>x.checked)}),phaseId);
  check('unchecking a Phase clears all descendant checks',!cleared.phase&&!cleared.descendants,cleared);
  const someSub=await page.evaluate(id=>!!document.querySelector('.phase#'+CSS.escape(id)+' .sub input[data-ck]'),phaseId);
  if(someSub){
    await page.evaluate(id=>document.querySelector('.phase#'+CSS.escape(id)+' .sub input[data-ck]').click(),phaseId);
    await wait(180);
    const partial=await page.evaluate(id=>({indeterminate:document.querySelector('.phase#'+CSS.escape(id)+' .ph-ck input').indeterminate,
      checked:document.querySelector('.phase#'+CSS.escape(id)+' .ph-ck input').checked}),phaseId);
    check('Phase checkbox visibly indicates partial completion',partial.indeterminate&&!partial.checked,partial);
  }

  // Desktop → tablet/mobile layout and no overflow.
  for(const w of [1280,1024,768,414]){
    await page.setViewport({width:w,height:820});await wait(250);
    const r=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,
      display:getComputedStyle(document.querySelector('.layout')).display,rightDisplay:getComputedStyle(document.querySelector('.side-right')).display,
      overviewOrder:getComputedStyle(document.querySelector('.side-card-overview')).order,phasesOrder:getComputedStyle(document.querySelector('.phases-card')).order,
      mainOrder:getComputedStyle(document.querySelector('.layout>.phases')).order}));
    const ok=r.sw<=r.cw+1&&(w>1180?(r.display==='grid'&&r.rightDisplay!=='contents'):(r.display==='flex'&&r.rightDisplay==='contents'&&Number(r.overviewOrder)<Number(r.phasesOrder)&&Number(r.phasesOrder)<Number(r.mainOrder)));
    check('responsive sidebar structure and no overflow @'+w,ok,r);
  }

  // Notebook: two notes side by side, separate Read/Edit modes, independent toolbar/actions.
  await page.setViewport({width:1280,height:900});
  await page.click('#fabNote');await wait(350);
  await page.click('.nb-listview [data-nb="new"]');await wait(180);
  await page.type('#nbTitle','یادداشت اصلی');await page.type('#nbEdit','متن اصلی برای مقایسه');await wait(350);
  await page.click('[data-nb="back-list"]');await wait(250);
  await page.click('.nb-listview [data-nb="new"]');await wait(180);
  await page.type('#nbTitle','یادداشت دوم');await page.type('#nbEdit','متن اولیه یادداشت دوم');await wait(350);
  const defaultSplit=await page.evaluate(()=>({split:document.querySelector('[data-nb-workspace]').classList.contains('split-open'),panes:document.querySelectorAll('.nb-pane:not([hidden])').length}));
  check('Notebook remains single-note by default',!defaultSplit.split&&defaultSplit.panes===1,defaultSplit);
  await page.click('[data-nb="split-toggle"]');await wait(350);
  let split=await page.evaluate(()=>({split:document.querySelector('[data-nb-workspace]').classList.contains('split-open'),
    panes:document.querySelectorAll('.nb-pane:not([hidden])').length,
    distinct:JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')).nbActiveId!==JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')).nbSecondaryId,
    columns:getComputedStyle(document.querySelector('[data-nb-workspace]')).gridTemplateColumns,
    primaryMode:document.querySelector('#nbEdit').hidden?'read':'edit',secondaryMode:document.querySelector('#nbEditSecondary').hidden?'read':'edit',
    toolbarPrimary:!!document.querySelector('[data-nb-tools="primary"]'),toolbarSecondary:!!document.querySelector('[data-nb-tools="secondary"]'),
    actionsPrimary:document.querySelectorAll('[data-nb-tools="primary"] [data-nb]').length,actionsSecondary:document.querySelectorAll('[data-nb-tools="secondary"] [data-nb]').length}));
  check('Split View shows two distinct notes with independent toolbars/actions',split.split&&split.panes===2&&split.distinct&&split.toolbarPrimary&&split.toolbarSecondary&&split.actionsPrimary>=18&&split.actionsSecondary>=18,split);
  await page.click('[data-nb="toggle-mode"][data-side="primary"]');await wait(120);
  await page.click('[data-nb="toggle-mode"][data-side="secondary"]');await wait(120);
  let modes=await page.evaluate(()=>({p:document.querySelector('#nbEdit').hidden?'read':'edit',s:document.querySelector('#nbEditSecondary').hidden?'read':'edit',
    pm:document.querySelector('[data-nb="toggle-mode"][data-side="primary"]').classList.contains('on'),sm:document.querySelector('[data-nb="toggle-mode"][data-side="secondary"]').classList.contains('on')}));
  check('each Split panel switches Read/Edit independently',modes.p==='read'&&modes.s==='edit'&&modes.pm&&!modes.sm,modes);
  await page.click('#nbEditSecondary');await page.type('#nbEditSecondary',' + متن ویژه پنل دوم');await wait(350);
  await page.evaluate(()=>{const t=document.querySelector('#nbEditSecondary');t.focus();t.setSelectionRange(0,t.value.length);});
  await page.click('[data-nb="fmt"][data-v="b"][data-side="secondary"]');await wait(220);
  const formatted=await page.evaluate(()=>({secondary:document.querySelector('#nbEditSecondary').value,primaryMode:document.querySelector('#nbEdit').hidden?'read':'edit',
    sameNote:JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')).nbActiveId===JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')).nbSecondaryId}));
  check('secondary Toolbar edits only the secondary note',formatted.secondary.includes('**')&&formatted.primaryMode==='read'&&!formatted.sameNote,formatted);
  await page.click('[data-nb="copy"][data-side="secondary"]');await wait(180);
  const copyEdit=await page.evaluate(()=>window.__copiedText);
  check('secondary Copy action copies its own Markdown',copyEdit.includes('**')&&copyEdit.includes('متن ویژه پنل دوم'),copyEdit.slice(-100));
  await page.click('[data-nb="toggle-mode"][data-side="secondary"]');await wait(180);
  const readSecondary=await page.evaluate(()=>({primaryRead:document.querySelector('#nbEdit').hidden,secondaryRead:document.querySelector('#nbEditSecondary').hidden,
    preview:!document.querySelector('#nbPreviewSecondary').hidden,hasMarkdown:document.querySelector('#nbPreviewSecondary').innerText.includes('متن ویژه پنل دوم')}));
  check('secondary Read Mode renders Markdown while primary stays in its own mode',readSecondary.primaryRead&&readSecondary.secondaryRead&&readSecondary.preview&&readSecondary.hasMarkdown,readSecondary);
  await page.click('[data-nb="copy"][data-side="secondary"]');await wait(180);
  const copyRead=await page.evaluate(()=>window.__copiedText);
  check('secondary Copy in Read mode returns rendered text',copyRead.includes('متن ویژه پنل دوم')&&!copyRead.includes('**'),copyRead.slice(-100));
  await page.click('[data-nb="new2"][data-side="secondary"]');await wait(180);
  await page.click('#nbTitleSecondary');await page.type('#nbTitleSecondary','یادداشت پنل دوم جدید');
  await page.click('#nbEditSecondary');await page.type('#nbEditSecondary','محتوای تازه پنل دوم');await wait(650);
  const panelNew=await page.evaluate(()=>{
    const s=JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2'));
    const second=s.nbNotes.find(n=>n.id===s.nbSecondaryId);
    return {split:s.nbSplit,secondaryId:s.nbSecondaryId,primaryId:s.nbActiveId,title:second?.title,body:second?.body};
  });
  check('New Note operation in secondary panel replaces only that panel note',panelNew.split&&panelNew.secondaryId!==panelNew.primaryId&&panelNew.title==='یادداشت پنل دوم جدید'&&panelNew.body.includes('محتوای تازه'),panelNew);
  await wait(350);
  const persistence=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2'));return {split:s.nbSplit,secondaryId:s.nbSecondaryId,secondaryMode:s.nbSecondaryMode};});
  check('Split selection and independent mode are saved in local data',persistence.split&&!!persistence.secondaryId&&persistence.secondaryMode==='edit',persistence);
  await page.evaluate(()=>{
    window.__answerExport='';
    const original=URL.createObjectURL.bind(URL);
    URL.createObjectURL=function(blob){try{blob.text().then(text=>window.__answerExport=text);}catch(e){}return original(blob);};
    document.querySelector('.side-card-data [data-act="export-answers"]').click();
  });
  await wait(250);
  const answerExport=await page.evaluate(()=>{try{const x=JSON.parse(window.__answerExport);return {split:x.nbSplit,secondaryId:x.nbSecondaryId,secondaryMode:x.nbSecondaryMode,notes:x.nbNotes?.length};}catch(e){return {error:String(e),raw:window.__answerExport.slice(0,60)}}});
  check('answers-roadmap JSON preserves the two-pane Notebook state',answerExport.split&&!!answerExport.secondaryId&&answerExport.secondaryMode==='edit'&&answerExport.notes===3,answerExport);
  await page.click('[data-nb="close"]');await wait(250);await page.click('#fabNote');await wait(450);
  const reopened=await page.evaluate(()=>({open:document.querySelector('#nbPanel').classList.contains('open'),note:!document.querySelector('[data-nb-noteview]').hidden,
    split:document.querySelector('[data-nb-workspace]').classList.contains('split-open'),panes:document.querySelectorAll('.nb-pane:not([hidden])').length}));
  check('reopening Notebook restores Last Note and the optional Split View',reopened.open&&reopened.note&&reopened.split&&reopened.panes===2,reopened);
  await page.click('[data-nb="back-list"]');await wait(250);
  check('Back to Note List still works from Split View',await page.evaluate(()=>!document.querySelector('[data-nb-listview]').hidden&&document.querySelectorAll('.nb-card').length===3));
  await page.click('.nb-card.active');await wait(350);
  // Tablet split remains side by side; mobile remains contained.
  await page.setViewport({width:768,height:900});await wait(250);
  const tabletSplit=await page.evaluate(()=>({w:Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width),
    split:document.querySelector('[data-nb-workspace]').classList.contains('split-open'),
    columns:getComputedStyle(document.querySelector('[data-nb-workspace]')).gridTemplateColumns.split(' ').length,
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
  check('Split View works side by side on a tablet width',tabletSplit.w>650&&tabletSplit.split&&tabletSplit.columns===2&&!tabletSplit.overflow,tabletSplit);
  await page.setViewport({width:414,height:820});await wait(250);
  const mobile=await page.evaluate(()=>({w:Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width),vw:innerWidth,
    split:document.querySelector('[data-nb-workspace]').classList.contains('split-open'),columns:getComputedStyle(document.querySelector('[data-nb-workspace]')).gridTemplateColumns.split(' ').length,
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
  check('Notebook Split remains usable and contained on mobile',mobile.w<=mobile.vw&&mobile.split&&mobile.columns===1&&!mobile.overflow,mobile);
  await page.click('[data-nb="close"]');await wait(200);

  // Shortcuts use no Alt and avoid Ctrl+N / Ctrl+Shift+N / browser defaults.
  await page.evaluate(()=>{
    window.__urlCreates=0;
    const original=URL.createObjectURL.bind(URL);
    URL.createObjectURL=function(x){window.__urlCreates++;return original(x);};
  });
  const saveKey=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'>',code:'Period',ctrlKey:true,shiftKey:true,cancelable:true,bubbles:true});document.dispatchEvent(e);return e.defaultPrevented;});
  await wait(250);
  check('Ctrl+Shift+. exports JSON and is handled by the app',saveKey&&await page.evaluate(()=>window.__urlCreates>0),{prevented:saveKey,downloads:await page.evaluate(()=>window.__urlCreates)});
  const beforeNotes=await page.evaluate(()=>JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')).nbNotes.length);
  const newKey=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:':',code:'Semicolon',ctrlKey:true,shiftKey:true,cancelable:true,bubbles:true});document.dispatchEvent(e);return e.defaultPrevented;});
  await wait(350);
  const afterNew=await page.evaluate(()=>({total:JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')).nbNotes.length,view:document.querySelector('[data-nb-noteview]').hidden?'list':'note',open:document.querySelector('#nbPanel').classList.contains('open')}));
  check('Ctrl+Shift+; creates a new note and opens Notebook',newKey&&afterNew.total===beforeNotes+1&&afterNew.view==='note'&&afterNew.open,{prevented:newKey,beforeNotes,afterNew});
  const oldKeys=await page.evaluate(()=>{
    const fire=(key,code,opts={})=>{const e=new KeyboardEvent('keydown',{key,code,cancelable:true,bubbles:true,...opts});document.dispatchEvent(e);return e.defaultPrevented;};
    const cs=fire('s','KeyS',{ctrlKey:true}),ce=fire('e','KeyE',{ctrlKey:true}),altN=fire('n','KeyN',{altKey:true});
    return {ctrlS:cs,ctrlE:ce,altN,nbOpen:document.querySelector('#nbPanel').classList.contains('open')};
  });
  check('old Ctrl+S / Alt+N handlers are removed (no browser shortcut interception)',!oldKeys.ctrlS&&!oldKeys.ctrlE&&!oldKeys.altN&&oldKeys.nbOpen,oldKeys);
  await wait(600);
  check('ZERO JavaScript errors in updated features',errors.length===0,errors.slice(0,10));
  await browser.close();server.close();
  console.log(failures.length?('\nFAILED '+failures.length+': '+failures.join(' ; ')):'\nALL TESTS PASSED');
  process.exit(failures.length?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
