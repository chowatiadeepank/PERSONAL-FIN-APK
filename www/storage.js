(function(){
  "use strict";

  /* ---------------- View mode (desktop / mobile) ---------------- */
  var VIEW_MODE_KEY = "pf_view_mode_v1";
  function getViewMode(){ try{ return localStorage.getItem(VIEW_MODE_KEY) || "auto"; }catch(e){ return "auto"; } }
  function setViewMode(mode){ try{ localStorage.setItem(VIEW_MODE_KEY, mode); }catch(e){} applyViewMode(); }
  function applyViewMode(){
    var mode = getViewMode();
    var root = document.documentElement;
    root.classList.remove("force-desktop","force-mobile");
    if(mode==="desktop") root.classList.add("force-desktop");
    else if(mode==="mobile") root.classList.add("force-mobile");
  }
  applyViewMode();

  /* ---------------- Storage ---------------- */
  var STORE_KEY = "personal_finance_data_v3";
  var OLD_KEYS = ["personal_finance_data_v2","ledger_app_data_v1"];
  var state = load();

  function defaultState(){
    return { accounts: [], transactions: [], debts: [], investments: [], soldInvestments: [], investmentEvents: [], loans: [], recurring: [], lastModified: 0 };
  }
  function load(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw){ for(var i=0;i<OLD_KEYS.length;i++){ raw = localStorage.getItem(OLD_KEYS[i]); if(raw) break; } }
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    }catch(e){ return defaultState(); }
  }
  function save(){
    try{
      state.lastModified = Date.now();
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    }
    catch(e){ alert("Could not save data on this device: " + e.message); }
    scheduleSync();
  }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  /* ---------------- Google Sheets sync ---------------- */
  var SYNC_KEY = "pf_sync_settings_v1";
  var syncTimer = null;
  var skipNextPush = false;

  function getSyncSettings(){
    var base = {url:"", enabled:false, lastSyncedAt:0, lastStatus:""};
    try{
      var raw = localStorage.getItem(SYNC_KEY);
      return raw ? Object.assign(base, JSON.parse(raw)) : base;
    }catch(e){ return base; }
  }
  function setSyncSettings(patch){
    var next = Object.assign(getSyncSettings(), patch);
    try{ localStorage.setItem(SYNC_KEY, JSON.stringify(next)); }catch(e){}
    renderSyncStatus();
    return next;
  }
  function scheduleSync(){
    var s = getSyncSettings();
    if(skipNextPush){ skipNextPush = false; return; }
    if(!s.enabled || !s.url) return;
    if(syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function(){ pushToSheet(); }, 1500);
  }
  function pushToSheet(cb){
    var s = getSyncSettings();
    if(!s.url){ if(cb) cb(false,"No Apps Script link set yet."); return; }
    renderSyncStatus("Syncing…");
    fetch(s.url, {
      method: "POST",
      headers: {"Content-Type":"text/plain;charset=utf-8"},
      body: JSON.stringify({action:"push", data: state, lastModified: state.lastModified})
    }).then(function(r){ return r.json(); }).then(function(res){
      if(res && res.ok){ setSyncSettings({lastSyncedAt: Date.now(), lastStatus:"ok"}); if(cb) cb(true); }
      else { setSyncSettings({lastStatus:"error"}); if(cb) cb(false, (res&&res.error)||"Unknown error from Apps Script."); }
    }).catch(function(err){
      setSyncSettings({lastStatus:"error"});
      if(cb) cb(false, "Could not reach the Apps Script link. " + err.message);
    });
  }
  function pullFromSheet(cb, silent){
    var s = getSyncSettings();
    if(!s.url){ if(cb) cb(false,"No Apps Script link set yet."); return; }
    if(!silent) renderSyncStatus("Checking for newer data…");
    var sep = s.url.indexOf("?")>-1 ? "&" : "?";
    fetch(s.url + sep + "action=pull", {method:"GET"})
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.ok && res.data){
          if((res.lastModified||0) > (state.lastModified||0)){
            skipNextPush = true;
            state = Object.assign(defaultState(), res.data, {lastModified: res.lastModified});
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
            renderAll();
          }
          setSyncSettings({lastSyncedAt: Date.now(), lastStatus:"ok"});
          if(cb) cb(true, res);
        } else { setSyncSettings({lastStatus:"error"}); if(cb) cb(false, (res&&res.error)||"No backup found on the sheet yet."); }
      }).catch(function(err){ setSyncSettings({lastStatus:"error"}); if(cb) cb(false, "Could not reach the Apps Script link. " + err.message); });
  }
  function testSyncConnection(cb){
    var s = getSyncSettings();
    if(!s.url){ if(cb) cb(false,"Paste your Apps Script web app link first."); return; }
    var sep = s.url.indexOf("?")>-1 ? "&" : "?";
    fetch(s.url + sep + "action=ping", {method:"GET"})
      .then(function(r){ return r.json(); })
      .then(function(res){ if(cb) cb(!!(res&&res.ok), res&&res.error); })
      .catch(function(err){ if(cb) cb(false, err.message); });
  }
  function renderSyncStatus(msg){
    var el = document.getElementById("syncStatusText");
    if(!el) return;
    var s = getSyncSettings();
    if(msg){ el.textContent = msg; return; }
    if(!s.url){ el.textContent = "Not connected — data stays on this device only."; return; }
    if(!s.enabled){ el.textContent = "Link saved, auto-sync is paused."; return; }
    if(s.lastStatus==="error"){ el.textContent = "Last sync attempt failed. Check the link and your internet connection."; return; }
    if(s.lastSyncedAt){ el.textContent = "Synced to Google Sheet · last time " + new Date(s.lastSyncedAt).toLocaleString('en-IN'); return; }
    el.textContent = "Connected. Syncing for the first time…";
  }
  /* Attempt a silent pull as soon as the page loads, so this device gets
     any newer data saved from another device, before rendering settles. */
  (function initialSync(){
    var s = getSyncSettings();
    if(s.enabled && s.url){ pullFromSheet(function(){ renderSyncStatus(); }, true); }
  })();

  /* ---------------- Helpers ---------------- */
  var currencySymbol = "₹";
  function fmt(n){
    n = Number(n)||0;
    var neg = n < 0;
    n = Math.abs(n);
    var s = n.toLocaleString('en-IN', {maximumFractionDigits:2, minimumFractionDigits:2});
    return (neg?"-":"") + currencySymbol + s;
  }
  function fmtRound(n){
    n = Number(n)||0;
    var neg = n < 0;
    n = Math.round(Math.abs(n));
    var s = n.toLocaleString('en-IN', {maximumFractionDigits:2, minimumFractionDigits:2});
    return (neg?"-":"") + currencySymbol + s;
  }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function niceDate(iso){
    if(!iso) return "";
    var d = new Date(iso+"T00:00:00");
    if(isNaN(d)) return iso;
    return d.toLocaleDateString('en-IN', {day:'numeric', month:'short', year: (d.getFullYear()!==new Date().getFullYear()?'numeric':undefined)});
  }
  function daysBetween(iso1, iso2){
    var a = new Date(iso1+"T00:00:00"), b = new Date(iso2+"T00:00:00");
    return Math.round((b-a)/86400000);
  }
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function advanceDate(iso, freq){
    var d = new Date(iso+"T00:00:00");
    if(freq==='weekly') d.setDate(d.getDate()+7);
    else if(freq==='yearly') d.setFullYear(d.getFullYear()+1);
    else d.setMonth(d.getMonth()+1);
    return d.toISOString().slice(0,10);
  }
  function nextEmiDate(loan){
    if(!loan.dueDay) return null;
    var today = new Date();
    var y = today.getFullYear(), m = today.getMonth();
    var lastDayThisMonth = new Date(y, m+1, 0).getDate();
    var day = Math.min(loan.dueDay, lastDayThisMonth);
    var candidate = new Date(y,m,day).toISOString().slice(0,10);
    if(candidate < todayISO()){
      var lastDayNext = new Date(y, m+2, 0).getDate();
      day = Math.min(loan.dueDay, lastDayNext);
      candidate = new Date(y,m+1,day).toISOString().slice(0,10);
    }
    return candidate;
  }
  function computeEMI(P, annualRatePct, months){
    P = Number(P)||0; months = Number(months)||0;
    if(!P || !months) return null;
    var r = (Number(annualRatePct)||0)/12/100;
    if(r<=0) return P/months;
    var pow = Math.pow(1+r, months);
    return P*r*pow/(pow-1);
  }
  function computeOutstandingAfterPayments(P, annualRatePct, paidCount, emi){
    P = Number(P)||0; paidCount = Number(paidCount)||0; emi = Number(emi)||0;
    if(!P || paidCount<=0) return P;
    var r = (Number(annualRatePct)||0)/12/100;
    var outstanding;
    if(r<=0){
      outstanding = P - emi*paidCount;
    } else {
      var pow = Math.pow(1+r, paidCount);
      outstanding = P*pow - emi*((pow-1)/r);
    }
    if(!isFinite(outstanding)) return P;
    return Math.max(0, Math.min(P, outstanding));
  }

  /* ---------------- Investment types ---------------- */
  var INV_TYPES = [
    {key:'shares', label:'Shares', divisible:true, unitDefault:'shares', partial:true, hint:'Holds a quantity of shares. Can be sold in parts.'},
    {key:'gold', label:'Gold', divisible:true, unitDefault:'grams', partial:true, hint:'Holds a quantity of gold. Can be sold in parts, cost adjusts as you sell.'},
    {key:'property', label:'Property', divisible:false, unitDefault:'', partial:false, hint:'A single holding — sold as a whole, not in parts.'},
    {key:'sip', label:'SIP', divisible:false, unitDefault:'', partial:false, hint:'A recurring investment. Set up automatic contributions from Recurring → Investment / SIP.'},
    {key:'insurance', label:'Insurance', divisible:false, unitDefault:'', partial:false, hint:'A yearly (or periodic) premium plan. Set up automatic contributions from Recurring → Investment / SIP.'}
  ];
  function invTypeInfo(key){
    for(var i=0;i<INV_TYPES.length;i++){ if(INV_TYPES[i].key===key) return INV_TYPES[i]; }
    return INV_TYPES[0];
  }
  function invTypeSegHTML(id, selected){
    if(!INV_TYPES.some(function(t){return t.key===selected;})) selected = INV_TYPES[0].key;
    return '<div class="seg wrap-seg" id="'+id+'">'+INV_TYPES.map(function(t){
      return '<button type="button" class="'+(t.key===selected?'on':'')+'" data-v="'+t.key+'">'+t.label+'</button>';
    }).join('')+'</div>';
  }
  function migrateInvestmentCategories(){
    var map = {current:'shares', fixed:'property'};
    var changed = false;
    function fix(obj, field){ if(obj && map[obj[field]]){ obj[field]=map[obj[field]]; changed=true; } }
    (state.investments||[]).forEach(function(i){ fix(i,'category'); });
    (state.soldInvestments||[]).forEach(function(i){ fix(i,'category'); });
    (state.investmentEvents||[]).forEach(function(e){ fix(e,'category'); });
    (state.recurring||[]).forEach(function(r){ fix(r,'investmentCategory'); });
    if(changed) save();
  }
  migrateInvestmentCategories();

  /* ---------------- Derived totals ---------------- */
  function accountBalance(acc){
    var bal = acc.opening || 0;
    state.transactions.forEach(function(t){
      if(t.accountId !== acc.id) return;
      bal += (t.type === 'income') ? t.amount : -t.amount;
    });
    return bal;
  }
  function totalCash(){ return state.accounts.reduce(function(sum,a){ return sum + accountBalance(a); }, 0); }
  function totalOwedToYou(){ return state.debts.filter(function(d){return d.type==='debtor';}).reduce(function(s,d){return s+d.amount;},0); }
  function totalYouOwe(){ return state.debts.filter(function(d){return d.type==='creditor';}).reduce(function(s,d){return s+d.amount;},0); }
  function totalInvestValue(){ return state.investments.reduce(function(s,i){return s+(i.currentValue||0);},0); }
  function totalInvested(){ return state.investments.reduce(function(s,i){return s+(i.invested||0);},0); }
  function totalLoansOutstanding(){ return state.loans.reduce(function(s,l){return s+(l.outstanding||0);},0); }
  function totalLiabilities(){ return totalYouOwe() + totalLoansOutstanding(); }
  function netWorth(){ return totalCash() + totalOwedToYou() + totalInvestValue() - totalLiabilities(); }

  function addTransaction(tx){
    tx.id = uid(); tx.created = Date.now();
    state.transactions.push(tx);
    return tx;
  }

  /* ============ Shared money-movement actions (single source of truth) ============ */
  function doGeneralTx(dir, accountId, amount, category, note, date){
    addTransaction({accountId:accountId, type: dir==='out'?'expense':'income', amount:amount, category:category, note:note, date:date});
  }
  /* ============ Investment running-ledger engine ============
     Every new buy/sell is stored as an event. Holdings are a projection of those
     events, so deleting a sale can restore the exact pre-sale quantity/cost state,
     even when later buys have been added to the same asset. */
  function ensureInvestmentEvents(inv){
    state.investmentEvents = state.investmentEvents || [];
    var has = state.investmentEvents.some(function(e){return e.investmentId===inv.id;});
    if(!has){
      state.investmentEvents.push({id:uid(), type:'opening', investmentId:inv.id, name:inv.name,
        category:inv.category, principal:inv.principalAmount||inv.invested||0,
        charges:inv.buyCharges||0, cost:inv.invested||0, quantity:inv.quantity,
        unitLabel:inv.unitLabel||'units', currentValue:inv.currentValue||inv.invested||0,
        adjustedCost:inv.adjustedCost!=null?inv.adjustedCost:(inv.invested||0),
        date:inv.date||todayISO(), created:Date.now()});
    }
  }
  function rebuildInvestment(invId){
    var inv = state.investments.find(function(x){return x.id===invId;});
    if(!inv) return;
    ensureInvestmentEvents(inv);
    var evs = state.investmentEvents.filter(function(e){return e.investmentId===invId;})
      .sort(function(a,b){return (a.date||'').localeCompare(b.date||'') || (a.created||0)-(b.created||0);});
    if(!evs.length) return;
    var first = evs[0];
    var divisible = first.quantity!=null;
    var qty = divisible ? (Number(first.quantity)||0) : null;
    var invested = Number(first.cost)||0;
    var adjusted = first.adjustedCost!=null ? Number(first.adjustedCost) : invested;
    var current = first.currentValue!=null ? Number(first.currentValue) : invested;
    var principal = Number(first.principal)||invested;
    var charges = Number(first.charges)||0;
    evs.slice(1).forEach(function(e){
      if(e.type==='buy'){
        invested += Number(e.cost)||0;
        adjusted += Number(e.cost)||0;
        principal += Number(e.principal)||0;
        charges += Number(e.charges)||0;
        current += Number(e.cost)||0;
        if(e.quantity!=null){ divisible=true; qty=(qty||0)+(Number(e.quantity)||0); }
      } else if(e.type==='sell'){
        var beforeQty = Number(e.beforeQty)||0;
        var q = e.quantity!=null ? Number(e.quantity) : beforeQty;
        var prop = (e.quantity!=null && beforeQty>0) ? Math.min(1, q/beforeQty) : 1;
        invested -= invested * prop;
        principal -= principal * prop;
        charges -= charges * prop;
        if(adjusted<0) adjusted=0;
        adjusted -= Number(e.netProceeds)||0;
        if(adjusted<0 && adjusted>-0.000001) adjusted=0;
        current = Math.max(0, current * (1-prop));
        if(divisible) qty = Math.max(0, (qty||0)-q);
      } else if(e.type==='mark'){
        current = Number(e.currentValue)||0;
      }
    });
    inv.invested = Math.max(0, invested);
    inv.adjustedCost = Math.max(0, adjusted);
    inv.currentValue = Math.max(0, current);
    inv.principalAmount = Math.max(0, principal);
    inv.buyCharges = Math.max(0, charges);
    inv.divisible = divisible;
    inv.quantity = divisible ? Math.max(0, qty||0) : null;
    inv.unitLabel = divisible ? (first.unitLabel||inv.unitLabel||'units') : null;
  }
  function doBuyInvestment(o){
    var invested = (o.principal||0) + (o.charges||0);
    var divisible = !!(o.quantity && o.quantity>0);
    var unit = o.unitLabel || (divisible?'units':null);
    var existing = state.investments.find(function(i){
      return i.category===o.category && i.name.trim().toLowerCase()===o.name.trim().toLowerCase() &&
        !!i.divisible===divisible && (!divisible || (i.unitLabel||'units')===(unit||'units'));
    });
    var inv;
    if(existing){
      inv=existing; ensureInvestmentEvents(inv);
      state.investmentEvents.push({id:uid(), type:'buy', investmentId:inv.id, name:inv.name, category:inv.category,
        principal:o.principal||0, charges:o.charges||0, cost:invested, quantity:divisible?o.quantity:null,
        unitLabel:unit, date:o.date, created:Date.now()});
      inv.currentValue=(inv.currentValue||0)+invested;
      inv.invested=(inv.invested||0)+invested;
      inv.adjustedCost=(inv.adjustedCost!=null?inv.adjustedCost:inv.invested-invested)+invested;
      if(divisible) inv.quantity=(inv.quantity||0)+o.quantity;
      inv.principalAmount=(inv.principalAmount||0)+(o.principal||0);
      inv.buyCharges=(inv.buyCharges||0)+(o.charges||0);
    } else {
      inv = {id:uid(), name:o.name, category:o.category, invested:invested, adjustedCost:invested,
        principalAmount:o.principal, buyCharges:o.charges||0, currentValue:invested, date:o.date,
        purchaseAccountId:o.accountId, attachment:o.attachment||null, divisible:divisible,
        quantity:divisible?o.quantity:null, unitLabel:divisible?unit:'units'};
      state.investments.push(inv);
      state.investmentEvents = state.investmentEvents || [];
      state.investmentEvents.push({id:uid(), type:'opening', investmentId:inv.id, name:inv.name, category:inv.category,
        principal:o.principal||0, charges:o.charges||0, cost:invested, quantity:divisible?o.quantity:null,
        unitLabel:unit, currentValue:invested, adjustedCost:invested, date:o.date, created:Date.now()});
    }
    addTransaction({accountId:o.accountId, type:'expense', amount:invested, category:'Investment purchase',
      note:'Bought '+o.name+(divisible?' ('+o.quantity+' '+unit+')':'')+(o.charges?' (incl. charges '+fmt(o.charges)+')':''), date:o.date,
      meta:{linkedType:'investment', linkedId:inv.id, linkedAction:'buy', investmentEventId:state.investmentEvents[state.investmentEvents.length-1].id,
        recurringId:o.recurringId||null}});
    return inv;
  }
  function doSellInvestment(inv, o){
    ensureInvestmentEvents(inv);
    var net = (o.salePrice||0) - (o.charges||0);
    var isDivisible = inv.divisible && inv.quantity!=null && inv.quantity>0;
    var q = isDivisible ? Math.min(Number(o.quantity)||0, inv.quantity) : null;
    var beforeQty = isDivisible ? inv.quantity : null;
    var proportion = isDivisible ? (q/beforeQty) : 1;
    var adjustedBefore = inv.adjustedCost!=null ? inv.adjustedCost : inv.invested;
    var costBasis = adjustedBefore * proportion;
    var profit = net - costBasis;
    var saleId = uid();
    var event = {id:saleId, type:'sell', investmentId:inv.id, name:inv.name, category:inv.category,
      quantity:q, beforeQty:beforeQty, costBasis:costBasis, salePrice:o.salePrice||0, charges:o.charges||0,
      netProceeds:net, profit:profit, date:o.date, created:Date.now()};
    state.investmentEvents.push(event);
    addTransaction({accountId:o.accountId, type:'income', amount:net, category:'Investment sale',
      note:(isDivisible?'Sold part of ':'Sold ')+inv.name+(isDivisible?' ('+q+' '+(inv.unitLabel||'units')+')':'')+
        ' ('+(profit>=0?'profit ':'loss ')+fmt(Math.abs(profit))+(o.charges?', charges '+fmt(o.charges):'')+')', date:o.date,
      meta:{linkedType:'investment', linkedId:inv.id, linkedAction:'sell', saleId:saleId, investmentEventId:saleId}});
    var soldRecord = {id:saleId, investmentId:inv.id, name:inv.name, category:inv.category,
      invested:costBasis, adjustedCostAfter:Math.max(0, adjustedBefore-net), salePrice:o.salePrice||0,
      sellCharges:o.charges||0, netProceeds:net, profit:profit, soldDate:o.date, saleAccountId:o.accountId,
      partial:isDivisible && q<beforeQty, quantitySold:q, unitLabel:inv.unitLabel||'units',
      beforeQty:beforeQty, beforeInvested:inv.invested, beforeAdjustedCost:adjustedBefore,
      beforePrincipalAmount:inv.principalAmount, beforeBuyCharges:inv.buyCharges, beforeCurrentValue:inv.currentValue,
      attachment:o.attachment||null};
    state.soldInvestments.push(soldRecord);
    rebuildInvestment(inv.id);
  }

  function doLendOrBorrow(kind, person, amount, accountId, date, note){
    var debt = {id:uid(), type:kind, person:person, amount:amount, note:note, date:date, accountId:accountId};
    state.debts.push(debt);
    addTransaction({
      accountId:accountId, type: kind==='debtor'?'expense':'income', amount:amount,
      category: kind==='debtor' ? 'Lent to '+person : 'Borrowed from '+person, note:note, date:date,
      meta:{linkedType:'debt', linkedId:debt.id, linkedAction: kind==='debtor'?'lend':'borrow'}
    });
    return debt;
  }
  function doSettleDebt(debt, accountId, date){
    var isDebtor = debt.type==='debtor';
    addTransaction({
      accountId:accountId, type: isDebtor?'income':'expense', amount:debt.amount,
      category: isDebtor ? 'Repayment from '+debt.person : 'Repayment to '+debt.person, note:'', date:date,
      meta:{linkedType:'debt', linkedId:debt.id, linkedAction:'settle'}
    });
    state.debts = state.debts.filter(function(d){return d.id!==debt.id;});
  }
  function doTakeLoanCredit(loan, accountId, date){
    addTransaction({
      accountId:accountId, type:'income', amount:loan.principal, category:'Loan received', note:loan.name, date:date,
      meta:{linkedType:'loan', linkedId:loan.id, linkedAction:'take'}
    });
  }
  function estimateEmiInterest(loan, amount){
    var monthlyRate = (Number(loan.interestRate)||0)/12/100;
    var interest = Math.round((loan.outstanding||0) * monthlyRate * 100)/100;
    if(interest < 0) interest = 0;
    if(interest > amount) interest = amount;
    return interest;
  }
  function doPayEmi(loan, amount, interest, accountId, date){
    interest = Math.max(0, Math.min(Number(interest)||0, amount));
    var principal = amount - interest;
    addTransaction({
      accountId:accountId, type:'expense', amount:amount, category:'EMI payment', note:loan.name, date:date,
      meta:{linkedType:'loan', linkedId:loan.id, linkedAction:'emi', interest:interest, principal:principal}
    });
    loan.outstanding = Math.max(0, (loan.outstanding||0) - principal);
  }
  function loanEmiTxns(loanId){
    return state.transactions.filter(function(t){
      return t.meta && t.meta.linkedType==='loan' && t.meta.linkedId===loanId && t.meta.linkedAction==='emi';
    }).sort(function(a,b){ return b.date.localeCompare(a.date) || b.created-a.created; });
  }
  function doApplyRecurring(rec){
    if(rec.type==='investment'){
      doBuyInvestment({
        name: rec.investmentName || rec.name,
        category: rec.investmentCategory || 'sip',
        principal: rec.amount,
        charges: rec.investmentCharges || 0,
        accountId: rec.accountId,
        date: rec.nextDue,
        quantity: rec.quantity || null,
        unitLabel: rec.unitLabel || null,
        recurringId: rec.id
      });
    } else {
      doGeneralTx(rec.type==='income'?'in':'out', rec.accountId, rec.amount, rec.category||rec.name, rec.name, rec.nextDue);
    }
    rec.nextDue = advanceDate(rec.nextDue, rec.frequency);
  }

  /* ---------------- Multi-page navigation ---------------- */
  var fileName = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
  var FILE_TO_TAB = {
    'dashboard.html':'dashboard', 'index.html':'dashboard', '':'dashboard',
    'accounts.html':'accounts', 'account-detail.html':'account-detail',
    'debts.html':'debts', 'investments.html':'invest', 'investment-ledger.html':'investLedger',
    'loans.html':'loans', 'more.html':'more', 'recurring.html':'recurring',
    'tips.html':'tips', 'settings.html':'settings'
  };
  var currentTab = FILE_TO_TAB[fileName] || 'dashboard';
  var openAccountId = new URLSearchParams(location.search).get('id');

  var THEME_MAP = {invest:'theme-green', investLedger:'theme-green', loans:'theme-red', debts:'theme-red'};
  (function applyPageTheme(){
    var appEl = document.getElementById('app');
    var cls = THEME_MAP[currentTab];
    if(appEl && cls) appEl.classList.add(cls);
  })();

  var pageMap = {
    dashboard: 'dashboard.html',
    accounts: 'accounts.html',
    'account-detail': 'account-detail.html',
    debts: 'debts.html',
    invest: 'investments.html',
    investLedger: 'investment-ledger.html',
    loans: 'loans.html',
    more: 'more.html',
    recurring: 'recurring.html',
    tips: 'tips.html',
    settings: 'settings.html'
  };

  function goTo(name, extraQuery){
    var target = pageMap[name] || pageMap.dashboard;
    if (extraQuery) target += extraQuery;
    location.href = target;
  }

  function showSection(id){
    /* Each section now lives in its own HTML file. */
    var el = document.getElementById('sec-' + id);
    if (el) el.classList.add('active');
  }

  function updateFab(){
    var fab = document.getElementById('fabAdd');
    if (!fab) return;
    var showable = ['dashboard','accounts','account-detail','invest','loans','debts','recurring'];
    fab.classList.toggle('hidden', showable.indexOf(currentTab) === -1);
  }

  /* ---------------- Header render ---------------- */
  function renderHeader(){
    document.getElementById('dateLine').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long', day:'numeric', month:'long'});
    var titles = {dashboard:"Personal Finance", accounts:"Accounts", invest:"Portfolio", investLedger:"Investment Ledger", loans:"Loans & cards", more:"More", debts:"People", recurring:"Recurring", tips:"Finance tips", settings:"Settings", "account-detail":"Account"};
    document.getElementById('greetTitle').textContent = titles[currentTab] || "Personal Finance";
    document.getElementById('netWorthVal').textContent = fmt(netWorth());
    document.getElementById('sumCash').textContent = fmtRound(totalCash());
    document.getElementById('sumInv').textContent = fmtRound(totalInvestValue());
    document.getElementById('sumLiab').textContent = fmtRound(totalLiabilities());
  }

  function emptyHTML(glyph,title,sub){
    return '<div class="empty"><span class="glyph">'+glyph+'</span><strong style="color:var(--ink)">'+title+'</strong><br>'+sub+'</div>';
  }
  function rowHTML(opts){
    return '<div class="ledger-row" '+(opts.attrs||'')+'>'+
      '<div class="name">'+esc(opts.name)+(opts.sub?'<span class="sub">'+opts.sub+'</span>':'')+'</div>'+
      '<div class="dots"></div>'+
      '<div class="amt '+opts.cls+'">'+(opts.sign||'')+opts.amount+(opts.badge?opts.badge:'')+'</div>'+
      '</div>';
  }

  /* ---------------- Dashboard ---------------- */
  function upcomingItems(){
    var items = [];
    state.recurring.forEach(function(r){
      if(r.active===false) return;
      var days = daysBetween(todayISO(), r.nextDue);
      if(days <= 14){
        items.push({kind:'recurring', ref:r, date:r.nextDue, days:days, name:r.name, amount:r.amount, type:r.type});
      }
    });
    state.loans.forEach(function(l){
      if(!l.dueDay || l.outstanding<=0) return;
      var nd = nextEmiDate(l);
      if(!nd) return;
      var days = daysBetween(todayISO(), nd);
      if(days <= 14){
        items.push({kind:'emi', ref:l, date:nd, days:days, name:l.name, amount:l.emiAmount, type:'expense'});
      }
    });
    items.sort(function(a,b){ return a.days-b.days; });
    return items;
  }
  function renderUpcoming(){
    var items = upcomingItems();
    var wrap = document.getElementById('upcomingWrap');
    if(items.length===0){ wrap.innerHTML=''; return; }
    wrap.innerHTML = '<div class="upcoming-card"><div class="uc-head">Upcoming (next 14 days)</div>' +
      items.map(function(it, idx){
        var label = it.days<0 ? Math.abs(it.days)+'d overdue' : (it.days===0?'Due today':'in '+it.days+'d');
        var actionLabel = it.kind==='emi' ? 'Pay' : 'Add';
        return '<div class="upcoming-row">'+
          '<div class="info"><div class="t">'+esc(it.name)+'</div><div class="s">'+label+' · '+niceDate(it.date)+'</div></div>'+
          '<div class="amt '+(it.type==='income'?'credit':'debit')+'">'+fmt(it.amount)+'</div>'+
          '<button data-upact="'+idx+'">'+actionLabel+'</button>'+
        '</div>';
      }).join('') + '</div>';
    wrap.querySelectorAll('[data-upact]').forEach(function(btn){
      btn.onclick = function(){
        var it = items[parseInt(btn.dataset.upact)];
        if(it.kind==='recurring'){ doApplyRecurring(it.ref); save(); renderAll(); }
        else { sheetPayEmi(it.ref); }
      };
    });
  }
  function renderOverview(){
    var el = document.getElementById('overviewGrid');
    el.innerHTML =
      '<div class="stat-card"><div class="k">Loans outstanding</div><div class="v" style="color:var(--debit)">'+fmt(totalLoansOutstanding())+'</div><div class="sub">'+state.loans.length+' loan'+(state.loans.length===1?'':'s')+'/card'+(state.loans.length===1?'':'s')+'</div></div>'+
      '<div class="stat-card"><div class="k">Investments</div><div class="v" style="color:var(--credit)">'+fmt(totalInvestValue())+'</div><div class="sub">'+state.investments.length+' holding'+(state.investments.length===1?'':'s')+'</div></div>'+
      '<div class="stat-card" data-people="creditor" style="cursor:pointer"><div class="k">You owe</div><div class="v" style="color:var(--debit)">'+fmt(totalYouOwe())+'</div><div class="sub">'+state.debts.filter(function(d){return d.type==='creditor';}).length+' people · tap to view</div></div>'+
      '<div class="stat-card" data-people="debtor" style="cursor:pointer"><div class="k">Owed to you</div><div class="v" style="color:var(--credit)">'+fmt(totalOwedToYou())+'</div><div class="sub">'+state.debts.filter(function(d){return d.type==='debtor';}).length+' people · tap to view</div></div>';
    el.querySelectorAll('[data-people]').forEach(function(card){
      card.onclick = function(){ sheetPeopleList(card.dataset.people); };
    });
  }
  function sheetPeopleList(type){
    var list = state.debts.filter(function(d){return d.type===type;}).sort(function(a,b){return b.date.localeCompare(a.date);});
    var title = type==='debtor' ? 'Owed to you' : 'You owe';
    var cls = type==='debtor' ? 'credit' : 'debit';
    var rows = list.length===0
      ? emptyHTML(type==='debtor'?'⇦':'⇨', type==='debtor'?'No one owes you right now':"You don't owe anyone right now", 'Add an entry from the People page.')
      : list.map(function(d){
          return rowHTML({name:d.person, sub:(d.note?esc(d.note)+' · ':'')+niceDate(d.date), amount:fmt(d.amount), cls:cls, attrs:'data-debt="'+d.id+'"'});
        }).join('');
    openSheet('<h3 style="color:var(--'+cls+')">'+title+'</h3><div>'+rows+'</div><button class="btn secondary" id="peopleViewAll" style="margin-top:10px">View all in People</button>');
    bindRowClicks();
    document.getElementById('peopleViewAll').onclick = function(){ closeSheet(); setDebtFilter(type); goTo('debts'); };
  }
  function renderDashboard(){
    renderUpcoming();
    renderOverview();
    var list = state.transactions.slice().sort(function(a,b){ return b.date.localeCompare(a.date) || b.created - a.created; }).slice(0,12);
    document.getElementById('txCount').textContent = state.transactions.length + " entries";
    var el = document.getElementById('recentList');
    if(list.length===0){
      el.innerHTML = emptyHTML("✎","No transactions yet","Tap + to add money in, money out, or something you're tracking.");
    } else {
      el.innerHTML = list.map(function(t){
        var acc = state.accounts.find(function(a){return a.id===t.accountId;});
        var accName = acc? acc.name : "—";
        return rowHTML({
          name: t.note || t.category || (t.type==='income'?'Income':'Expense'),
          sub: esc(accName) + " · " + niceDate(t.date),
          amount: fmt(t.amount),
          cls: t.type==='income' ? 'credit' : 'debit',
          sign: t.type==='income' ? '+' : '−',
          attrs: 'data-tx="'+t.id+'"'
        });
      }).join('');
    }
    bindRowClicks();
  }

  /* ---------------- Accounts ---------------- */
  function renderAccounts(){
    document.getElementById('acctCount').textContent = state.accounts.length + " account" + (state.accounts.length===1?"":"s");
    var el = document.getElementById('accountList');
    if(state.accounts.length===0){
      el.innerHTML = emptyHTML("▤","No accounts yet","Add a cash or bank account with the + button to start tracking.");
      return;
    }
    el.innerHTML = state.accounts.map(function(a){
      var bal = accountBalance(a);
      return rowHTML({
        name: a.name, sub: (a.kind||'cash').toUpperCase(), amount: fmt(Math.abs(bal)),
        cls: bal<0 ? 'debit':'neutral', sign: bal<0 ? '−':'', attrs: 'data-account="'+a.id+'"'
      });
    }).join('');
    bindRowClicks();
  }
  function openAccountDetail(id){
    openAccountId = id;
    var acc = state.accounts.find(function(a){return a.id===id;});
    if(!acc) return;

    var nameEl = document.getElementById('acctDetailName');
    var balEl = document.getElementById('acctDetailBal');
    var txEl = document.getElementById('acctDetailTx');
    if(!nameEl || !balEl || !txEl) return;

    nameEl.textContent = acc.name;
    balEl.textContent = fmt(accountBalance(acc));

    var txs = state.transactions.filter(function(t){return t.accountId===id;})
      .sort(function(a,b){ return b.date.localeCompare(a.date) || b.created-a.created; });

    if(txs.length===0){
      txEl.innerHTML = emptyHTML("✎","No entries for this account","Add money in or out to see it here.");
    } else {
      txEl.innerHTML = txs.map(function(t){
        return rowHTML({
          name: t.note || t.category || (t.type==='income'?'Income':'Expense'),
          sub: (t.category?esc(t.category)+" · ":"") + niceDate(t.date),
          amount: fmt(t.amount), cls: t.type==='income'?'credit':'debit', sign: t.type==='income'?'+':'−',
          attrs: 'data-tx="'+t.id+'"'
        });
      }).join('');
    }
    bindRowClicks();
  }

  /* ---------------- Debts ---------------- */
  var debtFilter = 'debtor';
  var pillDebtorEl = document.getElementById('pillDebtor'); if(pillDebtorEl) pillDebtorEl.addEventListener('click', function(){ setDebtFilter('debtor'); });
  var pillCreditorEl = document.getElementById('pillCreditor'); if(pillCreditorEl) pillCreditorEl.addEventListener('click', function(){ setDebtFilter('creditor'); });
  function setDebtFilter(f){
    debtFilter = f;
    document.getElementById('pillDebtor').classList.toggle('active', f==='debtor');
    document.getElementById('pillCreditor').classList.toggle('active', f==='creditor');
    renderDebts();
  }
  function renderDebts(){
    var list = state.debts.filter(function(d){return d.type===debtFilter;}).sort(function(a,b){ return b.date.localeCompare(a.date); });
    var el = document.getElementById('debtList');
    if(list.length===0){
      el.innerHTML = emptyHTML(debtFilter==='debtor'?'⇦':'⇨',
        debtFilter==='debtor' ? "No one owes you right now" : "You don't owe anyone right now",
        "Tap + to record money "+(debtFilter==='debtor'?"you lent out.":"someone lent you."));
      return;
    }
    el.innerHTML = list.map(function(d){
      return rowHTML({
        name: d.person, sub: (d.note?esc(d.note)+" · ":"") + niceDate(d.date), amount: fmt(d.amount),
        cls: d.type==='debtor'?'credit':'debit', attrs: 'data-debt="'+d.id+'"'
      });
    }).join('');
    bindRowClicks();
  }

  /* ---------------- Investments ---------------- */
  var invFilter = 'all';
  document.querySelectorAll('[data-invfilter]').forEach(function(p){
    p.addEventListener('click', function(){
      invFilter = p.dataset.invfilter;
      document.querySelectorAll('[data-invfilter]').forEach(function(x){ x.classList.toggle('active', x===p); });
      renderInvest();
    });
  });
  function investRowHTML(inv, sold){
    if(sold){
      var cls = inv.profit>=0 ? 'credit':'debit';
      var soldLabel = 'SOLD' + (inv.partial ? ' PART' : '') + ' ' + niceDate(inv.soldDate) +
        ' · basis ' + fmt(inv.invested);
      if(inv.partial && inv.quantitySold) soldLabel += ' · ' + inv.quantitySold + ' ' + (inv.unitLabel||'units');
      return rowHTML({name:inv.name, sub:soldLabel, amount:fmt(inv.salePrice), cls:cls,
        badge:'<span class="badge" style="color:'+(inv.profit>=0?'var(--credit)':'var(--debit)')+';background:transparent;padding-left:0">'+
          (inv.profit>=0?'+':'−')+fmt(Math.abs(inv.profit))+'</span>', attrs:'data-sold="'+inv.id+'"'});
    }
    var adjusted = inv.adjustedCost!=null ? inv.adjustedCost : inv.invested;
    var gain = (inv.currentValue||0) - adjusted;
    var pct = adjusted ? (gain/adjusted*100) : 0;
    var gcls = gain>=0 ? 'credit' : 'debit';
    var sign = gain>=0 ? '+':'−';
    var qtyBit = (inv.divisible && inv.quantity!=null) ? (' · '+inv.quantity+' '+(inv.unitLabel||'units')) : '';
    return rowHTML({name:inv.name + (inv.attachment?' 📎':''),
      sub:inv.category.toUpperCase()+qtyBit+' · invested '+fmt(inv.invested)+' · adjusted cost '+fmt(adjusted),
      amount:fmt(inv.currentValue)+' <span style="font-size:11px;font-weight:500">('+sign+Math.abs(pct).toFixed(1)+'%)</span>',
      cls:gcls, attrs:'data-invest="'+inv.id+'"'});
  }
  function renderInvest(){
    var invested=totalInvested(), current=totalInvestValue();
    var adjustedTotal=state.investments.reduce(function(s,i){return s+(i.adjustedCost!=null?i.adjustedCost:(i.invested||0));},0);
    var gain=current-adjustedTotal, pct=adjustedTotal?(gain/adjustedTotal*100):0;
    document.getElementById('invGainLine').innerHTML=state.investments.length
      ? 'Adjusted cost '+fmt(adjustedTotal)+' · '+(gain>=0?'+':'−')+fmt(Math.abs(gain))+' ('+(gain>=0?'+':'−')+Math.abs(pct).toFixed(1)+'%)'
      : '';
    var el=document.getElementById('investList');
    if(invFilter==='sold'){
      var sl=state.soldInvestments.slice().sort(function(a,b){return b.soldDate.localeCompare(a.soldDate);});
      el.innerHTML=sl.length===0?emptyHTML('◇','No sold investments yet','Sales show up here with realised profit or loss.'):sl.map(function(i){return investRowHTML(i,true);}).join('');
      bindRowClicks(); return;
    }
    var list=state.investments.filter(function(i){return invFilter==='all'||i.category===invFilter;}).sort(function(a,b){return b.date.localeCompare(a.date);});
    if(list.length===0){el.innerHTML=emptyHTML('◇','No investments in this view','Buying an asset moves money out of an account into it.');return;}
    el.innerHTML=list.map(function(i){return investRowHTML(i,false);}).join('');
    bindRowClicks();
  }

  /* ---------------- Loans ---------------- */
  function renderLoans(){
    document.getElementById('loanSummary').textContent = state.loans.length ? fmt(totalLoansOutstanding()) + ' outstanding' : '';
    var el = document.getElementById('loanList');
    if(state.loans.length===0){
      el.innerHTML = emptyHTML('⚖','No loans or cards yet','Track a loan or credit card and record EMI payments here.');
      return;
    }
    var list = state.loans.slice().sort(function(a,b){return (a.outstanding<=0)-(b.outstanding<=0);});
    el.innerHTML = list.map(function(l){
      return rowHTML({
        name: l.name,
        sub: (l.kind==='credit_card'?'CREDIT CARD':'LOAN') + ' · EMI ' + fmt(l.emiAmount) + (l.dueDay? ' · due '+l.dueDay+getOrdinal(l.dueDay):'') + (l.date? ' · since '+niceDate(l.date):''),
        amount: fmt(l.outstanding), cls: l.outstanding>0 ? 'debit':'neutral', attrs: 'data-loan="'+l.id+'"'
      });
    }).join('');
    bindRowClicks();
  }
  function getOrdinal(n){ var s=["th","st","nd","rd"], v=n%100; return s[(v-20)%10]||s[v]||s[0]; }


  /* ---------------- Investment Ledger ---------------- */
  function renderInvestmentLedger(){
    var el = document.getElementById('investmentLedgerList');
    if(!el) return;

    var rows = [];
    state.investments.forEach(function(inv){
      rows.push({
        date: inv.date || '',
        name: inv.name,
        action: 'BUY',
        qty: inv.quantity != null ? inv.quantity : null,
        unit: inv.unitLabel || '',
        amount: inv.invested || 0,
        profit: 0,
        cost: inv.adjustedCost != null ? inv.adjustedCost : (inv.invested || 0),
        ref: inv.id
      });
    });

    state.soldInvestments.forEach(function(s){
      rows.push({
        date: s.soldDate || '',
        name: s.name,
        action: 'SELL',
        qty: s.quantitySold != null ? s.quantitySold : null,
        unit: s.unitLabel || '',
        amount: s.netProceeds || 0,
        profit: s.profit || 0,
        cost: Math.max(0, (s.adjustedCostAfterSale != null ? s.adjustedCostAfterSale : 0)),
        ref: s.id
      });
    });

    state.transactions.forEach(function(t){
      if(!(t.meta && t.meta.linkedType==='investment')) return;
      if(t.meta.linkedAction!=='buy' && t.meta.linkedAction!=='sell') return;
      // Avoid duplicating entries already represented above.
    });

    rows.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });

    if(rows.length===0){
      el.innerHTML = emptyHTML('▥','No investment entries yet','Your investment purchases and sales will appear here.');
      return;
    }

    el.innerHTML =
      '<div class="card investment-ledger-card">'+
        '<div class="ledger-table-wrap">'+
          '<table class="investment-ledger-table">'+
            '<thead><tr>'+
              '<th>Date</th><th>Investment</th><th>Action</th><th>Qty</th>'+
              '<th>Value</th><th>Profit / Loss</th><th>Adjusted Cost</th>'+
            '</tr></thead>'+
            '<tbody>'+
              rows.map(function(r){
                var q = r.qty != null ? Number(r.qty).toFixed(2)+' '+esc(r.unit) : '—';
                var pl = r.action==='SELL' ? ((r.profit>=0?'+':'−')+fmt(Math.abs(r.profit))) : '—';
                return '<tr>'+
                  '<td>'+niceDate(r.date)+'</td>'+
                  '<td>'+esc(r.name)+'</td>'+
                  '<td><span class="ledger-action '+(r.action==='BUY'?'buy':'sell')+'">'+r.action+'</span></td>'+
                  '<td>'+q+'</td>'+
                  '<td>'+fmt(r.amount)+'</td>'+
                  '<td class="'+(r.profit>=0?'credit':'debit')+'">'+pl+'</td>'+
                  '<td>'+fmt(r.cost)+'</td>'+
                '</tr>';
              }).join('')+
            '</tbody>'+
          '</table>'+
        '</div>'+
      '</div>';
  }

  /* ---------------- Recurring ---------------- */
  function renderRecurring(){
    var el = document.getElementById('recurringList');
    if(state.recurring.length===0){
      el.innerHTML = emptyHTML('↻','Nothing recurring yet','Add a salary, rent, subscription or any repeating entry.');
      return;
    }
    var list = state.recurring.slice().sort(function(a,b){return a.nextDue.localeCompare(b.nextDue);});
    el.innerHTML = list.map(function(r){
      return rowHTML({
        name: r.name + (r.active===false?' (paused)':''),
        sub: r.frequency.toUpperCase() + ' · next ' + niceDate(r.nextDue),
        amount: fmt(r.amount), cls: r.type==='income'?'credit':(r.type==='investment'?'neutral':'debit'), sign: r.type==='income'?'+':'−',
        attrs: 'data-rec="'+r.id+'"'
      });
    }).join('');
    bindRowClicks();
  }

  /* ---------------- Tips ---------------- */
  var TIPS = [
    {t:"Build your emergency fund first", d:"Aim to keep 3–6 months of essential expenses in cash or a savings account before investing aggressively. It keeps a bad month from becoming a bad year."},
    {t:"Track every rupee for a month", d:"You can't manage what you don't measure. A month of honest expense logging usually reveals at least one surprise."},
    {t:"Clear high-interest debt first", d:"Credit card and personal loan interest usually outpaces what most investments return. Paying these down is often the best guaranteed return available."},
    {t:"Automate before you can spend it", d:"Move savings and investment contributions out on payday, not whatever's left at month end. Treat saving like a fixed bill."},
    {t:"Separate current and fixed assets", d:"Keep some wealth liquid and easy to access, and let the rest grow untouched. Relying on one or the other tends to backfire."},
    {t:"Review EMIs when you have surplus cash", d:"Prepaying a high-interest loan, even partially, can save more than most short-term investments would earn in the same period."},
    {t:"Watch the charges, not just the price", d:"Brokerage, exit loads and transaction fees quietly eat into returns. Factor them in before deciding if a trade was worth it."},
    {t:"Pause before non-essential purchases", d:"A short wait — even overnight — filters out most impulse spending without feeling restrictive."},
    {t:"Check net worth monthly, not daily", d:"Asset values move day to day; what matters is the trend over months. Daily checking mostly adds stress, not insight."},
    {t:"Keep some cash easily reachable", d:"One to two months of expenses in an easily accessible account avoids having to sell investments at a bad time."},
    {t:"Give big goals a date and a number", d:"“Save for a car” drifts. “₹3,00,000 by next March” gets a monthly target you can actually track."}
  ];
  renderInvestmentLedger();

  function renderTips(){
    document.getElementById('tipsList').innerHTML = TIPS.map(function(x){
      return '<div class="card"><h4>'+esc(x.t)+'</h4><p>'+esc(x.d)+'</p></div>';
    }).join('');
  }

  /* ---------------- Row click binding ---------------- */
  function bindRowClicks(){
    document.querySelectorAll('[data-account]').forEach(function(r){ r.onclick = function(){ location.href='account-detail.html?id='+encodeURIComponent(r.dataset.account); }; });
    document.querySelectorAll('[data-tx]').forEach(function(r){ r.onclick = function(){ openEditTx(r.dataset.tx); }; });
    document.querySelectorAll('[data-debt]').forEach(function(r){ r.onclick = function(){ openEditDebt(r.dataset.debt); }; });
    document.querySelectorAll('[data-invest]').forEach(function(r){ r.onclick = function(){ openEditInvest(r.dataset.invest); }; });
    document.querySelectorAll('[data-sold]').forEach(function(r){ r.onclick = function(){ openSoldDetail(r.dataset.sold); }; });
    document.querySelectorAll('[data-loan]').forEach(function(r){ r.onclick = function(){ openEditLoan(r.dataset.loan); }; });
    document.querySelectorAll('[data-rec]').forEach(function(r){ r.onclick = function(){ openEditRecurring(r.dataset.rec); }; });
  }

  function renderAll(){
    renderHeader();
    if(currentTab==='dashboard') renderDashboard();
    else if(currentTab==='accounts') renderAccounts();
    else if(currentTab==='account-detail' && openAccountId) openAccountDetail(openAccountId);
    else if(currentTab==='debts') renderDebts();
    else if(currentTab==='invest') renderInvest();
    else if(currentTab==='investLedger') renderInvestmentLedger();
    else if(currentTab==='loans') renderLoans();
    else if(currentTab==='recurring') renderRecurring();
    else if(currentTab==='tips') renderTips();
  }

  /* ================= SHEETS / FORMS ================= */
  var overlay = document.getElementById('overlay');
  var sheet = document.getElementById('sheet');
  var pendingAttachment = null;
  function openSheet(html){
    sheet.innerHTML = '<div class="sheet-handle"></div>' + html;
    overlay.classList.add('show');
  }
  function closeSheet(){ overlay.classList.remove('show'); sheet.innerHTML=''; pendingAttachment=null; }
  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeSheet(); });

  function accountOptions(selectedId){
    return state.accounts.map(function(a){
      return '<option value="'+a.id+'" '+(a.id===selectedId?'selected':'')+'>'+esc(a.name)+' ('+fmt(accountBalance(a))+')</option>';
    }).join('');
  }
  function needAccountFirst(){
    if(state.accounts.length>0) return false;
    openSheet('<h3>Add an account first</h3><div class="empty">You need at least one account to move money in or out.</div><button class="btn" id="goAcc">Add account</button>');
    document.getElementById('goAcc').onclick = function(){ closeSheet(); sheetNewAccount(); };
    return true;
  }
  function bindSeg(containerId, onChange){
    var wrap = document.getElementById(containerId);
    wrap.querySelectorAll('button').forEach(function(b){
      b.onclick = function(){
        wrap.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});
        b.classList.add('on');
        if(onChange) onChange(b.dataset.v);
      };
    });
  }
  function shake(id){
    var el = document.getElementById(id);
    el.style.outline='2px solid var(--debit)';
    el.focus();
    setTimeout(function(){ el.style.outline=''; }, 900);
  }

  /* ---- Add Account ---- */
  function sheetNewAccount(){
    openSheet(
      '<h3>New account</h3>'+
      '<div class="field"><label>Account name</label><input id="fAccName" placeholder="e.g. Wallet, HDFC Bank"></div>'+
      '<div class="field"><label>Type</label><div class="seg" id="fAccKind">'+
        '<button type="button" class="on" data-v="cash">Cash</button><button type="button" data-v="bank">Bank</button>'+
      '</div></div>'+
      '<div class="field"><label>Opening balance</label><input id="fAccOpen" type="number" inputmode="decimal" placeholder="0"></div>'+
      '<button class="btn" id="fAccSave">Save account</button>'
    );
    bindSeg('fAccKind');
    document.getElementById('fAccSave').onclick = function(){
      var name = document.getElementById('fAccName').value.trim();
      if(!name){ shake('fAccName'); return; }
      var kind = document.querySelector('#fAccKind .on').dataset.v;
      var open = parseFloat(document.getElementById('fAccOpen').value)||0;
      state.accounts.push({id:uid(), name:name, kind:kind, opening:open});
      save(); closeSheet(); goTo('accounts');
    };
  }

  /* ---- Edit / delete an EXISTING transaction (works for every entry, linked or not) ---- */
  function sheetTx(existing){
    var accOptions = accountOptions(existing.accountId);
    var linked = existing.meta && existing.meta.linkedType;
    openSheet(
      '<h3>Edit entry</h3>'+
      (linked ? '<div class="field hint" style="margin-top:-6px">Linked to a '+esc(linked)+' record — editing here only changes this transaction.</div>' : '')+
      '<div class="field"><label>Type</label><div class="seg" id="fTxType">'+
        '<button type="button" class="'+(existing.type==='expense'?'on':'')+'" data-v="expense">Money out</button>'+
        '<button type="button" class="'+(existing.type==='income'?'on':'')+'" data-v="income">Money in</button>'+
      '</div></div>'+
      '<div class="field"><label>Account</label><select id="fTxAcc">'+accOptions+'</select></div>'+
      '<div class="field"><label>Amount</label><input id="fTxAmt" type="number" inputmode="decimal" value="'+existing.amount+'"></div>'+
      '<div class="field"><label>Category</label><input id="fTxCat" value="'+esc(existing.category||'')+'"></div>'+
      '<div class="field"><label>Note</label><input id="fTxNote" value="'+esc(existing.note||'')+'"></div>'+
      '<div class="field"><label>Date</label><input id="fTxDate" type="date" value="'+existing.date+'"></div>'+
      '<button class="btn" id="fTxSave">Save</button>'+
      '<div class="row-actions"><button class="btn danger" id="fTxDel">Delete entry</button></div>'
    );
    bindSeg('fTxType');
    document.getElementById('fTxSave').onclick = function(){
      var amt = parseFloat(document.getElementById('fTxAmt').value);
      if(!amt || amt<=0){ shake('fTxAmt'); return; }
      Object.assign(existing, {
        accountId: document.getElementById('fTxAcc').value,
        type: document.querySelector('#fTxType .on').dataset.v,
        amount: amt,
        category: document.getElementById('fTxCat').value.trim(),
        note: document.getElementById('fTxNote').value.trim(),
        date: document.getElementById('fTxDate').value || todayISO()
      });
      save(); closeSheet(); renderAll();
    };
    document.getElementById('fTxDel').onclick = function(){
      var msg = linked ? 'This entry is linked to a '+linked+' — deleting it will NOT undo that record, only this transaction. Delete anyway?' : 'Delete this transaction?';
      if(confirm(msg)){
        state.transactions = state.transactions.filter(function(t){return t.id!==existing.id;});
        save(); closeSheet(); renderAll();
      }
    };
  }
  function openEditTx(id){
    var t = state.transactions.find(function(x){return x.id===id;});
    if(!t) return;
    if(t.meta && t.meta.linkedType==='loan' && t.meta.linkedAction==='emi'){
      var loan = state.loans.find(function(l){return l.id===t.meta.linkedId;});
      if(loan){ sheetEmiTx(t.id, loan); return; }
    }
    sheetTx(t);
  }

  /* ---- Unified quick add (dashboard / account-detail) ---- */
  function sheetQuickAdd(){
    if(needAccountFirst()) return;
    var dir = 'out', kind = 'general';
    var html =
      '<h3>Add entry</h3>'+
      '<div class="field"><label>Direction</label><div class="seg" id="fQDir">'+
        '<button type="button" class="on" data-v="out">Money out</button>'+
        '<button type="button" data-v="in">Money in</button>'+
      '</div></div>'+
      '<div class="field"><label>Account</label><select id="fQAcc">'+accountOptions(openAccountId)+'</select></div>'+
      '<div class="field"><label>Amount</label><input id="fQAmt" type="number" inputmode="decimal" placeholder="0"></div>'+
      '<div class="field"><label>Date</label><input id="fQDate" type="date" value="'+todayISO()+'"></div>'+
      '<div class="field"><label>What is this for?</label><div class="seg" id="fQKind">'+
        '<button type="button" class="on" data-v="general">General</button>'+
        '<button type="button" data-v="investment">Investment</button>'+
        '<button type="button" data-v="person">Person</button>'+
      '</div></div>'+
      '<div id="fQExtra"></div>'+
      '<button class="btn" id="fQSave">Save</button>';
    openSheet(html);
    bindSeg('fQDir', function(v){ dir=v; refreshExtra(); });
    bindSeg('fQKind', function(v){ kind=v; refreshExtra(); });
    document.getElementById('fQSave').onclick = function(){ trySave(); };
    refreshExtra();

    function refreshExtra(){
      var extra = document.getElementById('fQExtra');
      if(kind==='general'){
        extra.innerHTML =
          '<div class="field"><label>Category</label><input id="fQCat" placeholder="Food, Transport, Salary…"></div>'+
          '<div class="field"><label>Note</label><input id="fQNote" placeholder="Optional note"></div>';
      } else if(kind==='investment' && dir==='out'){
        extra.innerHTML =
          '<div class="field"><label>Asset name</label><input id="fQAssetName" placeholder="e.g. Index Fund, Gold"></div>'+
          '<div class="field"><label>Type</label>'+invTypeSegHTML('fQAssetCat','shares')+'</div>'+
          '<div class="field"><label>Quantity (optional)</label><input id="fQQty" type="number" inputmode="decimal" placeholder="e.g. 2"></div>'+
           '<div class="field"><label>Unit</label><input id="fQUnit" placeholder="grams, shares, units…"></div>'+
           '<div class="field"><label>Charges / fees (optional)</label><input id="fQCharges" type="number" inputmode="decimal" placeholder="0"><div class="hint">Amount above is the asset cost. Charges are added on top and included in your cost basis.</div></div>'+
          '<div class="field"><label>Bill / invoice (optional)</label><input type="file" id="fQFile" accept="image/*,application/pdf"><div id="fQAttachPreview"></div></div>';
        bindSeg('fQAssetCat');
        bindAttachmentInput('fQFile','fQAttachPreview', null);
      } else if(kind==='investment' && dir==='in'){
        if(state.investments.length===0){
          extra.innerHTML = '<div class="empty">No investments to sell yet.</div>';
        } else {
          extra.innerHTML =
            '<div class="field"><label>Which asset are you selling?</label><select id="fQSellWhich">'+
              state.investments.map(function(i){return '<option value="'+i.id+'">'+esc(i.name)+(i.divisible&&i.quantity!=null?' — '+i.quantity+' '+(i.unitLabel||'units')+' left':'')+' (invested '+fmt(i.invested)+')</option>';}).join('')+
            '</select></div>'+
            '<div id="fQSellQtyWrap"></div>'+
            '<div class="field hint">Amount above is treated as the gross sale price'+'.</div>'+
            '<div class="field"><label>Charges / fees (optional)</label><input id="fQCharges" type="number" inputmode="decimal" placeholder="0"></div>';
          var sellSel = document.getElementById('fQSellWhich');
          var sellQtyWrap = document.getElementById('fQSellQtyWrap');
          function renderSellQty(){
            var inv = state.investments.find(function(i){return i.id===sellSel.value;});
            if(inv && inv.divisible && inv.quantity!=null){
              sellQtyWrap.innerHTML = '<div class="field"><label>Quantity to sell (of '+inv.quantity+' '+(inv.unitLabel||'units')+')</label><input id="fQSellQty" type="number" inputmode="decimal" value="'+inv.quantity+'"></div>';
            } else { sellQtyWrap.innerHTML = ''; }
          }
          sellSel.addEventListener('change', renderSellQty);
          renderSellQty();
        }
      } else if(kind==='person' && dir==='out'){
        extra.innerHTML =
          '<div class="field"><label>What kind?</label><div class="seg" id="fQPersonSub">'+
            '<button type="button" class="on" data-v="lend">Lend (new)</button>'+
            '<button type="button" data-v="repay">Repay a debt</button>'+
          '</div></div>'+
          '<div id="fQPersonExtra"></div>';
        bindSeg('fQPersonSub', renderPersonExtra);
        renderPersonExtra('lend');
      } else if(kind==='person' && dir==='in'){
        extra.innerHTML =
          '<div class="field"><label>What kind?</label><div class="seg" id="fQPersonSub">'+
            '<button type="button" class="on" data-v="borrow">Borrow (new)</button>'+
            '<button type="button" data-v="receive">Receive repayment</button>'+
          '</div></div>'+
          '<div id="fQPersonExtra"></div>';
        bindSeg('fQPersonSub', renderPersonExtra);
        renderPersonExtra('borrow');
      }
      function renderPersonExtra(sub){
        var pe = document.getElementById('fQPersonExtra');
        if(!pe) return;
        if(sub==='lend' || sub==='borrow'){
          pe.innerHTML = '<div class="field"><label>Person</label><input id="fQPersonName" placeholder="Name"></div><div class="field"><label>Note</label><input id="fQPersonNote" placeholder="Reason (optional)"></div>';
        } else if(sub==='repay'){
          var creditors = state.debts.filter(function(d){return d.type==='creditor';});
          pe.innerHTML = creditors.length===0 ? '<div class="empty">You do not owe anyone right now.</div>' :
            '<div class="field"><label>Who are you repaying?</label><select id="fQDebtWhich">'+creditors.map(function(d){return '<option value="'+d.id+'">'+esc(d.person)+' — '+fmt(d.amount)+'</option>';}).join('')+'</select></div>'+
            '<div class="field hint">This settles the full amount owed to them.</div>';
        } else if(sub==='receive'){
          var debtors = state.debts.filter(function(d){return d.type==='debtor';});
          pe.innerHTML = debtors.length===0 ? '<div class="empty">No one owes you right now.</div>' :
            '<div class="field"><label>Who is repaying you?</label><select id="fQDebtWhich">'+debtors.map(function(d){return '<option value="'+d.id+'">'+esc(d.person)+' — '+fmt(d.amount)+'</option>';}).join('')+'</select></div>'+
            '<div class="field hint">This settles the full amount they owe you.</div>';
        }
      }
    }

    function trySave(){
      var accId = document.getElementById('fQAcc').value;
      var date = document.getElementById('fQDate').value || todayISO();
      var amtRaw = document.getElementById('fQAmt').value;
      var amt = parseFloat(amtRaw);

      if(kind==='general'){
        if(!amt || amt<=0){ shake('fQAmt'); return; }
        doGeneralTx(dir, accId, amt, document.getElementById('fQCat').value.trim(), document.getElementById('fQNote').value.trim(), date);
        save(); closeSheet(); renderAll(); return;
      }
      if(kind==='investment' && dir==='out'){
        if(!amt || amt<=0){ shake('fQAmt'); return; }
        var name = document.getElementById('fQAssetName').value.trim();
        if(!name){ shake('fQAssetName'); return; }
        var charges = parseFloat(document.getElementById('fQCharges').value)||0;
        doBuyInvestment({name:name, category:document.querySelector('#fQAssetCat .on').dataset.v, principal:amt, charges:charges, accountId:accId, date:date, attachment:pendingAttachment});
        save(); closeSheet(); goTo('invest'); return;
      }
      if(kind==='investment' && dir==='in'){
        if(state.investments.length===0) return;
        if(!amt || amt<0){ shake('fQAmt'); return; }
        var invId = document.getElementById('fQSellWhich').value;
        var inv = state.investments.find(function(i){return i.id===invId;});
        var charges2 = parseFloat(document.getElementById('fQCharges').value)||0;
        var qtyEl2 = document.getElementById('fQSellQty');
        var sellQty = qtyEl2 ? parseFloat(qtyEl2.value)||0 : null;
        if(qtyEl2 && (!sellQty || sellQty<=0)){ shake('fQSellQty'); return; }
        doSellInvestment(inv, {salePrice:amt, charges:charges2, quantity:sellQty, accountId:accId, date:date});
        save(); closeSheet(); invFilter='sold';
        document.querySelectorAll('[data-invfilter]').forEach(function(x){x.classList.toggle('active', x.dataset.invfilter==='sold');});
        goTo('invest'); return;
      }
      if(kind==='person'){
        var sub = document.querySelector('#fQPersonSub .on') ? document.querySelector('#fQPersonSub .on').dataset.v : null;
        if(sub==='lend' || sub==='borrow'){
          if(!amt || amt<=0){ shake('fQAmt'); return; }
          var pname = document.getElementById('fQPersonName').value.trim();
          if(!pname){ shake('fQPersonName'); return; }
          var pnote = document.getElementById('fQPersonNote').value.trim();
          doLendOrBorrow(sub==='lend'?'debtor':'creditor', pname, amt, accId, date, pnote);
          save(); closeSheet(); setDebtFilter(sub==='lend'?'debtor':'creditor'); goTo('debts'); return;
        }
        if(sub==='repay' || sub==='receive'){
          var sel = document.getElementById('fQDebtWhich');
          if(!sel) return;
          var debt = state.debts.find(function(d){return d.id===sel.value;});
          if(!debt) return;
          doSettleDebt(debt, accId, date);
          save(); closeSheet(); setDebtFilter(debt.type); goTo('debts'); return;
        }
      }
    }
  }

  /* ---- Attachment file handling (shared) ---- */
  function bindAttachmentInput(inputId, previewId, existingAttachment){
    pendingAttachment = existingAttachment || null;
    renderAttachPreview(previewId);
    document.getElementById(inputId).addEventListener('change', function(e){
      var f = e.target.files[0];
      if(!f) return;
      if(f.size > 2*1024*1024){ alert('Please choose a file under 2MB — large files may not save reliably in browser storage.'); return; }
      var reader = new FileReader();
      reader.onload = function(){
        pendingAttachment = {fileName:f.name, fileType:f.type, dataUrl:reader.result};
        renderAttachPreview(previewId);
      };
      reader.readAsDataURL(f);
    });
  }
  function renderAttachPreview(previewId){
    var el = document.getElementById(previewId);
    if(!el) return;
    if(!pendingAttachment){ el.innerHTML=''; return; }
    var isImg = pendingAttachment.fileType && pendingAttachment.fileType.indexOf('image')===0;
    el.innerHTML = '<div class="attach-preview">'+
      (isImg ? '<img src="'+pendingAttachment.dataUrl+'">' : '<div class="fico">📄</div>')+
      '<div class="fname">'+esc(pendingAttachment.fileName)+'</div>'+
      '<span class="frm" id="removeAttach">Remove</span></div>';
    document.getElementById('removeAttach').onclick = function(){ pendingAttachment=null; renderAttachPreview(previewId); };
  }

  /* ---- Debts (dedicated add, still uses shared actions) ---- */
  function sheetDebt(existing){
    if(!existing && needAccountFirst()) return;
    var type0 = existing ? existing.type : debtFilter;
    openSheet(
      '<h3>'+(existing?'Edit':'New')+' entry</h3>'+
      '<div class="field"><label>Type</label><div class="seg" id="fDebtType">'+
        '<button type="button" class="'+(type0==='debtor'?'on':'')+'" data-v="debtor">Owes you</button>'+
        '<button type="button" class="'+(type0==='creditor'?'on':'')+'" data-v="creditor">You owe</button>'+
      '</div></div>'+
      '<div class="field"><label>Person</label><input id="fDebtPerson" value="'+(existing?esc(existing.person):'')+'"></div>'+
      '<div class="field"><label>Amount</label><input id="fDebtAmt" type="number" inputmode="decimal" value="'+(existing?existing.amount:'')+'"></div>'+
      (existing?'':'<div class="field"><label id="fDebtAccLabel">Pay from account</label><select id="fDebtAcc">'+accountOptions()+'</select></div>')+
      '<div class="field"><label>Note</label><input id="fDebtNote" value="'+(existing?esc(existing.note||''):'')+'"></div>'+
      '<div class="field"><label>Date</label><input id="fDebtDate" type="date" value="'+(existing?existing.date:todayISO())+'"></div>'+
      '<button class="btn" id="fDebtSave">Save</button>'+
      (existing?'<div class="row-actions"><button class="btn gold" id="fDebtSettle">Settle</button><button class="btn danger" id="fDebtDel">Delete</button></div>':'')
    );
    bindSeg('fDebtType', existing?null:function(v){ document.getElementById('fDebtAccLabel').textContent = v==='debtor' ? 'Pay from account (cash out)' : 'Receive into account (cash in)'; });
    if(!existing){ document.getElementById('fDebtAccLabel').textContent = type0==='debtor' ? 'Pay from account (cash out)' : 'Receive into account (cash in)'; }
    document.getElementById('fDebtSave').onclick = function(){
      var person = document.getElementById('fDebtPerson').value.trim();
      var amt = parseFloat(document.getElementById('fDebtAmt').value);
      if(!person){ shake('fDebtPerson'); return; }
      if(!amt || amt<=0){ shake('fDebtAmt'); return; }
      var dType = document.querySelector('#fDebtType .on').dataset.v;
      var date = document.getElementById('fDebtDate').value || todayISO();
      var note = document.getElementById('fDebtNote').value.trim();
      if(existing){
        Object.assign(existing, {type:dType, person:person, amount:amt, note:note, date:date});
      } else {
        doLendOrBorrow(dType, person, amt, document.getElementById('fDebtAcc').value, date, note);
      }
      save(); closeSheet(); setDebtFilter(dType);
    };
    if(existing){
      document.getElementById('fDebtSettle').onclick = function(){ closeSheet(); sheetSettleDebt(existing); };
      document.getElementById('fDebtDel').onclick = function(){
        if(confirm('Delete this entry? (This will not undo any related transaction.)')){
          state.debts = state.debts.filter(function(d){return d.id!==existing.id;});
          save(); closeSheet(); renderDebts(); renderHeader();
        }
      };
    }
  }
  function sheetSettleDebt(existing){
    var isDebtor = existing.type==='debtor';
    openSheet(
      '<h3>Settle with '+esc(existing.person)+'</h3>'+
      '<div class="field"><label class="static" style="display:block">'+fmt(existing.amount)+' '+(isDebtor?'to be received':'to be paid')+'</label></div>'+
      '<div class="field"><label>'+(isDebtor?'Receive into account':'Pay from account')+'</label><select id="fSettleAcc">'+accountOptions(existing.accountId)+'</select></div>'+
      '<div class="field"><label>Date</label><input id="fSettleDate" type="date" value="'+todayISO()+'"></div>'+
      '<button class="btn gold" id="fSettleSave">Confirm settlement</button>'
    );
    document.getElementById('fSettleSave').onclick = function(){
      doSettleDebt(existing, document.getElementById('fSettleAcc').value, document.getElementById('fSettleDate').value || todayISO());
      save(); closeSheet(); setDebtFilter(existing.type);
    };
  }
  function openEditDebt(id){
    var d = state.debts.find(function(x){return x.id===id;});
    if(d) sheetDebt(d);
  }

  /* ---- Investments: dedicated Buy / Edit / Sell ---- */
  function sheetInvestBuy(){
    if(needAccountFirst()) return;
    openSheet(
      '<h3>Add an investment</h3>'+
      '<div class="field"><label>Name</label><input id="fInvName" placeholder="e.g. Reliance shares, Gold, Flat in Pune"></div>'+
      '<div class="field"><label>Type</label>'+invTypeSegHTML('fInvCat','shares')+'<div class="hint" id="fInvTypeHint"></div></div>'+
      '<div class="field"><label>Amount to invest</label><input id="fInvInvested" type="number" inputmode="decimal" placeholder="0"></div>'+
      '<div class="field"><label>Charges / fees (optional)</label><input id="fInvCharges" type="number" inputmode="decimal" placeholder="0"><div class="hint">Brokerage, transaction or platform fees — added to your cost basis.</div></div>'+
      '<div id="fInvQtyWrap"></div>'+
      '<div class="field"><label>Pay from account (cash out)</label><select id="fInvAcc">'+accountOptions()+'</select></div>'+
      '<div class="field"><label>Date</label><input id="fInvDate" type="date" value="'+todayISO()+'"></div>'+
      '<div class="field"><label>Bill / invoice (optional)</label><input type="file" id="fInvFile" accept="image/*,application/pdf"><div id="fInvAttachPreview"></div></div>'+
      '<button class="btn" id="fInvSave">Add investment</button>'
    );
    var qtyWrap = document.getElementById('fInvQtyWrap');
    var typeHintEl = document.getElementById('fInvTypeHint');
    function renderQtyFields(cat){
      var info = invTypeInfo(cat);
      typeHintEl.textContent = info.hint;
      if(!info.divisible){ qtyWrap.innerHTML=''; return; }
      qtyWrap.innerHTML =
        '<div class="field"><label>Quantity</label><input id="fInvQty" type="number" inputmode="decimal" placeholder="e.g. 100"></div>'+
        '<div class="field"><label>Unit</label><input id="fInvUnit" placeholder="'+info.unitDefault+'" value="'+info.unitDefault+'"></div>';
    }
    bindSeg('fInvCat', renderQtyFields);
    renderQtyFields('shares');
    bindAttachmentInput('fInvFile','fInvAttachPreview', null);
    document.getElementById('fInvSave').onclick = function(){
      var name = document.getElementById('fInvName').value.trim();
      var invested = parseFloat(document.getElementById('fInvInvested').value);
      if(!name){ shake('fInvName'); return; }
      if(!invested || invested<=0){ shake('fInvInvested'); return; }
      var charges = parseFloat(document.getElementById('fInvCharges').value)||0;
      var qtyEl = document.getElementById('fInvQty');
      var qty = qtyEl ? parseFloat(qtyEl.value)||0 : 0;
      var unitEl = document.getElementById('fInvUnit');
      doBuyInvestment({name:name, category:document.querySelector('#fInvCat .on').dataset.v, principal:invested, charges:charges,
        accountId:document.getElementById('fInvAcc').value, date:document.getElementById('fInvDate').value || todayISO(), attachment:pendingAttachment,
        quantity: qty>0 ? qty : null, unitLabel: unitEl ? unitEl.value.trim() : ''});
      save(); closeSheet(); goTo('invest');
    };
  }
  function sheetEditInvest(inv){
    openSheet(
      '<h3>'+esc(inv.name)+'</h3>'+
      '<div class="field"><label>Type</label>'+invTypeSegHTML('fInvCat', inv.category)+'</div>'+
      '<div class="field"><label>Original / remaining invested</label><div class="static">'+fmt(inv.invested)+'</div></div>'+
       '<div class="field"><label>Adjusted cost</label><div class="static">'+fmt(inv.adjustedCost!=null?inv.adjustedCost:inv.invested)+'</div><div class="hint">Adjusted cost = remaining invested cost after realised profit/loss.</div></div>'+
       '<div class="field"><label>Realised profit / loss</label><div class="static">'+fmt((inv.invested||0)-(inv.adjustedCost!=null?inv.adjustedCost:inv.invested))+'</div></div>'+
      (inv.divisible && inv.quantity!=null ? '<div class="field"><label>Quantity remaining</label><div class="static">'+inv.quantity+' '+(inv.unitLabel||'units')+'</div></div>' : '')+
      '<div class="field"><label>Current value (mark-to-market)</label><input id="fInvCurrent" type="number" inputmode="decimal" value="'+inv.currentValue+'"></div>'+
       '<div class="field"><label>Investment ledger</label><div class="calc-box">'+(function(){ ensureInvestmentEvents(inv); var ev=state.investmentEvents.filter(function(e){return e.investmentId===inv.id;}).sort(function(a,b){return (b.date||'').localeCompare(a.date||'')||(b.created||0)-(a.created||0);}); return ev.map(function(e){ return (e.type==='buy'?'BUY':e.type==='sell'?'SELL':'VALUE')+' · '+niceDate(e.date)+' · '+(e.quantity!=null?e.quantity+' '+(e.unitLabel||'units')+' · ':'')+fmt(e.type==='sell'?e.netProceeds:(e.type==='mark'?e.currentValue:e.cost)); }).join('<br>') || 'No ledger entries'; })()+'</div></div>'+
      '<div class="field"><label>Bill / invoice</label><input type="file" id="fInvFile" accept="image/*,application/pdf"><div id="fInvAttachPreview"></div></div>'+
      '<button class="btn" id="fInvUpdate">Save changes</button>'+
      '<div class="divider"></div>'+
      '<button class="btn gold" id="fInvSell">Sell this asset</button>'+
      '<div class="row-actions" style="margin-top:8px"><button class="btn danger" id="fInvDel">Delete without selling</button></div>'
    );
    bindSeg('fInvCat');
    bindAttachmentInput('fInvFile','fInvAttachPreview', inv.attachment || null);
    document.getElementById('fInvUpdate').onclick = function(){
      var cur = parseFloat(document.getElementById('fInvCurrent').value);
      if(isNaN(cur)){ shake('fInvCurrent'); return; }
      inv.currentValue = cur;
      inv.category = document.querySelector('#fInvCat .on').dataset.v;
      inv.attachment = pendingAttachment;
      save(); closeSheet(); goTo('invest');
    };
    document.getElementById('fInvSell').onclick = function(){ closeSheet(); sheetSellInvestment(inv); };
    document.getElementById('fInvDel').onclick = function(){
      if(confirm('Delete "'+inv.name+'" without recording a sale? This does not adjust any account balance.')){
        state.investments = state.investments.filter(function(i){return i.id!==inv.id;});
        save(); closeSheet(); renderAll();
      }
    };
  }
  function sheetSellInvestment(inv){
    var isDivisible = inv.divisible && inv.quantity!=null && inv.quantity>0;
    openSheet(
      '<h3>Sell '+esc(inv.name)+'</h3>'+
      '<div class="field"><label class="static" style="display:block">Invested '+fmt(inv.invested)+' · Last value '+fmt(inv.currentValue)+(isDivisible?' · '+inv.quantity+' '+(inv.unitLabel||'units')+' held':'')+'</label></div>'+
      (isDivisible ? '<div class="field"><label>Quantity to sell (of '+inv.quantity+' '+(inv.unitLabel||'units')+')</label><input id="fSellQty" type="number" inputmode="decimal" value="'+inv.quantity+'"><div class="hint" id="fSellQtyHint"></div></div>' : '')+
      '<div class="field"><label>Sale price'+(isDivisible?' (for the quantity above)':'')+'</label><input id="fSellPrice" type="number" inputmode="decimal" value="'+inv.currentValue+'"></div>'+
      '<div class="field"><label>Charges / fees (optional)</label><input id="fSellCharges" type="number" inputmode="decimal" placeholder="0"></div>'+
      '<div class="field"><label>Receive into account (cash in)</label><select id="fSellAcc">'+accountOptions(inv.purchaseAccountId)+'</select></div>'+
      '<div class="field"><label>Sale date</label><input id="fSellDate" type="date" value="'+todayISO()+'"></div>'+
      '<div id="fSellProfitLine" class="calc-box"></div>'+
      '<button class="btn gold" id="fSellConfirm">Confirm sale</button>'
    );
    var priceInput = document.getElementById('fSellPrice');
    var chargesInput = document.getElementById('fSellCharges');
    var qtyInput = document.getElementById('fSellQty');
    var qtyHint = document.getElementById('fSellQtyHint');
    var profitLine = document.getElementById('fSellProfitLine');
    function currentQty(){
      if(!isDivisible) return inv.quantity;
      var q = parseFloat(qtyInput.value);
      if(isNaN(q) || q<0) q = 0;
      if(q > inv.quantity) q = inv.quantity;
      return q;
    }
    function updateProfitLine(){
      var p = parseFloat(priceInput.value)||0;
      var c = parseFloat(chargesInput.value)||0;
      var net = p-c;
      var q = currentQty();
      var proportion = isDivisible ? (q / inv.quantity) : 1;
      var costBasis = (inv.adjustedCost!=null ? inv.adjustedCost : inv.invested) * proportion;
      var profit = net - costBasis;
      if(isDivisible && qtyHint){
        var remaining = inv.quantity - q;
        qtyHint.textContent = remaining>0 ? (remaining+' '+(inv.unitLabel||'units')+' will remain after this sale.') : 'This sells everything you hold of this asset.';
      }
      profitLine.innerHTML = (isDivisible?'Cost basis for this portion: <b>'+fmt(costBasis)+'</b><br>':'') +
        'Net proceeds: <b>'+fmt(net)+'</b><br>'+(profit>=0?'Profit: ':'Loss: ')+'<b style="color:'+(profit>=0?'var(--credit)':'var(--debit)')+'">'+fmt(Math.abs(profit))+'</b>';
    }
    priceInput.addEventListener('input', updateProfitLine);
    chargesInput.addEventListener('input', updateProfitLine);
    if(qtyInput) qtyInput.addEventListener('input', updateProfitLine);
    updateProfitLine();
    document.getElementById('fSellConfirm').onclick = function(){
      var price = parseFloat(priceInput.value);
      if(isNaN(price) || price<0){ shake('fSellPrice'); return; }
      if(isDivisible){
        var q = currentQty();
        if(!q || q<=0){ shake('fSellQty'); return; }
      }
      var charges = parseFloat(chargesInput.value)||0;
      doSellInvestment(inv, {salePrice:price, charges:charges, quantity: isDivisible ? currentQty() : null,
        accountId:document.getElementById('fSellAcc').value, date:document.getElementById('fSellDate').value || todayISO()});
      save(); closeSheet(); invFilter='sold';
      document.querySelectorAll('[data-invfilter]').forEach(function(x){ x.classList.toggle('active', x.dataset.invfilter==='sold'); });
      goTo('invest');
    };
  }
  function openEditInvest(id){ var i = state.investments.find(function(x){return x.id===id;}); if(i) sheetEditInvest(i); }
  function openSoldDetail(id){
    var i = state.soldInvestments.find(function(x){return x.id===id;});
    if(!i) return;
    openSheet(
      '<h3>'+esc(i.name)+' <span class="badge">'+(i.partial?'PARTIAL SALE':'SOLD')+'</span></h3>'+
      (i.partial && i.quantitySold ? '<div class="field"><label>Quantity sold</label><div class="static">'+i.quantitySold+' '+(i.unitLabel||'units')+'</div></div>' : '')+
      '<div class="field"><label>Invested (cost basis'+(i.partial?' for this portion':'')+')</label><div class="static">'+fmt(i.invested)+'</div></div>'+
      '<div class="field"><label>Sale price</label><div class="static">'+fmt(i.salePrice)+(i.sellCharges?' − '+fmt(i.sellCharges)+' charges':'')+'</div></div>'+
      '<div class="field"><label>Net proceeds</label><div class="static">'+fmt(i.netProceeds)+'</div></div>'+
      '<div class="field"><label>Result</label><div class="static" style="color:'+(i.profit>=0?'var(--credit)':'var(--debit)')+'">'+(i.profit>=0?'Profit ':'Loss ')+fmt(Math.abs(i.profit))+'</div></div>'+
      '<div class="field"><label>Sold on</label><div class="static">'+niceDate(i.soldDate)+'</div></div>'+
      (i.attachment ? '<div class="field"><label>Bill / invoice</label><div class="attach-preview">'+(i.attachment.fileType&&i.attachment.fileType.indexOf('image')===0?'<img src="'+i.attachment.dataUrl+'">':'<div class="fico">📄</div>')+'<div class="fname">'+esc(i.attachment.fileName)+'</div></div></div>' : '')+
      '<div class="divider"></div><button class="btn danger" id="fSoldDel">Delete this sold entry</button>'
    );
    document.getElementById('fSoldDel').onclick = function(){
      var msg = 'Delete this sold entry for "'+i.name+'"? This also removes the matching sale transaction from your account — the money will no longer be recorded as received. The investment holding will be recalculated from the remaining ledger entries and restored if needed. This cannot be undone.';
      if(confirm(msg)){
        state.soldInvestments = state.soldInvestments.filter(function(x){return x.id!==i.id;});
        state.investmentEvents = (state.investmentEvents||[]).filter(function(e){return e.id!==i.id;});
        state.transactions = state.transactions.filter(function(t){
          return !(t.meta && t.meta.linkedType==='investment' && t.meta.linkedAction==='sell' && (t.meta.saleId===i.id || t.meta.investmentEventId===i.id));
        });
        var inv = state.investments.find(function(x){return x.id===i.investmentId;});
        var hadEvent = (state.investmentEvents||[]).some(function(e){return e.id===i.id;});
        if(inv && hadEvent){ rebuildInvestment(inv.id); }
        else if(inv && i.beforeQty!=null){
          /* Legacy sale fallback: restore the exact pre-sale snapshot. */
          inv.invested=i.beforeInvested!=null?i.beforeInvested:i.invested;
          inv.adjustedCost=i.beforeAdjustedCost!=null?i.beforeAdjustedCost:inv.invested;
          inv.principalAmount=i.beforePrincipalAmount!=null?i.beforePrincipalAmount:inv.invested;
          inv.buyCharges=i.beforeBuyCharges||0; inv.currentValue=i.beforeCurrentValue!=null?i.beforeCurrentValue:inv.invested;
          inv.quantity=i.beforeQty; inv.divisible=true; inv.unitLabel=i.unitLabel||inv.unitLabel||'units';
        } else if(i.beforeQty!=null){
          var restored={id:i.investmentId,name:i.name,category:i.category,invested:i.beforeInvested||i.invested,
            adjustedCost:i.beforeAdjustedCost!=null?i.beforeAdjustedCost:(i.beforeInvested||i.invested),
            principalAmount:i.beforePrincipalAmount||i.invested,buyCharges:i.beforeBuyCharges||0,
            currentValue:i.beforeCurrentValue||i.invested,date:i.soldDate,purchaseAccountId:i.saleAccountId,
            divisible:true,quantity:i.beforeQty,unitLabel:i.unitLabel||'units'};
          state.investments.push(restored);
        }
        save(); closeSheet(); goTo('invest');
      }
    };
  }

  /* ---- Loans / EMI with auto-calculator ---- */
  function sheetLoan(existing){
    var kind0 = existing ? existing.kind : 'loan';
    openSheet(
      '<h3>'+(existing?'Edit':'New')+' loan / card</h3>'+
      '<div class="field"><label>Name</label><input id="fLoanName" placeholder="e.g. Car Loan, HDFC Credit Card" value="'+(existing?esc(existing.name):'')+'"></div>'+
      '<div class="field"><label>Type</label><div class="seg" id="fLoanKind">'+
        '<button type="button" class="'+(kind0==='loan'?'on':'')+'" data-v="loan">Loan</button>'+
        '<button type="button" class="'+(kind0==='credit_card'?'on':'')+'" data-v="credit_card">Credit card</button>'+
      '</div></div>'+
      '<div class="field"><label id="fLoanPrincipalLabel">Principal amount</label><input id="fLoanPrincipal" type="number" inputmode="decimal" value="'+(existing?existing.principal:'')+'"></div>'+
      '<div class="field"><label>Current outstanding</label><input id="fLoanOutstanding" type="number" inputmode="decimal" value="'+(existing?existing.outstanding:'')+'"><div class="hint">Leave blank on a new loan to default to the full principal.</div></div>'+
      '<div id="fLoanCalcWrap"></div>'+
      '<div class="field"><label id="fLoanEmiLabel">EMI / min. payment amount</label><input id="fLoanEmi" type="number" inputmode="decimal" value="'+(existing?existing.emiAmount:'')+'"></div>'+
      '<div class="field"><label>Due day of month (1–31)</label><input id="fLoanDue" type="number" min="1" max="31" value="'+(existing?existing.dueDay:'')+'"></div>'+
      '<div class="field"><label>Loan start date</label><input id="fLoanStart" type="date" value="'+(existing&&existing.date?existing.date:todayISO())+'"></div>'+
      '<div class="field"><label>Linked account for payments</label><select id="fLoanAcc">'+accountOptions(existing?existing.accountId:null)+'</select></div>'+
      (!existing ? '<div id="fLoanCreditWrap"></div>' : '')+
      '<button class="btn" id="fLoanSave">Save</button>'+
      (existing?'<div class="divider"></div><button class="btn gold" id="fLoanPay">Record EMI payment</button><div class="row-actions" style="margin-top:8px"><button class="btn danger" id="fLoanDel">Delete</button></div>':'')+
      (existing?'<div class="divider"></div><h3 style="margin-bottom:8px">EMI history</h3><div id="fLoanEmiHist"></div>':'')
    );
    var calcWrap = document.getElementById('fLoanCalcWrap');
    var creditWrap = document.getElementById('fLoanCreditWrap');

    function renderCalc(kind){
      if(kind==='credit_card'){ calcWrap.innerHTML=''; document.getElementById('fLoanPrincipalLabel').textContent='Credit limit'; return; }
      document.getElementById('fLoanPrincipalLabel').textContent='Principal amount';
      calcWrap.innerHTML =
        '<div class="field"><label>Interest rate % p.a.</label><input id="fLoanRate" type="number" inputmode="decimal" value="'+(existing&&existing.interestRate!=null?existing.interestRate:'')+'"></div>'+
        '<div class="field"><label>Duration (months)</label><input id="fLoanDuration" type="number" value="'+(existing&&existing.durationMonths?existing.durationMonths:'')+'"></div>'+
        '<div class="calc-box" id="fLoanCalcOut">Fill principal, rate and duration to auto-calculate EMI.</div>'+
        '<button type="button" class="btn secondary" id="fLoanUseCalc" style="margin-bottom:12px">Use suggested EMI</button>'+
        '<div class="field"><label>EMIs already paid</label><input id="fLoanPaidCount" type="number" min="0" inputmode="numeric" placeholder="e.g. 12"><div class="hint">For an old loan you\'re adding after the fact — enter how many EMIs have already gone out, and this works out what\'s left to pay.</div></div>'+
        '<div class="calc-box" id="fLoanOutstandingCalcOut">Fill principal, rate, EMI and EMIs paid to estimate the outstanding balance.</div>'+
        '<button type="button" class="btn secondary" id="fLoanUseOutstanding" style="margin-bottom:12px">Use as current outstanding</button>';
      var pEl=document.getElementById('fLoanPrincipal'), rEl=document.getElementById('fLoanRate'), dEl=document.getElementById('fLoanDuration');
      var out = document.getElementById('fLoanCalcOut');
      var emiEl = document.getElementById('fLoanEmi');
      var paidEl = document.getElementById('fLoanPaidCount');
      var outstandingOut = document.getElementById('fLoanOutstandingCalcOut');
      var lastEmi = null, lastOutstanding = null;
      function recalc(){
        var emi = computeEMI(pEl.value, rEl.value, dEl.value);
        if(emi==null){ out.textContent='Fill principal, rate and duration to auto-calculate EMI.'; lastEmi=null; }
        else {
          var months = parseInt(dEl.value)||0;
          var total = emi*months;
          var interest = total - (parseFloat(pEl.value)||0);
          lastEmi = emi;
          out.innerHTML = 'Suggested EMI: <b>'+fmt(emi)+'</b><br>Total interest: <b>'+fmt(interest)+'</b><br>Total payable: <b>'+fmt(total)+'</b>';
        }
        recalcOutstanding();
      }
      function recalcOutstanding(){
        var P = parseFloat(pEl.value)||0;
        var emiForCalc = parseFloat(emiEl.value) || lastEmi;
        var paidCount = parseInt(paidEl.value)||0;
        if(!P || !emiForCalc || paidCount<=0){
          outstandingOut.textContent = 'Fill principal, rate, EMI and EMIs paid to estimate the outstanding balance.';
          lastOutstanding = null;
          return;
        }
        var outstanding = computeOutstandingAfterPayments(P, rEl.value, paidCount, emiForCalc);
        lastOutstanding = outstanding;
        outstandingOut.innerHTML = 'After '+paidCount+' EMIs of '+fmt(emiForCalc)+': outstanding ≈ <b>'+fmt(outstanding)+'</b>';
      }
      [pEl,rEl,dEl].forEach(function(el){ el.addEventListener('input', recalc); });
      [emiEl,paidEl].forEach(function(el){ el.addEventListener('input', recalcOutstanding); });
      recalc();
      document.getElementById('fLoanUseCalc').onclick = function(){ if(lastEmi!=null) document.getElementById('fLoanEmi').value = lastEmi.toFixed(2); };
      document.getElementById('fLoanUseOutstanding').onclick = function(){ if(lastOutstanding!=null) document.getElementById('fLoanOutstanding').value = lastOutstanding.toFixed(2); };
    }
    function renderCreditToggle(kind){
      if(!creditWrap) return;
      if(kind!=='loan'){ creditWrap.innerHTML=''; return; }
      creditWrap.innerHTML = '<label class="checkline"><input type="checkbox" id="fLoanCredit" checked> Add the principal amount to my account as cash now — this is a new loan I am taking, not one I already had.</label>';
    }
    bindSeg('fLoanKind', function(v){ renderCalc(v); renderCreditToggle(v); });
    renderCalc(kind0); renderCreditToggle(kind0);

    document.getElementById('fLoanSave').onclick = function(){
      var name = document.getElementById('fLoanName').value.trim();
      if(!name){ shake('fLoanName'); return; }
      var kind = document.querySelector('#fLoanKind .on').dataset.v;
      var principal = parseFloat(document.getElementById('fLoanPrincipal').value)||0;
      var outstandingVal = document.getElementById('fLoanOutstanding').value;
      var outstanding = outstandingVal===''? principal : parseFloat(outstandingVal);
      var rateEl = document.getElementById('fLoanRate');
      var durEl = document.getElementById('fLoanDuration');
      var data = {
        name:name, kind:kind, principal:principal, outstanding:outstanding,
        emiAmount: parseFloat(document.getElementById('fLoanEmi').value)||0,
        dueDay: parseInt(document.getElementById('fLoanDue').value)||null,
        interestRate: (rateEl && rateEl.value!=='') ? parseFloat(rateEl.value) : null,
        durationMonths: (durEl && durEl.value!=='') ? parseInt(durEl.value) : null,
        accountId: document.getElementById('fLoanAcc').value || null,
        date: document.getElementById('fLoanStart').value || todayISO()
      };
      if(existing){
        Object.assign(existing,data);
        save(); closeSheet(); goTo('loans');
      } else {
        data.id=uid(); state.loans.push(data);
        var creditBox = document.getElementById('fLoanCredit');
        if(kind==='loan' && creditBox && creditBox.checked && data.accountId && principal>0){
          doTakeLoanCredit(data, data.accountId, data.date);
        }
        save(); closeSheet(); goTo('loans');
      }
    };
    if(existing){
      document.getElementById('fLoanPay').onclick = function(){ closeSheet(); sheetPayEmi(existing); };
      document.getElementById('fLoanDel').onclick = function(){
        if(confirm('Delete "'+existing.name+'"? Past EMI transactions already recorded will stay in your accounts.')){
          state.loans = state.loans.filter(function(l){return l.id!==existing.id;});
          save(); closeSheet(); renderAll();
        }
      };
      renderEmiHistory(existing);
    }
  }
  function renderEmiHistory(loan){
    var wrap = document.getElementById('fLoanEmiHist');
    if(!wrap) return;
    var txns = loanEmiTxns(loan.id);
    if(txns.length===0){
      wrap.innerHTML = '<div class="empty" style="padding:14px 0"><span class="glyph">✎</span>No EMI payments recorded yet.</div>';
      return;
    }
    wrap.innerHTML = txns.map(function(t){
      var interest = t.meta.interest||0, principal = t.meta.principal!=null ? t.meta.principal : t.amount;
      return rowHTML({
        name: 'EMI · '+niceDate(t.date),
        sub: 'Interest '+fmt(interest)+' · Principal '+fmt(principal),
        amount: fmt(t.amount), cls:'debit', sign:'−',
        attrs: 'data-emitx="'+t.id+'"'
      });
    }).join('');
    wrap.querySelectorAll('[data-emitx]').forEach(function(r){
      r.onclick = function(){ sheetEmiTx(r.dataset.emitx, loan); };
    });
  }
  function sheetEmiTx(txId, loan){
    var t = state.transactions.find(function(x){return x.id===txId;});
    if(!t) return;
    var interest = t.meta.interest||0;
    openSheet(
      '<h3>Edit EMI payment</h3>'+
      '<div class="field hint" style="margin-top:-6px">Editing this recalculates how much of it counted towards principal, and adjusts the loan\'s outstanding balance accordingly.</div>'+
      '<div class="field"><label>Payment amount</label><input id="fEtAmt" type="number" inputmode="decimal" value="'+t.amount+'"></div>'+
      '<div class="field"><label>Interest portion</label><input id="fEtInt" type="number" inputmode="decimal" value="'+interest+'"></div>'+
      '<div class="calc-box" id="fEtSplitOut"></div>'+
      '<div class="field"><label>Account</label><select id="fEtAcc">'+accountOptions(t.accountId)+'</select></div>'+
      '<div class="field"><label>Date</label><input id="fEtDate" type="date" value="'+t.date+'"></div>'+
      '<button class="btn" id="fEtSave">Save</button>'+
      '<div class="row-actions"><button class="btn danger" id="fEtDel">Delete entry</button></div>'
    );
    var amtEl=document.getElementById('fEtAmt'), intEl=document.getElementById('fEtInt'), out=document.getElementById('fEtSplitOut');
    function refresh(){
      var amt=parseFloat(amtEl.value)||0, intr=parseFloat(intEl.value)||0;
      if(intr>amt) intr=amt;
      out.innerHTML = 'Interest: <b>'+fmt(intr)+'</b> &nbsp;·&nbsp; Principal: <b>'+fmt(amt-intr)+'</b>';
    }
    amtEl.addEventListener('input', refresh); intEl.addEventListener('input', refresh); refresh();
    document.getElementById('fEtSave').onclick = function(){
      var amt = parseFloat(amtEl.value);
      if(!amt || amt<=0){ shake('fEtAmt'); return; }
      var intr = Math.max(0, Math.min(parseFloat(intEl.value)||0, amt));
      var oldPrincipal = t.meta.principal!=null ? t.meta.principal : t.amount;
      var newPrincipal = amt - intr;
      loan.outstanding = Math.max(0, (loan.outstanding||0) + oldPrincipal - newPrincipal);
      Object.assign(t, {
        amount: amt, accountId: document.getElementById('fEtAcc').value,
        date: document.getElementById('fEtDate').value || t.date
      });
      t.meta.interest = intr; t.meta.principal = newPrincipal;
      save(); closeSheet(); sheetLoan(loan);
    };
    document.getElementById('fEtDel').onclick = function(){
      if(confirm('Delete this EMI payment? The principal portion will be added back to the outstanding balance.')){
        var oldPrincipal = t.meta.principal!=null ? t.meta.principal : t.amount;
        loan.outstanding = (loan.outstanding||0) + oldPrincipal;
        state.transactions = state.transactions.filter(function(x){return x.id!==t.id;});
        save(); closeSheet(); sheetLoan(loan);
      }
    };
  }
  function sheetPayEmi(loan){
    if(needAccountFirst()) return;
    var defaultAmt = loan.emiAmount||0;
    openSheet(
      '<h3>Record EMI — '+esc(loan.name)+'</h3>'+
      '<div class="field"><label class="static" style="display:block">Outstanding: '+fmt(loan.outstanding)+'</label></div>'+
      '<div class="field"><label>Payment amount</label><input id="fEmiAmt" type="number" inputmode="decimal" value="'+(defaultAmt||'')+'"></div>'+
      '<div class="field"><label>Interest portion</label><input id="fEmiInt" type="number" inputmode="decimal" value="'+estimateEmiInterest(loan, defaultAmt)+'"><div class="hint">Auto-estimated from the interest rate; edit if your statement shows a different split. The rest of the payment goes towards principal.</div></div>'+
      '<div class="calc-box" id="fEmiSplitOut"></div>'+
      '<div class="field"><label>Pay from account</label><select id="fEmiAcc">'+accountOptions(loan.accountId)+'</select></div>'+
      '<div class="field"><label>Date</label><input id="fEmiDate" type="date" value="'+todayISO()+'"></div>'+
      '<button class="btn gold" id="fEmiSave">Confirm payment</button>'
    );
    var amtEl = document.getElementById('fEmiAmt'), intEl = document.getElementById('fEmiInt'), splitOut = document.getElementById('fEmiSplitOut');
    function refreshSplit(){
      var amt = parseFloat(amtEl.value)||0;
      var intr = parseFloat(intEl.value)||0;
      if(intr>amt) intr=amt;
      var principal = amt-intr;
      splitOut.innerHTML = 'Interest: <b>'+fmt(intr)+'</b> &nbsp;·&nbsp; Principal: <b>'+fmt(principal)+'</b><br>Whole '+fmt(amt)+' comes out of your account; only the principal part reduces what you owe.';
    }
    amtEl.addEventListener('input', function(){ intEl.value = estimateEmiInterest(loan, parseFloat(amtEl.value)||0); refreshSplit(); });
    intEl.addEventListener('input', refreshSplit);
    refreshSplit();
    document.getElementById('fEmiSave').onclick = function(){
      var amt = parseFloat(amtEl.value);
      if(!amt || amt<=0){ shake('fEmiAmt'); return; }
      var intr = parseFloat(intEl.value)||0;
      doPayEmi(loan, amt, intr, document.getElementById('fEmiAcc').value, document.getElementById('fEmiDate').value || todayISO());
      save(); closeSheet(); goTo('loans');
    };
  }
  function openEditLoan(id){ var l = state.loans.find(function(x){return x.id===id;}); if(l) sheetLoan(l); }

  /* ---- Recurring ---- */
  function sheetRecurring(existing){
    if(!existing && needAccountFirst()) return;
    var type0=existing?existing.type:'expense';
    openSheet(
      '<h3>'+(existing?'Edit':'New')+' recurring entry</h3>'+
      '<div class="field"><label>Name</label><input id="fRecName" placeholder="e.g. Salary, Rent, Netflix, Gold SIP" value="'+(existing?esc(existing.name):'')+'"></div>'+
      '<div class="field"><label>Type</label><div class="seg" id="fRecType">'+
        '<button type="button" class="'+(type0==='expense'?'on':'')+'" data-v="expense">Expense</button>'+
        '<button type="button" class="'+(type0==='income'?'on':'')+'" data-v="income">Income</button>'+
        '<button type="button" class="'+(type0==='investment'?'on':'')+'" data-v="investment">Investment / SIP</button>'+
      '</div></div>'+
      '<div class="field"><label>Amount per cycle</label><input id="fRecAmt" type="number" inputmode="decimal" value="'+(existing?existing.amount:'')+'"></div>'+
      '<div id="fRecInvExtra"></div>'+
      '<div class="field"><label>Account</label><select id="fRecAcc">'+accountOptions(existing?existing.accountId:null)+'</select></div>'+
      '<div class="field"><label>Category</label><input id="fRecCat" value="'+(existing?esc(existing.category||''):'')+'"></div>'+
      '<div class="field"><label>Frequency</label><div class="seg" id="fRecFreq">'+
        '<button type="button" class="'+(!existing||existing.frequency==='monthly'?'on':'')+'" data-v="monthly">Monthly</button>'+
        '<button type="button" class="'+(existing&&existing.frequency==='weekly'?'on':'')+'" data-v="weekly">Weekly</button>'+
        '<button type="button" class="'+(existing&&existing.frequency==='yearly'?'on':'')+'" data-v="yearly">Yearly</button>'+
      '</div></div>'+
      '<div class="field"><label>Next due date</label><input id="fRecNext" type="date" value="'+(existing?existing.nextDue:todayISO())+'"></div>'+
      (existing?'<label class="checkline"><input type="checkbox" id="fRecActive" '+(existing.active!==false?'checked':'')+'> Active (show in Upcoming until paused)</label>':'')+
      '<button class="btn" id="fRecSave">Save</button>'+
      (existing?'<div class="row-actions"><button class="btn gold" id="fRecApply">Add now &amp; advance</button><button class="btn danger" id="fRecDel">Delete</button></div>':'')
    );
    function renderRecInv(v){
      var el=document.getElementById('fRecInvExtra');
      if(v!=='investment'){el.innerHTML='';return;}
      el.innerHTML='<div class="field"><label>Investment asset</label><input id="fRecInvName" placeholder="e.g. Gold SIP, LIC premium" value="'+(existing?esc(existing.investmentName||existing.name):'')+'"></div>'+
        '<div class="field"><label>Investment type</label>'+invTypeSegHTML('fRecInvCat', existing?(existing.investmentCategory||'sip'):'sip')+'</div>'+
        '<div class="field"><label>Quantity per cycle (optional)</label><input id="fRecQty" type="number" inputmode="decimal" value="'+(existing&&existing.quantity?existing.quantity:'')+'" placeholder="e.g. 2"></div>'+
        '<div class="field"><label>Unit</label><input id="fRecUnit" placeholder="grams, shares, units…" value="'+(existing?esc(existing.unitLabel||''):'')+'"></div>'+
        '<div class="field"><label>Charges / fees per cycle</label><input id="fRecCharges" type="number" inputmode="decimal" value="'+(existing?existing.investmentCharges||0:0)+'"></div>';
      bindSeg('fRecInvCat');
    }
    bindSeg('fRecType',renderRecInv); bindSeg('fRecFreq'); renderRecInv(type0);
    document.getElementById('fRecSave').onclick=function(){
      var name=document.getElementById('fRecName').value.trim(), amt=parseFloat(document.getElementById('fRecAmt').value);
      if(!name){shake('fRecName');return;} if(!amt||amt<=0){shake('fRecAmt');return;}
      var type=document.querySelector('#fRecType .on').dataset.v;
      var data={name:name,type:type,amount:amt,accountId:document.getElementById('fRecAcc').value,category:document.getElementById('fRecCat').value.trim(),frequency:document.querySelector('#fRecFreq .on').dataset.v,nextDue:document.getElementById('fRecNext').value||todayISO()};
      if(type==='investment'){
        data.investmentName=document.getElementById('fRecInvName').value.trim()||name;
        data.investmentCategory=document.querySelector('#fRecInvCat .on').dataset.v;
        data.quantity=parseFloat(document.getElementById('fRecQty').value)||null;
        data.unitLabel=document.getElementById('fRecUnit').value.trim();
        data.investmentCharges=parseFloat(document.getElementById('fRecCharges').value)||0;
      }
      if(existing){data.active=document.getElementById('fRecActive').checked;Object.assign(existing,data);} else {data.id=uid();data.active=true;state.recurring.push(data);}
      save();closeSheet();goTo('recurring');
    };
    if(existing){
      document.getElementById('fRecApply').onclick=function(){doApplyRecurring(existing);save();closeSheet();goTo('recurring');};
      document.getElementById('fRecDel').onclick=function(){if(confirm('Delete this recurring entry?')){state.recurring=state.recurring.filter(function(r){return r.id!==existing.id;});save();closeSheet();renderAll();}};
    }
  }
  function openEditRecurring(id){ var r = state.recurring.find(function(x){return x.id===id;}); if(r) sheetRecurring(r); }

  /* ---- FAB routing per section ---- */
  var fabAddEl = document.getElementById('fabAdd'); if(fabAddEl) fabAddEl.addEventListener('click', function(){
    if(currentTab==='dashboard') sheetQuickAdd();
    else if(currentTab==='accounts') sheetNewAccount();
    else if(currentTab==='account-detail') sheetQuickAdd();
    else if(currentTab==='invest') sheetInvestBuy();
    else if(currentTab==='loans') sheetLoan(null);
    else if(currentTab==='debts') sheetDebt(null);
    else if(currentTab==='recurring') sheetRecurring(null);
  });

  /* ---- Settings ---- */
  var btnBackupEl = document.getElementById('btnBackup'); if(btnBackupEl) btnBackupEl.addEventListener('click', function(){
    var payload = JSON.stringify(state, null, 2);
    var blob = new Blob([payload], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'personal-finance-backup-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
  });
  var btnRestoreEl = document.getElementById('btnRestore'); if(btnRestoreEl) btnRestoreEl.addEventListener('click', function(){ document.getElementById('restoreFile').click(); });
  var restoreFileEl = document.getElementById('restoreFile'); if(restoreFileEl) restoreFileEl.addEventListener('change', function(e){
    var f = e.target.files[0];
    if(!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!parsed || typeof parsed!=='object') throw new Error('Invalid file');
        if(!confirm('This will replace all current data on this device with the backup file. Continue?')) return;
        state = Object.assign(defaultState(), parsed);
        save(); alert('Backup restored.'); goTo('dashboard');
      }catch(err){ alert('Could not read this backup file: ' + err.message); }
    };
    reader.readAsText(f);
    e.target.value = '';
  });
  var btnDeleteAllEl = document.getElementById('btnDeleteAll'); if(btnDeleteAllEl) btnDeleteAllEl.addEventListener('click', function(){
    if(!confirm('Delete ALL data on this device? This cannot be undone.')) return;
    if(!confirm('Really sure? Consider exporting a backup first. Delete everything now?')) return;
    state = defaultState(); save(); goTo('dashboard');
  });

  /* ---- Settings: view mode (desktop / mobile) ---- */
  var viewModeSeg = document.getElementById('fViewMode');
  if(viewModeSeg){
    var vm = getViewMode();
    Array.prototype.forEach.call(viewModeSeg.querySelectorAll('button'), function(b){
      b.classList.toggle('on', b.dataset.v===vm);
      b.addEventListener('click', function(){
        Array.prototype.forEach.call(viewModeSeg.querySelectorAll('button'), function(x){ x.classList.remove('on'); });
        b.classList.add('on');
        setViewMode(b.dataset.v);
      });
    });
  }

  /* ---- Settings: Google Sheet sync ---- */
  var syncUrlEl = document.getElementById('fSyncUrl');
  var syncEnabledEl = document.getElementById('fSyncEnabled');
  if(syncUrlEl){
    var ss = getSyncSettings();
    syncUrlEl.value = ss.url || '';
    if(syncEnabledEl) syncEnabledEl.checked = !!ss.enabled;
    renderSyncStatus();
  }
  var btnSyncSaveEl = document.getElementById('btnSyncSave');
  if(btnSyncSaveEl) btnSyncSaveEl.addEventListener('click', function(){
    var url = syncUrlEl.value.trim();
    if(url && url.indexOf('https://script.google.com/')!==0){
      if(!confirm('This does not look like a script.google.com web app link. Save it anyway?')) return;
    }
    setSyncSettings({url: url, enabled: url ? (syncEnabledEl?syncEnabledEl.checked:true) : false});
    if(url){
      testSyncConnection(function(ok, err){
        if(ok){ renderSyncStatus('Connected! Syncing now…'); pushToSheet(function(){ renderSyncStatus(); }); }
        else { alert('Could not connect: ' + (err||'unknown error') + '\n\nDouble-check the deployment is set to "Anyone" access and the link ends with /exec.'); renderSyncStatus(); }
      });
    } else {
      renderSyncStatus();
    }
  });
  if(syncEnabledEl) syncEnabledEl.addEventListener('change', function(){
    setSyncSettings({enabled: syncEnabledEl.checked});
  });
  var btnSyncTestEl = document.getElementById('btnSyncTest');
  if(btnSyncTestEl) btnSyncTestEl.addEventListener('click', function(){
    renderSyncStatus('Testing connection…');
    testSyncConnection(function(ok, err){
      if(ok) alert('Connection works! Auto-sync will keep this Sheet up to date.');
      else alert('Could not connect: ' + (err||'unknown error'));
      renderSyncStatus();
    });
  });

  /* ---------------- Init ---------------- */
  updateFab();
  renderAll();

})();
