const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const BASE = '/home/user';
const HTML = '/packpolymer-marketplace-roadmap.html';
let fails = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail === undefined ? '' : ' | ' + JSON.stringify(detail)}`);
  if (!ok) fails.push(name);
}
const wait = (ms=350) => new Promise(r => setTimeout(r, ms));

(async () => {
  const sidecarOriginal = fs.readFileSync(path.join(BASE, 'answers-roadmap.json'), 'utf8');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = pathname === '/' ? HTML : pathname;
    const full = path.resolve(BASE, '.' + rel);
    if (!full.startsWith(BASE)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      const type = full.endsWith('.json') ? 'application/json; charset=utf-8' : full.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
      res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(8899, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({headless:'new', args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  page.on('console', m => { if (m.type() === 'error' && !/scrollTo|not implemented/i.test(m.text())) jsErrors.push(m.text()); });
  await page.evaluateOnNewDocument(() => {
    window.__copiedText = '';
    try { Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText: async text => { window.__copiedText = String(text); } } }); } catch(e) {}
  });
  await page.setViewport({width:1400,height:900});
  await page.goto('http://127.0.0.1:8899' + HTML, {waitUntil:'load', timeout:60000});
  await wait(1000);

  // Build / content / offline / version smoke
  const base = await page.evaluate(() => ({
    title: document.title,
    phases: document.querySelectorAll('.phase').length,
    font: document.fonts.check('16px Vazir'),
    version: document.querySelector('meta[name="version"]')?.content,
    appVersion: document.querySelector('.foot')?.textContent.match(/V1\.0\.1/)?.[0] || '',
    brokenSection: Array.from(document.querySelectorAll('section.phase')).some(x => !x.id || !x.classList.contains('phase')),
    zwnj: document.documentElement.innerHTML.split(String.fromCharCode(8204)).length - 1,
    external: Array.from(document.querySelectorAll('[src],[href]')).filter(e => /^https?:/i.test(e.getAttribute('src') || e.getAttribute('href') || '')).length,
    noDuplicateIds: (() => { const ids=[...document.querySelectorAll('[id]')].map(x=>x.id); return ids.length === new Set(ids).size; })()
  }));
  check('13 phases load and Phase markup valid', base.phases === 13 && !base.brokenSection, base);
  check('app is labeled V1.0.1', base.version === '1.0.1' && base.appVersion === 'V1.0.1', base);
  check('Vazir font embedded and active', base.font === true);
  check('no zero-width non-joiner in HTML UI/content', base.zwnj === 0, base.zwnj);
  check('no external resource references', base.external === 0, base.external);
  check('no duplicate element ids', base.noDuplicateIds);

  // Show all, count complete plan
  await page.click('[data-act="expand-all"]'); await wait(500);
  const counts = await page.evaluate(() => ({ phases:document.querySelectorAll('.phase').length, steps:document.querySelectorAll('.step').length, subs:document.querySelectorAll('.sub').length, nums:[...document.querySelectorAll('.phase .ph-num')].map(x=>x.textContent.trim()) }));
  check('plan content counts: 13 phases / 122 steps / 749 substeps', counts.phases===13 && counts.steps===122 && counts.subs===749, counts);
  check('auto phase labels are 1..12 plus Appendix', counts.nums.join('|') === ['فاز ۱','فاز ۲','فاز ۳','فاز ۴','فاز ۵','فاز ۶','فاز ۷','فاز ۸','فاز ۹','فاز ۱۰','فاز ۱۱','فاز ۱۲','پیوست'].join('|'), counts.nums);

  // Exact phase search and digit normalization
  async function doSearch(q) {
    await page.evaluate(v => { const el=document.querySelector('#q'); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); }, q);
    await wait(600);
    return page.evaluate(() => ({
      nums:[...document.querySelectorAll('.phase .ph-num')].map(x=>x.textContent.trim()),
      phaseTitles:[...document.querySelectorAll('.phase .ph-title')].map(x=>x.innerText.trim()),
      steps:document.querySelectorAll('.step').length
    }));
  }
  const p4en = await doSearch('فاز 4');
  const p4fa = await doSearch('فاز ۴');
  check('search Phase 4 shows Phase 4, not Phase 5', p4en.nums.length===1 && p4en.nums[0]==='فاز ۴', p4en);
  check('English and Persian 4 digit searches are identical', JSON.stringify(p4en)===JSON.stringify(p4fa), {en:p4en.nums,fa:p4fa.nums});
  const p11en = await doSearch('فاز 11');
  const p11fa = await doSearch('فاز ۱۱');
  check('search Phase 11 shows Phase 11, not Phase 12', p11en.nums.length===1 && p11en.nums[0]==='فاز ۱۱', p11en);
  check('English and Persian 11 digit searches are identical', JSON.stringify(p11en)===JSON.stringify(p11fa), {en:p11en.nums,fa:p11fa.nums});
  const searchSpace = await doSearch('شخصی سازی');
  const searchCompat = await doSearch('شخصی' + String.fromCharCode(8204) + 'سازی');
  check('search tolerates legacy ZWNJ query but content uses plain spacing', searchSpace.steps>0 && searchSpace.steps===searchCompat.steps, {plain:searchSpace.steps,legacy:searchCompat.steps});
  await doSearch('');

  // Sidebar deep tree + repeated searches -> phase, step, substep navigation
  const navIds = await page.evaluate(() => {
    const phase = [...document.querySelectorAll('.phase')].find(p=>p.querySelector('.ph-num')?.textContent.trim()==='فاز ۱۱');
    const step = phase?.querySelector('.step');
    const sub = step?.querySelector('.sub');
    return {ph:phase?.id, step:step?.id, sub:sub?.id};
  });
  check('sidebar test targets found', !!navIds.ph && !!navIds.step && !!navIds.sub, navIds);
  await doSearch('Dokan Pro'); await doSearch('Rank Math'); await doSearch('WooCommerce');
  await page.evaluate(id => document.querySelector('[data-act="side-phase-toggle"][data-id="'+id+'"]').click(), navIds.ph);
  await wait(350);
  await page.evaluate(id => document.querySelector('[data-act="side-step-toggle"][data-id="'+id+'"]').click(), navIds.step);
  await wait(350);
  const hasSubNav = await page.evaluate(id => !!document.querySelector('.navsub[data-id="'+id+'"]'), navIds.sub);
  check('sidebar phase and step expand to substeps', hasSubNav);
  async function clickAndCheck(selector, targetId, label) {
    await page.evaluate(sel=>document.querySelector(sel).click(),selector);
    await wait(1100);
    const r=await page.evaluate(id=>{const e=document.getElementById(id);const b=e?.getBoundingClientRect();return {exists:!!e,top:b?Math.round(b.top):null,bottom:b?Math.round(b.bottom):null,open:!!e?.closest('.phase')?.classList.contains('open'),scrollY:Math.round(window.scrollY),hit:e?.classList.contains('hit')||false};},targetId);
    check(label, r.exists && r.open && r.top < 860 && r.bottom > 0 && r.scrollY > 100, r);
  }
  await clickAndCheck(`[data-act="goto"][data-id="${navIds.ph}"]`,navIds.ph,'sidebar Phase click scrolls correctly after searches');
  // Expand if phase got rendered and sidebar tree is still expanded; step target
  await clickAndCheck(`[data-act="goto-step"][data-id="${navIds.step}"]`,navIds.step,'sidebar Step click scrolls correctly after searches');
  await clickAndCheck(`[data-act="goto-sub"][data-id="${navIds.sub}"]`,navIds.sub,'sidebar SubStep click scrolls correctly after searches');
  await doSearch('');

  // Helpers for one entity type
  async function openMenu(type,id) {
    await page.evaluate((t,i)=>{
      const b=document.querySelector('[data-act="entity-menu"][data-etype="'+t+'"][data-eid="'+i+'"]');
      if (b) { const root=document.documentElement, old=root.style.scrollBehavior; root.style.scrollBehavior='auto'; try{b.scrollIntoView({block:'center',behavior:'instant'});}catch(e){b.scrollIntoView();} root.style.scrollBehavior=old; b.click(); }
    },type,id);
    await wait(180);
    return await page.evaluate(()=>!document.querySelector('#entityMenu').hidden);
  }
  async function menuAction(type,id,action) {
    const opened=await openMenu(type,id);
    if (!opened) return {opened:false};
    await page.evaluate(a=>document.querySelector('#entityMenu [data-entact="'+a+'"]').click(),action); await wait(500);
    return {opened:true};
  }
  // choose a smaller independent target set: Phase 3, first Step, first SubStep
  const targets = await page.evaluate(() => {
    const ph=[...document.querySelectorAll('.phase')].find(p=>p.querySelector('.ph-num')?.textContent.trim()==='فاز ۳');
    const st=ph?.querySelector('.step'); const sub=st?.querySelector('.sub');
    return {phase:ph?.id,step:st?.id,sub:sub?.id,sub2:st?.querySelectorAll('.sub')[1]?.id,sub3:st?.querySelectorAll('.sub')[2]?.id,stepTitle:st?.querySelector('.st-title')?.innerText.trim(),subTitle:sub?.querySelector('.sub-t')?.innerText.trim()};
  });
  check('archive/review/share/notebook targets found',!!targets.phase&&!!targets.step&&!!targets.sub,targets);

  // Needs review: phase, step, sub each stay in main content and get indicator
  for (const [type,id] of [['phase',targets.phase],['step',targets.step],['sub',targets.sub]]) {
    await menuAction(type,id,'review');
    const isVisible=await page.evaluate(i=>!!document.getElementById(i),id);
    check(`${type} can be marked Needs Review and remains visible`,isVisible, type);
  }
  const reviewBadges=await page.evaluate(ids=>ids.map(id=>({id,marked:document.getElementById(id)?.classList.contains('needs-review') || !!document.querySelector('#'+CSS.escape(id)+' .review-tag')})),[targets.phase,targets.step,targets.sub]);
  check('Needs Review indicators show on Phase, Step, SubStep',reviewBadges.every(x=>x.marked),reviewBadges);
  // Leave only the substep marked so the combined filters exercise true union behavior.
  await menuAction('phase',targets.phase,'review');
  await menuAction('step',targets.step,'review');
  await page.click('[data-act="mark-filter"][data-id="review"]'); await wait(500);
  const reviewFilter=await page.evaluate(ids=>({selected:document.querySelector('[data-act="mark-filter"][data-id="review"]')?.classList.contains('on'),phase:!!document.getElementById(ids[0]),step:!!document.getElementById(ids[1]),sub:!!document.getElementById(ids[2]),otherSub:!!document.getElementById(ids[3]),stepCount:document.querySelectorAll('.step').length}),[targets.phase,targets.step,targets.sub,targets.sub2]);
  check('Review filter in Header filters to the review-marked substep',reviewFilter.selected&&reviewFilter.phase&&reviewFilter.step&&reviewFilter.sub&&!reviewFilter.otherSub,reviewFilter);
  // the Sidebar carries an independent access point to the same filter
  const sideFilterExists=await page.evaluate(()=>!!document.querySelector('.side [data-act="mark-filter"][data-id="review"]'));
  check('Review/Archive filters also available in Sidebar',sideFilterExists);
  const collapseCount=await page.evaluate(()=>document.querySelectorAll('.side-card [data-act="side-toggle"]').length);
  check('every Sidebar card has its own Collapse/Uncollapse control',collapseCount===9,collapseCount);
  await page.evaluate(()=>document.querySelector('[data-act="side-toggle"][data-id="marks"]').click()); await wait(350);
  const markCardCollapsed=await page.evaluate(()=>{const b=document.querySelector('[data-act="side-toggle"][data-id="marks"]');return b?.closest('.side-card')?.classList.contains('closed')&&!b.closest('.side-card').querySelector('[data-act="mark-filter"]');});
  check('Sidebar Archive/Review card collapses and expands cleanly',markCardCollapsed);
  await page.evaluate(()=>document.querySelector('[data-act="side-toggle"][data-id="marks"]').click()); await wait(300);
  await page.click('[data-act="mark-clear"]'); await wait(450);
  // Multiple types are additive (OR): review substep and a different archived substep both appear.
  await menuAction('sub',targets.sub2,'archive');
  await page.click('[data-act="mark-filter"][data-id="review"]'); await wait(200);
  await page.click('[data-act="mark-filter"][data-id="archived"]'); await wait(500);
  const union=await page.evaluate(ids=>({review:!!document.getElementById(ids[0]),archived:!!document.getElementById(ids[1]),unmarked:!!document.getElementById(ids[2]),both:[...document.querySelectorAll('.mark-chips .chip.mk.on')].length}),[targets.sub,targets.sub2,targets.sub3]);
  check('Review + Archive filters can be active together as a union',union.review&&union.archived&&!union.unmarked&&union.both===2,union);
  await menuAction('sub',targets.sub2,'archive');
  await page.click('[data-act="mark-clear"]'); await wait(450);
  // Sidebar filter is live, not just decorative.
  await page.evaluate(()=>document.querySelector('.side [data-act="mark-filter"][data-id="review"]').click()); await wait(450);
  const sideFilterLive=await page.evaluate(id=>({on:document.querySelector('.side [data-act="mark-filter"][data-id="review"]')?.classList.contains('on'),sub:!!document.getElementById(id)}),targets.sub);
  check('Sidebar Review filter applies to main content',sideFilterLive.on&&sideFilterLive.sub,sideFilterLive);
  await page.evaluate(()=>document.querySelector('.side [data-act="mark-filter"][data-id="review"]').click()); await wait(400);

  // Share URL for all three entity types; ensure fragment shape + clipboard fallback.
  for (const [type,id] of [['phase',targets.phase],['step',targets.step],['sub',targets.sub]]) {
    await menuAction(type,id,'share'); await wait(200);
    const sh=await page.evaluate(()=>({hash:location.hash,copy:window.__copiedText}));
    check(`${type} Share produces a URL with a deep-link fragment`,sh.hash.includes('#item=')&&sh.copy.includes('#item='),sh);
  }
  // Direct share URL opens the correct substep and navigates there after startup
  const directURL=await page.evaluate(id=>location.href.split('#')[0]+'#item='+encodeURIComponent('sub:'+id),targets.sub);
  const deep=await browser.newPage();
  const deepErrors=[]; deep.on('pageerror',e=>deepErrors.push(e.message));
  await deep.setViewport({width:1400,height:900});
  await deep.goto(directURL,{waitUntil:'load'}); await wait(1600);
  const deepResult=await deep.evaluate(id=>{const e=document.getElementById(id);const r=e?.getBoundingClientRect();return {exists:!!e,y:r?Math.round(r.top):null,scrollY:Math.round(window.scrollY),phaseOpen:!!e?.closest('.phase')?.classList.contains('open')};},targets.sub);
  check('shared URL deep-link opens and scrolls to exact SubStep',deepResult.exists&&deepResult.phaseOpen&&deepResult.y<860&&deepResult.y>0&&deepResult.scrollY>50,deepResult);
  check('deep-link page has zero JS errors',deepErrors.length===0,deepErrors);
  await deep.close();
  // Reduce DOM while exercising stateful controls, without changing content.
  await page.click('[data-act="collapse-all"]'); await wait(250);
  await page.evaluate(id=>document.querySelector('[data-act="toggle-phase"][data-id="'+id+'"]').click(),targets.phase); await wait(350);

  // Add to Notebook for Phase/Step/SubStep (independent notes)
  for (const [type,id] of [['phase',targets.phase],['step',targets.step],['sub',targets.sub]]) {
    console.log('ACTION notebook:',type,id);
    await menuAction(type,id,'notebook'); await wait(550);
    const note=await page.evaluate(()=>({open:document.querySelector('#nbPanel')?.classList.contains('open'),title:document.querySelector('#nbTitle')?.value||'',body:document.querySelector('#nbEdit')?.value||'',view:!document.querySelector('[data-nb-noteview]')?.hidden}));
    check(`${type} Add to Notebook creates and opens a new note`,note.open&&note.view&&note.title.length>0&&note.body.length>0,{title:note.title,bodyStart:note.body.slice(0,150),length:note.body.length});
    await page.click('[data-nb="close"]'); await wait(300);
  }
  const noteCount=await page.evaluate(()=>JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')||'{}').nbNotes?.length||0);
  check('Phase/Step/SubStep actions create three independent notes',noteCount>=3,noteCount);

  // Archive Phase, Step, SubStep: hidden in normal view and retrievable from Archive filter
  for (const [type,id] of [['phase',targets.phase],['step',targets.step],['sub',targets.sub]]) {
    await menuAction(type,id,'archive');
    const defaultVisible=await page.evaluate(i=>!!document.getElementById(i),id);
    check(`${type} disappears from main page when archived`,!defaultVisible,type);
    await page.click('[data-act="mark-filter"][data-id="archived"]'); await wait(450);
    const archiveVisible=await page.evaluate(i=>{const e=document.getElementById(i);return !!e&&(e.classList.contains('is-archived')||e.closest('.is-archived'));},id);
    check(`${type} is visible in Archive filter`,archiveVisible,type);
    // Remove its archive mark again while archive view is active
    await menuAction(type,id,'archive');
    await page.click('[data-act="mark-clear"]'); await wait(450);
  }

  // Verify archive filters are also in Sidebar and counts
  const archiveTools=await page.evaluate(()=>({header:!!document.querySelector('.mark-chips [data-id="archived"]'),side:!!document.querySelector('.side [data-id="archived"][data-act="mark-filter"]')}));
  check('Archive filter exists in both Header and Sidebar',archiveTools.header&&archiveTools.side,archiveTools);

  // Sidecar over HTTP restores review/archive state and the last Notebook note.
  const seedSidecar={app:'packpolymer-marketplace-roadmap',kind:'answers',version:2,appVersion:'1.0.0',savedAt:'2099-01-01T00:00:00.000Z',checks:{},notes:{},marks:{archived:{'f2-s1-1':true},review:{'f2-s1':true}},notebook:'',nbNotes:[{id:'nb-sidecar-v1',title:'از فایل کناری',body:'محتوای دفترچه از sidecar',createdAt:'2099-01-01T00:00:00.000Z',updatedAt:'2099-01-01T00:00:00.000Z'}],nbActiveId:'nb-sidecar-v1',nbMode:'edit',nbView:'note',customized:false};
  fs.writeFileSync(path.join(BASE,'answers-roadmap.json'),JSON.stringify(seedSidecar,null,2));
  const sideCtx=await browser.createBrowserContext(); const sidePage=await sideCtx.newPage();
  sidePage.on('pageerror',e=>jsErrors.push('sidecar '+e.message));
  await sidePage.setViewport({width:1280,height:800});
  await sidePage.goto('http://127.0.0.1:8899'+HTML,{waitUntil:'load'}); await wait(1600);
  await sidePage.evaluate(()=>document.querySelector('[data-act="toggle-phase"][data-id="f2"]').click()); await wait(300);
  const sideLoaded=await sidePage.evaluate(()=>({review:document.getElementById('f2-s1')?.classList.contains('needs-review')||false,archiveHidden:!document.getElementById('f2-s1-1'),title:(JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')||'{}').nbNotes||[])[0]?.title||''}));
  check('answers-roadmap.json restores marks and Notebook notes over HTTP',sideLoaded.review&&sideLoaded.archiveHidden&&sideLoaded.title==='از فایل کناری',sideLoaded);
  await sidePage.click('[data-act="mark-filter"][data-id="archived"]'); await wait(400);
  check('sidecar-restored archived substep reappears with Archive filter',await sidePage.evaluate(()=>!!document.getElementById('f2-s1-1')));
  await sidePage.click('[data-act="notebook"]'); await wait(350);
  check('sidecar-restored Notebook resumes its Last Note',await sidePage.evaluate(()=>document.querySelector('#nbTitle').value==='از فایل کناری'));
  await sideCtx.close();
  fs.writeFileSync(path.join(BASE,'answers-roadmap.json'),sidecarOriginal);

  // All state captured by answer JSON; clean up and test responsive sizes
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>document.querySelector('[data-act="clean-all"]').click()); await wait(200);
  const cleanDialog=await page.evaluate(()=>document.querySelector('#confirmModal')?.classList.contains('show')||false);
  if (cleanDialog) await page.click('[data-confirm="yes"]');
  await wait(700);
  const cleanState=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')||'{}');return {nb:(s.nbNotes||[]).length,arch:Object.keys(s.marks?.archived||{}).length,review:Object.keys(s.marks?.review||{}).length};});
  check('Clean All removes Notebook notes plus Archive/Review marks',cleanState.nb===0&&cleanState.arch===0&&cleanState.review===0,cleanState);
  for (const w of [1280,768,414]) {
    await page.setViewport({width:w,height:800}); await wait(350);
    const r=await page.evaluate(()=>({cw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,bodySW:document.body.scrollWidth,nb:Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width)}));
    check(`responsive layout no horizontal overflow at ${w}px`,r.sw<=r.cw+1&&r.bodySW<=r.cw+1,r);
  }
  await page.setViewport({width:414,height:800});
  await page.click('[data-act="notebook"]'); await wait(300);
  const mobNB=await page.evaluate(()=>({w:Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width),vw:innerWidth}));
  check('Notebook is mobile-width at 414px',mobNB.w>=mobNB.vw*.9&&mobNB.w<=mobNB.vw,mobNB);
  check('ZERO JS errors during primary regression',jsErrors.length===0,jsErrors.slice(0,8));

  await browser.close(); server.close();
  fs.writeFileSync(path.join(BASE,'answers-roadmap.json'),sidecarOriginal);
  console.log(fails.length ? `\nFAILED ${fails.length}: ${fails.join(' ; ')}` : '\nALL TESTS PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch(e=>{console.error('FATAL',e);try{fs.writeFileSync(path.join(BASE,'answers-roadmap.json'),sidecarOriginal)}catch(_){}process.exit(2)});
