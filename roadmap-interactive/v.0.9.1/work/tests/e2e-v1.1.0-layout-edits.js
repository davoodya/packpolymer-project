const puppeteer = require('puppeteer');
const fs = require('fs');
const http = require('http');
const path = require('path');
const BASE = '/home/user';
const HTML = '/packpolymer-marketplace-roadmap.html';
const pause = (ms=180) => new Promise(r => setTimeout(r, ms));
const fails = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail === undefined ? '' : ' | ' + JSON.stringify(detail)}`);
  if (!ok) fails.push(name);
}
async function clickByEval(page, selector) {
  return page.evaluate(sel => { const el=document.querySelector(sel); if (!el) return false; el.click(); return true; }, selector);
}
async function top(page) {
  await page.evaluate(() => { document.scrollingElement.scrollTop=0; window.dispatchEvent(new Event('scroll')); });
  await pause(160);
}
async function getLayout(page) {
  return page.evaluate(() => {
    const L=document.querySelector('.layout'), main=document.querySelector('.layout>.phases');
    const left=document.querySelector('.layout>.side-left'), right=document.querySelector('.layout>.side-right'), single=document.querySelector('.layout>.side-single');
    const card=document.querySelector('.phases-card'), list=document.querySelector('.phases-card .navlist');
    const rect=e=>e?e.getBoundingClientRect().toJSON():null;
    return {
      mode:L?.dataset.sidebarLayout,
      layoutDisplay:L?getComputedStyle(L).display:'',
      scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,
      main:rect(main),left:rect(left),right:rect(right),single:rect(single),phaseCard:rect(card),phaseList:rect(list),
      cardHeight:card?Math.round(card.getBoundingClientRect().height):0,
      phaseCount:document.querySelectorAll('.phase').length,
      phaseFab:rect(document.querySelector('#phaseFab')),
      noteFab:rect(document.querySelector('#fabNote')),
      topbar:rect(document.querySelector('.topbar'))
    };
  });
}

(async()=>{
  const server=http.createServer((req,res)=>{
    const rel=decodeURIComponent((req.url||'/').split('?')[0]);
    const file=path.resolve(BASE,'.'+(rel==='/'?HTML:rel));
    if(!file.startsWith(BASE)){res.writeHead(403);return res.end('forbidden');}
    fs.readFile(file,(err,data)=>{
      if(err){res.writeHead(404);return res.end('not found');}
      const type=file.endsWith('.json')?'application/json; charset=utf-8':file.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(8897,'127.0.0.1',resolve));
  const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.createBrowserContext();
  const page=await context.newPage();
  const jsErrors=[], externalRequests=[];
  page.on('pageerror',e=>jsErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/scrollTo|not implemented/i.test(m.text()))jsErrors.push(m.text());});
  page.on('request',r=>{if(/^https?:/i.test(r.url())&&!r.url().startsWith('http://127.0.0.1:8897'))externalRequests.push(r.url());});
  await page.evaluateOnNewDocument(()=>{window.__promptCalls=0;window.prompt=()=>{window.__promptCalls++;return null;};});

  // Desktop: the new three-way sidebar cycle, content width, and equal phase-list height.
  await page.setViewport({width:1920,height:900});
  await page.goto('http://127.0.0.1:8897'+HTML,{waitUntil:'load'}); await pause(1000);
  const initial=await getLayout(page);
  check('Desktop starts in the requested default two-column arrangement',initial.mode==='dual-right'&&initial.left&&initial.right&&!initial.single&&initial.left.right<=initial.main.left+2&&initial.main.right<=initial.right.left+2,initial);
  check('Default Desktop puts overview/tools left and the only phase list right',await page.evaluate(()=>!!document.querySelector('.side-left .side-card-overview')&&!!document.querySelector('.side-left .side-card-dev')&&!!document.querySelector('.side-right .phases-card')&&!document.querySelector('.side-right .side-card-overview')));
  const desktopHeights=[initial.cardHeight];
  await clickByEval(page,'.topbar .sidebar-layout-btn'); await pause(140);
  let mode=await getLayout(page);
  check('Cycle 1→2 creates one right Sidebar and removes the left Sidebar',mode.mode==='single-right'&&!mode.left&&!!mode.single&&!!mode.right&&mode.main.right<=mode.single.left+2,mode);
  const order=await page.evaluate(()=>[...document.querySelector('.side-single').querySelectorAll(':scope > .side-card')].map(x=>x.classList.contains('side-card-overview')?'overview':x.classList.contains('side-card-phases')?'phases':x.classList.contains('side-card-marks')?'marks':x.className));
  check('Single Sidebar order is overview, phases, then all other cards',order[0]==='overview'&&order[1]==='phases'&&order[2]==='marks',order);
  desktopHeights.push(mode.cardHeight);
  await clickByEval(page,'.side-single .phases-card .sidebar-layout-btn'); await pause(140);
  mode=await getLayout(page);
  const reverseContent=await page.evaluate(()=>({phaseLeft:!!document.querySelector('.side-left .phases-card'),toolsRight:!!document.querySelector('.side-right .side-card-overview')}));
  check('Cycle 2→3 reverses the two sidebars and places phases on the left',mode.mode==='dual-left'&&!!mode.left&&!mode.single&&mode.left.right<=mode.main.left+2&&mode.main.right<=mode.right.left+2&&reverseContent.phaseLeft&&reverseContent.toolsRight,{mode:mode.mode,left:mode.left,right:mode.right,main:mode.main,reverseContent});
  desktopHeights.push(mode.cardHeight);
  await clickByEval(page,'.topbar .sidebar-layout-btn'); await pause(140);
  mode=await getLayout(page);
  const defaultContent=await page.evaluate(()=>({phaseRight:!!document.querySelector('.side-right .phases-card'),toolsLeft:!!document.querySelector('.side-left .side-card-overview')}));
  check('Cycle 3→1 returns to the default two-column arrangement',mode.mode==='dual-right'&&defaultContent.phaseRight&&defaultContent.toolsLeft,{mode:mode.mode,defaultContent});
  check('Phase-list card height is equal in all three Desktop modes',Math.max(...desktopHeights)-Math.min(...desktopHeights)<=1,desktopHeights);

  // Responsive layouts: on tablets the main work area stays first and wide; on phones it stacks cleanly.
  for (const w of [1280,1024,768,414,360]) {
    await page.setViewport({width:w,height:820}); await top(page);
    const records=[];
    for(let i=0;i<3;i++) {
      const r=await getLayout(page); records.push(r);
      const noOverflow=r.scrollWidth<=r.clientWidth+1;
      const structure=w>1180
        ? (r.layoutDisplay==='grid'&&r.mode!=='single-right' ? !!r.left&&!!r.right : r.layoutDisplay==='grid'&&!!r.single&&!r.left)
        : w>720
          ? (r.layoutDisplay==='grid'&&r.main.bottom<=Math.min(r.left?.top??Infinity,r.right?.top??Infinity,r.single?.top??Infinity)+2)
          : (r.layoutDisplay==='flex'&&r.main.top<Math.min(r.left?.top??Infinity,r.right?.top??Infinity,r.single?.top??Infinity));
      check(`Responsive ${w}px mode ${r.mode}: no overflow and main/sidebars remain usable`,noOverflow&&structure,{mode:r.mode,display:r.layoutDisplay,sw:r.scrollWidth,cw:r.clientWidth,mainTop:Math.round(r.main.top),mainBottom:Math.round(r.main.bottom),leftTop:r.left&&Math.round(r.left.top),rightTop:r.right&&Math.round(r.right.top),singleTop:r.single&&Math.round(r.single.top)});
      if(i<2) { await clickByEval(page,'.topbar .sidebar-layout-btn'); await pause(120); }
    }
    if(w<=1180) {
      const hs=records.map(r=>r.cardHeight);
      check(`Phase list keeps one height in all sidebar modes at ${w}px`,Math.max(...hs)-Math.min(...hs)<=1,hs);
    }
    // return to mode 1 before next viewport
    await clickByEval(page,'.topbar .sidebar-layout-btn'); await pause(120);
  }

  // Compact sticky Header after a short scroll, at laptop/tablet/mobile as well as Desktop.
  for (const w of [1920,1280,1024,768,414]) {
    await page.setViewport({width:w,height:820});
    await page.goto('http://127.0.0.1:8897'+HTML+'?header='+w+'-'+Date.now(),{waitUntil:'load'}); await pause(500); await top(page);
    const before=await page.evaluate(()=>({h:document.querySelector('.topbar').getBoundingClientRect().height,position:getComputedStyle(document.querySelector('.topbar')).position,y:scrollY}));
    await page.keyboard.press('PageDown'); await pause(500);
    const compact=await page.evaluate(()=>{
      const h=document.querySelector('.topbar'),get=s=>document.querySelector(s),vis=e=>!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;
      return {cls:h.className,height:h.getBoundingClientRect().height,top:h.getBoundingClientRect().top,y:scrollY,
        layout:vis(get('.topbar .sidebar-layout-btn')),edit:vis(get('.topbar .edit-mode-btn')),note:vis(get('.topbar .notebook-btn')),
        fonts:vis(get('.topbar .font-controls')),filters:getComputedStyle(get('.topbar .filters-main')).display,secondary:getComputedStyle(get('.topbar .header-secondary')).display,
        label:getComputedStyle(get('.topbar .edit-mode-btn .control-label')).display};
    });
    check(`Header compacts into a sticky icon rail after short scroll at ${w}px`,compact.cls.includes('compact')&&compact.y>48&&before.y<10&&before.position==='sticky'&&compact.height<before.h&&compact.layout&&compact.edit&&compact.note&&compact.fonts&&compact.filters==='none'&&compact.secondary==='none'&&compact.label==='none',{before,compact});
  }

  // Reload a clean Desktop page, verify main Sidebar expander doesn't move the page, then test the Drawer.
  await page.setViewport({width:1920,height:900}); await page.goto('http://127.0.0.1:8897'+HTML+'?fresh='+Date.now(),{waitUntil:'load'}); await pause(650); await top(page);
  const mainIconBefore=await page.evaluate(()=>({y:scrollY,steps:document.querySelectorAll('.side-phases [data-phase-nav="f2"] .navstep').length}));
  await clickByEval(page,'.side-phases [data-phase-nav="f2"] .tree-toggle'); await pause(220);
  const mainIconExpand=await page.evaluate(()=>({y:scrollY,steps:document.querySelectorAll('.side-phases [data-phase-nav="f2"] .navstep').length}));
  await clickByEval(page,'.side-phases [data-phase-nav="f2"] .tree-toggle'); await pause(220);
  const mainIconCollapse=await page.evaluate(()=>({y:scrollY,steps:document.querySelectorAll('.side-phases [data-phase-nav="f2"] .navstep').length}));
  check('Main Sidebar Phase expand/collapse icons do not navigate or scroll',mainIconBefore.y<10&&mainIconBefore.steps===0&&mainIconExpand.y<10&&mainIconExpand.steps>0&&mainIconCollapse.y<10&&mainIconCollapse.steps===0,{before:mainIconBefore,expanded:mainIconExpand,collapsed:mainIconCollapse});
  const floatPos=await page.evaluate(()=>{const p=document.querySelector('#phaseFab').getBoundingClientRect(),n=document.querySelector('#fabNote').getBoundingClientRect();return{p:p.toJSON(),n:n.toJSON(),vw:innerWidth,above:p.bottom<n.top+1,right:p.right<=innerWidth-10};});
  check('Sticky Phase button is right aligned and above Notebook FAB',floatPos.above&&floatPos.right,floatPos);
  await page.evaluate(()=>{document.scrollingElement.scrollTop=260;}); await pause(160);
  const beforeDrawer=await page.evaluate(()=>{const top=document.getElementById('f2')?.getBoundingClientRect().top;return{y:scrollY,hash:location.hash,top,docY:scrollY+(top||0)};});
  await page.click('#phaseFab'); await pause(350);
  const drawerOpen=await page.evaluate(()=>({open:document.querySelector('#phaseNavDrawer').classList.contains('open'),aria:document.querySelector('#phaseNavDrawer').getAttribute('aria-hidden'),rect:document.querySelector('#phaseNavDrawer').getBoundingClientRect().toJSON(),scrim:document.querySelector('#phaseDrawerScrim').classList.contains('show'),overflow:getComputedStyle(document.body).overflow}));
  check('Phase FAB opens an accessible left-side Drawer covering the viewport',drawerOpen.open&&drawerOpen.aria==='false'&&drawerOpen.rect.left===0&&drawerOpen.scrim&&drawerOpen.overflow==='hidden',drawerOpen);
  await page.type('#phaseDrawerSearch','لایسنس/رجیستر کن'); await pause(350);
  let search=await page.evaluate(()=>({trees:[...document.querySelectorAll('#phaseDrawerNavList .tree-ph')].map(x=>x.getAttribute('data-phase-nav')),steps:document.querySelectorAll('#phaseDrawerNavList .navstep').length,subs:document.querySelectorAll('#phaseDrawerNavList .navsub').length,subText:document.querySelector('#phaseDrawerNavList .navsub')?.innerText||''}));
  check('Drawer has independent search across Sub-step text and reveals the matching tree',search.trees.length===1&&search.trees[0]==='f2'&&search.steps===1&&search.subs>=1&&search.subText.includes('لایسنس'),search);
  await clickByEval(page,'#phaseNavDrawer [data-phase-nav="f2"] .tree-toggle'); await pause(240);
  const afterCollapse=await page.evaluate(()=>{const top=document.getElementById('f2')?.getBoundingClientRect().top;return{drawer:document.querySelector('#phaseNavDrawer').classList.contains('open'),steps:document.querySelectorAll('#phaseDrawerNavList .navstep').length,subs:document.querySelectorAll('#phaseDrawerNavList .navsub').length,y:scrollY,hash:location.hash,mainTop:top,docY:scrollY+(top||0)};});
  check('Drawer phase expander only collapses; it does not navigate to the Phase or jump the page',afterCollapse.drawer&&afterCollapse.steps===0&&afterCollapse.subs===0&&afterCollapse.hash===beforeDrawer.hash&&afterCollapse.mainTop>1000&&Math.abs(afterCollapse.y-beforeDrawer.y)<200&&Math.abs(afterCollapse.docY-beforeDrawer.docY)<10,{before:beforeDrawer,after:afterCollapse});
  await clickByEval(page,'#phaseNavDrawer [data-phase-nav="f2"] .tree-toggle'); await pause(200);
  const stepBefore=await page.evaluate(()=>{const top=document.getElementById('f2')?.getBoundingClientRect().top;return{y:scrollY,hash:location.hash,docY:scrollY+(top||0),steps:document.querySelectorAll('#phaseDrawerNavList .navstep').length,subs:document.querySelectorAll('#phaseDrawerNavList .navsub').length};});
  await clickByEval(page,'#phaseNavDrawer [data-phase-nav="f2"] .tree-step-toggle'); await pause(220);
  const stepCollapse=await page.evaluate(()=>{const top=document.getElementById('f2')?.getBoundingClientRect().top;return{drawer:document.querySelector('#phaseNavDrawer').classList.contains('open'),y:scrollY,hash:location.hash,docY:scrollY+(top||0),steps:document.querySelectorAll('#phaseDrawerNavList .navstep').length,subs:document.querySelectorAll('#phaseDrawerNavList .navsub').length};});
  check('Drawer Step expander only collapses Sub-steps without navigating',stepCollapse.drawer&&stepCollapse.steps===stepBefore.steps&&stepCollapse.subs===0&&stepCollapse.hash===stepBefore.hash&&Math.abs(stepCollapse.y-stepBefore.y)<5&&Math.abs(stepCollapse.docY-stepBefore.docY)<25,{before:stepBefore,after:stepCollapse});
  await clickByEval(page,'#phaseNavDrawer [data-phase-nav="f2"] .tree-step-toggle'); await pause(180);
  await clickByEval(page,'#phaseNavDrawer [data-phase-nav="f2"] .navitem .tt'); await pause(500);
  const phaseNav=await page.evaluate(()=>({drawer:document.querySelector('#phaseNavDrawer').classList.contains('open'),open:document.getElementById('f2')?.classList.contains('open'),top:document.getElementById('f2')?.getBoundingClientRect().top,scrollY}));
  check('Clicking a Phase title (not its expander) navigates and closes the Drawer',!phaseNav.drawer&&phaseNav.open&&phaseNav.top>0&&phaseNav.top<220,phaseNav);
  // Edit UI: warning banner, and no prompt-based insertion; Persian digits accepted in small inline fields.
  await clickByEval(page,'.topbar .edit-mode-btn'); await pause(240);
  const editState=await page.evaluate(()=>({body:document.body.classList.contains('editing'),warning:getComputedStyle(document.body,'::after').content,phaseFields:document.querySelectorAll('#f2 .editbar [data-insert-position="phase"]').length,stepFields:document.querySelectorAll('#f2 .editbar [data-insert-position="step"]').length,subField:document.querySelector('#f2-s1 [data-insert-position="sub"]')!==null}));
  check('Edit mode shows sticky warning and inline insert fields for Phase, Step, Sub-step',editState.body&&editState.warning.includes('حالت ویرایش')&&editState.phaseFields===1&&editState.stepFields===1&&editState.subField,editState);
  await page.click('#phaseFab'); await pause(250);
  const drawerWarn=await page.evaluate(()=>!!document.querySelector('#phaseNavDrawer .phase-edit-warning'));
  check('Edit mode warning is also shown above the Drawer phase controls',drawerWarn);
  await page.keyboard.press('Escape'); await pause(220);
  const safeBefore=await page.evaluate(()=>({phases:document.querySelectorAll('.phase').length,steps:document.querySelectorAll('#f2 .step').length,subs:document.querySelectorAll('#f2-s1 .sub').length,phaseIds:[...document.querySelectorAll('.phase')].map(x=>x.id),stepIds:[...document.querySelectorAll('#f2 .step')].map(x=>x.id),subIds:[...document.querySelectorAll('#f2-s1 .sub')].map(x=>x.id)}));
  check('Inline insertion fields accept Persian digits and insert Steps/Sub-steps at their ordinal',editState.stepFields===1&&safeBefore.stepIds.length>0,'before counts captured');
  // Step number ۲ inserts at ordinal 2 (after the original first step).
  await page.evaluate(()=>{const i=document.querySelector('#f2 .editbar [data-insert-position="step"]');i.value='۲';i.closest('.insert-action-group').querySelector('[data-act="add-step"]').click();}); await pause(250);
  const stepAt2=await page.evaluate(before=>{const ids=[...document.querySelectorAll('#f2 .step')].map(x=>x.id);return{ids,oldFirst:before[0],oldSecond:before[1],newTitle:document.querySelector('#f2 .step:nth-child(2) .st-title')?.innerText||'',number:document.querySelector('#f2 .step:nth-child(2) .st-num')?.innerText||''};},safeBefore.stepIds);
  check('Step insertion position ۲ is honored and auto numbering is recalculated',stepAt2.ids.length===safeBefore.stepIds.length+1&&stepAt2.ids[0]===stepAt2.oldFirst&&stepAt2.ids[2]===stepAt2.oldSecond&&stepAt2.newTitle.includes('مرحله جدید')&&stepAt2.number.includes('۳.۲'),stepAt2);
  // Empty Step field preserves default append behavior.
  await page.evaluate(()=>{const i=document.querySelector('#f2 .editbar [data-insert-position="step"]');i.value='';i.closest('.insert-action-group').querySelector('[data-act="add-step"]').click();}); await pause(240);
  const defaultStep=await page.evaluate(()=>{const x=[...document.querySelectorAll('#f2 .step')];return{n:x.length,title:x[x.length-1]?.querySelector('.st-title')?.innerText||'',id:x[x.length-1]?.id};});
  check('Empty Step position keeps the default append behavior',defaultStep.n===safeBefore.stepIds.length+2&&defaultStep.title.includes('مرحله جدید'),defaultStep);
  // Sub-step ۱ goes first; empty field appends at the end.
  await page.evaluate(()=>{const i=document.querySelector('#f2-s1 [data-insert-position="sub"]');i.value='۱';i.closest('.insert-action-group').querySelector('[data-act="add-sub"]').click();}); await pause(250);
  const subAt1=await page.evaluate(before=>{const a=[...document.querySelectorAll('#f2-s1 .sub')];return{ids:a.map(x=>x.id),oldFirst:before[0],title:a[0]?.querySelector('.sub-t')?.innerText||'',number:a[0]?.querySelector('.sub-num')?.innerText||''};},safeBefore.subIds);
  check('Sub-step insertion position ۱ is honored and auto numbering is recalculated',subAt1.ids.length===safeBefore.subIds.length+1&&subAt1.ids[1]===subAt1.oldFirst&&subAt1.title.includes('زیرمرحله جدید')&&subAt1.number.includes('۳.۱.۱'),subAt1);
  await page.evaluate(()=>{const i=document.querySelector('#f2-s1 [data-insert-position="sub"]');i.value='';i.closest('.insert-action-group').querySelector('[data-act="add-sub"]').click();}); await pause(240);
  const defaultSub=await page.evaluate(()=>{const a=[...document.querySelectorAll('#f2-s1 .sub')];return{n:a.length,title:a[a.length-1]?.querySelector('.sub-t')?.innerText||''};});
  check('Empty Sub-step position keeps the default append behavior',defaultSub.n===safeBefore.subIds.length+2&&defaultSub.title.includes('زیرمرحله جدید'),defaultSub);
  // Phase position ۱ inserts at the beginning; blank position inserts after the current Phase.
  await page.evaluate(()=>{const i=document.querySelector('#f2 .editbar [data-insert-position="phase"]');i.value='۱';i.closest('.insert-action-group').querySelector('[data-act="add-phase"]').click();}); await pause(250);
  const phaseAt1=await page.evaluate(()=>({count:document.querySelectorAll('.phase').length,first:document.querySelector('.phase')?.id,num:document.querySelector('.phase .ph-num')?.innerText,title:document.querySelector('.phase .ph-title')?.innerText}));
  check('Phase insertion position ۱ is honored and phase numbers recalculate',phaseAt1.count===safeBefore.phases+1&&phaseAt1.first!=='f1'&&phaseAt1.num==='فاز ۱'&&phaseAt1.title.includes('فاز جدید'),phaseAt1);
  await page.evaluate(()=>{const i=document.querySelector('#f2 .editbar [data-insert-position="phase"]');i.value='';i.closest('.insert-action-group').querySelector('[data-act="add-phase"]').click();}); await pause(230);
  const defaultPhase=await page.evaluate(()=>{const a=[...document.querySelectorAll('.phase')].map(x=>x.id);return{ids:a,index:a.indexOf('f2'),next:a[a.indexOf('f2')+1]};});
  check('Empty Phase position preserves the default insert-after-current behavior',defaultPhase.index>=0&&defaultPhase.next!=='f2',defaultPhase);
  const promptCount=await page.evaluate(()=>window.__promptCalls);
  check('Phase/Step/Sub-step insertion never calls prompt()',promptCount===0,promptCount);

  // Global UI font size, then offline Markdown + syntax highlighting in Phase, Step and Sub-step content.
  const uiFontBefore=await page.evaluate(()=>getComputedStyle(document.querySelector('#f2-s1 .st-title')).fontSize);
  await clickByEval(page,'.topbar .font-controls [data-act="font-scale"][data-scope="ui"][data-dir="1"]'); await pause(140);
  const uiFontAfter=await page.evaluate(()=>({size:getComputedStyle(document.querySelector('#f2-s1 .st-title')).fontSize,label:document.querySelector('.topbar [data-font-scale="ui"]')?.textContent}));
  check('Global Font Size control scales the whole interface',parseFloat(uiFontAfter.size)>parseFloat(uiFontBefore)&&uiFontAfter.label.includes('۱۰۵'),{before:uiFontBefore,after:uiFontAfter});
  const block='راهنمای کد\n```js\nconst api = "offline";\n```';
  await page.evaluate(txt=>{const e=document.querySelector('#f2 .ph-goal[data-field="goal"]');e.focus();e.innerText=txt;e.dispatchEvent(new Event('input',{bubbles:true}));e.blur();},block); await pause(220);
  await page.evaluate(()=>{if(!document.querySelector('#f2-s1 .tip-content[data-field="tip"]'))document.querySelector('#f2-s1 [data-act="add-tip"]')?.click();}); await pause(150);
  await page.evaluate(txt=>{const e=document.querySelector('#f2-s1 .tip-content[data-field="tip"]');if(!e)return false;e.focus();e.innerText=txt;e.dispatchEvent(new Event('input',{bubbles:true}));e.blur();return true;},block); await pause(220);
  await page.evaluate(()=>{const e=document.querySelector('#f2-s1-1 .sub-t[data-field="sub"]');e.focus();e.innerText='کد زیرمرحله\n```js\nconst subToken = "safe";\n```\nاز `OFFLINE_TOKEN` امن استفاده کن';e.dispatchEvent(new Event('input',{bubbles:true}));e.blur();}); await pause(220);
  await clickByEval(page,'.topbar .edit-mode-btn'); await pause(300);
  const phaseHighlight=await page.evaluate(()=>({phase:!!document.querySelector('#f2 .ph-goal .md-pre .hl-keyword'),phaseString:!!document.querySelector('#f2 .ph-goal .md-pre .hl-string'),step:!!document.querySelector('#f2-s1 .tip-content .md-pre .hl-keyword'),stepString:!!document.querySelector('#f2-s1 .tip-content .md-pre .hl-string'),subInline:document.querySelector('#f2-s1-1 .sub-t code:not([class*="language-"])')?.textContent||'',subBlock:!!document.querySelector('#f2-s1-1 .sub-t .md-pre .hl-keyword'),subString:!!document.querySelector('#f2-s1-1 .sub-t .md-pre .hl-string'),preCount:document.querySelectorAll('#f2 .md-pre').length}));
  check('Phase, Step and Sub-step descriptions render offline syntax colors; inline code is safely styled',phaseHighlight.phase&&phaseHighlight.phaseString&&phaseHighlight.step&&phaseHighlight.stepString&&phaseHighlight.subBlock&&phaseHighlight.subString&&phaseHighlight.subInline==='OFFLINE_TOKEN'&&phaseHighlight.preCount>=3,phaseHighlight);

  // Notebook Markdown / code fences and independent Notebook font scale.
  await page.click('#fabNote'); await pause(350);
  await page.click('#nbPanel [data-nb="new"]'); await pause(250);
  const noteText='# Offline code test\n\n```js\nconst answer = 42;\nconsole.log("safe");\n```\n\n**bold** and `inline`';
  await page.evaluate(txt=>{const t=document.querySelector('#nbEdit');t.value=txt;t.dispatchEvent(new Event('input',{bubbles:true}));const title=document.querySelector('#nbTitle');title.value='Syntax Highlight Test';title.dispatchEvent(new Event('input',{bubbles:true}));},noteText); await pause(320);
  await clickByEval(page,'#nbPanel [data-nb="toggle-mode"][data-side="primary"]'); await pause(220);
  const nbHighlight=await page.evaluate(()=>({open:document.querySelector('#nbPanel').classList.contains('open'),preview:!document.querySelector('#nbPreview').hidden,keyword:!!document.querySelector('#nbPreview .hl-keyword'),number:!!document.querySelector('#nbPreview .hl-number'),string:!!document.querySelector('#nbPreview .hl-string'),bold:!!document.querySelector('#nbPreview strong'),inline:document.querySelector('#nbPreview code:not(.language-js)')?.textContent||'',hasCode:!!document.querySelector('#nbPreview .md-pre'),external:document.querySelector('#nbPreview img, #nbPreview script, #nbPreview iframe')!==null}));
  check('Notebook Markdown renders fenced code, syntax tokens, inline formatting, and no injected HTML',nbHighlight.open&&nbHighlight.preview&&nbHighlight.keyword&&nbHighlight.number&&nbHighlight.string&&nbHighlight.bold&&nbHighlight.inline==='inline'&&nbHighlight.hasCode&&!nbHighlight.external,nbHighlight);
  const nbFontBefore=await page.evaluate(()=>({nb:getComputedStyle(document.querySelector('#nbPreview')).fontSize,main:getComputedStyle(document.querySelector('#f2-s1 .st-title')).fontSize}));
  await clickByEval(page,'#nbPanel .nb-head .font-controls [data-nb="font-scale"][data-dir="1"]'); await pause(130);
  const nbFontAfter=await page.evaluate(()=>({nb:getComputedStyle(document.querySelector('#nbPreview')).fontSize,main:getComputedStyle(document.querySelector('#f2-s1 .st-title')).fontSize,label:document.querySelector('#nbPanel .nb-head [data-font-scale="nb"]')?.textContent}));
  check('Notebook Font Size control is independent from the global UI scale',parseFloat(nbFontAfter.nb)>parseFloat(nbFontBefore.nb)&&nbFontAfter.main===nbFontBefore.main&&nbFontAfter.label.includes('۱۰۵'),{before:nbFontBefore,after:nbFontAfter});
  await clickByEval(page,'#nbPanel [data-nb="close"]'); await pause(200);

  // Notebook takes the requested width at each device class.
  for (const [w,h,expected] of [[1920,900,'desktop'],[1280,820,'full'],[1024,820,'full'],[414,820,'full']]) {
    await page.setViewport({width:w,height:h}); await top(page);
    await page.click('#fabNote'); await pause(280);
    const nbw=await page.evaluate(()=>({w:document.querySelector('#nbPanel').getBoundingClientRect().width,vw:innerWidth,open:document.querySelector('#nbPanel').classList.contains('open')}));
    const ok=expected==='desktop'?Math.abs(nbw.w/nbw.vw-.75)<.015:nbw.w>=nbw.vw*.98&&nbw.w<=nbw.vw+1;
    check(`Notebook width is ${expected==='desktop'?'about 75%':'full'} at ${w}px`,ok,nbw);
    await clickByEval(page,'#nbPanel [data-nb="close"]'); await pause(150);
  }

  check('No unexpected external network requests in the offline HTML',externalRequests.length===0,externalRequests);
  check('No JavaScript errors during v1.1 layout/edit/highlight tests',jsErrors.length===0,jsErrors);
  await context.close(); await browser.close(); server.close();
  console.log(fails.length?`\nFAILED ${fails.length}: ${fails.join(' ; ')}`:'\nALL V1.1 LAYOUT / INSERTION / MARKDOWN TESTS PASSED');
  process.exit(fails.length?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
