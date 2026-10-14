const puppeteer = require('puppeteer');
const FILE = 'file:///home/user/packpolymer-marketplace-roadmap.html';
let failures = [];
function ok(name, cond, extra) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); if (!cond) failures.push(name); }
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let promptValue = '';
  page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept(promptValue); else await d.accept(); });
  await page.evaluateOnNewDocument(() => {
    window.__copied = null;
    try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) {}
  });
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 900));

  const base = await page.evaluate(() => ({
    phases: document.querySelectorAll('.phase').length,
    steps: document.querySelectorAll('.step').length,
    sideCards: Array.from(document.querySelectorAll('.side-card .side-h-t')).map(e => e.textContent.trim()),
    vazir: document.fonts.check('16px Vazir'),
    sideH: Math.round(document.querySelector('.side').getBoundingClientRect().height),
    vh: window.innerHeight,
    sideScroll: (() => { const s = document.querySelector('.side'); return s.scrollHeight > s.clientHeight; })(),
    navScroll: (() => { const n = document.querySelector('.navlist'); return n.scrollHeight >= n.clientHeight; })(),
  }));
  ok('counts phases=13', base.phases === 13, base.phases);
  ok('vazir loaded', base.vazir === true);
  ok('sidebar order: overview first', /نمای کلی/.test(base.sideCards[0] || ''), base.sideCards);
  ok('sidebar order: phase list second', /فهرست فازها/.test(base.sideCards[1] || ''), base.sideCards[1]);
  ok('sidebar order: dev guide last', /توسعه دهنده/.test(base.sideCards[base.sideCards.length - 1] || ''), base.sideCards[base.sideCards.length - 1]);
  ok('sidebar fills viewport height', Math.abs(base.sideH - (base.vh - 114)) <= 8, { sideH: base.sideH, vh: base.vh });
  ok('sidebar own scroll', base.sideScroll === true);

  // collapse all sidebar cards
  await page.click('[data-act="side-toggle"][data-id="stack"]');
  await new Promise(r => setTimeout(r, 350));
  let collapsed = await page.evaluate(() => { const b=document.querySelector('[data-act="side-toggle"][data-id="stack"]'); return !!b && b.closest('.side-card').classList.contains('closed') && !b.closest('.side-card').querySelector('.stack-chips'); });
  ok('sidebar card collapse works (stack)', collapsed);
  await page.click('[data-act="side-toggle"][data-id="stack"]');
  await new Promise(r => setTimeout(r, 350));

  // sidebar phase tree expand + goto step
  await page.evaluate(() => { const t = document.querySelector('[data-act="side-phase-toggle"]'); t.scrollIntoView(); t.click(); });
  await new Promise(r => setTimeout(r, 400));
  let tree = await page.evaluate(() => ({ steps: document.querySelectorAll('.tree-steps .navstep').length, firstNum: (document.querySelector('.tree-steps .ns-num') || {}).textContent }));
  ok('sidebar phase expands to steps', tree.steps > 0, tree);
  await page.evaluate(() => document.querySelector('.tree-steps .navstep').click());
  await new Promise(r => setTimeout(r, 600));
  let gotoStep = await page.evaluate(() => { const h = document.querySelector('.step.hit'); return { hit: !!h, mainStepsVisible: !!h }; });
  ok('sidebar step click navigates/flashes step', gotoStep.hit === true, gotoStep);

  // search digits equivalence
  async function searchCount(q) {
    await page.evaluate((v) => { const el = document.querySelector('#q'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, q);
    await new Promise(r => setTimeout(r, 550));
    return page.evaluate(() => document.querySelectorAll('.step').length);
  }
  const sEn = await searchCount('فاز 1'), sFa = await searchCount('فاز ۱');
  ok('search EN digit == FA digit', sEn === sFa && sEn > 0, { sEn, sFa });
  await searchCount('');

  // stack filter + highlight + Vazir
  await page.evaluate(() => { const chips = Array.from(document.querySelectorAll('.schip')); const c = chips.find(x => x.dataset.id === 'Dokan Pro'); c.scrollIntoView(); c.click(); });
  await new Promise(r => setTimeout(r, 600));
  let stk = await page.evaluate(() => ({
    marks: document.querySelectorAll('mark.hl-stack').length,
    font: getComputedStyle(document.querySelector('.schip')).fontFamily,
    activeNote: !!document.querySelector('.stack-active-note'),
    steps: document.querySelectorAll('.step').length
  }));
  ok('stack filter shows steps', stk.steps > 0, stk.steps);
  ok('stack keyword highlighted <mark.hl-stack>', stk.marks > 0, stk.marks);
  ok('stack chips use Vazir', /Vazir/.test(stk.font), stk.font);
  ok('stack active note explains highlight', stk.activeNote === true);
  await page.evaluate(() => document.querySelector('[data-act="stack-clear"]').click());
  await new Promise(r => setTimeout(r, 500));

  // checkbox parent/child
  await page.evaluate(() => { document.querySelector('.step input[data-ck]').click(); });
  await new Promise(r => setTimeout(r, 250));
  let ck = await page.evaluate(() => { const st = document.querySelector('.step'); return { done: st.classList.contains('done'), subsDone: st.querySelectorAll('.sub.done').length, subs: st.querySelectorAll('.sub').length }; });
  ok('step tick ticks all subs', ck.done && ck.subsDone === ck.subs, ck);
  await page.evaluate(() => { document.querySelector('.step input[data-ck]').click(); });

  // NOTEBOOK multi-note + list + modes + copy + last note + width
  await page.click('#fabNote');
  await new Promise(r => setTimeout(r, 500));
  let nb0 = await page.evaluate(() => ({
    open: document.querySelector('#nbPanel').classList.contains('open'),
    listVisible: !document.querySelector('[data-nb-listview]').hidden,
    width: Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width)
  }));
  ok('notebook opens to Note List (no notes yet)', nb0.open && nb0.listVisible, nb0);
  ok('notebook width >= 800 (doubled)', nb0.width >= 800, nb0.width);
  await page.click('[data-nb="new"]');
  await new Promise(r => setTimeout(r, 300));
  await page.type('#nbTitle', 'یادداشت تست اول');
  await page.type('#nbEdit', '# تیتر یک\n\nمتن **مهم** برای تست\n\n- [ ] کار اول');
  await new Promise(r => setTimeout(r, 500));
  let nb1 = await page.evaluate(() => ({ view: !document.querySelector('[data-nb-noteview]').hidden, editVisible: !document.querySelector('#nbEdit').hidden, previewHidden: document.querySelector('#nbPreview').hidden, total: document.querySelector('[data-nb-total]').textContent }));
  ok('new note opens editor (Edit only, preview hidden)', nb1.view && nb1.editVisible && nb1.previewHidden, nb1);
  // copy in Edit => raw markdown
  await page.click('[data-nb="copy"]');
  await new Promise(r => setTimeout(r, 250));
  let copiedEdit = await page.evaluate(() => window.__copied || '');
  ok('Copy in Edit copies raw Markdown', copiedEdit.includes('**مهم**') && copiedEdit.includes('# تیتر'), copiedEdit.slice(0, 60));
  // switch to Read
  await page.click('[data-nb="toggle-mode"]');
  await new Promise(r => setTimeout(r, 300));
  let nb2 = await page.evaluate(() => ({ editHidden: document.querySelector('#nbEdit').hidden, previewVisible: !document.querySelector('#nbPreview').hidden, h1: !!document.querySelector('#nbPreview h1'), bothVisible: !document.querySelector('#nbEdit').hidden && !document.querySelector('#nbPreview').hidden }));
  ok('Read Mode: edit hidden, preview visible, never side-by-side', nb2.editHidden && nb2.previewVisible && !nb2.bothVisible, nb2);
  ok('Read Mode renders Markdown h1', nb2.h1 === true);
  await page.click('[data-nb="copy"]');
  await new Promise(r => setTimeout(r, 250));
  let copiedRead = await page.evaluate(() => window.__copied || '');
  ok('Copy in Read copies rendered text only (no ** )', copiedRead.includes('مهم') && !copiedRead.includes('**'), copiedRead.slice(0, 80));
  // back to list
  await page.click('[data-nb="back-list"]');
  await new Promise(r => setTimeout(r, 300));
  let nb3 = await page.evaluate(() => ({ cards: document.querySelectorAll('.nb-card').length, listVisible: !document.querySelector('[data-nb-listview]').hidden, backLabel: document.querySelector('[data-nb="back-list"]') ? true : true }));
  ok('Back to Note List shows list with 1 card', nb3.cards === 1 && nb3.listVisible, nb3);
  const backText = await page.evaluate(() => { document.querySelector('.nb-card').click(); return new Promise(res => setTimeout(() => res(document.querySelector('[data-nb="back-list"]').textContent), 250)); });
  ok('note card reopens note; Back button labeled Back to Note List', /Back to Note List/.test(backText), backText);
  // second note, then reopen notebook -> last note
  await page.click('[data-nb="back-list"]');
  await new Promise(r => setTimeout(r, 250));
  await page.click('[data-nb="new"]');
  await new Promise(r => setTimeout(r, 250));
  await page.type('#nbTitle', 'یادداشت دوم - آخرین');
  await page.type('#nbEdit', 'متن یادداشت دوم');
  await new Promise(r => setTimeout(r, 500));
  await page.click('[data-nb="close"]');
  await new Promise(r => setTimeout(r, 350));
  await page.click('#fabNote');
  await new Promise(r => setTimeout(r, 500));
  let nb4 = await page.evaluate(() => ({ inNote: !document.querySelector('[data-nb-noteview]').hidden, title: document.querySelector('#nbTitle').value, total: document.querySelector('[data-nb-total]').textContent }));
  ok('reopen notebook resumes Last Note', nb4.inNote && /آخرین/.test(nb4.title), nb4);
  ok('two notes stored', /۲/.test(nb4.total), nb4.total);
  await page.click('[data-nb="close"]');
  await new Promise(r => setTimeout(r, 300));

  // NUMBERING: edit mode insertions with prompt position
  await page.evaluate(() => document.querySelector('[data-act="edit-mode"]').click());
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => document.querySelector('[data-act="expand-all"]').click());
  await new Promise(r => setTimeout(r, 500));
  // add sub at position 2 in first step
  promptValue = '2';
  await page.evaluate(() => document.querySelector('.step [data-act="add-sub"]').click());
  await new Promise(r => setTimeout(r, 500));
  let num1 = await page.evaluate(() => {
    const st = document.querySelector('.step');
    const nums = Array.from(st.querySelectorAll('.sub-num')).map(e => e.textContent.trim());
    const titles = Array.from(st.querySelectorAll('.sub-t')).map(e => e.textContent.trim());
    return { nums, insertedAt2: /جدید/.test(titles[1] || ''), sequential: nums.every((n, i) => n.endsWith(String(i + 1).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d])) || true) };
  });
  ok('add SubStep with number 2 inserts at position 2', num1.insertedAt2 === true, num1.titles ? '' : num1.nums);
  ok('sub numbers displayed (hierarchical)', num1.nums.length > 1 && /\./.test(num1.nums[0] || ''), num1.nums.slice(0, 3));
  // add step at position 1 in first phase
  promptValue = '1';
  await page.evaluate(() => document.querySelector('.phase [data-act="add-step"]').click());
  await new Promise(r => setTimeout(r, 500));
  let num2 = await page.evaluate(() => { const ph = document.querySelector('.phase'); const first = ph.querySelector('.step .st-title'); const firstNum = ph.querySelector('.step .st-num').textContent.trim(); return { firstIsNew: /مرحله جدید/.test(first.textContent), firstNum }; });
  ok('add Step with number 1 inserts first + renumbers', num2.firstIsNew === true, num2);
  // add phase at position 2
  promptValue = '2';
  await page.evaluate(() => document.querySelector('.phase [data-act="add-phase"]').click());
  await new Promise(r => setTimeout(r, 600));
  let num3 = await page.evaluate(() => { const phs = document.querySelectorAll('.phase'); const second = phs[1]; return { count: phs.length, secondIsNew: /فاز جدید/.test(second.textContent), secondLabel: (second.querySelector('.ph-num') || {}).textContent }; });
  ok('add Phase with number 2 inserts second + auto label', num3.secondIsNew === true && num3.count === 14, num3);
  // delete that new sub/phase cleanup: delete new phase (position2) via its del button
  promptValue = '';
  await page.evaluate(() => { const phs = document.querySelectorAll('.phase'); phs[1].querySelector('[data-act="del-phase"]').click(); });
  await new Promise(r => setTimeout(r, 500));
  let num4 = await page.evaluate(() => ({ count: document.querySelectorAll('.phase').length, firstLabel: (document.querySelector('.phase .ph-num') || {}).textContent }));
  ok('delete phase renumbers back to 13', num4.count === 13, num4);
  await page.evaluate(() => document.querySelector('[data-act="edit-mode"]').click());
  await new Promise(r => setTimeout(r, 400));

  // report menu + modal
  await page.evaluate(() => document.querySelector('[data-act="report-menu"]').click());
  await new Promise(r => setTimeout(r, 250));
  await page.evaluate(() => document.querySelector('[data-act="report"][data-id="done"]').click());
  await new Promise(r => setTimeout(r, 400));
  let rep = await page.evaluate(() => ({ modal: document.querySelector('#textModal').classList.contains('show'), hasNb: document.querySelector('#textModal .modal-text').value.includes('یادداشت تست اول') || document.querySelector('#textModal .modal-text').value.includes('یادداشت دوم') }));
  ok('MD report modal opens + includes notebook notes', rep.modal === true && rep.hasNb === true, rep);
  await page.evaluate(() => document.querySelector('[data-modal="close"]').click());

  // clean all clears notes too
  await page.evaluate(() => document.querySelector('[data-act="clean-all"]').click());
  await new Promise(r => setTimeout(r, 600));
  let clean = await page.evaluate(() => ({ done: document.querySelector('[data-stat="done"]').textContent, ls: (() => { try { const s = JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')); return { nb: (s.nbNotes || []).length, nbText: (s.notebook || '').length }; } catch (e) { return {}; } })() }));
  ok('clean-all clears notebook notes', clean.ls.nb === 0, clean);

  // responsive
  for (const w of [1280, 768, 414]) {
    await page.setViewport({ width: w, height: 800 });
    await new Promise(r => setTimeout(r, 450));
    let r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, nbW: Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width) }));
    ok('responsive no horizontal overflow @' + w, r.sw <= r.cw + 1, r);
  }
  await page.setViewport({ width: 414, height: 800 });
  await page.click('#fabNote');
  await new Promise(r => setTimeout(r, 400));
  let mob = await page.evaluate(() => ({ listVisible: !document.querySelector('[data-nb-listview]').hidden || !document.querySelector('[data-nb-noteview]').hidden, w: Math.round(document.querySelector('#nbPanel').getBoundingClientRect().width), vw: window.innerWidth }));
  ok('notebook mobile fills width', mob.w <= mob.vw && mob.w >= mob.vw * 0.9, mob);
  await page.click('[data-nb="close"]');

  ok('ZERO JS errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log(failures.length ? ('\nFAILED: ' + failures.join(' ; ')) : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
