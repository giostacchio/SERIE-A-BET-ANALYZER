(() => {
  'use strict';

  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const ODDS_KEY = 'seriea-analyzer-odds-v1';
  const LAB_ID = 'v15ConsensusLab';
  const MARKETS = [
    { key: '1X', label: '1X' },
    { key: 'X2', label: 'X2' },
    { key: 'O15', label: 'Over 1.5' },
    { key: 'U35', label: 'Under 3.5' },
    { key: 'GG', label: 'Gol' },
    { key: 'NG', label: 'No Gol' },
    { key: 'O25', label: 'Over 2.5' },
    { key: 'U25', label: 'Under 2.5' }
  ];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const pct = (value) => Math.round(Number(value || 0) * 100) + '%';
  const dec = (value) => Number(value || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '');
      return parsed == null ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  }

  function quoteKey(matchId, marketKey) {
    return String(matchId) + '|' + marketKey;
  }

  function eventWon(key, home, away) {
    const total = home + away;
    if (key === '1X') return home >= away;
    if (key === 'X2') return home <= away;
    if (key === 'GG') return home > 0 && away > 0;
    if (key === 'NG') return home === 0 || away === 0;
    if (key === 'O15') return total >= 2;
    if (key === 'U35') return total <= 3;
    if (key === 'O25') return total >= 3;
    if (key === 'U25') return total <= 2;
    return false;
  }

  function poisson(lambda, goals) {
    let factorial = 1;
    for (let i = 2; i <= goals; i += 1) factorial *= i;
    return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
  }

  function scoreMatrix(homeLambda, awayLambda) {
    const cells = [];
    for (let home = 0; home <= 7; home += 1) {
      for (let away = 0; away <= 7; away += 1) {
        cells.push({ home, away, p: poisson(homeLambda, home) * poisson(awayLambda, away) });
      }
    }
    const total = cells.reduce((sum, row) => sum + row.p, 0) || 1;
    return cells.map((row) => ({ home: row.home, away: row.away, p: row.p / total }));
  }

  function leagueStats(history) {
    const finished = history.filter((match) => match.status === 'FINISHED' && match.homeScore != null && match.awayScore != null);
    if (!finished.length) return { homeGoals: 1.45, awayGoals: 1.15, sample: 0 };
    return {
      homeGoals: finished.reduce((sum, match) => sum + Number(match.homeScore), 0) / finished.length,
      awayGoals: finished.reduce((sum, match) => sum + Number(match.awayScore), 0) / finished.length,
      sample: finished.length
    };
  }

  function teamMatches(history, teamId, role, limit) {
    return history
      .filter((match) => {
        if (match.status !== 'FINISHED' || match.homeScore == null || match.awayScore == null) return false;
        if (role === 'home') return Number(match.homeTeam && match.homeTeam.id) === Number(teamId);
        if (role === 'away') return Number(match.awayTeam && match.awayTeam.id) === Number(teamId);
        return Number(match.homeTeam && match.homeTeam.id) === Number(teamId) || Number(match.awayTeam && match.awayTeam.id) === Number(teamId);
      })
      .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
      .slice(-limit);
  }

  function weightedRate(rows, getter, priorMean, priorWeight) {
    if (!rows.length) return priorMean;
    let weighted = 0;
    let weights = 0;
    rows.forEach((row, index) => {
      const age = rows.length - 1 - index;
      const weight = Math.pow(0.88, age);
      weighted += getter(row) * weight;
      weights += weight;
    });
    return (weighted + priorMean * priorWeight) / (weights + priorWeight);
  }

  function teamGoalProfile(history, teamId, role, league) {
    const roleRows = teamMatches(history, teamId, role, 12);
    const allRows = teamMatches(history, teamId, 'all', 18);
    const rolePriorFor = role === 'home' ? league.homeGoals : league.awayGoals;
    const rolePriorAgainst = role === 'home' ? league.awayGoals : league.homeGoals;

    const roleFor = weightedRate(roleRows, (match) => role === 'home' ? Number(match.homeScore) : Number(match.awayScore), rolePriorFor, 5);
    const roleAgainst = weightedRate(roleRows, (match) => role === 'home' ? Number(match.awayScore) : Number(match.homeScore), rolePriorAgainst, 5);
    const allFor = weightedRate(allRows, (match) => Number(match.homeTeam.id) === Number(teamId) ? Number(match.homeScore) : Number(match.awayScore), (league.homeGoals + league.awayGoals) / 2, 6);
    const allAgainst = weightedRate(allRows, (match) => Number(match.homeTeam.id) === Number(teamId) ? Number(match.awayScore) : Number(match.homeScore), (league.homeGoals + league.awayGoals) / 2, 6);

    return {
      forRate: roleFor * 0.68 + allFor * 0.32,
      againstRate: roleAgainst * 0.68 + allAgainst * 0.32,
      sample: Math.min(18, allRows.length)
    };
  }

  function poissonProbabilities(match, history) {
    const league = leagueStats(history);
    const home = teamGoalProfile(history, match.homeTeam.id, 'home', league);
    const away = teamGoalProfile(history, match.awayTeam.id, 'away', league);
    const homeAttack = clamp(home.forRate / Math.max(0.35, league.homeGoals), 0.55, 1.75);
    const awayDefence = clamp(away.againstRate / Math.max(0.35, league.homeGoals), 0.55, 1.75);
    const awayAttack = clamp(away.forRate / Math.max(0.30, league.awayGoals), 0.55, 1.75);
    const homeDefence = clamp(home.againstRate / Math.max(0.30, league.awayGoals), 0.55, 1.75);
    const lambdaHome = clamp(league.homeGoals * Math.sqrt(homeAttack * awayDefence), 0.35, 3.1);
    const lambdaAway = clamp(league.awayGoals * Math.sqrt(awayAttack * homeDefence), 0.28, 2.9);
    const matrix = scoreMatrix(lambdaHome, lambdaAway);
    const probability = (test) => matrix.filter((row) => test(row.home, row.away)).reduce((sum, row) => sum + row.p, 0);
    return {
      sample: Math.min(home.sample, away.sample),
      lambdaHome,
      lambdaAway,
      markets: {
        '1X': probability((h, a) => h >= a),
        'X2': probability((h, a) => h <= a),
        'GG': probability((h, a) => h > 0 && a > 0),
        'NG': probability((h, a) => h === 0 || a === 0),
        'O15': probability((h, a) => h + a >= 2),
        'U35': probability((h, a) => h + a <= 3),
        'O25': probability((h, a) => h + a >= 3),
        'U25': probability((h, a) => h + a <= 2)
      }
    };
  }

  function weightedEventRate(rows, test, prior, priorWeight) {
    if (!rows.length) return prior;
    let hitWeight = 0;
    let totalWeight = 0;
    rows.forEach((row, index) => {
      const age = rows.length - 1 - index;
      const weight = Math.pow(0.90, age);
      if (test(row)) hitWeight += weight;
      totalWeight += weight;
    });
    return (hitWeight + prior * priorWeight) / (totalWeight + priorWeight);
  }

  function empiricalProbabilities(match, history) {
    const leagueRows = history.filter((row) => row.status === 'FINISHED' && row.homeScore != null && row.awayScore != null).slice(-180);
    const homeRows = teamMatches(history, match.homeTeam.id, 'home', 14);
    const awayRows = teamMatches(history, match.awayTeam.id, 'away', 14);
    const homeAll = teamMatches(history, match.homeTeam.id, 'all', 18);
    const awayAll = teamMatches(history, match.awayTeam.id, 'all', 18);
    const output = {};

    MARKETS.forEach((market) => {
      const leaguePrior = leagueRows.length
        ? leagueRows.filter((row) => eventWon(market.key, Number(row.homeScore), Number(row.awayScore))).length / leagueRows.length
        : 0.5;

      let homeEvidence;
      let awayEvidence;
      if (market.key === '1X') {
        homeEvidence = weightedEventRate(homeRows, (row) => Number(row.homeScore) >= Number(row.awayScore), leaguePrior, 5);
        awayEvidence = weightedEventRate(awayRows, (row) => Number(row.homeScore) >= Number(row.awayScore), leaguePrior, 5);
      } else if (market.key === 'X2') {
        homeEvidence = weightedEventRate(homeRows, (row) => Number(row.homeScore) <= Number(row.awayScore), leaguePrior, 5);
        awayEvidence = weightedEventRate(awayRows, (row) => Number(row.homeScore) <= Number(row.awayScore), leaguePrior, 5);
      } else {
        homeEvidence = weightedEventRate(homeAll, (row) => eventWon(market.key, Number(row.homeScore), Number(row.awayScore)), leaguePrior, 6);
        awayEvidence = weightedEventRate(awayAll, (row) => eventWon(market.key, Number(row.homeScore), Number(row.awayScore)), leaguePrior, 6);
      }
      output[market.key] = clamp(leaguePrior * 0.24 + homeEvidence * 0.38 + awayEvidence * 0.38, 0.08, 0.92);
    });

    return {
      sample: Math.min(homeAll.length, awayAll.length),
      markets: output
    };
  }

  function analyseConsensus(match, history) {
    const poissonModel = poissonProbabilities(match, history);
    const empiricalModel = empiricalProbabilities(match, history);
    const markets = {};
    MARKETS.forEach((market) => {
      const a = Number(poissonModel.markets[market.key] || 0);
      const b = Number(empiricalModel.markets[market.key] || 0);
      const low = Math.min(a, b);
      const average = (a + b) / 2;
      markets[market.key] = {
        poisson: a,
        empirical: b,
        disagreement: Math.abs(a - b),
        conservative: clamp(low * 0.72 + average * 0.28, 0.01, 0.99)
      };
    });
    return {
      markets,
      sample: Math.min(poissonModel.sample, empiricalModel.sample),
      lambdaHome: poissonModel.lambdaHome,
      lambdaAway: poissonModel.lambdaAway
    };
  }

  function backtestLeague(history) {
    const finished = history
      .filter((row) => row.status === 'FINISHED' && row.homeScore != null && row.awayScore != null)
      .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    const totals = {};
    MARKETS.forEach((market) => { totals[market.key] = { samples: 0, hits: 0, predicted: 0 }; });
    const start = Math.max(45, finished.length - 120);

    for (let index = start; index < finished.length; index += 1) {
      const match = finished[index];
      const prior = finished.slice(Math.max(0, index - 190), index);
      if (prior.length < 40) continue;
      const analysis = analyseConsensus(match, prior);
      if (analysis.sample < 6) continue;
      MARKETS.forEach((market) => {
        const row = analysis.markets[market.key];
        if (!row || row.conservative < 0.60 || row.disagreement > 0.12) return;
        const total = totals[market.key];
        total.samples += 1;
        total.predicted += row.conservative;
        if (eventWon(market.key, Number(match.homeScore), Number(match.awayScore))) total.hits += 1;
      });
    }

    const output = {};
    Object.keys(totals).forEach((key) => {
      const row = totals[key];
      const predictedRate = row.samples ? row.predicted / row.samples : 0;
      const actualRate = row.samples ? row.hits / row.samples : 0;
      output[key] = {
        samples: row.samples,
        predictedRate,
        actualRate,
        gap: Math.abs(predictedRate - actualRate)
      };
    });
    return output;
  }

  function minimumOdd(probability) {
    return Math.ceil((1.04 / Math.max(0.01, probability)) * 100) / 100;
  }

  function evaluateCandidate(match, market, consensus, backtest, odd) {
    const probability = consensus.conservative;
    const tested = Boolean(backtest && backtest.samples >= 20);
    const stable = consensus.disagreement <= 0.10;
    const calibrated = tested && backtest.gap <= 0.10 && backtest.actualRate >= 0.58;
    const enoughTeamData = consensus.sample >= 7;
    const hasOdd = Number(odd) >= 1.01;
    const value = hasOdd ? Number(odd) * probability - 1 : 0;
    const oddOk = hasOdd && Number(odd) >= 1.18 && Number(odd) <= 2.05;
    const edgeOk = hasOdd && value >= 0.035 && value <= 0.15;
    const qualified = probability >= 0.62 && stable && calibrated && enoughTeamData && oddOk && edgeOk;
    const estimate = !hasOdd && probability >= 0.64 && stable && calibrated && enoughTeamData;
    const score = probability * 0.50 + (backtest ? backtest.actualRate : 0) * 0.22 + (1 - consensus.disagreement) * 0.18 + Math.max(0, value) * 0.10;
    return {
      match,
      market,
      consensus,
      backtest,
      odd: Number(odd) || 0,
      probability,
      value,
      qualified,
      estimate,
      score
    };
  }

  function buildLab() {
    const snapshot = readJson(SNAPSHOT_KEY, null);
    if (!snapshot || !Array.isArray(snapshot.upcoming) || !Array.isArray(snapshot.history)) {
      return { status: 'empty', candidates: [] };
    }
    const odds = readJson(ODDS_KEY, {});
    const competitionCodes = Array.from(new Set(snapshot.upcoming.map((match) => match.competitionCode || snapshot.loadedCompetition || 'SA')));
    const backtests = {};
    competitionCodes.forEach((code) => {
      backtests[code] = backtestLeague(snapshot.history.filter((match) => (match.competitionCode || snapshot.loadedCompetition || 'SA') === code));
    });

    const candidates = [];
    snapshot.upcoming.forEach((match) => {
      const code = match.competitionCode || snapshot.loadedCompetition || 'SA';
      const history = snapshot.history.filter((row) => (row.competitionCode || snapshot.loadedCompetition || 'SA') === code);
      if (history.length < 45) return;
      const analysis = analyseConsensus(match, history.slice(-220));
      MARKETS.forEach((market) => {
        const consensus = Object.assign({ sample: analysis.sample }, analysis.markets[market.key]);
        const odd = Number(odds[quoteKey(match.id, market.key)] || 0);
        candidates.push(evaluateCandidate(match, market, consensus, backtests[code] && backtests[code][market.key], odd));
      });
    });

    candidates.sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.estimate) - Number(a.estimate) || b.score - a.score);
    return { status: snapshot.isDemo ? 'demo' : 'real', candidates };
  }

  function injectStyles() {
    if (document.getElementById('v15ConsensusStyles')) return;
    const style = document.createElement('style');
    style.id = 'v15ConsensusStyles';
    style.textContent = `
      .v15-lab{margin-top:18px;padding:18px;border:1px solid rgba(89,224,164,.35);border-radius:18px;background:linear-gradient(145deg,rgba(89,224,164,.06),rgba(7,18,15,.35))}
      .v15-lab-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:12px}
      .v15-lab-head h3{margin:2px 0 4px;font-size:1.15rem}.v15-lab-head p{margin:0;color:var(--muted,#a8b8b1);font-size:.88rem}
      .v15-chip{display:inline-flex;padding:6px 10px;border:1px solid rgba(89,224,164,.35);border-radius:999px;color:#59e0a4;font-size:.72rem;font-weight:900;white-space:nowrap}
      .v15-pick{padding:14px;border:1px solid rgba(89,224,164,.28);border-radius:14px;background:rgba(89,224,164,.06)}
      .v15-pick.pass{border-color:rgba(255,190,82,.25);background:rgba(255,190,82,.05)}
      .v15-pick strong{display:block;margin-bottom:5px}.v15-pick p{margin:5px 0;color:var(--muted,#a8b8b1)}
      .v15-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:11px 0}
      .v15-metrics span{padding:8px;border-radius:10px;background:rgba(255,255,255,.035);font-size:.72rem;color:var(--muted,#a8b8b1)}
      .v15-metrics b{display:block;color:var(--text,#fff);font-size:.96rem;margin-top:2px}
      .v15-audit{margin-top:12px;display:grid;gap:6px}.v15-audit-row{display:grid;grid-template-columns:1.4fr .7fr .7fr .7fr;gap:6px;padding:8px;border-radius:10px;background:rgba(255,255,255,.025);font-size:.76rem}
      .v15-audit-row b{color:var(--text,#fff)}.v15-audit-row span{color:var(--muted,#a8b8b1)}
      .v15-open{margin-top:10px;width:100%}
      @media(max-width:620px){.v15-lab-head{flex-direction:column}.v15-metrics{grid-template-columns:1fr 1fr}.v15-audit-row{grid-template-columns:1.4fr .8fr .8fr}.v15-audit-row span:last-child{display:none}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    injectStyles();
    let panel = document.getElementById(LAB_ID);
    if (panel) return panel;
    const generated = document.getElementById('generatedBox');
    if (!generated) return null;
    panel = document.createElement('section');
    panel.id = LAB_ID;
    panel.className = 'v15-lab';
    generated.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function matchName(candidate) {
    const home = candidate.match.homeTeam && (candidate.match.homeTeam.shortName || candidate.match.homeTeam.name) || 'Casa';
    const away = candidate.match.awayTeam && (candidate.match.awayTeam.shortName || candidate.match.awayTeam.name) || 'Ospite';
    return home + ' – ' + away;
  }

  function renderLab() {
    const panel = ensurePanel();
    if (!panel) return;
    const lab = buildLab();
    if (lab.status === 'empty') {
      panel.innerHTML = '<div class="v15-lab-head"><div><span class="v15-chip">V15 CONSENSUS</span><h3>Secondo modello indipendente</h3><p>Aggiorna prima partite e risultati reali.</p></div></div>';
      return;
    }

    const qualified = lab.candidates.filter((item) => item.qualified);
    const estimates = lab.candidates.filter((item) => item.estimate);
    const best = qualified[0] || estimates[0] || lab.candidates[0];
    const topAudit = lab.candidates.slice(0, 3);
    let mainHtml = '';

    if (qualified.length && best) {
      mainHtml = '<div class="v15-pick"><strong>✅ Consenso qualificato: ' + esc(matchName(best)) + ' · ' + esc(best.market.label) + '</strong>' +
        '<p>Quota ' + dec(best.odd) + ' · probabilità conservativa ' + pct(best.probability) + ' · margine ' + (best.value >= 0 ? '+' : '') + Math.round(best.value * 100) + '%.</p>' +
        '<div class="v15-metrics"><span>Poisson<b>' + pct(best.consensus.poisson) + '</b></span><span>Empirico<b>' + pct(best.consensus.empirical) + '</b></span><span>Backtest<b>' + (best.backtest ? best.backtest.hits + '/' + best.backtest.samples : '—') + '</b></span><span>Scarto modelli<b>' + Math.round(best.consensus.disagreement * 100) + ' pt</b></span></div>' +
        '<button class="secondary v15-open" data-v15-open="' + esc(best.match.id) + '">Apri questa partita nell’analisi</button></div>';
    } else if (estimates.length && best) {
      mainHtml = '<div class="v15-pick pass"><strong>🟠 Buon consenso, ma manca la quota reale</strong>' +
        '<p>' + esc(matchName(best)) + ' · <b>' + esc(best.market.label) + '</b> · probabilità conservativa ' + pct(best.probability) + '. Quota minima richiesta: <b>' + dec(minimumOdd(best.probability)) + '</b>.</p>' +
        '<button class="secondary v15-open" data-v15-open="' + esc(best.match.id) + '">Apri e inserisci la quota</button></div>';
    } else {
      mainHtml = '<div class="v15-pick pass"><strong>⛔ V15 dice PASSA</strong><p>Nessuna selezione supera contemporaneamente i due modelli, il backtest progressivo e il margine minimo sulla quota. Meglio zero giocate che una giocata forzata.</p></div>';
    }

    const auditHtml = topAudit.length ? '<div class="v15-audit">' + topAudit.map((item) => {
      const bt = item.backtest;
      return '<div class="v15-audit-row"><b>' + esc(matchName(item)) + ' · ' + esc(item.market.label) + '</b><span>P ' + pct(item.probability) + '</span><span>Δ ' + Math.round(item.consensus.disagreement * 100) + 'pt</span><span>' + (bt ? bt.samples + ' test' : '0 test') + '</span></div>';
    }).join('') + '</div>' : '';

    panel.innerHTML = '<div class="v15-lab-head"><div><span class="v15-chip">V15 CONSENSUS LAB</span><h3>Doppio controllo indipendente</h3><p>Poisson bayesiano + modello empirico recente. Una giocata passa solo se concordano e il segnale regge nel backtest.</p></div><span class="v15-chip">' + (lab.status === 'real' ? 'DATI REALI' : 'DEMO') + '</span></div>' + mainHtml + auditHtml;
  }

  function openMatch(matchId) {
    const analysisNav = document.querySelector('.bottom-nav button[data-view="analysis"]');
    if (analysisNav) analysisNav.click();
    window.setTimeout(() => {
      const card = document.querySelector('[data-match="' + CSS.escape(String(matchId)) + '"]');
      if (card) {
        card.click();
        window.setTimeout(() => {
          const panel = document.getElementById('analysisPanel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      }
    }, 120);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-v15-open]');
    if (!button) return;
    openMatch(button.dataset.v15Open);
  });

  let lastSignature = '';
  function refreshIfNeeded(force) {
    const snapshotRaw = localStorage.getItem(SNAPSHOT_KEY) || '';
    const oddsRaw = localStorage.getItem(ODDS_KEY) || '';
    const signature = snapshotRaw.length + ':' + oddsRaw.length + ':' + snapshotRaw.slice(-60) + ':' + oddsRaw.slice(-60);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    window.setTimeout(renderLab, 60);
  }

  window.addEventListener('load', () => refreshIfNeeded(true));
  window.addEventListener('storage', () => refreshIfNeeded(true));
  document.addEventListener('click', (event) => {
    if (event.target.closest('#syncBtn,#syncOddsBtn,#saveFootballTokenBtn,#saveOddsTokenBtn,[data-odd],#generateBtn')) {
      window.setTimeout(() => refreshIfNeeded(true), 900);
    }
  });
  window.setInterval(() => refreshIfNeeded(false), 2500);
})();
