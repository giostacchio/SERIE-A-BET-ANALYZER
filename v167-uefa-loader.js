(() => {
  'use strict';

  const TOKEN_KEY = 'seriea-analyzer-token-v1';
  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const COMP_KEY = 'football-analyzer-competition-v1';
  const SPECIAL_KEY = 'football-v16-special-competition';
  const STATUS_KEY = 'football-v16-loader-status';
  const LABELS = { UEFA:'Coppe UEFA', CL:'Champions League', EL:'Europa League' };

  const SOURCES = {
    EL: [
      'https://r.jina.ai/https://www.uefa.com/uefaeuropaleague/news/02a8-2174cafa5bb6-82bbc20c9b92-1000--2026-27-europa-league-all-the-league-phase-fixtures/',
      'https://r.jina.ai/https://www.uefa.com/uefaeuropaleague/fixtures-results/'
    ],
    CL: [
      'https://r.jina.ai/https://www.uefa.com/uefachampionsleague/news/02a8-2174c9e9019d-f909a77bd77a-1000--2026-27-champions-league-all-the-league-phase-fixtures/',
      'https://r.jina.ai/https://www.uefa.com/uefachampionsleague/fixtures-results/'
    ]
  };

  const MONTHS = {
    january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
    gennaio:0,febbraio:1,marzo:2,aprile:3,maggio:4,giugno:5,luglio:6,agosto:7,settembre:8,ottobre:9,novembre:10,dicembre:11
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const readJson = (key, fallback) => { try { const x = JSON.parse(localStorage.getItem(key) || ''); return x == null ? fallback : x; } catch { return fallback; } };
  const setMessage = (text, error) => {
    const el = document.getElementById('message');
    const dot = document.getElementById('dataDot');
    if (el) el.textContent = text;
    if (dot) dot.classList.toggle('error', Boolean(error));
  };
  const hash = (value) => {
    let h = 2166136261;
    const text = String(value || '');
    for (let i=0;i<text.length;i+=1) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619); }
    return h >>> 0;
  };
  const team = (name) => ({ id:hash('team|' + name), name, shortName:name });
  const fixture = (code, md, iso, home, away) => ({
    id:'uefa-' + code.toLowerCase() + '-' + hash(code+'|'+iso.slice(0,10)+'|'+home+'|'+away),
    utcDate:new Date(iso).toISOString(), matchday:md, status:'SCHEDULED', competitionCode:code,
    homeTeam:team(home), awayTeam:team(away), homeScore:null, awayScore:null
  });

  function clean(value) {
    return String(value || '')
      .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/^\s*[-*>]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDate(line) {
    const s = clean(line).replace(/^#+\s*/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    let m = s.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica)?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/i);
    if (m) {
      const month = MONTHS[m[2].toLowerCase()];
      if (month != null) return { day:Number(m[1]), month, year:Number(m[3]) };
    }
    m = s.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/i);
    if (m) {
      const month = MONTHS[m[1].toLowerCase()];
      if (month != null) return { day:Number(m[2]), month, year:Number(m[3]) };
    }
    return null;
  }

  function localIso(parts, time) {
    const p = String(time || '21:00').split(':').map(Number);
    return new Date(parts.year, parts.month, parts.day, p[0] || 21, p[1] || 0, 0, 0).toISOString();
  }

  function parseFixtures(text, code) {
    const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
    const out = [];
    let md = 0;
    let date = null;

    for (const raw of lines) {
      const line = raw.replace(/^#+\s*/, '').trim();
      const day = line.match(/^(?:Matchday|Giornata)\s*(\d+)/i);
      if (day) { md = Number(day[1]); date = null; continue; }
      const d = parseDate(line);
      if (d) { date = d; continue; }
      if (!md || !date || /highlights?|fixture list|calendar|calendario/i.test(line)) continue;

      const timeMatch = line.match(/\((\d{1,2}:\d{2})(?:\s*(?:CET|CEST))?\)\s*$/i);
      const time = timeMatch ? timeMatch[1] : '21:00';
      let body = line.replace(/\s*\((\d{1,2}:\d{2})(?:\s*(?:CET|CEST))?\)\s*$/i, '').trim();
      let home = '', away = '';

      let m = body.match(/^(.+?)\s+(?:vs|v\.?|[-–—])\s+(.+)$/i);
      if (m) { home = clean(m[1]); away = clean(m[2]); }
      if (!home || !away) {
        m = body.match(/^(.+?)\s+\d+\s*[-–—]\s*\d+\s+(.+)$/);
        if (m) { home = clean(m[1]); away = clean(m[2]); }
      }
      if (!home || !away) continue;
      home = home.replace(/\s+\d+\s*[-–—]\s*\d+.*$/, '').trim();
      away = away.replace(/\s+\d+\s*[-–—]\s*\d+.*$/, '').trim();
      if (!home || !away) continue;
      out.push(fixture(code, md, localIso(date, time), home, away));
    }

    const unique = new Map();
    out.forEach((m) => unique.set(m.id, m));
    return Array.from(unique.values()).sort((a,b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
  }

  function embedded(code) {
    if (code === 'EL') return [
      fixture('EL',1,'2026-09-16T18:45:00+02:00','Ararat-Armenia','Sparta Praha'),
      fixture('EL',1,'2026-09-16T18:45:00+02:00','Omonia','Celta'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Milan','Benfica'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Leverkusen','Celje'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Hapoel Beer-Sheva','GNK Dinamo'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Olympiacos','Jagiellonia'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Anderlecht','Lyon'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Sturm Graz','Rennes'),
      fixture('EL',1,'2026-09-16T21:00:00+02:00','Sunderland','AZ Alkmaar'),
      fixture('EL',1,'2026-09-17T18:45:00+02:00','OFI Crete','Hoffenheim'),
      fixture('EL',1,'2026-09-17T18:45:00+02:00','Levski Sofia','Salzburg'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Beşiktaş','Marseille'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Celtic','Ferencváros'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Crystal Palace','Lech Poznań'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Viktoria Plzeň','Union SG'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Juventus','N.E.C.'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Lillestrøm','Torreense'),
      fixture('EL',1,'2026-09-17T21:00:00+02:00','Real Sociedad','Bournemouth'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Sparta Praha','Lillestrøm'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','AZ Alkmaar','Hapoel Beer-Sheva'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Salzburg','Milan'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Lech Poznań','Leverkusen'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Celje','Omonia'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Lyon','Crystal Palace'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Union SG','Real Sociedad'),
      fixture('EL',2,'2026-10-15T18:45:00+02:00','Torreense','Sunderland'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Bournemouth','Sturm Graz'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Ferencváros','Viktoria Plzeň'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','GNK Dinamo','Anderlecht'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Jagiellonia','Ararat-Armenia'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','N.E.C.','Levski Sofia'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Marseille','Olympiacos'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Celta','Juventus'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Benfica','Celtic'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Rennes','OFI Crete'),
      fixture('EL',2,'2026-10-15T21:00:00+02:00','Hoffenheim','Beşiktaş')
    ];
    if (code === 'CL') return [
      fixture('CL',2,'2026-10-13T18:45:00+02:00','Lens','Sporting CP'),
      fixture('CL',2,'2026-10-13T18:45:00+02:00','Sabah','Slavia Praha'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Arsenal','Lille'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Atlético de Madrid','Manchester United'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Inter','Club Brugge'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Galatasaray','Barcelona'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Leipzig','PSV Eindhoven'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Viking','Bayern München'),
      fixture('CL',2,'2026-10-13T21:00:00+02:00','Villarreal','Napoli'),
      fixture('CL',2,'2026-10-14T18:45:00+02:00','Feyenoord','Como'),
      fixture('CL',2,'2026-10-14T18:45:00+02:00','LASK','Liverpool'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Roma','Real Madrid'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Aston Villa','Fenerbahçe'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Shakhtar Donetsk','AEK Athens'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Bodø/Glimt','Borussia Dortmund'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Manchester City','Paris Saint-Germain'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Real Betis','Porto'),
      fixture('CL',2,'2026-10-14T21:00:00+02:00','Slovan Bratislava','Stuttgart')
    ];
    return [];
  }

  function selectCurrent(fixtures) {
    const rows = fixtures.slice().sort((a,b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    if (!rows.length) return [];
    const threshold = Date.now() - 6*3600000;
    const viable = rows.filter((m) => Date.parse(m.utcDate) >= threshold);
    if (!viable.length) return [];
    const first = viable[0];
    let selected = viable.filter((m) => m.matchday === first.matchday && Date.parse(m.utcDate) >= threshold);
    if (!selected.length) selected = viable.filter((m) => Date.parse(m.utcDate) <= Date.parse(first.utcDate) + 48*3600000);
    return selected;
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const r = await fetch(url, { cache:'no-store', signal:controller.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      if (text.length < 250) throw new Error('risposta vuota');
      return text;
    } finally { clearTimeout(timer); }
  }

  async function loadCalendar(code) {
    const errors = [];
    for (const url of SOURCES[code] || []) {
      try {
        const parsed = parseFixtures(await fetchText(url), code);
        const selected = selectCurrent(parsed);
        if (selected.length) return { code, source:'UEFA', upcoming:selected, history:[] };
        errors.push('nessuna partita letta');
      } catch (e) { errors.push(e && e.message || 'errore'); }
    }
    const fallback = selectCurrent(embedded(code));
    if (fallback.length) return { code, source:'UEFA · calendario incorporato verificato', upcoming:fallback, history:[] };
    throw new Error('UEFA: ' + errors.join(' / '));
  }

  function currentSeason() { const d = new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear()-1; }
  function normalizeApi(raw, code) {
    return { id:String(raw.id), utcDate:raw.utcDate, matchday:Number(raw.matchday||0), status:raw.status, competitionCode:code,
      homeTeam:{ id:Number(raw.homeTeam&&raw.homeTeam.id||0), name:raw.homeTeam&&raw.homeTeam.name||'Casa', shortName:raw.homeTeam&&(raw.homeTeam.shortName||raw.homeTeam.name)||'Casa' },
      awayTeam:{ id:Number(raw.awayTeam&&raw.awayTeam.id||0), name:raw.awayTeam&&raw.awayTeam.name||'Ospite', shortName:raw.awayTeam&&(raw.awayTeam.shortName||raw.awayTeam.name)||'Ospite' },
      homeScore:raw.score&&raw.score.fullTime&&raw.score.fullTime.home!=null?Number(raw.score.fullTime.home):null,
      awayScore:raw.score&&raw.score.fullTime&&raw.score.fullTime.away!=null?Number(raw.score.fullTime.away):null };
  }
  async function loadApi(code, token) {
    if (!token) throw new Error('token assente');
    const url = 'https://api.football-data.org/v4/competitions/' + code + '/matches?season=' + currentSeason();
    const r = await fetch(url, { headers:{'X-Auth-Token':token,Accept:'application/json'}, cache:'no-store' });
    if (!r.ok) throw new Error('football-data HTTP ' + r.status);
    const p = await r.json();
    const all = (p.matches || []).map((m) => normalizeApi(m, code));
    const upcoming = selectCurrent(all.filter((m) => ['SCHEDULED','TIMED','POSTPONED'].includes(m.status)));
    const history = all.filter((m) => m.status === 'FINISHED' && m.homeScore != null && m.awayScore != null).slice(-260);
    if (!upcoming.length) throw new Error('nessuna prossima partita API');
    return { code, source:'football-data.org', upcoming, history };
  }
  async function loadEuropean(code, token) {
    try { return await loadApi(code, token); } catch (_) { return loadCalendar(code); }
  }

  function saveSnapshot(target, loaded, failures) {
    let upcoming = loaded.flatMap((r) => r.upcoming).sort((a,b) => Date.parse(a.utcDate)-Date.parse(b.utcDate));
    if (target === 'UEFA' && upcoming.length) {
      const start = Date.parse(upcoming[0].utcDate);
      upcoming = upcoming.filter((m) => Date.parse(m.utcDate) <= start + 4*86400000);
    }
    if (!upcoming.length) throw new Error('nessuna partita disponibile');

    const old = readJson(SNAPSHOT_KEY, null);
    let history = loaded.flatMap((r) => r.history || []);
    const codes = new Set(upcoming.map((m) => m.competitionCode));
    if (old && Array.isArray(old.history)) {
      old.history.forEach((m) => {
        if (!codes.has(m.competitionCode)) return;
        const key = String(m.id) + '|' + String(m.competitionCode || '');
        if (!history.some((x) => String(x.id)+'|'+String(x.competitionCode||'') === key)) history.push(m);
      });
    }
    history.sort((a,b) => Date.parse(a.utcDate)-Date.parse(b.utcDate));

    localStorage.setItem(SPECIAL_KEY, target);
    localStorage.setItem(COMP_KEY, 'ALL');
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ upcoming, history, loadedCompetition:'ALL', updatedAt:new Date().toISOString(), isDemo:false }));
    const sources = Array.from(new Set(loaded.map((r) => r.source))).join(' + ');
    let status = LABELS[target] + ': ' + upcoming.length + ' partite caricate · ' + sources + '.';
    if (failures.length) status += ' Non caricati: ' + failures.map((x) => LABELS[x.code] + ' (' + x.error + ')').join(', ') + '.';
    localStorage.setItem(STATUS_KEY, status);
  }

  async function sync(target) {
    const tokenField = document.getElementById('footballToken');
    const draft = tokenField && tokenField.value.trim();
    if (draft) localStorage.setItem(TOKEN_KEY, draft);
    const token = draft || localStorage.getItem(TOKEN_KEY) || '';
    const codes = target === 'UEFA' ? ['CL','EL'] : [target];
    const loaded = [], failures = [];
    setMessage('Aggiorno ' + LABELS[target] + '…', false);
    for (let i=0;i<codes.length;i+=1) {
      const code = codes[i];
      setMessage('Aggiorno ' + LABELS[code] + ' (' + (i+1) + '/' + codes.length + ')…', false);
      try { loaded.push(await loadEuropean(code, token)); }
      catch (e) { failures.push({code,error:e&&e.message||'errore'}); }
      if (i < codes.length-1) await wait(300);
    }
    if (!loaded.length) {
      setMessage('Aggiornamento non riuscito. ' + failures.map((x) => LABELS[x.code] + ': ' + x.error).join(' · '), true);
      return;
    }
    saveSnapshot(target, loaded, failures);
    location.reload();
  }

  function restoreUi() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    if (special) {
      document.querySelectorAll('#leagueNav button').forEach((b) => b.classList.remove('active','special-active'));
      const b = document.querySelector('#leagueNav button[data-euro-league="' + special + '"]');
      if (b) b.classList.add('active','special-active');
      const mode = document.getElementById('dataMode');
      if (mode) mode.textContent = LABELS[special].toUpperCase() + ' · AGGIORNATO';
    }
    const status = localStorage.getItem(STATUS_KEY);
    if (status) { localStorage.removeItem(STATUS_KEY); setTimeout(() => setMessage(status, false), 180); }
  }

  function patchLabels() {
    document.querySelectorAll('#matchGrid .match-card').forEach((card) => {
      const decision = card.querySelector('.match-decision strong');
      const badge = card.querySelector('.decision-badge');
      const footer = card.querySelector('.match-footer span:first-child');
      const meta = card.querySelector('.match-meta span');
      if (decision && decision.textContent.trim() === 'PASSA') decision.textContent = 'ANALISI';
      if (badge && badge.textContent.trim() === 'SCARTATA') badge.textContent = 'DA VALUTARE';
      if (footer && footer.textContent.trim() === 'Nessuna giocata') footer.textContent = 'Apri per vedere tutte le stime';
      if (meta) meta.textContent = meta.textContent.replace(/^EL\s*·/, 'Europa League ·').replace(/^CL\s*·/, 'Champions League ·');
    });
  }

  document.addEventListener('click', (event) => {
    const special = event.target.closest && event.target.closest('#leagueNav button[data-euro-league]');
    const syncBtn = event.target.closest && event.target.closest('#syncBtn');
    const current = localStorage.getItem(SPECIAL_KEY) || '';
    if (!special && !(syncBtn && ['UEFA','CL','EL'].includes(current))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sync(special ? special.dataset.euroLeague : current);
  }, true);

  const observer = new MutationObserver(patchLabels);
  addEventListener('load', () => {
    restoreUi();
    patchLabels();
    const grid = document.getElementById('matchGrid');
    if (grid) observer.observe(grid, {childList:true,subtree:true});
  });
})();