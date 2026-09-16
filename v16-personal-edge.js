(() => {
  'use strict';

  const SNAPSHOT_KEY = 'football-analyzer-snapshot-v14';
  const ODDS_KEY = 'seriea-analyzer-odds-v1';
  const SAFE_MARKETS = [
    { key: '1X', label: '1X', minProbability: 0.67 },
    { key: 'X2', label: 'X2', minProbability: 0.67 },
    { key: 'O15', label: 'Over 1.5', minProbability: 0.69 },
    { key: 'U35', label: 'Under 3.5', minProbability: 0.69 },
    { key: 'GG', label: 'Gol', minProbability: 0.64 },
    { key: 'NG', label: 'No Gol', minProbability: 0.64 },
    { key: 'O25', label: 'Over 2.5', minProbability: 0.62 },
    { key: 'U25', label: 'Under 2.5', minProbability: 0.62 }
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
    for (let h = 0; h <= 7; h += 1) {
      for (let a = 0; a <= 7; a += 1) cells.push({ h, a, p: poisson(homeLambda, h) * poisson(awayLambda, a) });
    }
    const total = cells.reduce((sum, row) => sum + row.p, 0) || 1;
    return cells.map((row) => ({ h: row.h, a: row.a, p: row.p / total }));
  }

  function finishedRows(history) {
    return history
      .filter((row) => row.status === 'FINISHED' && row.homeScore != null && row.awayScore != null)
      .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
  }

  function teamRows(history, teamId, role, limit) {
    return finishedRows(history)
      .filter((row) => {
        const homeId = Number(row.homeTeam && row.homeTeam.id);
        const awayId = Number(row.awayTeam && row.awayTeam.id);
        if (role === 'home') return homeId === Number(teamId);
        if (role === 'away') return awayId === Number(teamId);
        return homeId === Number(teamId) || awayId === Number(teamId);
      })
      .slice(-limit);
  }

  function weightedMean(rows, getter, prior, priorWeight, decay) {
    let total = prior * priorWeight;
    let weight = priorWeight;
    rows.forEach((row, index) => {
      const age = rows.length - 1 - index;
      const w = Math.pow(decay, age);
      total += getter(row) * w;
      weight += w;
    });
    return weight ? total / weight : prior;
  }

  function leagueProfile(history) {
    const rows = finishedRows(history).slice(-220);
    if (!rows.length) return { home: 1.45, away: 1.15, sample: 0 };
    return {
      home: rows.reduce((s, r) => s + Number(r.homeScore), 0) / rows.length,
      away: rows.reduce((s, r) => s + Number(r.awayScore), 0) / rows.length,
      sample: rows.length
    };
  }

  function teamGoalProfile(history, teamId, role, league) {
    const split = teamRows(history, teamId, role, 14);
    const all = teamRows(history, teamId, 'all', 20);
    const priorFor = role === 'home' ? league.home : league.away;
    const priorAgainst = role === 'home' ? league.away : league.home;
    const splitFor = weightedMean(split, (r) => role === 'home' ? Number(r.homeScore) : Number(r.awayScore), priorFor, 5, 0.88);
    const splitAgainst = weightedMean(split, (r) => role === 'home' ? Number(r.awayScore) : Number(r.homeScore), priorAgainst, 5, 0.88);
    const avgPrior = (league.home + league.away) / 2;
    const allFor = weightedMean(all, (r) => Number(r.homeTeam.id) === Number(teamId) ? Number(r.homeScore) : Number(r.awayScore), avgPrior, 6, 0.90);
    const allAgainst = weightedMean(all, (r) => Number(r.homeTeam.id) === Number(teamId) ? Number(r.awayScore) : Number(r.homeScore), avgPrior, 6, 0.90);
    return {
      forRate: splitFor * 0.70 + allFor * 0.30,
      againstRate: splitAgainst * 0.70 + allAgainst * 0.30,
      sample: Math.min(20, all.length)
    };
  }

  function poissonModel(match, history) {
    const league = leagueProfile(history);
    const home = teamGoalProfile(history, match.homeTeam.id, 'home', league);
    const away = teamGoalProfile(history, match.awayTeam.id, 'away', league);
    const homeAttack = clamp(home.forRate / Math.max(0.35, league.home), 0.52, 1.80);
    const awayDef = clamp(away.againstRate / Math.max(0.35, league.home), 0.52, 1.80);
    const awayAttack = clamp(away.forRate / Math.max(0.30, league.away), 0.52, 1.80);
    const homeDef = clamp(home.againstRate / Math.max(0.30, league.away), 0.52, 1.80);
    const lambdaHome = clamp(league.home * Math.sqrt(homeAttack * awayDef), 0.35, 3.15);
    const lambdaAway = clamp(league.away * Math.sqrt(awayAttack * homeDef), 0.28, 2.95);
    const matrix = scoreMatrix(lambdaHome, lambdaAway);
    const probability = (test) => matrix.filter((r) => test(r.h, r.a)).reduce((sum, r) => sum + r.p, 0);
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

  function eventRate(rows, key, prior, priorWeight, decay) {
    return weightedMean(rows, (row) => eventWon(key, Number(row.homeScore), Number(row.awayScore)) ? 1 : 0, prior, priorWeight, decay);
  }

  function empiricalModel(match, history) {
    const leagueRows = finishedRows(history).slice(-220);
    const homeAll = teamRows(history, match.homeTeam.id, 'all', 20);
    const awayAll = teamRows(history, match.awayTeam.id, 'all', 20);
    const homeRole = teamRows(history, match.homeTeam.id, 'home', 14);
    const awayRole = teamRows(history, match.awayTeam.id, 'away', 14);
    const markets = {};
    const stability = {};

    SAFE_MARKETS.forEach((market) => {
      const prior = leagueRows.length
        ? leagueRows.filter((row) => eventWon(market.key, Number(row.homeScore), Number(row.awayScore))).length / leagueRows.length
        : 0.5;
      const homeRows = (market.key === '1X' || market.key === 'X2') ? homeRole : homeAll;
      const awayRows = (market.key === '1X' || market.key === 'X2') ? awayRole : awayAll;
      const homeRate = eventRate(homeRows, market.key, prior, 6, 0.90);
      const awayRate = eventRate(awayRows, market.key, prior, 6, 0.90);
      markets[market.key] = clamp(prior * 0.24 + homeRate * 0.38 + awayRate * 0.38, 0.06, 0.94);

      const homeRecent = homeRows.slice(-6);
      const homePrev = homeRows.slice(-12, -6);
      const awayRecent = awayRows.slice(-6);
      const awayPrev = awayRows.slice(-12, -6);
      const simpleRate = (rows) => rows.length ? rows.filter((row) => eventWon(market.key, Number(row.homeScore), Number(row.awayScore))).length / rows.length : prior;
      const recent = (simpleRate(homeRecent) + simpleRate(awayRecent)) / 2;
      const previous = (simpleRate(homePrev) + simpleRate(awayPrev)) / 2;
      stability[market.key] = Math.abs(recent - previous);
    });

    return { sample: Math.min(homeAll.length, awayAll.length), markets, stability };
  }

  function consensusModel(match, history) {
    const poisson = poissonModel(match, history);
    const empirical = empiricalModel(match, history);
    const markets = {};
    SAFE_MARKETS.forEach((market) => {
      const a = Number(poisson.markets[market.key] || 0);
      const b = Number(empirical.markets[market.key] || 0);
      const low = Math.min(a, b);
      const average = (a + b) / 2;
      markets[market.key] = {
        poisson: a,
        empirical: b,
        disagreement: Math.abs(a - b),
        formSwing: Number(empirical.stability[market.key] || 0),
        conservative: clamp(low * 0.78 + average * 0.22, 0.01, 0.99)
      };
    });
    return {
      sample: Math.min(poisson.sample, empirical.sample),
      lambdaHome: poisson.lambdaHome,
      lambdaAway: poisson.lambdaAway,
      markets
    };
  }

  function backtestLeague(history) {
    const rows = finishedRows(history);
    const output = {};
    SAFE_MARKETS.forEach((market) => { output[market.key] = { samples: 0, hits: 0, predicted: 0, squaredError: 0 }; });
    const start = Math.max(55, rows.length - 150);

    for (let i = start; i < rows.length; i += 1) {
      const match = rows[i];
      const prior = rows.slice(Math.max(0, i - 220), i);
      if (prior.length < 50) continue;
      const model = consensusModel(match, prior);
      if (model.sample < 7) continue;
      SAFE_MARKETS.forEach((market) => {
        const c = model.markets[market.key];
        if (!c || c.conservative < 0.58 || c.disagreement > 0.14 || c.formSwing > 0.45) return;
        const result = eventWon(market.key, Number(match.homeScore), Number(match.awayScore)) ? 1 : 0;
        const row = output[market.key];
        row.samples += 1;
        row.hits += result;
        row.predicted += c.conservative;
        row.squaredError += Math.pow(c.conservative - result, 2);
      });
    }

    Object.keys(output).forEach((key) => {
      const row = output[key];
      row.actualRate = row.samples ? row.hits / row.samples : 0;
      row.predictedRate = row.samples ? row.predicted / row.samples : 0;
      row.gap = Math.abs(row.actualRate - row.predictedRate);
      row.brier = row.samples ? row.squaredError / row.samples : 1;
    });
    return output;
  }

  function minimumOdd(probability) {
    return Math.ceil((1.045 / Math.max(0.01, probability)) * 100) / 100;
  }

  function evaluate(match, market, consensus, backtest, odd) {
    const probability = consensus.conservative;
    const hasOdd = Number(odd) >= 1.01;
    const value = hasOdd ? Number(odd) * probability - 1 : 0;
    const tested = Boolean(backtest && backtest.samples >= 30);
    const highlyTested = Boolean(backtest && backtest.samples >= 45);
    const agreementOk = consensus.disagreement <= 0.075;
    const formStable = consensus.formSwing <= 0.28;
    const sampleOk = consensus.sample >= 9;
    const calibrationOk = tested && backtest.gap <= 0.075 && backtest.brier <= 0.235;
    const historicalHitOk = tested && backtest.actualRate >= Math.max(0.58, market.minProbability - 0.08);
    const probabilityOk = probability >= market.minProbability;
    const oddsOk = hasOdd && Number(odd) >= 1.20 && Number(odd) <= 1.90;
    const valueOk = hasOdd && value >= 0.035 && value <= 0.12;
    const qualified = probabilityOk && agreementOk && formStable && sampleOk && calibrationOk && historicalHitOk && oddsOk && valueOk;
    const estimate = !hasOdd && probability >= market.minProbability + 0.015 && agreementOk && formStable && sampleOk && calibrationOk && historicalHitOk;
    const quality =
      probability * 0.34 +
      (backtest ? backtest.actualRate : 0) * 0.20 +
      (1 - consensus.disagreement) * 0.16 +
      (1 - Math.min(0.5, consensus.formSwing) / 0.5) * 0.10 +
      Math.min(1, (backtest ? backtest.samples : 0) / 60) * 0.08 +
      Math.max(0, Math.min(0.12, value)) * 1.0;
    return {
      match, market, consensus, backtest, odd: Number(odd) || 0, probability, value,
      qualified, estimate, quality, highlyTested,
      checks: { agreementOk, formStable, sampleOk, calibrationOk, historicalHitOk, probabilityOk, oddsOk, valueOk }
    };
  }

  function buildDecision() {
    const snapshot = readJson(SNAPSHOT_KEY, null);
    if (!snapshot || !Array.isArray(snapshot.upcoming) || !Array.isArray(snapshot.history)) return { status: 'empty', all: [] };
    if (snapshot.isDemo) return { status: 'demo', all: [] };
    const odds = readJson(ODDS_KEY, {});
    const codes = Array.from(new Set(snapshot.upcoming.map((m) => m.competitionCode || snapshot.loadedCompetition || 'SA')));
    const backtests = {};
    codes.forEach((code) => {
      const leagueHistory = snapshot.history.filter((m) => (m.competitionCode || snapshot.loadedCompetition || 'SA') === code);
      backtests[code] = backtestLeague(leagueHistory);
    });

    const all = [];
    snapshot.upcoming.forEach((match) => {
      const code = match.competitionCode || snapshot.loadedCompetition || 'SA';
      const history = snapshot.history.filter((m) => (m.competitionCode || snapshot.loadedCompetition || 'SA') === code);
      if (finishedRows(history).length < 55) return;
      const model = consensusModel(match, history.slice(-240));
      SAFE_MARKETS.forEach((market) => {
        const consensus = Object.assign({ sample: model.sample }, model.markets[market.key]);
        const odd = Number(odds[quoteKey(match.id, market.key)] || 0);
        all.push(evaluate(match, market, consensus, backtests[code] && backtests[code][market.key], odd));
      });
    });

    all.sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.estimate) - Number(a.estimate) || b.quality - a.quality);
    return { status: 'real', all };
  }

  function matchName(item) {
    const home = item.match.homeTeam && (item.match.homeTeam.shortName || item.match.homeTeam.name) || 'Casa';
    const away = item.match.awayTeam && (item.match.awayTeam.shortName || item.match.awayTeam.name) || 'Ospite';
    return home + ' – ' + away;
  }

  function render() {
    const box = document.getElementById('generatedBox');
    if (!box) return;
    const decision = buildDecision();
    if (decision.status === 'empty') {
      box.innerHTML = '<div class="pass-card"><strong>V16 · DATI MANCANTI</strong><p>Aggiorna prima partite e risultati.</p></div>';
      return;
    }
    if (decision.status === 'demo') {
      box.innerHTML = '<div class="pass-card"><strong>V16 · PASSA</strong><p>I dati dimostrativi non vengono usati per una giocata personale. Carica i dati reali.</p></div>';
      return;
    }

    const qualified = decision.all.filter((item) => item.qualified);
    const estimates = decision.all.filter((item) => item.estimate);
    const best = qualified[0] || estimates[0] || decision.all[0];

    if (qualified.length && best) {
      const bt = best.backtest || {};
      box.innerHTML = '<div class="generated-card">' +
        '<strong class="green">V16 · UNA SOLA SINGOLA</strong>' +
        '<p>' + esc(matchName(best)) + ': <b>' + esc(best.market.label) + '</b> @' + dec(best.odd) + '</p>' +
        '<p>Probabilità prudente ' + pct(best.probability) + ' · margine ' + (best.value >= 0 ? '+' : '') + Math.round(best.value * 100) + '% · ' + Number(bt.samples || 0) + ' backtest.</p>' +
        '<p class="small">Poisson ' + pct(best.consensus.poisson) + ' · empirico ' + pct(best.consensus.empirical) + ' · scarto ' + Math.round(best.consensus.disagreement * 100) + ' pt · stabilità forma ' + Math.round(best.consensus.formSwing * 100) + ' pt.</p>' +
        '<button class="secondary" data-v16-use="' + esc(best.match.id + '|' + best.market.key) + '">Usa questa singola</button>' +
        '</div>';
      return;
    }

    if (estimates.length && best) {
      box.innerHTML = '<div class="pass-card"><strong>V16 · ATTENDI LA QUOTA</strong>' +
        '<p>' + esc(matchName(best)) + ' · <b>' + esc(best.market.label) + '</b> ha consenso sufficiente, ma senza quota reale non c’è una giocata valida.</p>' +
        '<p>Probabilità prudente ' + pct(best.probability) + ' · quota minima richiesta <b>' + dec(minimumOdd(best.probability)) + '</b>.</p>' +
        '<button class="ghost" data-v16-open="' + esc(best.match.id) + '">Apri la partita</button></div>';
      return;
    }

    box.innerHTML = '<div class="pass-card"><strong>V16 · PASSA</strong><p>Nessuna partita supera contemporaneamente consenso dei modelli, stabilità recente, backtest, quota e margine. Il tool non forza una giocata.</p></div>';
  }

  function openMatch(matchId, marketKey, addAfterOpen) {
    const nav = document.querySelector('.bottom-nav button[data-view="analysis"]');
    if (nav) nav.click();
    window.setTimeout(() => {
      const card = document.querySelector('[data-match="' + CSS.escape(String(matchId)) + '"]');
      if (card) card.click();
      window.setTimeout(() => {
        if (addAfterOpen && marketKey) {
          const add = document.querySelector('[data-add="' + CSS.escape(String(matchId) + '|' + String(marketKey)) + '"]');
          if (add) add.click();
        }
        const panel = document.getElementById('analysisPanel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 180);
    }, 140);
  }

  document.addEventListener('click', (event) => {
    const generate = event.target.closest && event.target.closest('#generateBtn');
    if (generate) {
      event.preventDefault();
      event.stopImmediatePropagation();
      render();
      return;
    }
    const open = event.target.closest && event.target.closest('[data-v16-open]');
    if (open) {
      openMatch(open.dataset.v16Open, '', false);
      return;
    }
    const use = event.target.closest && event.target.closest('[data-v16-use]');
    if (use) {
      const parts = String(use.dataset.v16Use || '').split('|');
      openMatch(parts[0], parts[1], true);
    }
  }, true);

  let signature = '';
  function refresh(force) {
    const s = localStorage.getItem(SNAPSHOT_KEY) || '';
    const o = localStorage.getItem(ODDS_KEY) || '';
    const next = s.length + ':' + o.length + ':' + s.slice(-80) + ':' + o.slice(-80);
    if (!force && next === signature) return;
    signature = next;
    window.setTimeout(render, 80);
  }

  window.addEventListener('load', () => refresh(true));
  window.addEventListener('storage', () => refresh(true));
  document.addEventListener('change', (event) => {
    if (event.target && event.target.matches('[data-odd]')) window.setTimeout(() => refresh(true), 120);
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest && event.target.closest('#syncBtn,#syncOddsBtn,#saveFootballTokenBtn,#saveOddsTokenBtn')) {
      window.setTimeout(() => refresh(true), 1000);
    }
  });
  window.setInterval(() => refresh(false), 3000);
})();
