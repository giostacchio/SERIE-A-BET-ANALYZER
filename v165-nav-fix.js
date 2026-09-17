(() => {
  'use strict';

  const SPECIAL_KEY = 'football-v16-special-competition';
  const COMP_KEY = 'football-analyzer-competition-v1';
  const STATUS_KEY = 'football-v16-loader-status';
  const NOTE_KEY = 'football-v163-note';
  const ODDS_TOKEN_KEY = 'football-analyzer-rundown-token-v1';
  const ODDS_KEY = 'seriea-analyzer-odds-v1';
  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';

  const LABELS = { ALL:'Campionati 4', SA:'Serie A', PL:'Premier League', PD:'LaLiga', FL1:'Ligue 1' };

  function readJson(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || ''); return value == null ? fallback : value; }
    catch (_error) { return fallback; }
  }

  function setModeForDomestic(code) {
    document.querySelectorAll('#leagueNav button').forEach((button) => button.classList.remove('active','special-active'));
    const button = document.querySelector('#leagueNav button[data-league="' + code + '"]');
    if (button) button.classList.add('active');
    const mode = document.getElementById('dataMode');
    if (mode) mode.textContent = (LABELS[code] || code).toUpperCase() + ' · AGGIORNO';
    const message = document.getElementById('message');
    if (message) message.textContent = 'Cambio competizione: scarico i dati di ' + (LABELS[code] || code) + '…';
  }

  function clearUefaState(code) {
    localStorage.removeItem(SPECIAL_KEY);
    localStorage.removeItem(STATUS_KEY);
    localStorage.removeItem(NOTE_KEY);
    localStorage.setItem(COMP_KEY, code);
    setModeForDomestic(code);
  }

  // Questo listener gira in capture prima del gestore normale di app.js sul menu campionati.
  // Non blocca il click: pulisce soltanto lo stato UEFA che prima restava appeso.
  document.addEventListener('click', (event) => {
    const domestic = event.target.closest && event.target.closest('#leagueNav button[data-league]');
    if (!domestic) return;
    clearUefaState(domestic.dataset.league || 'SA');
  }, true);

  function patchUefaNoOddsState() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    if (!['UEFA','CL','EL'].includes(special)) return;
    const snapshot = readJson(SNAPSHOT_KEY, null);
    if (!snapshot || !Array.isArray(snapshot.upcoming) || !snapshot.upcoming.length) return;

    const odds = readJson(ODDS_KEY, {});
    const hasOddsToken = Boolean(localStorage.getItem(ODDS_TOKEN_KEY));
    const withAnyRealOdd = snapshot.upcoming.some((match) => {
      const prefix = String(match.id) + '|';
      return Object.keys(odds).some((key) => key.startsWith(prefix) && Number(odds[key]) >= 1.01);
    });
    if (withAnyRealOdd) return;

    document.querySelectorAll('#matchGrid .match-card').forEach((card) => {
      const badge = card.querySelector('.decision-badge');
      const footer = card.querySelector('.match-footer span:first-child');
      if (badge && /DA VALUTARE|SCARTATA/i.test(badge.textContent || '')) {
        badge.textContent = hasOddsToken ? 'QUOTE NON DISP.' : 'SERVE QUOTA';
      }
      if (footer && /Apri per vedere tutte le stime|Nessuna giocata/i.test(footer.textContent || '')) {
        footer.textContent = hasOddsToken ? 'Apri analisi · quote automatiche non trovate' : 'Apri analisi · inserisci una quota reale';
      }
    });
  }

  const observer = new MutationObserver(() => patchUefaNoOddsState());
  window.addEventListener('load', () => {
    const grid = document.getElementById('matchGrid');
    if (grid) observer.observe(grid, { childList:true, subtree:true });
    window.setTimeout(patchUefaNoOddsState, 300);
  });
})();
