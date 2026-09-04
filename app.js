(() => {
  "use strict";

  const STORAGE = {
    token: "seriea-analyzer-token-v1",
    oddsToken: "football-analyzer-rundown-token-v1",
    odds: "seriea-analyzer-odds-v1",
    oddsMeta: "football-analyzer-odds-meta-v1",
    archive: "seriea-analyzer-archive-v1",
    bankroll: "seriea-analyzer-bankroll-v1",
    competition: "football-analyzer-competition-v1",
    strict: "football-analyzer-strict-v1",
    snapshot: "football-analyzer-snapshot-v14"
  };
  const LEAGUES = {
    ALL: { name: "Europa 4" }, SA: { name: "Serie A" }, PL: { name: "Premier League" },
    PD: { name: "LaLiga" }, FL1: { name: "Ligue 1" }
  };
  const LEAGUE_CODES = ["SA", "PL", "PD", "FL1"];
  const RUNDOWN_SPORTS = { SA: 15, PL: 11, PD: 14, FL1: 12 };
  const MAX_STAKE = 2;
  const MIN_BACKTEST_SAMPLES = 40;
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const quoteKey = (matchId, marketKey) => String(matchId) + "|" + marketKey;
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const dec = (value) => Number(value || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (value) => Math.round(Number(value || 0) * 100) + "%";
  const dateLabel = (value) => {
    try {
      return new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    } catch { return value; }
  };
  const readJson = (key, fallback) => {
    try { const parsed = JSON.parse(localStorage.getItem(key) || ""); return parsed == null ? fallback : parsed; }
    catch { return fallback; }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { setMessage("Memoria del browser piena: libera spazio e riprova.", "error"); }
  };

  function demoData() {
    const teams = [[108,"Inter"],[109,"Juventus"],[98,"Milan"],[113,"Napoli"],[100,"Roma"],[110,"Lazio"],[102,"Atalanta"],[99,"Fiorentina"],[103,"Bologna"],[586,"Torino"]]
      .map((row) => ({ id: Number(row[0]), name: row[1], shortName: row[1] }));
    const history = [];
    for (let round = 0; round < 13; round += 1) {
      for (let index = 0; index < 5; index += 1) {
        const home = teams[(index + round) % teams.length];
        const away = teams[(teams.length - 1 - index + round) % teams.length];
        if (home.id === away.id) continue;
        const hg = Math.max(0, Math.round(1.45 + ((home.id + round) % 5 - 2) * .38));
        const ag = Math.max(0, Math.round(1.05 + ((away.id + round * 2) % 5 - 2) * .31));
        history.push({ id:"demo-h-"+round+"-"+index, utcDate:new Date(Date.now()-(84-round*6)*86400000).toISOString(), matchday:round+1, status:"FINISHED", competitionCode:"SA", homeTeam:home, awayTeam:away, homeScore:hg, awayScore:ag });
      }
    }
    const next = new Date(Date.now() + 4 * 86400000);
    next.setUTCHours(18, 0, 0, 0);
    const pairs = [[0,7],[1,8],[2,6],[3,9],[4,5]];
    const upcoming = pairs.map((pair,index) => ({ id:"demo-n-"+index, utcDate:new Date(+next+index*7200000).toISOString(), matchday:1, status:"SCHEDULED", competitionCode:"SA", homeTeam:teams[pair[0]], awayTeam:teams[pair[1]], homeScore:null, awayScore:null }));
    return { upcoming, history };
  }

  function initialState() {
    const demo = demoData();
    const legacy = readJson("seriea_bet_v1", {});
    const snapshot = readJson(STORAGE.snapshot, null);
    const savedOdds = readJson(STORAGE.odds, legacy.odds || {});
    const savedMeta = readJson(STORAGE.oddsMeta, {});
    const savedArchive = readJson(STORAGE.archive, []);
    const competition = localStorage.getItem(STORAGE.competition) || legacy.league || "SA";
    const bankroll = Number(localStorage.getItem(STORAGE.bankroll));
    const token = localStorage.getItem(STORAGE.token) || legacy.token || "";
    if (token && !localStorage.getItem(STORAGE.token)) localStorage.setItem(STORAGE.token, token);
    return {
      token,
      oddsToken: localStorage.getItem(STORAGE.oddsToken) || "",
      competition: LEAGUES[competition] ? competition : "SA",
      loadedCompetition: snapshot && LEAGUES[snapshot.loadedCompetition] ? snapshot.loadedCompetition : "SA",
      upcoming: snapshot && Array.isArray(snapshot.upcoming) && snapshot.upcoming.length ? snapshot.upcoming : demo.upcoming,
      history: snapshot && Array.isArray(snapshot.history) && snapshot.history.length ? snapshot.history : demo.history,
      updatedAt: snapshot && snapshot.updatedAt || "",
      isDemo: !(snapshot && snapshot.isDemo === false),
      odds: savedOdds && typeof savedOdds === "object" && !Array.isArray(savedOdds) ? savedOdds : {},
      oddsMeta: savedMeta && typeof savedMeta === "object" && !Array.isArray(savedMeta) ? savedMeta : {},
      archive: Array.isArray(savedArchive) ? savedArchive : [],
      bankroll: Number.isFinite(bankroll) && bankroll >= 5 ? bankroll : 50,
      strict: localStorage.getItem(STORAGE.strict) !== "0",
      selected: null,
      slip: [],
      view: "analysis",
      syncing: false,
      oddsLoading: false
    };
  }

  const state = initialState();
  let analyses = [];
  let backtests = {};
  let recommendations = [];
  let deferredInstallPrompt = null;

  function setMessage(text, tone) {
    $("message").textContent = text;
    $("dataDot").className = "data-dot" + (tone === "error" ? " error" : state.isDemo ? " demo" : "");
  }
  function leagueName(code) { return LEAGUES[code] ? LEAGUES[code].name : (code || "Campionato"); }
  function persistSnapshot() {
    writeJson(STORAGE.snapshot, { upcoming:state.upcoming, history:state.history, loadedCompetition:state.loadedCompetition, updatedAt:state.updatedAt, isDemo:state.isDemo });
  }

  function poisson(lambda, goals) {
    let factorial = 1;
    for (let i = 2; i <= goals; i += 1) factorial *= i;
    return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial;
  }
  function blankRollup() {
    return { played:0,gf:0,ga:0,points:0,homePlayed:0,homeGf:0,homeGa:0,awayPlayed:0,awayGf:0,awayGa:0,recent:[] };
  }
  function buildRollups(matches) {
    const rollups = new Map();
    const finished = matches.filter((m) => m.status === "FINISHED" && m.homeScore != null && m.awayScore != null)
      .sort((a,b) => Date.parse(a.utcDate)-Date.parse(b.utcDate));
    let totalHome = 0, totalAway = 0;
    finished.forEach((m) => {
      const home = rollups.get(m.homeTeam.id) || blankRollup();
      const away = rollups.get(m.awayTeam.id) || blankRollup();
      const hg = Number(m.homeScore), ag = Number(m.awayScore);
      const hp = hg > ag ? 3 : hg === ag ? 1 : 0;
      const ap = ag > hg ? 3 : hg === ag ? 1 : 0;
      home.played++; home.gf+=hg; home.ga+=ag; home.points+=hp; home.homePlayed++; home.homeGf+=hg; home.homeGa+=ag; home.recent.push({points:hp});
      away.played++; away.gf+=ag; away.ga+=hg; away.points+=ap; away.awayPlayed++; away.awayGf+=ag; away.awayGa+=hg; away.recent.push({points:ap});
      rollups.set(m.homeTeam.id,home); rollups.set(m.awayTeam.id,away); totalHome+=hg; totalAway+=ag;
    });
    return { rollups, leagueHome:finished.length?totalHome/finished.length:1.48, leagueAway:finished.length?totalAway/finished.length:1.17, sample:finished.length };
  }
  function recentForm(team) {
    if (!team || !team.recent.length) return .5;
    const recent = team.recent.slice(-6);
    const weighted = recent.reduce((sum,row,index) => sum + row.points * (index+1), 0);
    const maximum = recent.reduce((sum,row,index) => sum + 3 * (index+1), 0);
    return weighted / maximum;
  }
  function scoreMatrix(homeLambda, awayLambda) {
    const cells = [];
    for (let h=0;h<=7;h++) for (let a=0;a<=7;a++) cells.push({h,a,p:poisson(homeLambda,h)*poisson(awayLambda,a)});
    const total = cells.reduce((sum,c) => sum+c.p,0);
    return cells.map((c) => ({h:c.h,a:c.a,p:c.p/total}));
  }
  function analyseMatches(upcoming, history) {
    const built = buildRollups(history);
    return upcoming.map((match) => {
      const home=built.rollups.get(match.homeTeam.id), away=built.rollups.get(match.awayTeam.id);
      const ha=home&&home.homePlayed?(home.homeGf/home.homePlayed)/built.leagueHome:home&&home.played?(home.gf/home.played)/built.leagueHome:1;
      const ad=away&&away.awayPlayed?(away.awayGa/away.awayPlayed)/built.leagueHome:away&&away.played?(away.ga/away.played)/built.leagueHome:1;
      const aa=away&&away.awayPlayed?(away.awayGf/away.awayPlayed)/built.leagueAway:away&&away.played?(away.gf/away.played)/built.leagueAway:1;
      const hd=home&&home.homePlayed?(home.homeGa/home.homePlayed)/built.leagueAway:home&&home.played?(home.ga/home.played)/built.leagueAway:1;
      const lambdaHome=clamp(built.leagueHome*Math.sqrt(clamp(ha,.45,2.2)*clamp(ad,.45,2.2))*(.86+recentForm(home)*.28),.35,3.25);
      const lambdaAway=clamp(built.leagueAway*Math.sqrt(clamp(aa,.45,2.2)*clamp(hd,.45,2.2))*(.86+recentForm(away)*.28),.28,3);
      const matrix=scoreMatrix(lambdaHome,lambdaAway);
      const prob=(test)=>matrix.filter((c)=>test(c.h,c.a)).reduce((sum,c)=>sum+c.p,0);
      const p1=prob((h,a)=>h>a), px=prob((h,a)=>h===a), p2=prob((h,a)=>h<a);
      const exact=matrix.slice().sort((a,b)=>b.p-a.p).slice(0,4);
      const markets=[
        ["1","1","1X2",p1],["X","X","1X2",px],["2","2","1X2",p2],
        ["1X","1X","Doppia chance",p1+px],["X2","X2","Doppia chance",px+p2],["12","12","Doppia chance",p1+p2],
        ["GG","Gol","Gol",prob((h,a)=>h>0&&a>0)],["NG","No Gol","Gol",prob((h,a)=>h===0||a===0)],
        ["O15","Over 1.5","Under/Over",prob((h,a)=>h+a>=2)],["U15","Under 1.5","Under/Over",prob((h,a)=>h+a<=1)],
        ["O25","Over 2.5","Under/Over",prob((h,a)=>h+a>=3)],["U25","Under 2.5","Under/Over",prob((h,a)=>h+a<=2)],
        ["O35","Over 3.5","Under/Over",prob((h,a)=>h+a>=4)],["U35","Under 3.5","Under/Over",prob((h,a)=>h+a<=3)],
        ["MG13","Multigol 1–3","Multigol",prob((h,a)=>h+a>=1&&h+a<=3)],
        ["MG24","Multigol 2–4","Multigol",prob((h,a)=>h+a>=2&&h+a<=4)],
        ["MG35","Multigol 3–5","Multigol",prob((h,a)=>h+a>=3&&h+a<=5)]
      ].map((row)=>({key:row[0],label:row[1],group:row[2],probability:row[3]}));
      const sampleHome=home?home.played:0, sampleAway=away?away.played:0;
      const reliability=clamp(42+Math.min(sampleHome,10)*2.1+Math.min(sampleAway,10)*2.1+(built.sample>60?8:0),42,92);
      return { match,lambdaHome,lambdaAway,markets,sampleHome,sampleAway,reliability,projectedScore:exact[0]?exact[0].h+"–"+exact[0].a:"–" };
    });
  }
  function marketWon(key,home,away) {
    const total=home+away;
    if(key==="1")return home>away;if(key==="X")return home===away;if(key==="2")return home<away;
    if(key==="1X")return home>=away;if(key==="X2")return home<=away;if(key==="12")return home!==away;
    if(key==="GG")return home>0&&away>0;if(key==="NG")return home===0||away===0;
    if(key==="O15")return total>=2;if(key==="U15")return total<=1;if(key==="O25")return total>=3;if(key==="U25")return total<=2;
    if(key==="O35")return total>=4;if(key==="U35")return total<=3;
    if(key==="MG13")return total>=1&&total<=3;if(key==="MG24")return total>=2&&total<=4;if(key==="MG35")return total>=3&&total<=5;
    return false;
  }
  function backtestMarkets(history) {
    const finished=history.filter((m)=>m.status==="FINISHED"&&m.homeScore!=null&&m.awayScore!=null).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate));
    const totals=new Map(), start=Math.min(60,Math.max(20,Math.floor(finished.length*.25)));
    for(let i=start;i<finished.length;i++){
      const match=finished[i], analysis=analyseMatches([match],finished.slice(0,i))[0];
      if(!analysis||analysis.sampleHome<3||analysis.sampleAway<3)continue;
      analysis.markets.forEach((market)=>{
        const row=totals.get(market.key)||{samples:0,predicted:0,wins:0};
        row.samples++;row.predicted+=market.probability;row.wins+=marketWon(market.key,Number(match.homeScore),Number(match.awayScore))?1:0;totals.set(market.key,row);
      });
    }
    const output={};
    totals.forEach((row,key)=>{const predictedRate=row.predicted/row.samples,actualRate=row.wins/row.samples;output[key]={marketKey:key,samples:row.samples,predictedRate,actualRate,calibrationGap:Math.abs(predictedRate-actualRate)};});
    return output;
  }
  function aggregateBacktests(){
    const totals={};
    Array.from(new Set(state.history.map((m)=>m.competitionCode||state.loadedCompetition))).forEach((code)=>{
      const tested=backtestMarkets(state.history.filter((m)=>(m.competitionCode||state.loadedCompetition)===code));
      Object.keys(tested).forEach((key)=>{const row=tested[key];if(!totals[key])totals[key]={samples:0,predicted:0,actual:0};totals[key].samples+=row.samples;totals[key].predicted+=row.predictedRate*row.samples;totals[key].actual+=row.actualRate*row.samples;});
    });
    const output={};
    Object.keys(totals).forEach((key)=>{const row=totals[key],pr=row.predicted/row.samples,ar=row.actual/row.samples;output[key]={marketKey:key,samples:row.samples,predictedRate:pr,actualRate:ar,calibrationGap:Math.abs(pr-ar)};});
    return output;
  }
  function minimumOdd(probability){return Math.ceil((1.03/Math.max(.01,probability))*100)/100;}
  function evaluateMarket(analysis,market,odd,backtest){
    const hasRealOdd=Number(odd)>=1.01,tested=Boolean(backtest&&backtest.samples>=MIN_BACKTEST_SAMPLES);
    const empirical=tested?backtest.actualRate:market.probability;
    const calibrated=market.probability*.65+empirical*.35,reliabilityFactor=.6+.4*(analysis.reliability/100);
    const dataAdjusted=.5+(calibrated-.5)*reliabilityFactor,marketImplied=hasRealOdd?1/Number(odd):dataAdjusted;
    const conservativeProbability=Math.min(dataAdjusted,dataAdjusted*.7+marketImplied*.3);
    const value=hasRealOdd?Number(odd)*conservativeProbability-1:0,calibrationScore=tested?Math.max(0,1-backtest.calibrationGap*4):0;
    const score=conservativeProbability*.6+(analysis.reliability/100)*.2+calibrationScore*.2;
    const dataQualified=conservativeProbability>=.64&&analysis.reliability>=70&&tested&&backtest.calibrationGap<=.08;
    const prudent=hasRealOdd&&Number(odd)>=1.18&&Number(odd)<=2.05&&dataQualified&&value>=.025&&value<=.15;
    const estimate=!hasRealOdd&&dataQualified;
    const watch=!prudent&&!estimate&&conservativeProbability>=.6&&analysis.reliability>=64&&tested&&backtest.calibrationGap<=.12;
    return {hasRealOdd,tested,conservativeProbability,value,score,dataQualified,prudent,estimate,watch};
  }
  function refreshDerived(rebuild){
    const codes=Array.from(new Set(state.upcoming.map((m)=>m.competitionCode||state.loadedCompetition)));analyses=[];
    codes.forEach((code)=>{analyses=analyses.concat(analyseMatches(state.upcoming.filter((m)=>(m.competitionCode||state.loadedCompetition)===code),state.history.filter((m)=>(m.competitionCode||state.loadedCompetition)===code)));});
    analyses.sort((a,b)=>Date.parse(a.match.utcDate)-Date.parse(b.match.utcDate));
    if(rebuild||!Object.keys(backtests).length)backtests=aggregateBacktests();
    recommendations=analyses.map((analysis)=>analysis.markets.map((market)=>{const odd=Number(state.odds[quoteKey(analysis.match.id,market.key)]||0);return{analysis,market,odd,evaluation:evaluateMarket(analysis,market,odd,backtests[market.key])};})
      .sort((a,b)=>Number(b.evaluation.prudent)-Number(a.evaluation.prudent)||Number(b.evaluation.estimate)-Number(a.evaluation.estimate)||Number(b.evaluation.watch)-Number(a.evaluation.watch)||b.evaluation.score-a.evaluation.score)[0]).filter(Boolean);
    if(!state.selected||!analyses.some((a)=>a.match.id===state.selected))state.selected=analyses[0]?analyses[0].match.id:null;
  }

  function renderLeagueNav(){
    document.querySelectorAll("#leagueNav button").forEach((button)=>button.classList.toggle("active",button.dataset.league===state.competition));
  }
  function renderStatus(){
    $("dataMode").textContent=state.isDemo?"DATI DIMOSTRATIVI":leagueName(state.loadedCompetition).toUpperCase()+" · AGGIORNATO";
    $("dataDot").className="data-dot"+(state.isDemo?" demo":"");
  }
  function renderSummary(){
    const prudent=recommendations.filter((item)=>item.evaluation.prudent).length;
    const withOdds=recommendations.filter((item)=>item.evaluation.hasRealOdd).length;
    const sample=state.history.filter((m)=>m.status==="FINISHED").length;
    const summary=[["Partite",analyses.length,""],["Risultati studiati",sample,""],["Con quota reale",withOdds,withOdds?"amber":""],["Singole idonee",prudent,prudent?"green":"red"]];
    $("summaryCards").innerHTML=summary.map((item)=>'<div class="summary-card"><span>'+item[0]+'</span><strong class="'+item[2]+'">'+item[1]+'</strong></div>').join("");
    $("matchCount").textContent=String(analyses.length);
    if(!analyses.length){$("matchGrid").innerHTML='<div class="empty-state">Nessuna prossima partita disponibile.</div>';return;}
    $("matchGrid").innerHTML=analyses.map((analysis)=>{
      const item=recommendations.find((row)=>row.analysis.match.id===analysis.match.id),ev=item&&item.evaluation;
      const accepted=Boolean(ev&&ev.prudent),estimated=Boolean(ev&&ev.estimate),watch=Boolean(ev&&ev.watch);
      const tone=accepted?"green":estimated||watch?"amber":"red";
      const decision=accepted||estimated||watch?item.market.label:"PASSA";
      const badge=accepted?"IDONEA":estimated?"SERVE QUOTA":watch?"DEBOLE":"SCARTATA";
      const footer=accepted?pct(ev.conservativeProbability)+" prudente · @"+dec(item.odd):estimated?pct(ev.conservativeProbability)+" · quota min "+dec(minimumOdd(ev.conservativeProbability)):watch?pct(ev.conservativeProbability)+" · non idonea":"Nessuna giocata";
      const width=accepted||estimated||watch?Math.round(ev.conservativeProbability*100):2;
      return '<button class="match-card '+(state.selected===analysis.match.id?"active":"")+'" data-match="'+esc(analysis.match.id)+'"><div class="match-meta"><span>'+esc(leagueName(analysis.match.competitionCode))+' · G.'+esc(analysis.match.matchday||"–")+'</span><time>'+esc(dateLabel(analysis.match.utcDate))+'</time></div><div class="teams"><span>'+esc(analysis.match.homeTeam.shortName||analysis.match.homeTeam.name)+'</span><b>VS</b><span>'+esc(analysis.match.awayTeam.shortName||analysis.match.awayTeam.name)+'</span></div><div class="match-decision"><span>Filtro</span><strong class="'+tone+'">'+esc(decision)+'</strong><em class="decision-badge '+tone+'">'+badge+'</em></div><span class="probability-bar"><i class="'+(tone==="amber"?"amber-bar":tone==="red"?"red-bar":"")+'" style="width:'+width+'%"></i></span><div class="match-footer"><span>'+esc(footer)+'</span><span>Apri analisi ›</span></div></button>';
    }).join("");
  }
  function renderAnalysis(){
    const analysis=analyses.find((row)=>row.match.id===state.selected);
    if(!analysis){$("analysisPanel").innerHTML="";return;}
    const rows=analysis.markets.map((market)=>{
      const key=quoteKey(analysis.match.id,market.key),odd=Number(state.odds[key]||0),meta=state.oddsMeta[key];
      const ev=evaluateMarket(analysis,market,odd,backtests[market.key]);
      const inSlip=state.slip.some((pick)=>pick.matchId===analysis.match.id&&pick.marketKey===market.key);
      const valueClass=odd>1&&ev.value>=.025?"green":odd>1?"red":"";
      return '<div class="market-row"><div class="market-name"><strong>'+esc(market.label)+'</strong><small>'+esc(market.group)+'</small></div><div class="market-cell"><span>Prob. prudente</span><strong>'+pct(ev.conservativeProbability)+'</strong></div><label class="odds-field"><input data-odd="'+esc(key)+'" inputmode="decimal" type="number" min="1.01" step=".01" value="'+(odd>=1.01?odd.toFixed(2):"")+'" placeholder="quota"><small title="'+esc(meta?meta.source:"")+'">'+esc(meta?meta.source:"Quota reale")+'</small></label><div class="market-cell value-cell"><span>Margine</span><strong class="'+valueClass+'">'+(odd>1?(ev.value>=0?"+":"")+Math.round(ev.value*100)+"%":"–")+'</strong></div><button class="add-market '+(inSlip?"added":"")+'" data-add="'+esc(analysis.match.id+"|"+market.key)+'">'+(inSlip?"Aggiunta":"Aggiungi")+'</button></div>';
    }).join("");
    $("analysisPanel").innerHTML='<div class="analysis-head"><div><p class="eyebrow">ANALISI DETTAGLIATA</p><h2>'+esc(analysis.match.homeTeam.shortName||analysis.match.homeTeam.name)+' <span>vs</span> '+esc(analysis.match.awayTeam.shortName||analysis.match.awayTeam.name)+'</h2><p>'+esc(dateLabel(analysis.match.utcDate))+'</p></div><div class="score-model"><span>Risultato modale</span><strong>'+esc(analysis.projectedScore)+'</strong></div></div><div class="model-grid"><div><span>Gol attesi casa</span><strong>'+dec(analysis.lambdaHome)+'</strong></div><div><span>Gol attesi ospite</span><strong>'+dec(analysis.lambdaAway)+'</strong></div><div><span>Affidabilità dati</span><strong>'+Math.round(analysis.reliability)+'%</strong></div><div><span>Campione squadre</span><strong>'+analysis.sampleHome+'+'+analysis.sampleAway+'</strong></div></div><div class="market-list">'+rows+'</div><p class="analysis-note"><strong>Filtro:</strong> probabilità Poisson corretta con affidabilità, backtest progressivo e quota reale. Senza almeno 40 casi storici ben calibrati il mercato non viene qualificato.</p>';
  }
  function stakeCap(){
    return state.strict?Math.max(.5,Math.min(MAX_STAKE,Math.floor((state.bankroll*.02)*2)/2)):MAX_STAKE;
  }
  function monthlyStaked(){
    const now=new Date();
    return state.archive.filter((bet)=>{const date=new Date(bet.createdAt);return date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth();}).reduce((sum,bet)=>sum+Number(bet.stake||0),0);
  }
  function renderSlip(){
    const count=state.slip.length;
    $("slipCount").textContent=count+(count===1?" selezione":" selezioni");
    $("navSlipBadge").textContent=count?String(count):"";$("navSlipBadge").style.display=count?"block":"none";
    $("slipBox").innerHTML=count?state.slip.map((pick)=>'<div class="slip-row"><button data-remove-pick="'+esc(pick.id)+'" aria-label="Rimuovi">×</button><div><strong>'+esc(pick.home)+' – '+esc(pick.away)+'</strong><span>'+esc(pick.market)+' · prudente '+pct(pick.conservativeProbability)+' · '+(pick.qualified?"qualificata":"non qualificata")+'</span></div><b>'+dec(pick.odds)+'</b></div>').join(""):'<div class="empty-state">Inserisci una quota reale nell’analisi e aggiungi il mercato.</div>';
    const total=state.slip.reduce((value,pick)=>value*Number(pick.odds||1),1),cap=stakeCap(),input=$("stakeInput");
    input.max=String(cap);if(Number(input.value)>cap||Number(input.value)<.5)input.value=String(cap);
    const stake=Number(input.value||cap);
    $("slipOdds").textContent=count?dec(total):"–";$("potentialReturn").textContent=count?"€ "+dec(stake*total):"–";
    const used=monthlyStaked(),remaining=Math.max(0,state.bankroll-used);
    $("monthlyBudgetLabel").textContent="€ "+dec(used)+" / € "+dec(state.bankroll);
    $("budgetBar").style.width=Math.min(100,state.bankroll?used/state.bankroll*100:0)+"%";
    $("budgetHelp").textContent="Disponibile € "+dec(remaining)+" · massimo per giocata € "+dec(cap);
  }
  function renderGenerated(){
    const prudent=recommendations.filter((item)=>item.evaluation.prudent).sort((a,b)=>b.evaluation.score-a.evaluation.score);
    const estimates=recommendations.filter((item)=>item.evaluation.estimate).sort((a,b)=>b.evaluation.score-a.evaluation.score);
    if(prudent.length){
      const item=prudent[0],samples=backtests[item.market.key]?backtests[item.market.key].samples:0;
      $("generatedBox").innerHTML='<div class="generated-card"><strong class="green">Singola qualificata</strong><p>'+esc(item.analysis.match.homeTeam.shortName||item.analysis.match.homeTeam.name)+' – '+esc(item.analysis.match.awayTeam.shortName||item.analysis.match.awayTeam.name)+': <b>'+esc(item.market.label)+'</b> @'+dec(item.odd)+'</p><p>Probabilità prudente '+pct(item.evaluation.conservativeProbability)+' · margine '+(item.evaluation.value>=0?"+":"")+Math.round(item.evaluation.value*100)+'% · '+samples+' test</p><button class="secondary" data-use-generated="'+esc(item.analysis.match.id+"|"+item.market.key)+'">Usa questa singola</button></div>';return;
    }
    if(estimates.length){
      const item=estimates[0];
      $("generatedBox").innerHTML='<div class="pass-card"><strong>PASSA per ora</strong><p>La migliore stima è '+esc(item.analysis.match.homeTeam.shortName||item.analysis.match.homeTeam.name)+' – '+esc(item.analysis.match.awayTeam.shortName||item.analysis.match.awayTeam.name)+': <b>'+esc(item.market.label)+'</b>, ma manca la quota reale. Valutala solo da '+dec(minimumOdd(item.evaluation.conservativeProbability))+' in su.</p><button class="ghost" data-open-generated="'+esc(item.analysis.match.id)+'">Inserisci la quota</button></div>';return;
    }
    $("generatedBox").innerHTML='<div class="pass-card"><strong>PASSA</strong><p>Nessun evento supera insieme qualità dei dati, verifica storica e margine richiesto. Non giocare è una decisione prevista dal metodo.</p></div>';
  }
  function getStats(){
    const settled=state.archive.filter((bet)=>bet.status!=="open"),resolved=settled.filter((bet)=>bet.status==="won"||bet.status==="lost");
    const staked=settled.reduce((sum,bet)=>sum+Number(bet.stake||0),0),returned=settled.reduce((sum,bet)=>sum+(bet.status==="won"?Number(bet.stake)*Number(bet.totalOdds):bet.status==="void"?Number(bet.stake):0),0),profit=returned-staked;
    const closing=state.archive.filter((bet)=>Number(bet.closingOdds)>=1.01),averageClv=closing.length?closing.reduce((sum,bet)=>sum+(Number(bet.totalOdds)/Number(bet.closingOdds)-1),0)/closing.length*100:0;
    let cumulative=0,peak=0,maxDrawdown=0;
    settled.slice().sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).forEach((bet)=>{cumulative+=bet.status==="won"?Number(bet.stake)*Number(bet.totalOdds)-Number(bet.stake):bet.status==="void"?0:-Number(bet.stake);peak=Math.max(peak,cumulative);maxDrawdown=Math.max(maxDrawdown,peak-cumulative);});
    return {settled:settled.length,resolved:resolved.length,wins:resolved.filter((bet)=>bet.status==="won").length,profit,roi:staked?profit/staked*100:0,closingSamples:closing.length,averageClv,maxDrawdown};
  }
  function renderArchive(){
    const result=getStats();
    const values=[["Chiuse",result.settled,""],["Vinte",result.wins,""],["Profitto",(result.profit>=0?"+":"")+"€ "+dec(result.profit),result.profit>=0?"green":"red"],["ROI",(result.roi>=0?"+":"")+dec(result.roi)+"%",result.roi>=0?"green":"red"],["CLV medio",result.closingSamples?(result.averageClv>=0?"+":"")+dec(result.averageClv)+"%":"–",result.averageClv>=0?"green":"red"],["Drawdown max","−€ "+dec(result.maxDrawdown),"red"]];
    $("statGrid").innerHTML=values.map((item)=>'<div class="stat-card"><span>'+item[0]+'</span><strong class="'+item[2]+'">'+item[1]+'</strong></div>').join("");
    const enough=result.resolved>=30,enoughClv=result.closingSamples>=15,positive=enough&&enoughClv&&result.roi>0&&result.averageClv>0;
    $("verdict").className="verdict"+(positive?" positive":"");
    $("verdict").innerHTML=!enough?'<strong>Campione ancora insufficiente</strong><span>Servono almeno 30 giocate chiuse prima di giudicare il metodo.</span>':!enoughClv?'<strong>Mancano quote di chiusura</strong><span>Inseriscine almeno 15 per misurare la qualità delle scelte oltre al risultato.</span>':positive?'<strong>Segnale positivo da confermare</strong><span>ROI e CLV sono positivi, ma il campione resta soggetto a varianza.</span>':'<strong>Nessun vantaggio dimostrato</strong><span>Riduci o sospendi le giocate e rivaluta il filtro.</span>';
    if(!state.archive.length){$("archiveList").innerHTML='<div class="empty-state">Le giocate registrate compariranno qui.</div>';return;}
    $("archiveList").innerHTML=state.archive.map((bet)=>{
      const clv=Number(bet.closingOdds)>=1.01?Number(bet.totalOdds)/Number(bet.closingOdds)-1:null;
      const statuses=["open","won","lost","void"].map((status)=>'<button data-bet-status="'+esc(bet.id+"|"+status)+'" data-status="'+status+'" class="'+(bet.status===status?"active":"")+'">'+({open:"Aperta",won:"Vinta",lost:"Persa",void:"Rimb."})[status]+'</button>').join("");
      return '<article class="archive-card"><div class="archive-head"><div><span>'+esc(bet.kind||"Singola")+' · '+esc(new Date(bet.createdAt).toLocaleDateString("it-IT"))+'</span><strong>€ '+dec(bet.stake)+' @ '+dec(bet.totalOdds)+'</strong></div><button data-delete-bet="'+esc(bet.id)+'">×</button></div>'+(bet.picks||[]).map((pick)=>'<p><span>'+esc(pick.home)+' – '+esc(pick.away)+'</span><b>'+esc(pick.market)+'</b></p>').join("")+'<div class="archive-controls"><label>Quota di chiusura<input data-closing="'+esc(bet.id)+'" inputmode="decimal" type="number" min="1.01" step=".01" value="'+(Number(bet.closingOdds)>=1.01?Number(bet.closingOdds).toFixed(2):"")+'" placeholder="es. 1,58"></label><div class="status-switch">'+statuses+'</div></div>'+(clv==null?"":'<div class="clv-row"><span>CLV</span><strong class="'+(clv>=0?"green":"red")+'">'+(clv>=0?"+":"")+dec(clv*100)+'%</strong></div>')+'</article>';
    }).join("");
  }
  function renderSettings(){
    $("footballToken").value=state.token;$("oddsToken").value=state.oddsToken;$("bankrollInput").value=String(state.bankroll);$("strictInput").checked=state.strict;
    $("syncBtn").disabled=state.syncing;$("syncBtn").textContent=state.syncing?"Aggiornamento…":"Salva e aggiorna";
    $("syncOddsBtn").disabled=state.oddsLoading;$("syncOddsBtn").textContent=state.oddsLoading?"Scarico…":"Scarica quote";
  }
  function renderAll(rebuild){refreshDerived(Boolean(rebuild));renderLeagueNav();renderStatus();renderSummary();renderAnalysis();renderGenerated();renderSlip();renderArchive();renderSettings();}
  function showView(view){
    state.view=view;document.querySelectorAll(".view").forEach((section)=>section.classList.remove("active"));
    if($("view-"+view))$("view-"+view).classList.add("active");
    document.querySelectorAll(".bottom-nav button").forEach((button)=>button.classList.toggle("active",button.dataset.view===view));
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function normaliseApiMatch(raw,code){
    return {id:String(raw.id),utcDate:raw.utcDate,matchday:raw.matchday||0,status:raw.status,competitionCode:code,
      homeTeam:{id:Number(raw.homeTeam&&raw.homeTeam.id||0),name:raw.homeTeam&&raw.homeTeam.name||"Casa",shortName:raw.homeTeam&&(raw.homeTeam.shortName||raw.homeTeam.name)||"Casa"},
      awayTeam:{id:Number(raw.awayTeam&&raw.awayTeam.id||0),name:raw.awayTeam&&raw.awayTeam.name||"Ospite",shortName:raw.awayTeam&&(raw.awayTeam.shortName||raw.awayTeam.name)||"Ospite"},
      homeScore:raw.score&&raw.score.fullTime&&raw.score.fullTime.home!=null?Number(raw.score.fullTime.home):null,
      awayScore:raw.score&&raw.score.fullTime&&raw.score.fullTime.away!=null?Number(raw.score.fullTime.away):null};
  }
  async function fetchJson(url,headers){
    let lastError;
    for(let attempt=0;attempt<2;attempt++){
      const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),22000);
      try{
        const response=await fetch(url,{headers,signal:controller.signal,cache:"no-store"});
        const payload=await response.json().catch(()=>({}));
        if(response.status===429&&attempt===0){await wait(clamp(Number(response.headers.get("Retry-After"))||7,2,15)*1000);continue;}
        if(!response.ok){
          if(response.status===401||response.status===403)throw new Error("chiave non valida o campionato non incluso nel piano");
          throw new Error(payload.message||payload.error||"errore HTTP "+response.status);
        }
        return payload;
      }catch(error){
        lastError=error&&error.name==="AbortError"?new Error("richiesta scaduta"):error;
        if(attempt===0&&!/chiave non valida/.test(lastError&&lastError.message||"")){await wait(700);continue;}
      }finally{window.clearTimeout(timeout);}
    }
    throw lastError||new Error("connessione non riuscita");
  }
  async function fetchLeague(code,season){
    const endpoint="https://api.football-data.org/v4/competitions/"+code+"/matches?season=",headers={"X-Auth-Token":state.token,Accept:"application/json"};
    const current=await fetchJson(endpoint+season,headers);await wait(700);
    let previous={matches:[]};
    try{previous=await fetchJson(endpoint+(season-1),headers);}catch{previous={matches:[]};}
    const byId=new Map();
    [].concat(previous.matches||[],current.matches||[]).forEach((raw)=>{const match=normaliseApiMatch(raw,code);byId.set(match.id,match);});
    const all=Array.from(byId.values()),cutoff=Date.now()+5*60*1000;
    return {
      upcoming:all.filter((m)=>["SCHEDULED","TIMED","POSTPONED"].includes(m.status)&&Date.parse(m.utcDate)>cutoff).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate)).slice(0,state.competition==="ALL"?5:12),
      history:all.filter((m)=>m.status==="FINISHED"&&m.homeScore!=null&&m.awayScore!=null).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate)).slice(-260)
    };
  }
  async function syncData(){
    const draft=$("footballToken").value.trim();
    if(draft){state.token=draft;localStorage.setItem(STORAGE.token,draft);}
    if(!state.token){showView("settings");setMessage("Inserisci prima la chiave gratuita football-data.org.","error");return;}
    if(state.syncing)return;
    state.syncing=true;renderSettings();
    const codes=state.competition==="ALL"?LEAGUE_CODES:[state.competition];
    const season=new Date().getMonth()>=6?new Date().getFullYear():new Date().getFullYear()-1,loaded=[];
    try{
      for(let i=0;i<codes.length;i++){
        setMessage("Aggiorno "+leagueName(codes[i])+" ("+(i+1)+"/"+codes.length+")…");
        loaded.push(Object.assign({code:codes[i]},await fetchLeague(codes[i],season)));
        if(i<codes.length-1)await wait(900);
      }
      const upcoming=loaded.flatMap((row)=>row.upcoming).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate));
      const history=loaded.flatMap((row)=>row.history).sort((a,b)=>Date.parse(a.utcDate)-Date.parse(b.utcDate));
      if(!upcoming.length)throw new Error("nessuna prossima partita disponibile in questo momento");
      state.upcoming=upcoming;state.history=history;state.loadedCompetition=state.competition;state.updatedAt=new Date().toISOString();state.isDemo=false;state.selected=upcoming[0].id;
      state.slip=state.slip.filter((pick)=>upcoming.some((match)=>match.id===pick.matchId));
      const settled=settleFromResults(history);persistSnapshot();renderAll(true);showView("analysis");
      setMessage(leagueName(state.loadedCompetition)+": "+upcoming.length+" prossime partite e "+history.length+" risultati analizzati."+(settled?" "+settled+" giocate chiuse automaticamente.":""));
      if(state.oddsToken&&state.competition!=="ALL")await syncOdds(true);
    }catch(error){setMessage("Aggiornamento non riuscito: "+(error&&error.message||"errore sconosciuto")+".","error");}
    finally{state.syncing=false;renderSettings();}
  }

  function normaliseTeam(value){
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(fc|ac|afc|cf|ssc|ss|as|calcio|football|club|deportivo|futbol|fussball|1907)\b/g," ").replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim();
  }
  function teamsMatch(left,right){
    const a=normaliseTeam(left),b=normaliseTeam(right);
    return Boolean(a&&b&&(a===b||a.includes(b)||b.includes(a)||a.split(" ").some((word)=>word.length>=5&&b.includes(word))));
  }
  function median(values){const sorted=values.slice().sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;}
  function decimalOdds(american){if(!Number.isFinite(american)||american===0||american===.0001)return 0;return american>0?1+american/100:1+100/Math.abs(american);}
  function selectionKey(market,participant,line,home,away){
    const marketName=String(market.name||"").toLowerCase(),participantName=String(participant.name||"").toLowerCase().trim(),lineValue=String(line.value||"").toLowerCase().trim();
    if(market.market_id===1||marketName.includes("moneyline")){
      if(participantName.includes("draw")||participantName==="x")return "X";
      if(teamsMatch(participantName,home))return "1";if(teamsMatch(participantName,away))return "2";
    }
    if(market.market_id===3||marketName.includes("total")){
      const found=lineValue.match(/\d+(?:\.\d+)?/)||participantName.match(/\d+(?:\.\d+)?/),side=participantName.includes("over")?"O":participantName.includes("under")?"U":"";
      if(side&&found&&["1.5","2.5","3.5"].includes(found[0]))return side+found[0].replace(".","");
    }
    if(marketName.includes("both teams")||marketName.includes("btts")){if(/^(yes|si|sì)$/.test(participantName))return "GG";if(participantName==="no")return "NG";}
    return "";
  }
  async function syncOdds(silent){
    const draft=$("oddsToken").value.trim();
    if(draft){state.oddsToken=draft;localStorage.setItem(STORAGE.oddsToken,draft);}
    if(!state.oddsToken){if(!silent){showView("settings");setMessage("Inserisci una API key TheRundown oppure aggiungi le quote a mano.","error");}return;}
    if(state.loadedCompetition==="ALL"){if(!silent)setMessage("Per Europa 4 inserisci le quote a mano: il download automatico lavora su un campionato alla volta.");return;}
    const sport=RUNDOWN_SPORTS[state.loadedCompetition];
    if(!sport||!state.upcoming.length){if(!silent)setMessage("Aggiorna prima le partite reali.","error");return;}
    state.oddsLoading=true;renderSettings();
    try{
      const dates=Array.from(new Set(state.upcoming.map((match)=>match.utcDate.slice(0,10)))).slice(0,6),events=[];
      for(let i=0;i<dates.length;i++){
        if(i)await wait(1150);setMessage("Scarico le quote reali ("+(i+1)+"/"+dates.length+")…");
        const payload=await fetchJson("https://therundown.io/api/v2/sports/"+sport+"/events/"+dates[i]+"?market_ids=1,2,3&main_line=true",{"X-TheRundown-Key":state.oddsToken,Accept:"application/json"});
        events.push.apply(events,Array.isArray(payload)?payload:payload.events||payload.data||[]);
      }
      let quoteCount=0,matchedCount=0;
      state.upcoming.forEach((match)=>{
        const matchTime=Date.parse(match.utcDate);
        const event=events.find((candidate)=>{
          const teams=candidate.teams||[],home=teams.find((team)=>team.is_home)||teams[1]||{},away=teams.find((team)=>team.is_away)||teams[0]||{};
          return Math.abs(Date.parse(candidate.event_date||"")-matchTime)<=21600000&&teamsMatch(match.homeTeam.name,home.name)&&teamsMatch(match.awayTeam.name,away.name);
        });
        if(!event)return;matchedCount++;
        const teams=event.teams||[],homeName=(teams.find((team)=>team.is_home)||teams[1]||{}).name||match.homeTeam.name,awayName=(teams.find((team)=>team.is_away)||teams[0]||{}).name||match.awayTeam.name,collected=new Map();
        (event.markets||[]).forEach((market)=>(market.participants||[]).forEach((participant)=>(participant.lines||[]).forEach((line)=>{
          const key=selectionKey(market,participant,line,homeName,awayName);if(!key)return;
          const row=collected.get(key)||{values:[],books:new Set()};
          Object.keys(line.prices||{}).forEach((book)=>{const odd=decimalOdds(Number(line.prices[book]&&line.prices[book].price));if(odd>=1.01){row.values.push(odd);row.books.add(book);}});
          collected.set(key,row);
        })));
        collected.forEach((row,key)=>{if(!row.values.length)return;const storageKey=quoteKey(match.id,key);state.odds[storageKey]=Number(median(row.values).toFixed(2));state.oddsMeta[storageKey]={source:"Mediana "+row.books.size+" bookmaker",updatedAt:new Date().toISOString(),automatic:true};quoteCount++;});
      });
      if(!quoteCount)throw new Error("nessuna quota pre-partita ancora disponibile");
      writeJson(STORAGE.odds,state.odds);writeJson(STORAGE.oddsMeta,state.oddsMeta);renderAll(false);setMessage(quoteCount+" quote reali caricate su "+matchedCount+" partite.");
    }catch(error){setMessage("Quote automatiche non disponibili: "+(error&&error.message||"connessione non riuscita")+". Puoi inserirle a mano.","error");}
    finally{state.oddsLoading=false;renderSettings();}
  }

  function updateOdd(key,value){
    const numeric=Number(String(value).replace(",","."));
    if(Number.isFinite(numeric)&&numeric>=1.01)state.odds[key]=numeric;else delete state.odds[key];
    delete state.oddsMeta[key];writeJson(STORAGE.odds,state.odds);writeJson(STORAGE.oddsMeta,state.oddsMeta);
    refreshDerived(false);renderSummary();renderAnalysis();renderGenerated();
  }
  function addPick(matchId,marketKey){
    const analysis=analyses.find((row)=>row.match.id===matchId),market=analysis&&analysis.markets.find((row)=>row.key===marketKey);
    if(!analysis||!market)return;
    const odd=Number(state.odds[quoteKey(matchId,marketKey)]||0);
    if(odd<1.01){setMessage("Inserisci prima la quota realmente disponibile.","error");return;}
    const ev=evaluateMarket(analysis,market,odd,backtests[market.key]);
    const pick={id:matchId+"-"+marketKey,matchId,home:analysis.match.homeTeam.shortName||analysis.match.homeTeam.name,away:analysis.match.awayTeam.shortName||analysis.match.awayTeam.name,competitionCode:analysis.match.competitionCode,marketKey,market:market.label,probability:market.probability,conservativeProbability:ev.conservativeProbability,reliability:analysis.reliability,odds:odd,backtestSamples:backtests[market.key]?backtests[market.key].samples:0,value:ev.value,qualified:ev.prudent};
    if(state.strict)state.slip=[pick];else{state.slip=state.slip.filter((row)=>row.matchId!==matchId);if(state.slip.length>=5){setMessage("Limite: massimo cinque eventi.","error");return;}state.slip.push(pick);}
    renderAnalysis();renderSlip();setMessage(pick.market+" aggiunto alla schedina"+(pick.qualified?".":", ma non supera il filtro rigoroso."));
  }
  function archiveSlip(){
    if(!state.slip.length){setMessage("Aggiungi una selezione prima di salvarla.","error");return;}
    if(state.strict&&state.slip.length!==1){setMessage("La modalità rigorosa consente solo singole.","error");return;}
    if(state.strict&&state.slip.some((pick)=>!pick.qualified||Number(pick.value)<.025||Number(pick.backtestSamples)<MIN_BACKTEST_SAMPLES)){setMessage("Giocata bloccata: non supera quota, margine, affidabilità e verifica storica.","error");return;}
    const cap=stakeCap(),stake=clamp(Number($("stakeInput").value||cap),.5,cap);
    if(monthlyStaked()+stake>state.bankroll){setMessage("Budget mensile esaurito: giocata non salvata.","error");return;}
    const createdAt=new Date().toISOString(),totalOdds=state.slip.reduce((value,pick)=>value*Number(pick.odds),1);
    state.archive.unshift({id:createdAt+"-"+state.archive.length,createdAt,kind:state.slip.length===1?"Singola":"Multipla "+state.slip.length,stake,picks:state.slip.slice(),totalOdds,status:"open"});
    writeJson(STORAGE.archive,state.archive);state.slip=[];renderSlip();renderArchive();showView("archive");setMessage("Giocata reale salvata nell’archivio.");
  }
  function settleFromResults(results){
    const byId=new Map(results.filter((m)=>m.homeScore!=null&&m.awayScore!=null).map((m)=>[String(m.id),m]));let settled=0;
    state.archive=state.archive.map((bet)=>{if(bet.status!=="open")return bet;const matches=(bet.picks||[]).map((pick)=>byId.get(String(pick.matchId)));if(!matches.length||matches.some((m)=>!m))return bet;const won=bet.picks.every((pick,index)=>marketWon(pick.marketKey,Number(matches[index].homeScore),Number(matches[index].awayScore)));settled++;return Object.assign({},bet,{status:won?"won":"lost",settledAt:new Date().toISOString()});});
    if(settled)writeJson(STORAGE.archive,state.archive);return settled;
  }
  function exportArchive(){
    if(!state.archive.length){setMessage("Non ci sono giocate da esportare.","error");return;}
    const rows=[["data","tipo","puntata","quota","stato","quota_chiusura","selezioni"]];
    state.archive.forEach((bet)=>rows.push([bet.createdAt,bet.kind,bet.stake,bet.totalOdds,bet.status,bet.closingOdds||"",(bet.picks||[]).map((pick)=>pick.home+"-"+pick.away+" "+pick.market).join(" | ")]));
    const csv=rows.map((row)=>row.map((cell)=>'"'+String(cell).replace(/"/g,'""')+'"').join(",")).join("\n"),blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download="football-archivio-"+new Date().toISOString().slice(0,10)+".csv";anchor.click();URL.revokeObjectURL(url);
  }
  async function installApp(){
    if(window.matchMedia("(display-mode: standalone)").matches){setMessage("L’app è già installata.");return;}
    if(deferredInstallPrompt){await deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;setMessage(choice.outcome==="accepted"?"Installazione avviata.":"Installazione annullata.");deferredInstallPrompt=null;return;}
    setMessage("Apri il menu ⋮ di Chrome e scegli “Installa app” o “Aggiungi a schermata Home”.");
  }
  async function updateApp(){
    $("updateBtn").disabled=true;
    try{if("serviceWorker"in navigator){const registration=await navigator.serviceWorker.getRegistration();if(registration)await registration.update();}await fetch("./index.html?refresh="+Date.now(),{cache:"no-store"});setMessage("Controllo completato. Ricarico l’app…");window.setTimeout(()=>window.location.reload(),450);}
    catch{setMessage("Aggiornamento non riuscito: controlla la connessione.","error");$("updateBtn").disabled=false;}
  }

  function bindEvents(){
    document.querySelector(".bottom-nav").addEventListener("click",(event)=>{const button=event.target.closest("button[data-view]");if(button)showView(button.dataset.view);});
    $("leagueNav").addEventListener("click",(event)=>{
      const button=event.target.closest("button[data-league]");if(!button)return;
      state.competition=button.dataset.league;localStorage.setItem(STORAGE.competition,state.competition);renderLeagueNav();
      if(state.token)syncData();else{showView("settings");setMessage("Campionato scelto: "+leagueName(state.competition)+". Inserisci la chiave per aggiornarlo.");}
    });
    $("matchGrid").addEventListener("click",(event)=>{const button=event.target.closest("button[data-match]");if(!button)return;state.selected=button.dataset.match;renderSummary();renderAnalysis();window.setTimeout(()=>$("analysisPanel").scrollIntoView({behavior:"smooth",block:"start"}),50);});
    $("analysisPanel").addEventListener("change",(event)=>{const input=event.target.closest("input[data-odd]");if(input)updateOdd(input.dataset.odd,input.value);});
    $("analysisPanel").addEventListener("click",(event)=>{const button=event.target.closest("button[data-add]");if(button){const parts=button.dataset.add.split("|");addPick(parts[0],parts[1]);}});
    $("generateBtn").addEventListener("click",()=>{renderGenerated();$("generatedBox").scrollIntoView({behavior:"smooth",block:"nearest"});});
    $("generatedBox").addEventListener("click",(event)=>{
      const use=event.target.closest("button[data-use-generated]");
      if(use){const parts=use.dataset.useGenerated.split("|");addPick(parts[0],parts[1]);return;}
      const open=event.target.closest("button[data-open-generated]");
      if(open){state.selected=open.dataset.openGenerated;showView("analysis");renderSummary();renderAnalysis();window.setTimeout(()=>$("analysisPanel").scrollIntoView({behavior:"smooth"}),50);}
    });
    $("slipBox").addEventListener("click",(event)=>{const button=event.target.closest("button[data-remove-pick]");if(button){state.slip=state.slip.filter((pick)=>pick.id!==button.dataset.removePick);renderAnalysis();renderSlip();}});
    $("stakeInput").addEventListener("change",renderSlip);$("archiveBtn").addEventListener("click",archiveSlip);
    $("archiveList").addEventListener("change",(event)=>{
      const input=event.target.closest("input[data-closing]");if(!input)return;
      const numeric=Number(String(input.value).replace(",","."));state.archive=state.archive.map((bet)=>bet.id===input.dataset.closing?Object.assign({},bet,{closingOdds:numeric>=1.01?numeric:undefined}):bet);writeJson(STORAGE.archive,state.archive);renderArchive();
    });
    $("archiveList").addEventListener("click",(event)=>{
      const status=event.target.closest("button[data-bet-status]");
      if(status){const parts=status.dataset.betStatus.split("|");state.archive=state.archive.map((bet)=>bet.id===parts[0]?Object.assign({},bet,{status:parts[1],settledAt:parts[1]==="open"?undefined:new Date().toISOString()}):bet);writeJson(STORAGE.archive,state.archive);renderArchive();return;}
      const remove=event.target.closest("button[data-delete-bet]");
      if(remove&&window.confirm("Eliminare questa giocata dall’archivio?")){state.archive=state.archive.filter((bet)=>bet.id!==remove.dataset.deleteBet);writeJson(STORAGE.archive,state.archive);renderArchive();renderSlip();}
    });
    $("saveFootballTokenBtn").addEventListener("click",()=>{const value=$("footballToken").value.trim();if(!value){setMessage("Incolla prima la chiave.","error");return;}state.token=value;localStorage.setItem(STORAGE.token,value);setMessage("Chiave risultati salvata solo su questo dispositivo.");});
    $("syncBtn").addEventListener("click",syncData);
    $("removeFootballTokenBtn").addEventListener("click",()=>{state.token="";$("footballToken").value="";localStorage.removeItem(STORAGE.token);setMessage("Chiave risultati rimossa.");});
    $("saveOddsTokenBtn").addEventListener("click",()=>{const value=$("oddsToken").value.trim();if(!value){setMessage("Incolla la API key oppure usa le quote manuali.","error");return;}state.oddsToken=value;localStorage.setItem(STORAGE.oddsToken,value);setMessage("Chiave quote salvata solo su questo dispositivo.");});
    $("syncOddsBtn").addEventListener("click",()=>syncOdds(false));
    $("removeOddsTokenBtn").addEventListener("click",()=>{state.oddsToken="";$("oddsToken").value="";localStorage.removeItem(STORAGE.oddsToken);setMessage("Chiave quote rimossa.");});
    $("bankrollInput").addEventListener("change",(event)=>{state.bankroll=Math.max(5,Number(event.target.value)||50);localStorage.setItem(STORAGE.bankroll,String(state.bankroll));renderSlip();});
    $("strictInput").addEventListener("change",(event)=>{state.strict=event.target.checked;localStorage.setItem(STORAGE.strict,state.strict?"1":"0");if(state.strict&&state.slip.length>1)state.slip=state.slip.slice(0,1);renderSlip();});
    $("exportBtn").addEventListener("click",exportArchive);$("installBtn").addEventListener("click",installApp);$("updateBtn").addEventListener("click",updateApp);
    window.addEventListener("beforeinstallprompt",(event)=>{event.preventDefault();deferredInstallPrompt=event;$("installBtn").textContent="Installa";});
    window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;$("installBtn").textContent="Installata";setMessage("App installata con icona Football.");});
  }
  async function registerServiceWorker(){
    if(!("serviceWorker"in navigator))return;
    try{
      const registration=await navigator.serviceWorker.register("./service-worker.js",{scope:"./"});
      registration.addEventListener("updatefound",()=>{const worker=registration.installing;if(worker)worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller)setMessage("Nuova versione pronta: premi “Aggiorna app”.");});});
    }catch{setMessage("Modalità offline non disponibile; l’app online continua a funzionare.","error");}
  }

  bindEvents();renderAll(true);
  if(!state.isDemo&&state.updatedAt)setMessage("Ultimo aggiornamento: "+dateLabel(state.updatedAt)+". Scegli il campionato per scaricare dati nuovi.");
  registerServiceWorker();
})();
