const puppeteer = require('puppeteer');
const http = require('http'); const fs = require('fs'); const path = require('path');
let failures = [];
function ok(n, c, x) { console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x !== undefined ? ' | ' + JSON.stringify(x) : '')); if (!c) failures.push(n); }
(async () => {
  // serve /home/user for sidecar + sandbox tests
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f === '/') f = '/packpolymer-marketplace-roadmap.html';
    const full = path.join('/home/user', f);
    fs.readFile(full, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'Content-Type': full.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' }); res.end(d); } });
  });
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  // seed sidecar with multi-note
  fs.writeFileSync('/tmp/seed-note.txt', 'x');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  await page.setViewport({ width: 1300, height: 850 });
  await page.evaluateOnNewDocument(() => { window.__copied = null; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) {} });

  // 1) sandbox iframe (localStorage throws)
  await page.setContent('<iframe sandbox="allow-scripts" src="http://127.0.0.1:8899/packpolymer-marketplace-roadmap.html" style="width:1200px;height:800px"></iframe>', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1800));
  const frame = page.frames().find(f => f.url().includes('8899'));
  let sb = { phases: 0 };
  if (frame) sb = await frame.evaluate(() => ({ phases: document.querySelectorAll('.phase').length, steps: document.querySelectorAll('.step').length }));
  ok('sandbox iframe renders (13 phases)', sb.phases === 13, sb);
  if (frame) {
    await frame.evaluate(() => document.querySelector('#fabNote').click());
    await new Promise(r => setTimeout(r, 500));
    let nbo = await frame.evaluate(() => !document.querySelector('[data-nb-listview]').hidden);
    ok('sandbox notebook opens to list', nbo === true);
    await frame.evaluate(() => document.querySelector('[data-nb="new"]').click());
    await new Promise(r => setTimeout(r, 300));
    await frame.type('#nbTitle', 'سندباکس نوت');
    await frame.type('#nbEdit', 'متن **تست** سندباکس');
    await new Promise(r => setTimeout(r, 400));
    await frame.evaluate(() => document.querySelector('[data-nb="toggle-mode"]').click());
    await new Promise(r => setTimeout(r, 300));
    let rd = await frame.evaluate(() => ({ read: !document.querySelector('#nbPreview').hidden, strong: !!document.querySelector('#nbPreview strong') }));
    ok('sandbox notebook create+read mode works', rd.read && rd.strong, rd);
  }

  // 2) sidecar auto-load over http with nbNotes
  const seed = { app: 'packpolymer-marketplace-roadmap', kind: 'answers', version: 2, savedAt: new Date(Date.now() + 60000).toISOString(), checks: {}, notes: {}, notebook: '', nbNotes: [{ id: 'nb-seed1', title: 'یادداشت کناری', body: 'از فایل **کناری** آمد', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], nbActiveId: 'nb-seed1', nbMode: 'edit', nbView: 'note', customized: false };
  const orig = fs.readFileSync('/home/user/answers-roadmap.json', 'utf-8');
  fs.writeFileSync('/home/user/answers-roadmap.json', JSON.stringify(seed, null, 2));
  const page2 = await browser.newPage();
  page2.on('pageerror', e => errors.push('p2 ' + e.message));
  page2.on('dialog', async d => { await d.accept(); });
  await page2.setViewport({ width: 1300, height: 850 });
  await page2.evaluateOnNewDocument(() => { window.__copied = null; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (tx) => { window.__copied = tx; return Promise.resolve(); } }, configurable: true }); } catch (e) {} });
  await page2.goto('http://127.0.0.1:8899/packpolymer-marketplace-roadmap.html', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1600));
  await page2.evaluate(() => document.querySelector('#fabNote').click());
  await new Promise(r => setTimeout(r, 600));
  let side = await page2.evaluate(() => ({ inNote: !document.querySelector('[data-nb-noteview]').hidden, title: document.querySelector('#nbTitle').value }));
  ok('sidecar http auto-loads nbNotes + resumes last note', side.inNote && /کناری/.test(side.title), side);
  fs.writeFileSync('/home/user/answers-roadmap.json', orig);

  // 3) share fallback (no navigator.share in headless -> copy) + export JSON contains nbNotes
  await page2.evaluate(() => { window.__copied = null; });
  await page2.evaluate(() => document.querySelector('[data-nb="share"]').click());
  await new Promise(r => setTimeout(r, 500));
  let sh = await page2.evaluate(() => window.__copied || '');
  ok('notebook share fallback copies note text', /کناری/.test(sh), sh.slice(0, 50));
  let exp = await page2.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('packpolymer-marketplace-roadmap-v2')); return { nb: (s.nbNotes || []).length, active: !!s.nbActiveId }; } catch (e) { return {}; } });
  ok('state persists nbNotes + last note id', exp.nb === 1 && exp.active === true, exp);

  // 4) sidebar bottom alignment at page bottom
  await page2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 600));
  let bot = await page2.evaluate(() => { const r = document.querySelector('.side').getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: window.innerHeight, gap: Math.round(window.innerHeight - r.bottom) }; });
  ok('sidebar extends to bottom of viewport at page end', bot.gap >= 0 && bot.gap <= 24, bot);

  ok('ZERO JS errors (sandbox+sidecar)', errors.length === 0, errors.slice(0, 4));
  await browser.close(); server.close();
  console.log(failures.length ? ('FAILED: ' + failures.join(';')) : 'ALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
