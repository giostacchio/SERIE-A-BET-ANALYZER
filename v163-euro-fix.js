(() => {
  'use strict';

  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const SPECIAL_KEY = 'football-v16-special-competition';
  const TOKEN_KEY = 'seriea-analyzer-token-v1';
  const ODDS_TOKEN_KEY = 'football-analyzer-rundown-token-v1';
  const ODDS_KEY = 'seriea-analyzer-odds-v1';
  const ODDS_META_KEY = 'football-analyzer-odds-meta-v1';
  const ENRICH_KEY = 'football-v163-euro-enrich';
  const ODDS_SYNC_KEY = 'football-v163-euro-odds-sync';
  const NOTE_KEY = 'football-v163-note';
  const RUNDOWN = { CL: 16, EL: 17 };
  const FORM_GROUPS = ['PL,SA', 'PD,FL1', 'BL1,DED,PPL,ELC', 'CL'];

  const readJson = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key) || ''); return value == null ? fallback : value; }
    catch (_error) { return fallback; }
  };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const setMessage = (text, error) => {
    const message = document.getElementById('message');
    const dot = document.getElementById('dataDot');
    if (message) message.textContent = text;
    if (dot) dot.classList.toggle('error', Boolean(error));
  };
  const hash = (value) => {
    let h = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const normalize = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(fc|cf|ac|afc|sc|ssc|as|fk|sk|jk|tsg|sv|club|calcio|football|futbol|deportivo)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  const similar = (a, b) => {
    const x = normalize(a), y = normalize(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) return true;
    const aliases = [
      ['nec', 'necnijmegen'], ['salzburg', 'rbsalzburg'], ['psg', 'parissaintgermain'],
      ['unionsg', 'royaleunionsaintgilloise'], ['olympiakos', 'olympiacos'],
      ['dinamozagreb', 'gnkdinamo'], ['plzen', 'viktoriaplzen']
    ];
    return aliases.some(([p, q]) => (x === p && y === q) || (x === q && y === p));
  };
  const decimalOdds = (american) => {
    const n = Number(american);
    if (!Number.isFinite(n) || n === 0 || n === 0.0001) return 0;
    return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  };
  const median = (values) => {
    const rows = values.slice().sort((a, b) => a - b);
    if (!rows.length) return 0;
    const m = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[m] : (rows[m - 1] + rows[m]) / 2;
  };
  const quoteKey = (matchId, marketKey) => String(matchId) + '|' + marketKey;

  function currentSpecial() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    return ['EL', 'CL', 'UEFA'].includes(special) ? special : '';
  }

  function fixtureTeamLookup(snapshot) {
    const teams = [];
    (snapshot.upcoming || []).forEach((match) => {
      [match.homeTeam, match.awayTeam].forEach((team) => {
        if (!team || teams.some((row) => String(row.id) === String(team.id))) return;
        teams.push(team);
      });
    });
    return {
      teams,
      find(rawTeam) {
        if (!rawTeam) return null;
        const names = [rawTeam.name, rawTeam.shortName, rawTeam.tla].filter(Boolean);
        return teams.find((team) => names.some((name) => similar(name, team.name) || similar(name, team.shortName))) || null;
      }
    };
  }

  function dateIso(daysAgo) {
    const date = new Date(Date.now() - daysAgo * 86400000);
    return date.toISOString().slice(0, 10);
  }

  async function fetchFootballDataGroup(group, token) {
    const url = 'https://api.football-data.org/v4/matches?competitions=' + encodeURIComponent(group) +
      '&dateFrom=' + dateIso(175) + '&dateTo=' + dateIso(-1) + '&status=FINISHED&limit=500';
    const response = await fetch(url, { headers: { 'X-Auth-Token': token, Accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 429) throw new Error('limite richieste football-data.org');
    if (response.status === 401) throw new Error('chiave football-data.org non valida');
    if (!response.ok) throw new Error('football-data.org HTTP ' + response.status);
    const payload = await response.json();
    return Array.isArray(payload.matches) ? payload.matches : [];
  }

  function convertHistory(raw, code, lookup) {
    const score = raw && raw.score && raw.score.fullTime || {};
    if (score.home == null || score.away == null) return null;
    const homeLinked = lookup.find(raw.homeTeam);
    const awayLinked = lookup.find(raw.awayTeam);
    if (!homeLinked && !awayLinked) return null;
    const makeTeam = (rawTeam, linked) => linked ? {
      id: linked.id,
      name: linked.name,
      shortName: linked.shortName || linked.name
    } : {
      id: hash('form-team|' + normalize(rawTeam && (rawTeam.name || rawTeam.shortName))),
      name: rawTeam && rawTeam.name || 'Squadra',
      shortName: rawTeam && (rawTeam.shortName || rawTeam.name) || 'Squadra'
    };
    return {
      id: 'form-' + String(raw.id),
      utcDate: raw.utcDate,
      matchday: Number(raw.matchday || 0),
      status: 'FINISHED',
      competitionCode: code,
      homeTeam: makeTeam(raw.homeTeam, homeLinked),
      awayTeam: makeTeam(raw.awayTeam, awayLinked),
      homeScore: Number(score.home),
      awayScore: Number(score.away)
    };
  }

  function linkedTeamCount(snapshot, code) {
    const finished = (snapshot.history || []).filter((row) => row.competitionCode === code && row.status === 'FINISHED');
    return (snapshot.upcoming || []).flatMap((m) => [m.homeTeam, m.awayTeam]).filter((team, index, arr) =>
      arr.findIndex((x) => String(x.id) === String(team.id)) === index &&
      finished.filter((row) => String(row.homeTeam.id) === String(team.id) || String(row.awayTeam.id) === String(team.id)).length >= 7
    ).length;
  }

  async function enrichEuropaHistory(snapshot, special) {
    if (special !== 'EL') return false;
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) return false;
    const signature = (snapshot.upcoming || []).map((m) => [m.homeTeam.name, m.awayTeam.name].join('|')).join('||');
    const marker = readJson(ENRICH_KEY, {});
    if (marker.signature === signature && Date.now() - Number(marker.time || 0) < 6 * 3600000) return false;

    const already = (snapshot.history || []).filter((row) => row.competitionCode === 'EL' && row.status === 'FINISHED').length;
    if (already >= 80 && linkedTeamCount(snapshot, 'EL') >= 8) {
      writeJson(ENRICH_KEY, { signature, time: Date.now(), count: already });
      return false;
    }

    setMessage('Europa League: collego lo storico recente delle squadre…', false);
    const lookup = fixtureTeamLookup(snapshot);
    const collected = [];
    for (let i = 0; i < FORM_GROUPS.length; i += 1) {
      try {
        const rows = await fetchFootballDataGroup(FORM_GROUPS[i], token);
        rows.forEach((raw) => {
          const converted = convertHistory(raw, 'EL', lookup);
          if (converted) collected.push(converted);
        });
      } catch (error) {
        if (/non valida/.test(String(error && error.message))) throw error;
      }
      if (i < FORM_GROUPS.length - 1) await wait(850);
    }

    const existing = (snapshot.history || []).filter((row) => row.competitionCode !== 'EL' || !String(row.id).startsWith('form-'));
    const unique = new Map();
    existing.concat(collected).forEach((row) => unique.set(String(row.id) + '|' + String(row.competitionCode || ''), row));
    snapshot.history = Array.from(unique.values()).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    writeJson(SNAPSHOT_KEY, snapshot);
    const linked = linkedTeamCount(snapshot, 'EL');
    writeJson(ENRICH_KEY, { signature, time: Date.now(), count: collected.length, linked });
    localStorage.setItem(NOTE_KEY, 'Europa League: storico recente collegato per ' + linked + ' squadre del turno (' + collected.length + ' risultati utili).');
    return collected.length > 0;
  }

  function eventTeams(event) {
    const teams = event && event.teams || [];
    return {
      home: teams.find((team) => team.is_home) || teams[1] || {},
      away: teams.find((team) => team.is_away) || teams[0] || {}
    };
  }

  function selectionKey(market, participant, line, home, away) {
    const marketName = String(market && market.name || '').toLowerCase();
    const participantName = String(participant && participant.name || '').toLowerCase().trim();
    const lineValue = String(line && line.value || '').toLowerCase().trim();
    if (Number(market && market.market_id) === 1 || marketName.includes('moneyline')) {
      if (participantName.includes('draw') || participantName === 'x') return 'X';
      if (similar(participantName, home)) return '1';
      if (similar(participantName, away)) return '2';
    }
    if (Number(market && market.market_id) === 3 || marketName.includes('total')) {
      const found = lineValue.match(/\d+(?:\.\d+)?/) || participantName.match(/\d+(?:\.\d+)?/);
      const side = participantName.includes('over') ? 'O' : participantName.includes('under') ? 'U' : '';
      if (side && found && ['1.5', '2.5', '3.5'].includes(found[0])) return side + found[0].replace('.', '');
    }
    if (marketName.includes('both teams') || marketName.includes('btts')) {
      if (/^(yes|si|sì)$/.test(participantName)) return 'GG';
      if (participantName === 'no') return 'NG';
    }
    return '';
  }

  async function fetchRundownEvents(sport, date, token) {
    const url = 'https://therundown.io/api/v2/sports/' + sport + '/events/' + date + '?market_ids=1,2,3&main_line=true';
    const response = await fetch(url, { headers: { 'X-TheRundown-Key': token, Accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 401 || response.status === 403) throw new Error('chiave TheRundown non valida o non abilitata');
    if (response.status === 429) throw new Error('limite richieste TheRundown');
    if (!response.ok) throw new Error('TheRundown HTTP ' + response.status);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : payload.events || payload.data || [];
  }

  async function syncSpecialOdds(snapshot, special, force) {
    const token = localStorage.getItem(ODDS_TOKEN_KEY) || '';
    if (!token) return false;
    const dates = Array.from(new Set((snapshot.upcoming || []).map((m) => String(m.utcDate || '').slice(0, 10)).filter(Boolean)));
    if (!dates.length) return false;
    const signature = special + '|' + dates.join(',') + '|' + (snapshot.upcoming || []).length;
    const marker = readJson(ODDS_SYNC_KEY, {});
    if (!force && marker.signature === signature && Date.now() - Number(marker.time || 0) < 30 * 60000) return false;

    const sports = special === 'UEFA' ? [RUNDOWN.CL, RUNDOWN.EL] : [RUNDOWN[special]];
    if (sports.some((id) => !id)) return false;
    setMessage('Coppe UEFA: scarico le quote reali…', false);
    const events = [];
    for (const sport of sports) {
      for (const date of dates.slice(0, 4)) {
        try { events.push(...await fetchRundownEvents(sport, date, token)); }
        catch (error) { if (force) throw error; }
        await wait(450);
      }
    }

    const odds = readJson(ODDS_KEY, {});
    const meta = readJson(ODDS_META_KEY, {});
    let quoteCount = 0;
    let matched = 0;
    (snapshot.upcoming || []).forEach((match) => {
      const matchTime = Date.parse(match.utcDate);
      const event = events.find((candidate) => {
        const teams = eventTeams(candidate);
        const eventTime = Date.parse(candidate.event_date || candidate.eventDate || '');
        return Number.isFinite(eventTime) && Math.abs(eventTime - matchTime) <= 21600000 &&
          similar(match.homeTeam.name, teams.home.name) && similar(match.awayTeam.name, teams.away.name);
      });
      if (!event) return;
      matched += 1;
      const teams = eventTeams(event);
      const collected = new Map();
      (event.markets || []).forEach((market) => (market.participants || []).forEach((participant) => (participant.lines || []).forEach((line) => {
        const key = selectionKey(market, participant, line, teams.home.name || match.homeTeam.name, teams.away.name || match.awayTeam.name);
        if (!key) return;
        const row = collected.get(key) || { values: [], books: new Set() };
        Object.keys(line.prices || {}).forEach((book) => {
          const price = line.prices[book] && line.prices[book].price;
          const odd = decimalOdds(price);
          if (odd >= 1.01) { row.values.push(odd); row.books.add(book); }
        });
        collected.set(key, row);
      })));
      collected.forEach((row, key) => {
        if (!row.values.length) return;
        const storageKey = quoteKey(match.id, key);
        odds[storageKey] = Number(median(row.values).toFixed(2));
        meta[storageKey] = { source: 'Mediana ' + row.books.size + ' bookmaker · UEFA', updatedAt: new Date().toISOString(), automatic: true };
        quoteCount += 1;
      });
    });

    writeJson(ODDS_KEY, odds);
    writeJson(ODDS_META_KEY, meta);
    writeJson(ODDS_SYNC_KEY, { signature, time: Date.now(), quoteCount, matched });
    if (quoteCount) localStorage.setItem(NOTE_KEY, quoteCount + ' quote UEFA reali caricate su ' + matched + ' partite.');
    return quoteCount > 0;
  }

  function implied(matchId) {
    const odds = readJson(ODDS_KEY, {});
    const one = Number(odds[quoteKey(matchId, '1')] || 0);
    const draw = Number(odds[quoteKey(matchId, 'X')] || 0);
    const two = Number(odds[quoteKey(matchId, '2')] || 0);
    if (one < 1.01 || draw < 1.01 || two < 1.01) return null;
    const raw = [1 / one, 1 / draw, 1 / two];
    const total = raw.reduce((a, b) => a + b, 0);
    return { one, draw, two, p1: raw[0] / total, px: raw[1] / total, p2: raw[2] / total };
  }

  function patchCards() {
    document.querySelectorAll('#matchGrid .match-card').forEach((card) => {
      const trigger = card.matches('[data-match]') ? card : card.querySelector('[data-match]');
      if (!trigger) return;
      const market = implied(trigger.dataset.match);
      if (!market) return;
      const badge = card.querySelector('.decision-badge');
      if (badge && /DA VALUTARE|SCARTATA/i.test(badge.textContent || '')) {
        badge.textContent = 'QUOTE MERCATO';
        badge.classList.add('v163-market-badge');
      }
      const footer = card.querySelector('.match-footer span:first-child');
      if (footer && !footer.dataset.v163) {
        footer.dataset.v163 = '1';
        footer.textContent = 'Mercato 1/X/2: ' + Math.round(market.p1 * 100) + '% · ' + Math.round(market.px * 100) + '% · ' + Math.round(market.p2 * 100) + '%';
      }
    });
  }

  function patchAnalysisPanel(matchId) {
    const panel = document.getElementById('analysisPanel');
    if (!panel || !matchId || panel.querySelector('#v163MarketBox')) return;
    const market = implied(matchId);
    if (!market) return;
    const box = document.createElement('section');
    box.id = 'v163MarketBox';
    box.className = 'v163-market-box';
    box.innerHTML = '<div><strong>QUOTE MERCATO 1/X/2</strong><span>mediana bookmaker</span></div>' +
      '<div class="v163-market-grid"><b>1 · ' + market.one.toFixed(2) + '<small>' + Math.round(market.p1 * 100) + '%</small></b>' +
      '<b>X · ' + market.draw.toFixed(2) + '<small>' + Math.round(market.px * 100) + '%</small></b>' +
      '<b>2 · ' + market.two.toFixed(2) + '<small>' + Math.round(market.p2 * 100) + '%</small></b></div>' +
      '<p>Le percentuali sono probabilità implicite normalizzate dalle quote reali: servono come riferimento quando lo storico V16 della coppa è insufficiente, non sono una previsione garantita.</p>';
    panel.appendChild(box);
  }

  function injectStyle() {
    if (document.getElementById('v163EuroStyle')) return;
    const style = document.createElement('style');
    style.id = 'v163EuroStyle';
    style.textContent = '.decision-badge.v163-market-badge{background:rgba(244,163,64,.14)!important;color:#f6b55c!important;border:1px solid rgba(244,163,64,.25)}' +
      '.v163-market-box{margin-top:18px;padding:16px;border:1px solid rgba(244,163,64,.3);border-radius:18px;background:rgba(244,163,64,.06)}' +
      '.v163-market-box>div:first-child{display:flex;justify-content:space-between;gap:12px;align-items:center}.v163-market-box>div:first-child strong{color:#f6b55c}.v163-market-box>div:first-child span{font-size:12px;opacity:.7}' +
      '.v163-market-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.v163-market-grid b{padding:10px;border-radius:12px;background:rgba(255,255,255,.05);text-align:center}.v163-market-grid small{display:block;margin-top:4px;opacity:.7}' +
      '.v163-market-box p{margin:0;font-size:12px;line-height:1.45;opacity:.75}';
    document.head.appendChild(style);
  }

  async function bootstrap() {
    injectStyle();
    const special = currentSpecial();
    if (!special) return;
    const snapshot = readJson(SNAPSHOT_KEY, null);
    if (!snapshot || !Array.isArray(snapshot.upcoming) || !snapshot.upcoming.length) return;
    let changed = false;
    try { changed = await enrichEuropaHistory(snapshot, special) || changed; }
    catch (error) { setMessage('Storico Europa League non aggiornato: ' + (error && error.message || 'errore') + '.', true); }
    try { changed = await syncSpecialOdds(readJson(SNAPSHOT_KEY, snapshot), special, false) || changed; }
    catch (_error) {}
    if (changed) {
      window.location.reload();
      return;
    }
    const note = localStorage.getItem(NOTE_KEY);
    if (note) { localStorage.removeItem(NOTE_KEY); window.setTimeout(() => setMessage(note, false), 250); }
    window.setTimeout(patchCards, 250);
  }

  document.addEventListener('click', (event) => {
    const oddsButton = event.target.closest && event.target.closest('#syncOddsBtn');
    if (oddsButton && currentSpecial()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const snapshot = readJson(SNAPSHOT_KEY, null);
      if (!snapshot) return;
      syncSpecialOdds(snapshot, currentSpecial(), true)
        .then((changed) => { if (changed) window.location.reload(); else setMessage('Nessuna quota UEFA disponibile per queste partite.', true); })
        .catch((error) => setMessage('Quote UEFA non disponibili: ' + (error && error.message || 'errore') + '.', true));
      return;
    }
    const matchButton = event.target.closest && event.target.closest('#matchGrid [data-match]');
    if (matchButton) window.setTimeout(() => patchAnalysisPanel(matchButton.dataset.match), 220);
  }, true);

  const observer = new MutationObserver(() => patchCards());
  window.addEventListener('load', () => {
    const grid = document.getElementById('matchGrid');
    if (grid) observer.observe(grid, { childList: true, subtree: true });
    bootstrap();
  });
})();
