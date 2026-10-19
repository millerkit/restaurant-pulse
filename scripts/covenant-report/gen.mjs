// Writes reports/covenant-scenarios-2026-10.html (the covenant report for Erin). Imports calc.mjs,
// calc2.mjs and dep.mjs. Hard-coded production figures as of 2026-10-19 (see calc.mjs).
// Make the PDF (macOS, Chrome installed):
//   node scripts/covenant-report/gen.mjs
//   cd reports && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
//     --disable-gpu --no-pdf-header-footer --print-to-pdf=covenant-scenarios-2026-10.pdf \
//     covenant-scenarios-2026-10.html
import fs from 'node:fs'
import {areas,C0,R0,S0,cogsPct,opexVarPct} from './calc.mjs'
import {nbv as nbvAssets,totalAcc,totalCost} from './dep.mjs'
import {nov,dec,N,val,per1,plan,spendVal,debt,req,cm,laborVarPerCover} from './calc2.mjs'
const $=(n,d=0)=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
const K=n=>'$'+(n/1000).toFixed(1)+'K'
const pct=(n,d=1)=>(n*100).toFixed(d)+'%'
const CH='Chef’s Counter',DR='Dining Room',BR='Bar',SA='Salon'

// ---------- P&L snapshot (production, read 2026-10-19) ----------
const proceeds=100000, nbv=nbvAssets, gainReal=proceeds-nbv
const ytd={revenue:1344108.22,cogs:310887.31,labor:785985.83,opex:455727.04,oi:176048.11,oe:14750}
const proj={revenue:1212069.68+644236.15,cogs:277586.59+175130.72,labor:701823.81+361959.08,opex:422441.06+141744.26,oi:131491.11+168900-nbv,oe:14750}
const ni=x=>x.revenue-x.cogs-x.labor-x.opex+x.oi-x.oe
const ytdNI=ni(ytd), projNI=ni(proj)
const interestAddBack=80015.30   // account 7020, Jan–Sep posted + Oct–Dec budget
const neededNI=req-interestAddBack
const ebitda=projNI+interestAddBack, ratioNow=ebitda/debt, cushion=ebitda-req
const assetSale=gainReal, noSale=ebitda-assetSale, noSaleRatio=noSale/debt, gap=req-noSale
const ratio=v=>(noSale+v)/debt
const allLoansDebt=128439.96, allLoansRatio=ebitda/allLoansDebt, allLoansShort=1.25*allLoansDebt-ebitda
const projOpsNI=projNI-proj.oi+proj.oe
// ---------- page 1 (unchanged table) ----------
const maxCovers=Math.max(...areas.map(a=>a.cpn)), maxPc=Math.max(...areas.map(a=>a.pc)), maxRev=Math.max(...areas.map(a=>a.rev))
const bar=(cls,w,label)=>`<div class="bc"><div class="track"><div class="bar ${cls}" style="width:${w}%"></div></div><span>${label}</span></div>`
const rows=areas.map(a=>`<tr><td class="nm">${a.n}<div class="sub">open ${a.nights} of 65 nights</div></td>
<td>${bar('b1',a.cpn/maxCovers*100,a.cpn.toFixed(1))}</td><td>${bar('b2',a.pc/maxPc*100,$(a.pc,2))}</td>
<td>${bar('b3',a.rev/maxRev*100,$(a.rev))}</td><td class="sh">${pct(a.rev/R0,0)}</td></tr>`).join('')

// ---------- page 2: per-space headroom ----------
const octSoFar={[CH]:11.9,[DR]:47.9,[BR]:17.0,[SA]:7.0}
const octPlan={[CH]:12,[DR]:48,[BR]:17,[SA]:7}
const cap={[CH]:'6 seats × 2 turns = 12',[DR]:'32 seats × 2.5 turns = 80',[BR]:'11 seats × 3 turns = 33',[SA]:'10 seats × 3 turns = 30'}
const spaces=[CH,DR,BR,SA]
const maxPer1=per1(CH)
const spaceRows=spaces.map(s=>`<tr><td class="nm">${s}</td><td class="c">${cap[s]}</td><td class="c">${plan[s][0]} / ${plan[s][1]}</td><td class="c">${octSoFar[s].toFixed(1)} <span class="sub">(plan ${octPlan[s]})</span></td>
<td>${bar('b4',Math.max(per1(s),0)/maxPer1*100,per1(s)<50?'≈ $0':$(per1(s)))}</td></tr>`).join('')
  +`<tr><td class="nm">Outdoor</td><td class="c sub" colspan="4">Closed for the season (Nov–Apr)</td></tr>`

// ---------- scenarios ----------
const colors={[CH]:'#1f5f8b',[DR]:'#7aa7c7',[BR]:'#c9a66b',spend:'#9a86c2'}
const mk=(title,parts,detail)=>({title,parts,detail,total:parts.reduce((s,p)=>s+p.v,0)})
const P=(space,covers)=>({key:space,v:covers*per1(space),label:`${space==CH?'Chef’s':space} +${covers}`})
const sc=[
  mk('Fill Chef’s Counter (12 every night)',[P(CH,2)],'Chef’s 12 a night (plan is 10)'),
  mk('Fill Chef’s + 10 more in the Dining Room',[P(CH,2),P(DR,10)],'Chef’s 12 · Dining 56 in Nov, 66 in Dec'),
  mk('Fill Chef’s + 10 more Dining + 5 more at the Bar + $5 more per Dining cover',[P(CH,2),P(DR,10),P(BR,5),{key:'spend',v:spendVal(DR,5,10),label:'Dining +$5'}],'Chef’s 12 · Dining 56 / 66 · Bar 25'),
  mk('Close to full every night: Chef’s 12, Dining +20, Bar +10, +$5 per Dining cover',[P(CH,2),P(DR,20),P(BR,10),{key:'spend',v:spendVal(DR,5,20),label:'Dining +$5'}],'Chef’s 12 · Dining 66 / 76 (of 80) · Bar 30 (of 33)'),
]
const scaleMax=Math.max(gap,...sc.map(s=>s.total))*1.06
const tgt=gap/scaleMax*100
const scRows=sc.map(s=>{const ok=s.total>=gap-1;const r=ratio(s.total)
 return `<div class="sc"><div class="scl"><b>${s.title}</b><div class="sub">${s.detail}</div></div>
 <div class="sct"><div class="tgt" style="left:${tgt}%"></div>${s.parts.map(p=>`<div class="seg" style="width:${p.v/scaleMax*100}%;background:${colors[p.key]}" title="${p.label}">${p.v/scaleMax>0.09?p.label:''}</div>`).join('')}</div>
 <div class="scv ${ok?'ok':'no'}"><b>${K(s.total)}</b> ${ok?'✓':'▲'}<div class="sub">${r.toFixed(2)}x · ${pct(s.total/gap,0)}</div></div></div>`}).join('')

// ---------- spend (secondary) ----------
const spendRows=[[CH,10],[DR,5],[BR,5],[SA,5]].map(([s,d])=>`<tr><td class="nm">${s}</td><td class="c">+${$(d)}</td><td class="c">${pct(d/(areas.find(a=>a.n===s).pc),0)}</td><td class="c"><b>${$(spendVal(s,d))}</b></td></tr>`).join('')

const html=`<!doctype html><html><head><meta charset="utf-8"><title>Urban Hearth — Spaces & Loan Covenant</title>
<style>
@page{size:letter;margin:.5in}
*{box-sizing:border-box}
:root{--ink:#1c1c1e;--mute:#666;--line:#e2e0da;--panel:#f7f5ef;--blue:#1f5f8b;--blue-l:#cfe3f1;--or:#b4510f;--or-l:#fbe2d1}
body{font:12px/1.4 -apple-system,Helvetica,Arial,sans-serif;color:var(--ink);margin:0}
h1{font-size:23px;margin:0}.meta{color:var(--mute);margin:2px 0 14px}
h2{font-size:15px;margin:14px 0 3px}.lead{color:var(--mute);margin:0 0 8px}
.page2{break-before:page}
.tiles{display:flex;gap:10px}.tile{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.tv{font-size:26px;font-weight:700}.tl{font-size:11px;color:var(--mute)}
.tile.bad{border-color:var(--or);background:var(--or-l)}.tile.bad .tv{color:var(--or)}
.gauge{position:relative;height:16px;background:linear-gradient(90deg,var(--or-l) 0 ${1.25/2*100}%,var(--blue-l) ${1.25/2*100}% 100%);border-radius:8px;margin:20px 0 4px}
.mk{position:absolute;top:-6px;width:3px;height:28px;background:var(--ink)}
.mk b{position:absolute;top:-16px;left:-30px;width:63px;text-align:center;font-size:10.5px;white-space:nowrap}
.mk.cov{background:var(--blue)}.mk.risk{background:var(--or)}.mk b.lft{left:auto;right:6px;width:auto;text-align:right}.mk b.rgt{left:6px;width:auto;text-align:left}.mk b{left:-60px;width:123px}
.scale{position:relative;height:14px;font-size:10px;color:var(--mute)}.scale span{position:absolute;transform:translateX(-50%)}.scale span:first-child{transform:none}.scale span:last-child{transform:translateX(-100%)}
table{border-collapse:collapse;width:100%}
th{text-align:left;font-size:10.5px;color:var(--mute);font-weight:600;padding:4px 6px;border-bottom:2px solid var(--line)}
th.c,td.c{text-align:center}
td{padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
td.nm{font-weight:600;width:150px}.sub{font-weight:400;font-size:10px;color:var(--mute)}
td.sh{color:var(--mute);width:60px;font-size:11px}
.bc{display:flex;align-items:center;gap:6px;height:20px}.bc span{font-variant-numeric:tabular-nums;font-weight:600;font-size:12px}
.bc .track{width:110px;flex:none}.bc .bar{height:16px;border-radius:3px}
.b1{background:#7aa7c7}.b2{background:#8fbfa8}.b3{background:#c9a66b}.b4{background:#1f5f8b}
tr.tot td{border-top:2px solid #999;border-bottom:0;font-weight:700}
.callout{border-left:4px solid var(--or);background:var(--or-l);padding:8px 12px;border-radius:0 6px 6px 0;margin:6px 0 10px}
.callout.blue{border-left-color:var(--blue);background:var(--blue-l)}
.sc{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--line)}
.scl{width:235px;flex:none}.scl b{font-size:11.5px}
.sct{position:relative;flex:1;height:22px;background:#f1efe9;border-radius:4px;display:flex;overflow:visible}
.seg{height:100%;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden;border-right:1px solid #fff}
.seg:first-child{border-radius:4px 0 0 4px}
.tgt{position:absolute;top:-5px;bottom:-5px;width:0;border-left:2px dashed var(--ink);z-index:2}
.scv{width:72px;flex:none;text-align:right;font-variant-numeric:tabular-nums}.scv b{font-size:14px}
.scv.ok b{color:var(--blue)}.scv.no b{color:var(--or)}
.sckey{display:flex;gap:14px;font-size:10.5px;color:var(--mute);margin:6px 0 0;flex-wrap:wrap}
.sckey b{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:-2px;margin-right:4px}
.notes{font-size:10px;color:#444;line-height:1.45;padding-left:16px;margin-top:10px}.notes li{margin-bottom:3px}
.cg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grp{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:9px 12px}
.grp.bad{border-color:var(--or);background:var(--or-l)}.grp.good{border-color:var(--blue);background:var(--blue-l)}.v.pos{color:var(--blue)}
.grp h3{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute)}.grp h3 span{text-transform:none;letter-spacing:0;font-weight:400}
.pair{display:flex;gap:12px}.pair>div{flex:1}.pair>div+div{border-left:1px solid var(--line);padding-left:12px}
.v{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums}.v.neg{color:var(--or)}.l{font-size:10.5px;color:var(--mute);line-height:1.3}
.pagebreak{break-before:page}
.two{display:flex;gap:16px;align-items:flex-start}.two>div{flex:1}
</style></head><body>

<h1>Urban Hearth — where we stand</h1>
<div class="meta">Prepared for Erin · Oct 19, 2026 · Toast covers and spend, trailing 3 months (Aug 1 – Oct 18)</div>
<div class="cg">
<div class="grp"><h3>Revenue</h3><div class="pair"><div><div class="v">${$(ytd.revenue)}</div><div class="l">So far this year<br>(through Oct 18)</div></div><div><div class="v">${$(proj.revenue)}</div><div class="l">Projected for 2026</div></div></div></div>
<div class="grp"><h3>Other income <span>grants &amp; asset sale</span></h3><div class="pair"><div><div class="v">${$(ytd.oi)}</div><div class="l">So far (almost all grants)</div></div><div><div class="v">${$(proj.oi)}</div><div class="l">Projected, incl. a ${K(gainReal)} gain on the old location’s assets and ${K(68600-44557)} more grant money not yet received</div></div></div></div>
<div class="grp"><h3>Profit</h3><div class="pair"><div><div class="v ${ytdNI<0?'neg':''}">${ytdNI<0?'−':''}${$(Math.abs(ytdNI))}</div><div class="l">So far · ${pct(ytdNI/ytd.revenue)} margin</div></div><div><div class="v">${$(projNI)}</div><div class="l">Projected · ${pct(projNI/proj.revenue)} margin, before any new Section 179 depreciation</div></div></div></div>
<div class="grp good"><h3>Loan covenant</h3><div class="pair"><div><div class="v">${$(neededNI)}</div><div class="l">Profit we need for 2026</div></div><div><div class="v pos">+${$(projNI-neededNI)}</div><div class="l">Projected cushion · ${ratioNow.toFixed(2)}x vs 1.25x required ✓</div></div></div></div>
</div>
<p class="sub" style="margin:6px 0 0">So far this year includes only part of October’s bills, so it reads a little better than it will once October closes. Without the grants and asset sale, 2026 is projected at a <b>${$(Math.abs(projOpsNI))} loss</b>: the year’s profit comes from that other income.</p>

<h2>What the covenant requires, in plain terms</h2>
<div class="callout blue">Our Eastern Bank loan has a rule we have to pass once a year: <b>for every $1 we pay on our loans, the restaurant has to earn at least $1.25</b> before loan interest is paid. This is the bank’s way of checking that we earn comfortably more than we owe, with a 25% cushion.<br>
<span style="display:block;margin-top:5px">For 2026 the loans counted (the SBA loan plus five investor notes) cost <b>${$(debt)}</b> in payments, so we need <b>${$(req)}</b> of earnings before interest (1.25 × ${$(debt)}). Because the ${$(interestAddBack)} of loan interest on our books this year gets added back, that works out to only about <b>${$(neededNI)} of profit</b>. We’re projected at ${$(projNI)}, so <b>we pass with about ${$(cushion)} to spare</b> (${ratioNow.toFixed(2)}x).</span>
<span style="display:block;margin-top:5px"><b>The catch:</b> that projection counts a ${K(gainReal)} gain from selling the old location for $100K (equipment, the lease and the liquor license). Those are still carried at ${K(nbv)} on the books after catch-up depreciation, so the gain is $100K less that. If the sale slips into 2027, or the bank won’t count a one-time gain as earnings, we’d be at <b>${noSaleRatio.toFixed(2)}x, about ${$(gap)} short</b>. Page 2 looks at that risk.</span></div>
<div class="gauge"><div class="mk risk" style="left:${noSaleRatio/2*100}%"><b style="color:var(--or)">Without asset sale ${noSaleRatio.toFixed(2)}x</b></div><div class="mk cov" style="left:${1.25/2*100}%"><b class="lft" style="color:var(--blue)">Needed 1.25x</b></div><div class="mk" style="left:${ratioNow/2*100}%"><b class="rgt">Projected ${ratioNow.toFixed(2)}x</b></div></div>
<div class="scale"><span style="left:0">0x</span><span style="left:25%">0.5x</span><span style="left:50%">1.0x</span><span style="left:75%">1.5x</span><span style="left:100%">2.0x</span></div>

<h2>A typical night, by space</h2>
<p class="lead">Average of the last 3 months. Whole restaurant: <b>${C0.toFixed(1)} covers</b> and <b>${$(R0)}</b> a night — about <b>${$(S0,2)}</b> per cover. Chef’s Counter is 26% of revenue from 11% of covers.</p>
<table><tr><th>Space</th><th>Covers / night</th><th>Spend per cover</th><th>Revenue / night</th><th>Share</th></tr>${rows}
<tr class="tot"><td class="nm">Whole restaurant</td><td>${C0.toFixed(1)}</td><td>${$(S0,2)}</td><td>${$(R0)}</td><td class="sh">100%</td></tr></table>

<div class="page2"></div>
<h1>The risk: the gain on the asset sale</h1>
<div class="meta">What happens if it doesn’t count for 2026, and how much extra covers in specific spaces can make up</div>
<div class="callout">On the current plan we pass the covenant with about ${K(cushion)} to spare. But ${K(assetSale)} of the year’s earnings is the gain on the asset sale. The lease and liquor license transfers need approval from the landlord, the City and the state, so closing could slip into 2027. Without the sale we’d be at ${noSaleRatio.toFixed(2)}x and need about <b>${K(gap)}</b> more. <b>October is landing on plan so far</b> (Chef’s 11.9 a night against 12 planned, Dining 47.9 against 48, Bar 17 against 17), so any extra has to come from covers <b>above the plan</b> in November and December: about ${N} service nights (${nov} in Nov, ${dec} in Dec).</div>

<h2>Room to grow, by space</h2>
<p class="lead">“Plan” is the covers a night our budget already counts on. October is landing right on plan so far.</p>
<table><tr><th>Space</th><th class="c">Most it can seat</th><th class="c">Plan, Nov / Dec</th><th class="c">October so far</th><th>One more cover every night, Nov–Dec</th></tr>${spaceRows}</table>

<h2>The bottom line</h2>
<div class="callout blue"><b>Covers can’t replace the asset sale this year.</b> Even running close to full every night in November and December makes up about ${pct(sc[3].total/gap,0)} of the ${K(gap)}. So the most important steps are <b>closing the sale in 2026</b> and <b>confirming with Eastern Bank</b> that a one-time gain counts toward the covenant.<br>
<span style="display:block;margin-top:5px">Extra covers still build cushion, and Chef’s Counter is the strongest lever: each extra Chef’s cover adds about <b>${$(val(CH))}</b> to earnings, against ${$(val(DR))} in the Dining Room and ${$(val(BR))} at the Bar.</span></div>

<h2>How far extra covers get us without the asset sale</h2>
<p class="lead">Extra covers a night above the plan, every night in November and December. The dashed line is the ${K(gap)} we’d need for 1.25x without the sale.</p>
${scRows}
<div class="sckey"><span><b style="background:${colors[CH]}"></b>Chef’s Counter</span><span><b style="background:${colors[DR]}"></b>Dining Room</span><span><b style="background:${colors[BR]}"></b>Bar</span><span><b style="background:${colors.spend}"></b>Higher Dining spend</span><span>✓ reaches 1.25x · ▲ falls short</span></div>

<div class="two pagebreak">
<div><h2>Spending more per cover (secondary)</h2>
<p class="lead">For comparison: what higher spend per cover adds over November and December, at the planned covers.</p>
<table><tr><th>Space</th><th class="c">Per cover</th><th class="c">Increase</th><th class="c">Adds</th></tr>${spendRows}</table></div>
<div><h2>Why covers, not prices</h2>
<p style="margin:4px 0">Higher spend does help: $5 more per Dining cover is worth about ${K(spendVal(DR,5))}. But that means raising prices or getting every table to order more, which is hard to do quickly. Bringing more people in is the bigger and more controllable lever. The likeliest spend gains are drinks: wine pairings at Chef’s and a second glass in the Dining Room.</p>
<p style="margin:4px 0"><b>Looking ahead:</b> the covenant is tested every year. Over a full year, 2 more covers a night at Chef’s Counter is worth about <b>$70K</b>, about as much as the asset sale is adding this year, which makes it the lever for 2027.</p></div>
</div>

<ul class="notes">
<li><b>Baseline:</b> the Revenue Modeling projection — real results through September plus the budget for Oct–Dec, with the rest of October assumed to land on plan. The covenant counts the SBA loan and the Chen, Savage, Schaefer, Gilreath and Mis notes: ${$(debt)} of payments in 2026, so required EBITDA is 1.25 × that = ${$(req)}. Projected EBITDA = ${$(projNI)} profit + ${$(interestAddBack)} loan interest on the books (actual Jan–Sep, budget Oct–Dec) + $0 depreciation = ${$(ebitda)}. If the bank counts all 10 loans (${$(allLoansDebt)} of payments) we’d be at ${allLoansRatio.toFixed(2)}x, about ${K(allLoansShort)} short, even with the asset sale.</li>
<li><b>Value of an extra cover:</b> recent spend per cover × (1 − ${pct(cogsPct)} food &amp; drink cost − ${pct(opexVarPct)} variable operating costs) − about ${$(laborVarPerCover,2)} of hourly labor. That labor figure is a restaurant-wide average; 2 more seats at Chef’s Counter probably add less, so Chef’s is, if anything, understated. The Salon adds almost nothing per cover at about $38 of spend.</li>
<li><b>Other income:</b> the projection includes ${$(proj.oi)} of other income, ${K(68600-44557)} of it grant money and the ${K(gainReal)} gain on the asset sale not yet received. Every dollar of it that slips comes straight off the cushion. Depreciation on the new location is not included yet. The accountant will decide how much Section 179 to take (possibly up to about $300K, limited by business income). It does not change the covenant ratio, because depreciation is added back to EBITDA.</li>
</ul>
</body></html>`
fs.writeFileSync(new URL('../../reports/covenant-scenarios-2026-10.html',import.meta.url).pathname,html)
