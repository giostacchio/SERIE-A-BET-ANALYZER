(() => {
  'use strict';

  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const SPECIAL_KEY = 'football-v16-special-competition';
  const STATUS_KEY = 'football-v16-loader-status';
  const TOKEN_KEY = 'seriea-analyzer-token-v1';
  const LABELS = { UEFA: 'Coppe UEFA', CL: 'Champions League', EL: 'Europa League' };

  const SOURCES = {
    EL: 'https://r.jina.ai/https://www.uefa.com/uefaeuropaleague/news/02a8-2174cafa5bb6-82bbc20c9b92-1000--2026-27-europa-league-all-the-league-phase-fixtures/',
    CL: 'https://r.jina.ai/https://www.uefa.com/uefachampionsleague/news/02a8-2174c9e9019d-f909a77bd77a-1000--2026-27-champions-league-all-the-league-phase-fixtures/'
  };

  const MONTHS = {
    january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
    gennaio:0,febbraio:1,marzo:2,aprile:3,maggio:4,giugno:5,luglio:6,agosto:7,settembre:8,ottobre:9,novembre:10,dicembre:11
  };

  function hash(value) {
    let h = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function team(name) {
    const clean = String(name || '').trim();
    return { id: hash('uefa-team|' + clean), name: clean, shortName: clean };
  }

  function fixture(code, md, iso, home, away) {
    return {
      id: 'uefa-' + code.toLowerCase() + '-' + hash(code + '|' + iso + '|' + home + '|' + away),
      utcDate: new Date(iso).toISOString(),
      matchday: md,
      status: 'SCHEDULED',
      competitionCode: code,
      homeTeam: team(home), awayTeam: team(away), homeScore: null, awayScore: null
    };
  }

  function embeddedFixtures(code) {
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

  function clean(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/^[#>*\-]+\s*/, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDate(line) {
    const s = clean(line);
    const m = s.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica)?\s*(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/i);
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase()];
    if (month == null) return null;
    return { day:Number(m[1]), month, year:Number(m[3]) };
  }

  function parseOfficialText(text, code) {
    const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
    const out = [];
    let activeDate = null;
    let matchday = 0;
    for (const raw of lines) {
      const line = clean(raw);
      const md = line.match(/(?:Matchday|Giornata)\s*(\d+)/i);
      if (md) { matchday = Number(md[1]); continue; }
      const date = parseDate(line);
      if (date) { activeDate = date; continue; }
      if (!activeDate) continue;
      const match = line.match(/^(.+?)\s+(?:vs|v\.?|[-–—])\s+(.+?)(?:\s+\((\d{1,2}:\d{2})(?:\s*CET|\s*CEST)?\))?$/i);
      if (!match) continue;
      let home = clean(match[1]);
      let away = clean(match[2]).replace(/\s+\d+[-–]\d+.*$/, '').trim();
      home = home.replace(/\s+\d+[-–]\d+.*$/, '').trim();
      if (!home || !away || /fixture|result|calendar|calendario|highlight/i.test(home + ' ' + away)) continue;
      const time = match[3] || '21:00';
      const offset = (activeDate.month >= 2 && activeDate.month <= 9) ? '+02:00' : '+01:00';
      const iso = `${activeDate.year}-${String(activeDate.month+1).padStart(2,'0')}-${String(activeDate.day).padStart(2,'0')}T${time}:00${offset}`;
      out.push(fixture(code, matchday || 1, iso, home, away));
    }
    const unique = new Map();
    out.forEach((m) => unique.set(m.id, m));
    return Array.from(unique.values()).sort((a,b) => Date.parse(a.utcDate)-Date.parse(b.utcDate));
  }

  function currentOrNext(fixtures) {
    const now = Date.now();
    const future = fixtures.filter((m) => Date.parse(m.utcDate) >= now - 6*60*60*1000).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate));
    if (!future.length) return [];
    const first = future[0];
    if (first.matchday) {
      const same = future.filter((m) => m.matchday === first.matchday);
      if (same.length) return same;
    }
    const end = Date.parse(first.utcDate) + 48*60*60*1000;
    return future.filter((m)=>Date.parse(m.utcDate)<=end);
  }

  async function fetchOfficial(code) {
    try {
      const response = await fetch(SOURCES[code], { cache:'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      const parsed = parseOfficialText(text, code);
      const selected = currentOrNext(parsed);
      if (selected.length) return { code, source:'UEFA ufficiale', upcoming:selected, history:[] };
    } catch (_error) {}
    const selected = currentOrNext(embeddedFixtures(code));
    if (!selected.length) throw new Error('calendario UEFA non disponibile');
    return { code, source:'UEFA ufficiale · calendario incorporato', upcoming:selected, history:[] };
  }

  function setMessage(text, error) {
    const el = document.getElementById('message');
    const dot = document.getElementById('dataDot');
    if (el) el.textContent = text;
    if (dot) dot.classList.toggle('error', Boolean(error));
  }

  function save(target, rows) {
    let upcoming = rows.flatMap((r)=>r.upcoming).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate));
    if (target === 'UEFA' && upcoming.length) {
      const min = Date.parse(upcoming[0].utcDate);
      upcoming = upcoming.filter((m)=>Date.parse(m.utcDate) <= min + 4*24*60*60*1000);
    }
    if (!upcoming.length) throw new Error('nessuna partita disponibile');
    const old = (()=>{ try{return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||'null');}catch{return null;} })();
    const history = old && Array.isArray(old.history) ? old.history : [];
    localStorage.setItem(SPECIAL_KEY, target);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ upcoming, history, loadedCompetition:'ALL', updatedAt:new Date().toISOString(), isDemo:false }));
    const sources = Array.from(new Set(rows.map((r)=>r.source))).join(' + ');
    localStorage.setItem(STATUS_KEY, LABELS[target] + ': ' + upcoming.length + ' partite caricate · ' + sources + '.');
  }

  async function loadTarget(target) {
    setMessage('Aggiorno ' + LABELS[target] + '…', false);
    try {
      const rows = target === 'UEFA'
        ? await Promise.all([fetchOfficial('EL'), fetchOfficial('CL')])
        : [await fetchOfficial(target)];
      save(target, rows);
      window.location.reload();
    } catch (error) {
      setMessage('Aggiornamento UEFA non riuscito: ' + (error && error.message || 'errore sconosciuto') + '.', true);
    }
  }

  document.addEventListener('click', (event) => {
    const special = event.target.closest && event.target.closest('#leagueNav button[data-euro-league]');
    const sync = event.target.closest && event.target.closest('#syncBtn');
    const current = localStorage.getItem(SPECIAL_KEY) || '';
    if (!special && !(sync && ['UEFA','CL','EL'].includes(current))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadTarget(special ? special.dataset.euroLeague : current);
  }, true);
})();