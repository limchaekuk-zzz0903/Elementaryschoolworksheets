// Writes catalog.json: subjects → grades → regions → lessons, read by the 오늘우리집 server
// (subject menu in the app, per-subject progress, valid start screens).
// Usage: node tools/catalog.js            (writes ../catalog.json)
//        node tools/catalog.js --check    (exit 1 if catalog.json is out of date)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto('file://' + path.join(ROOT, 'index.html') + '#home');
  const cat = await p.evaluate(() => {
    const plain = h => String(h).replace(/<[^>]+>/g, '').trim();
    const subjects = SUBJECTS.map(S => {
      const grades = S.grades.map(G => ({
        g: G.g, island: plain(G.island), focus: plain(G.focus), start: gradeHash(S.id, G.g),
        regions: regionsOf(G.g, S.id).map(k => ({ id: k, name: plain(R[k].name), sem: plain(R[k].sem || ''), boss: k + '-boss', lessons: lessonsOf(k).map(l => ({ id: l.id, title: plain(l.t) })) }))
      }));
      const ls = grades.flatMap(G => G.regions.flatMap(r => r.lessons));
      return { id: S.id, name: S.name, icon: SUBJ_ICON[S.id], span: S.span, desc: plain(S.desc), start: S.id,
        grades_range: [S.grades[0].g, S.grades[S.grades.length - 1].g],
        lessons_total: ls.length, crystals_total: grades.reduce((a, G) => a + G.regions.length, 0), grades };
    });
    return { title: '지혜섬 탐험대', lessons_total: LESSONS.length, crystals_total: Object.keys(R).length,
      level_xp: 'xpFor(n)=20*n*(n+1); level = smallest n with xp < xpFor(n)', badges_total: BADGES.length,
      extra_starts: ['home', 'daily', 'trophy', 'review', 'report'], subjects };
  });
  await b.close();
  const out = JSON.stringify(cat, null, 1) + '\n', file = path.join(ROOT, 'catalog.json');
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === out;
    console.log(same ? 'catalog.json is up to date' : 'catalog.json is out of date: run node tools/catalog.js');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(file, out); console.log('wrote catalog.json', cat.lessons_total, 'lessons', cat.crystals_total, 'crystals');
})();
