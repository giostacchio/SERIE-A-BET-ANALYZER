(() => {
  'use strict';

  const SPECIAL_KEY = 'football-v16-special-competition';
  const COMP_KEY = 'football-analyzer-competition-v1';
  const STATUS_KEY = 'football-v16-loader-status';
  const NOTE_KEY = 'football-v163-note';
  const ODDS_KEY = 'seriea-analyzer-odds-v1';
  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const LABELS = { ALL:'Campionati 4', SA:'Serie A', PL:'Premier League', PD:'LaLiga', FL1:'Ligue 1' };

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '');
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function clearUefaState(code) {
    localStorage.removeItem(SPECIAL_KEY);
    localStorage.removeItem(STATUS_KEY);
    localStorage.removeItem(NOTE_KEY);
    localStorage.setItem(COMP_KEY, code);
  }

  // Important: this runs before app.js receives a domestic-league click.
  // It only clears the previous UEFA state and never blocks the normal click.
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('#leagueNav button[data-league]');
    if (!button) return;
    clearUefaState(button.dataset.league || 'SA');
  }, true);

  function patchDomesticSelection() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    if (special) return;
    const code = localStorage.getItem(COMP_KEY) || 'SA';
    document.querySelectorAll('#leagueNav button').forEach((button) => button.classList.remove('special-active'));
    const mode = document.getElementById('dataMode');
    if (mode && LABELS[code] && !/DATI DIMOSTRATIVI/.test(mode.textContent || '')) {
      mode.textContent = LABELS[code].toUpperCase() + ' · AGGIORNATO';
    }
  }

  function patchUefaNoOddsOnce() {
    const special = localStorage.getItem(SPECIAL_KEY) || '';
    if (!['UEFA','CL','EL'].includes(special)) return;

    const snapshot = readJson(SNAPSHOT_KEY, null);
    if (!snapshot || !Array.isArray(snapshot.upcoming)) return;
    const odds = readJson(ODDS_KEY, {});

    document.querySelectorAll('#matchGrid .match-card').forEach((card) => {
      const trigger = card.matches('[data-match]') ? card : card.querySelector('[data-match]');
      if (!trigger) return;
      const prefix = String(trigger.dataset.match || '') + '|';
      const hasOdd = Object.keys(odds).some((key) => key.startsWith(prefix) && Number(odds[key]) >= 1.01);
      if (hasOdd) return;

      const badge = card.querySelector('.decision-badge');
      if (badge && /DA VALUTARE|SCARTATA/.test(badge.textContent || '')) badge.textContent = 'SERVE QUOTA';

      const footer = card.querySelector('.match-footer span:first-child');
      if (footer && /Apri per vedere tutte le stime|Nessuna giocata/.test(footer.textContent || '')) {
        footer.textContent = 'Apri analisi · quota reale mancante';
      }
    });
  }

  window.addEventListener('load', () => {
    patchDomesticSelection();
    window.setTimeout(patchUefaNoOddsOnce, 250);
  });

  // No MutationObserver, no interval, no automatic network calls.
})();