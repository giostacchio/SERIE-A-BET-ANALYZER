(() => {
  'use strict';

  const TOKEN_KEY = 'seriea-analyzer-token-v1';
  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const COMP_KEY = 'football-analyzer-competition-v1';
  const SPECIAL_KEY = 'football-v16-special-competition';
  const STATUS_KEY = 'football-v16-loader-status';

  const DOMESTIC = ['SA', 'PL', 'PD', 'FL1'];
  const LABELS = {
    ALL: 'Europa 4', SA: 'Serie A', PL: 'Premier League', PD: 'LaLiga', FL1: 'Ligue 1',
    CL: 'Champions League', EL: 'Europa League'
  };

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const setMessage = (text, error) => {
    const target = document.getElementById('message');
    const dot = document.getElementById('dataDot');
    if (target) target.textContent = text;
    if (dot && error) dot.classList.add('error');
  };

  function currentSeason() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
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
    return future.filter((m) => Date.parse(m.utcDate) <= end).slice(0, 24);
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
      upcoming: nextRound(all),
      history: all
        .filter((m) => m.status === 'FINISHED' && m.homeScore != null && m.awayScore != null)
        .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
        .slice(-260)
    };
  }

  function saveSnapshot(target, loaded, failures) {
    const upcoming = loaded.flatMap((row) => row.upcoming).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    const history = loaded.flatMap((row) => row.history).sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    if (!upcoming.length) throw new Error('nessuna prossima partita disponibile');

    const special = target === 'CL' || target === 'EL' ? target : '';
    localStorage.setItem(SPECIAL_KEY, special);
    localStorage.setItem(COMP_KEY, special ? 'ALL' : target);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      upcoming,
      history,
      loadedCompetition: special ? 'ALL' : target,
      updatedAt: new Date().toISOString(),
      isDemo: false
    }));

    let status = LABELS[target] + ': ' + upcoming.length + ' partite del prossimo turno caricate.';
    if (failures.length) status += ' Non caricati: ' + failures.map((row) => LABELS[row.code] + ' (' + row.error + ')').join(', ') + '.';
    localStorage.setItem(STATUS_KEY, status);
  }

  async function robustSync(target) {
    const tokenField = document.getElementById('footballToken');
    const draft = tokenField && tokenField.value.trim();
    if (draft) localStorage.setItem(TOKEN_KEY, draft);
    const token = draft || localStorage.getItem(TOKEN_KEY) || '';
    if (!token) {
      setMessage('La chiave non è presente: apri Impostazioni e salvala prima.', true);
      return;
    }

    const codes = target === 'ALL' ? DOMESTIC : [target];
    const season = currentSeason();
    const loaded = [];
    const failures = [];

    setMessage('Aggiorno ' + LABELS[target] + '…');
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      setMessage('Aggiorno ' + LABELS[code] + ' (' + (index + 1) + '/' + codes.length + ')…');
      try {
        loaded.push(await loadCompetition(code, token, season));
      } catch (error) {
        failures.push({ code, error: String(error && error.message || 'errore') });
      }
      if (index < codes.length - 1) await wait(650);
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
    if (special === 'CL' || special === 'EL') return special;
    const competition = localStorage.getItem(COMP_KEY) || 'SA';
    return ['ALL', 'SA', 'PL', 'PD', 'FL1'].includes(competition) ? competition : 'SA';
  }

  function patchPassLabels() {
    document.querySelectorAll('#matchGrid .match-card').forEach((card) => {
      const decision = card.querySelector('.match-decision strong');
      const badge = card.querySelector('.decision-badge');
      const footer = card.querySelector('.match-footer span:first-child');
      if (decision && decision.textContent.trim() === 'PASSA') decision.textContent = 'ANALISI';
      if (badge && badge.textContent.trim() === 'SCARTATA') badge.textContent = 'DA VALUTARE';
      if (footer && footer.textContent.trim() === 'Nessuna giocata') footer.textContent = 'Apri per vedere tutte le stime';
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