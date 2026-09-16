(() => {
  'use strict';

  const TOKEN_KEY = 'seriea-analyzer-token-v1';
  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const COMP_KEY = 'football-analyzer-competition-v1';
  const SPECIAL_KEY = 'football-v16-special-competition';
  const STATUS_KEY = 'football-v16-loader-status';

  const DOMESTIC = ['SA', 'PL', 'PD', 'FL1'];
  const LABELS = {
    ALL: 'Campionati 4', SA: 'Serie A', PL: 'Premier League', PD: 'LaLiga', FL1: 'Ligue 1',
    UEFA: 'Coppe UEFA', CL: 'Champions League', EL: 'Europa League'
  };

  const UEFA_SOURCES = {
    EL: [
      'https://r.jina.ai/https://www.uefa.com/uefaeuropaleague/fixtures-results/',
      'https://r.jina.ai/https://www.uefa.com/uefaeuropaleague/news/02a8-2174cafa5bb6-82bbc20c9b92-1000--2026-27-europa-league-all-the-league-phase-fixtures/'
    ],
    CL: [
      'https://r.jina.ai/https://www.uefa.com/uefachampionsleague/fixtures-results/',
      'https://r.jina.ai/https://www.uefa.com/uefachampionsleague/news/02a8-2174c9e9019d-f909a77bd77a-1000--2026-27-champions-league-all-the-league-phase-fixtures/'
    ]
  };

  const MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
    luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11
  };

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const setMessage = (text, error) => {
    const target = document.getElementById('message');
    const dot = document.getElementById('dataDot');
    if (target) target.textContent = text;
    if (dot) dot.classList.toggle('error', Boolean(error));
  };

  function currentSeason() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function normalizeMatch(raw, code) {
    return {
      id: String(raw.id),
      utcDate: raw.utcDate,
      matchday: Number(raw.matchday || 0),
      status: raw.status,
      competitionCode: code,
      homeTeam: {
        id: Number(raw.homeTeam && raw.homeTeam.id || 0),
        name: raw.homeTeam && raw.homeTeam.name || 'Casa',
        shortName: raw.homeTeam && (raw.homeTeam.shortName || raw.homeTeam.name) || 'Casa'
      },
      awayTeam: {
        id: Number(raw.awayTeam && raw.awayTeam.id || 0),
        name: raw.awayTeam && raw.awayTeam.name || 'Ospite',
        shortName: raw.awayTeam && (raw.awayTeam.shortName || raw.awayTeam.name) || 'Ospite'
      },
      homeScore: raw.score && raw.score.fullTime && raw.score.fullTime.home != null ? Number(raw.score.fullTime.home) : null,
      awayScore: raw.score && raw.score.fullTime && raw.score.fullTime.away != null ? Number(raw.score.fullTime.away) : null
    };
  }

  async function fetchJson(url, token) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(url, {
          headers: { 'X-Auth-Token': token, Accept: 'application/json' },
          cache: 'no-store',
          mode: 'cors',
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 429) {
          const retry = Math.max(4, Math.min(20, Number(response.headers.get('Retry-After')) || 8));
          lastError = new Error('limite richieste API');
          if (attempt < 2) { await wait(retry * 1000); continue; }
        }
        if (response.status === 401) throw new Error('chiave football-data.org non valida');
        if (response.status === 403) throw new Error('competizione non inclusa nel piano della chiave');
        if (!response.ok) throw new Error(payload.message || payload.error || ('HTTP ' + response.status));
        return payload;
      } catch (error) {
        lastError = error && error.name === 'AbortError' ? new Error('richiesta scaduta') : error;
        const message = String(lastError && lastError.message || '');
        if (/non valida|non inclusa/.test(message)) throw lastError;
        if (attempt < 2) await wait(900 + attempt * 900);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    throw lastError || new Error('connessione API non riuscita');
  }

  async function fetchText(url) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        if (text && text.length > 300) return text;
        throw new Error('risposta UEFA vuota');
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(700);
      }
    }
    throw lastError || new Error('calendario UEFA non raggiungibile');
  }

  function nextRound(matches) {
    const cutoff = Date.now() + 5 * 60 * 1000;
    const future = matches
      .filter((m) => ['SCHEDULED', 'TIMED', 'POSTPONED'].includes(m.status) && Date.parse(m.utcDate) > cutoff)
      .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    if (!future.length) return [];

    const first = future[0];
    if (first.matchday > 0) {
      const sameDay = future.filter((m) => m.matchday === first.matchday);
      if (sameDay.length >= 2) return sameDay;
    }

    const end = Date.parse(first.utcDate) + 4 * 86400000;
    return future.filter((m) => Date.parse(m.utcDate) <= end).slice(0, 40);
  }

  async function loadCompetition(code, token, season) {
    const endpoint = 'https://api.football-data.org/v4/competitions/' + code + '/matches?season=';
    const current = await fetchJson(endpoint + season, token);
    let previous = { matches: [] };
    await wait(450);
    try {
      previous = await fetchJson(endpoint + (season - 1), token);
    } catch (_error) {
      previous = { matches: [] };
    }

    const byId = new Map();
    [].concat(previous.matches || [], current.matches || []).forEach((raw) => {
      const match = normalizeMatch(raw, code);
      byId.set(match.id, match);
    });
    const all = Array.from(byId.values());
    return {
      code,
      source: 'football-data.org',
      upcoming: nextRound(all),
      history: all
        .filter((m) => m.status === 'FINISHED' && m.homeScore != null && m.awayScore != null)
        .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
        .slice(-260)
    };
  }

  function cleanLine(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/^[-*]\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDateHeading(line) {
    const english = line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
    if (english) {
      const month = MONTHS[english[3].toLowerCase()];
      if (month != null) return { day: Number(english[2]), month, year: Number(english[4]) };
    }
    const italian = line.match(/^(Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica)\s+(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(\d{4})$/i);
    if (italian) {
      const month = MONTHS[italian[3].toLowerCase()];
      if (month != null) return { day: Number(italian[2]), month, year: Number(italian[4]) };
    }
    return null;
  }

  function localIso(dateParts, timeText) {
    const parts = String(timeText || '21:00').split(':').map(Number);
    const date = new Date(dateParts.year, dateParts.month, dateParts.day, parts[0] || 21, parts[1] || 0, 0, 0);
    return date.toISOString();
  }

  function parseUefaFixtures(text, code) {
    const lines = String(text || '').split('\n').map(cleanLine).filter(Boolean);
    const fixtures = [];
    let matchday = 0;
    let activeDate = null;

    for (const line of lines) {
      const md = line.match(/^#{0,3}\s*(?:Matchday|Giornata)\s*(\d+)/i);
      if (md) {
        matchday = Number(md[1]);
        activeDate = null;
        continue;
      }

      const dateHeading = parseDateHeading(line.replace(/^#+\s*/, ''));
      if (dateHeading) {
        activeDate = dateHeading;
        continue;
      }
      if (!activeDate || !matchday) continue;

      const noScore = line.replace(/\s+\d+[-–]\d+(?:\s.*)?$/, '').trim();
      const match = noScore.match(/^(.+?)\s+(?:vs|[-–])\s+(.+?)(?:\s+\((\d{1,2}:\d{2})(?:\s*CET)?\))?$/i);
      if (!match) continue;

      const home = cleanLine(match[1]);
      const away = cleanLine(match[2]);
      if (!home || !away || /fixtures|results|calendar|calendario/i.test(home + ' ' + away)) continue;
      const time = match[3] || '21:00';
      const utcDate = localIso(activeDate, time);
      const id = 'uefa-' + code.toLowerCase() + '-' + hashText(code + '|' + utcDate.slice(0, 10) + '|' + home + '|' + away);
      fixtures.push({
        id,
        utcDate,
        matchday,
        status: 'SCHEDULED',
        competitionCode: code,
        homeTeam: { id: hashText('team|' + home), name: home, shortName: home },
        awayTeam: { id: hashText('team|' + away), name: away, shortName: away },
        homeScore: null,
        awayScore: null
      });
    }

    const unique = new Map();
    fixtures.forEach((m) => unique.set(m.id, m));
    return Array.from(unique.values()).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
  }

  function selectCurrentUefaMatchday(fixtures) {
    if (!fixtures.length) return [];
    const now = Date.now();
    const groups = new Map();
    fixtures.forEach((match) => {
      if (!groups.has(match.matchday)) groups.set(match.matchday, []);
      groups.get(match.matchday).push(match);
    });
    const matchdays = Array.from(groups.keys()).sort((a, b) => a - b);
    for (const day of matchdays) {
      const rows = groups.get(day).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
      const latest = Math.max.apply(null, rows.map((m) => Date.parse(m.utcDate)));
      if (latest >= now - 6 * 60 * 60 * 1000) return rows;
    }
    return groups.get(matchdays[matchdays.length - 1]) || [];
  }

  async function loadUefaCalendar(code) {
    const sources = UEFA_SOURCES[code] || [];
    const errors = [];
    for (const url of sources) {
      try {
        const text = await fetchText(url);
        const parsed = parseUefaFixtures(text, code);
        const upcoming = selectCurrentUefaMatchday(parsed);
        if (upcoming.length) {
          return { code, source: 'UEFA', upcoming, history: [] };
        }
        errors.push('nessuna partita letta');
      } catch (error) {
        errors.push(String(error && error.message || 'errore'));
      }
    }
    throw new Error('UEFA: ' + errors.join(' / '));
  }

  async function loadEuropean(code, token, season) {
    try {
      const api = await loadCompetition(code, token, season);
      if (api.upcoming.length) return api;
    } catch (_error) {
    }
    return loadUefaCalendar(code);
  }

  function saveSnapshot(target, loaded, failures) {
    const upcoming = loaded.flatMap((row) => row.upcoming).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    const history = loaded.flatMap((row) => row.history).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    if (!upcoming.length) throw new Error('nessuna prossima partita disponibile');

    const special = ['UEFA', 'CL', 'EL'].includes(target) ? target : '';
    localStorage.setItem(SPECIAL_KEY, special);
    localStorage.setItem(COMP_KEY, special ? 'ALL' : target);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      upcoming,
      history,
      loadedCompetition: special ? 'ALL' : target,
      updatedAt: new Date().toISOString(),
      isDemo: false
    }));

    const sources = Array.from(new Set(loaded.map((row) => row.source))).join(' + ');
    let status = LABELS[target] + ': ' + upcoming.length + ' partite caricate · fonte ' + sources + '.';
    if (loaded.some((row) => row.source === 'UEFA' && !row.history.length)) {
      status += ' Per le partite da calendario UEFA lo storico del torneo può essere limitato: le partite restano comunque tutte visibili.';
    }
    if (failures.length) status += ' Non caricati: ' + failures.map((row) => LABELS[row.code] + ' (' + row.error + ')').join(', ') + '.';
    localStorage.setItem(STATUS_KEY, status);
  }

  async function robustSync(target) {
    const tokenField = document.getElementById('footballToken');
    const draft = tokenField && tokenField.value.trim();
    if (draft) localStorage.setItem(TOKEN_KEY, draft);
    const token = draft || localStorage.getItem(TOKEN_KEY) || '';

    const season = currentSeason();
    const loaded = [];
    const failures = [];
    let codes;
    if (target === 'ALL') codes = DOMESTIC;
    else if (target === 'UEFA') codes = ['CL', 'EL'];
    else codes = [target];

    if (!token && !codes.every((code) => code === 'CL' || code === 'EL')) {
      setMessage('La chiave non è presente: apri Impostazioni e salvala prima.', true);
      return;
    }

    setMessage('Aggiorno ' + LABELS[target] + '…');
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      setMessage('Aggiorno ' + LABELS[code] + ' (' + (index + 1) + '/' + codes.length + ')…');
      try {
        if (code === 'CL' || code === 'EL') loaded.push(await loadEuropean(code, token, season));
        else loaded.push(await loadCompetition(code, token, season));
      } catch (error) {
        failures.push({ code, error: String(error && error.message || 'errore') });
      }
      if (index < codes.length - 1) await wait(500);
    }

    if (!loaded.length) {
      const detail = failures.map((row) => LABELS[row.code] + ': ' + row.error).join(' · ');
      setMessage('Aggiornamento non riuscito. ' + detail, true);
      return;
    }

    try {
      saveSnapshot(target, loaded, failures);
      window.location.reload();
    } catch (error) {
      setMessage('Aggiornamento non riuscito: ' + error.message + '.', true);
    }
  }

  function selectedTarget() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    if (['UEFA', 'CL', 'EL'].includes(special)) return special;
    const competition = localStorage.getItem(COMP_KEY) || 'SA';
    return ['ALL', 'SA', 'PL', 'PD', 'FL1'].includes(competition) ? competition : 'SA';
  }

  function patchPassLabels() {
    document.querySelectorAll('#matchGrid .match-card').forEach((card) => {
      const decision = card.querySelector('.match-decision strong');
      const badge = card.querySelector('.decision-badge');
      const footer = card.querySelector('.match-footer span:first-child');
      const meta = card.querySelector('.match-meta span');
      if (decision && decision.textContent.trim() === 'PASSA') decision.textContent = 'ANALISI';
      if (badge && badge.textContent.trim() === 'SCARTATA') badge.textContent = 'DA VALUTARE';
      if (footer && footer.textContent.trim() === 'Nessuna giocata') footer.textContent = 'Apri per vedere tutte le stime';
      if (meta) {
        meta.textContent = meta.textContent.replace(/^EL\s*·/, 'Europa League ·').replace(/^CL\s*·/, 'Champions League ·');
      }
    });
  }

  function restoreSpecialUi() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    document.querySelectorAll('#leagueNav button').forEach((button) => button.classList.remove('special-active'));
    if (special) {
      document.querySelectorAll('#leagueNav button[data-league]').forEach((button) => button.classList.remove('active'));
      const specialButton = document.querySelector('#leagueNav button[data-euro-league="' + special + '"]');
      if (specialButton) specialButton.classList.add('active', 'special-active');
      const mode = document.getElementById('dataMode');
      if (mode) mode.textContent = LABELS[special].toUpperCase() + ' · AGGIORNATO';
    }

    const status = localStorage.getItem(STATUS_KEY);
    if (status) {
      localStorage.removeItem(STATUS_KEY);
      window.setTimeout(() => setMessage(status, false), 150);
    }
  }

  function injectStyles() {
    if (document.getElementById('v16EuropeAllStyle')) return;
    const style = document.createElement('style');
    style.id = 'v16EuropeAllStyle';
    style.textContent = `
      #leagueNav button[data-euro-league].active{border-color:#2bd982;background:rgba(43,217,130,.10)}
      #leagueNav button[data-euro-league="EL"] small{color:#f4a340}
      #leagueNav button[data-euro-league="CL"] small{color:#6eb5ff}
      #leagueNav button[data-euro-league="UEFA"] small{color:#c6a8ff}
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('click', (event) => {
    const league = event.target.closest('#leagueNav button[data-league]');
    const special = event.target.closest('#leagueNav button[data-euro-league]');
    const sync = event.target.closest('#syncBtn');
    if (!league && !special && !sync) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (special) {
      robustSync(special.dataset.euroLeague);
      return;
    }
    if (league) {
      localStorage.removeItem(SPECIAL_KEY);
      robustSync(league.dataset.league);
      return;
    }
    robustSync(selectedTarget());
  }, true);

  const observer = new MutationObserver(() => patchPassLabels());
  window.addEventListener('load', () => {
    injectStyles();
    restoreSpecialUi();
    patchPassLabels();
    const grid = document.getElementById('matchGrid');
    if (grid) observer.observe(grid, { childList: true, subtree: true });
  });
})();