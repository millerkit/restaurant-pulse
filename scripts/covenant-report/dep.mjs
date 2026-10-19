// Catch-up depreciation for the 2263 Mass Ave assets: builds the SaasAnt journal CSVs and the item
// schedule in reports/depreciation-catch-up/ and exports the remaining book value used by gen.mjs.
// Run directly (node scripts/covenant-report/dep.mjs) to rewrite the CSVs. Assumptions are in
// reports/depreciation-catch-up/README.md. CSV format: see the saasant-journal-csv-format memory
// (MM/DD/YY dates, "Debit Amount"/"Credit Amount").
import fs from 'node:fs'
const MACRS7=[.1429,.2449,.1749,.1249,.0893,.0892,.0893,.0446]
const r2=n=>Math.round(n*100)/100
// Post-2021 additions from the QuickBooks registers (kitchen equipment 1330, leasehold improvements 1361).
// method: 'macrs' = 7-yr 200DB half-year (as the 2024 return did for the larger items), 'expense' = de minimis, written off in year placed in service.
const items=[
 {acct:'1330',desc:'Sandwich unit refrigerator (B&G, 08/13/2022)',cost:5644.53,year:2022,method:'macrs'},
 {acct:'1330',desc:'Sandwich unit refrigerator, 12 pan (B&G, 05/30/2023)',cost:1972.83,year:2023,method:'expense'},
 {acct:'1330',desc:'Peter Ungar (06/26/2023)',cost:1200,year:2023,method:'expense'},
 {acct:'1330',desc:'Dishwasher (B&G, billed 10/20/2023, in service 01/01/2024 per 2024 return)',cost:4574.06,year:2024,method:'macrs',claimed:{2024:null}},
 {acct:'1330',desc:'Range 60" (B&G, 05/07/2024)',cost:3654.54,year:2024,method:'macrs'},
 {acct:'1330',desc:'Worktop freezer (B&G, 05/07/2024)',cost:1768.38,year:2024,method:'macrs'},
 {acct:'1330',desc:'Back bar refrigerated cabinet (B&G, 05/07/2024)',cost:3547.35,year:2024,method:'macrs'},
 {acct:'1330',desc:'Espresso machine (Whole Latte Love, 01/26/2024)',cost:455.81,year:2024,method:'expense'},
 {acct:'1330',desc:'Ice machine (02/09/2025)',cost:1000,year:2025,method:'expense'},
 {acct:'1330',desc:'Dishwasher (Total Restaurant Solutions, 08/09/2025)',cost:3143.75,year:2025,method:'macrs'},
 {acct:'1361',desc:'A/C repair (Central Cooling & Heating, 05/12/2023)',cost:1218.13,year:2023,method:'expense'},
 {acct:'1361',desc:'Shelving (Iron Abode, 02/12/2024)',cost:1252.95,year:2024,method:'expense'},
 {acct:'1361',desc:'Lumber/materials (Home Depot, Mar–Apr 2024, 4 purchases)',cost:497.17+323.17+127.25+240.91,year:2024,method:'expense'},
 {acct:'1361',desc:'Home Depot (06/24/2024)',cost:1198.96,year:2024,method:'expense'},
 {acct:'1361',desc:'Millwork/paint/materials (Home Depot, 06/26/2024)',cost:185.66,year:2024,method:'expense'},
]
const schedule=[] // {year,acct,desc,amount,basis}
for(const it of items){
  for(let y=it.year;y<=2025;y++){
    let a
    if(it.method==='expense') a=y===it.year?it.cost:0
    else a=it.cost*MACRS7[y-it.year]
    // 2024 return actually claimed $1,935 on the four 2024 MACRS items (basis $13,544); use that figure for 2024.
    if(a>0) schedule.push({year:y,acct:it.acct,desc:it.desc,amount:a,note:it.method==='macrs'?`7-yr MACRS yr ${y-it.year+1}`:'de minimis, expensed when placed in service'})
  }
}
// scale 2024 MACRS year-1 lines to the actual claimed 1,935
const y1_2024=schedule.filter(s=>s.year===2024&&s.note==='7-yr MACRS yr 1'&&s.desc.match(/Dishwasher \(B&G|Range|Worktop|Back bar/))
const sum24=y1_2024.reduce((s,x)=>s+x.amount,0)
for(const s of y1_2024) s.amount=s.amount*1935/sum24
// 2025 return claimed $3,317 on the same four 2024 items (24.49% of $13,544, incl. the since-retired dishwasher)
const y2_2025=schedule.filter(s=>s.year===2025&&s.note==='7-yr MACRS yr 2'&&s.desc.match(/Dishwasher \(B&G|Range|Worktop|Back bar/))
const sum25=y2_2025.reduce((t,x)=>t+x.amount,0)
for(const s of y2_2025) s.amount=s.amount*3317/sum25
for(const s of schedule) s.amount=r2(s.amount)
const RETIRED='Dishwasher (B&G, billed 10/20/2023'
const retiredCost=4574.06
const retiredLines=schedule.filter(s=>s.desc.startsWith(RETIRED))
const retiredAcc=r2(retiredLines.reduce((t,s)=>t+s.amount,0))
for(let i=schedule.length-1;i>=0;i--) if(schedule[i].desc.startsWith(RETIRED)) schedule.splice(i,1)
const retiredLoss=r2(retiredCost-retiredAcc)
const byYear={}; for(const s of schedule) byYear[s.year]=r2((byYear[s.year]||0)+s.amount)
const post21Equip=r2(schedule.filter(s=>s.acct==='1330').reduce((t,s)=>t+s.amount,0))
const post21Lease=r2(schedule.filter(s=>s.acct==='1361').reduce((t,s)=>t+s.amount,0))
const claimed={2016:20168,2017:32632,2018:20200,2019:12563,2020:11771,2021:74052}
const claimedTotal=Object.values(claimed).reduce((a,b)=>a+b,0)
// 2016 allocation rewritten per the Bill of Sale ($83,000 personal property): 1405 $2,000, 1320 $10,000, 1330 $73,000 (was 40,000 / 10,000 / 35,000)
// Cost through 2021 on the new split exceeds what the returns claimed by this amount; accountant agreed (2026-10-19) it is 2016 inventory, not equipment.
const inventoryWriteoff=r2(32394.05+59285.80+(73000+(51475.51-35000))-171386)
const cost={furn:32394.05,eq:r2(73000+(78436.76-35000)-retiredCost-inventoryWriteoff),lh:64330.00,lease:2000.00}
const eqThru21=51475.51, lhThru21=59285.80
// accumulated depreciation by asset account at 12/31/2025
const acc={
 furn:cost.furn,                          // fully depreciated
 lh:r2(lhThru21+post21Lease),             // fully depreciated
 eq:r2((claimedTotal-(cost.furn+lhThru21))+post21Equip), // rest of the 2016-21 claimed depreciation + 2022-25
 lease:0
}
const totalAcc=r2(acc.furn+acc.eq+acc.lh+acc.lease)
const totalCost=r2(cost.furn+cost.eq+cost.lh+cost.lease)
const nbv=r2(totalCost-totalAcc)
const nbvBy={furn:r2(cost.furn-acc.furn),eq:r2(cost.eq-acc.eq),lh:r2(cost.lh-acc.lh),lease:r2(cost.lease-acc.lease)}
export {inventoryWriteoff,retiredCost,retiredAcc,retiredLoss,schedule,byYear,claimed,claimedTotal,cost,acc,totalAcc,totalCost,nbv,nbvBy,post21Equip,post21Lease}
if(process.argv[1].endsWith('dep.mjs')){
 console.log({inventoryWriteoff,retiredCost,retiredAcc,retiredLoss,byYear,post21Equip,post21Lease,claimedTotal,acc,totalAcc,totalCost,nbv,nbvBy})
 const sub=Object.entries(byYear).reduce((s,[,v])=>s+v,0); console.log('post-2021 total',r2(sub))
 const OUT=new URL('../../reports/depreciation-catch-up/',import.meta.url).pathname
 const A={
  furn:'Furniture, Fixtures & Equipment (FFE):Accumulated Depreciation - Furniture & Fixtures (2263 Mass Ave)',
  eq:'Furniture, Fixtures & Equipment (FFE):Accumulated Depreciation - Kitchen Equipment (2263 Mass Ave)',
  lh:'Leasehold Improvements:Accumulated Depreciation - Mass Ave Leasehold Improvements',
  lease:'Intangible & Acquisition Assets:Accumulated Amortization - Leasehold Interest - 2263 Mass Ave'}
 const q=s=>'"'+s.replace(/"/g,'""')+'"'
 const memo='Catch-up depreciation 2016-2025, 2263 Mass Ave assets (prior-period adjustment)'
 const KE='Furniture, Fixtures & Equipment (FFE):Kitchen Equipment (Fixed Assets)'
 const debitTotal=r2(totalAcc+retiredCost+inventoryWriteoff)
 const rows=[['Journal No','Journal Date','Account','Debit Amount','Credit Amount','Description','Name'],
  ['DEP-CATCHUP-12-31-2025','12/31/25','Retained Earnings',debitTotal.toFixed(2),'',memo,''],
  ...['furn','eq','lh'].map(k=>['DEP-CATCHUP-12-31-2025','12/31/25',A[k],'',acc[k].toFixed(2),{furn:'Accumulated depreciation, furniture & fixtures',eq:'Accumulated depreciation, kitchen equipment',lh:'Accumulated depreciation, Mass Ave leasehold improvements',lease:'Accumulated amortization, leasehold interest'}[k],'']),
  ['DEP-CATCHUP-12-31-2025','12/31/25',KE,'',retiredCost.toFixed(2),'Retire high-temp dishwasher replaced 08/2025 (not part of sale)',''],
  ['DEP-CATCHUP-12-31-2025','12/31/25',KE,'',inventoryWriteoff.toFixed(2),'Write off 2016 inventory included in purchase price, never depreciable','']]
 fs.writeFileSync(OUT+'saasant-depreciation-catch-up-je.csv',rows.map(r=>r.map(c=>/[",]/.test(String(c))?q(String(c)):c).join(',')).join('\n')+'\n')
 const only=[['Journal No','Journal Date','Account','Debit Amount','Credit Amount','Description','Name'],
  ['INV-WRITEOFF-12-31-2025','12/31/25','Retained Earnings',inventoryWriteoff.toFixed(2),'','Write off 2016 inventory included in purchase price (never depreciable)',''],
  ['INV-WRITEOFF-12-31-2025','12/31/25',KE,'',inventoryWriteoff.toFixed(2),'Write off 2016 inventory included in purchase price (never depreciable)','']]
 fs.writeFileSync(OUT+'saasant-inventory-writeoff-only.csv',only.map(r=>r.map(c=>/[",]/.test(String(c))?q(String(c)):c).join(',')).join('\n')+'\n')
 // calculation schedule
 const sch=[['Year','Source','Asset account','Asset','Method / note','Amount']]
 for(const [y,v] of Object.entries(claimed)) sch.push([y,'Tax return (as filed)','All Mass Ave assets','2016–2021 depreciation per tax returns','As claimed',v.toFixed(2)])
 for(const s of schedule.sort((a,b)=>a.year-b.year||a.acct.localeCompare(b.acct))) sch.push([s.year,'Reconstructed',s.acct,s.desc,s.note,s.amount.toFixed(2)])
 sch.push(['2025','Disposal',  '1330','Retired dishwasher ($4,574.06 cost, replaced 08/09/2025): written off, not sold','Depreciation already claimed on it ('+retiredAcc.toFixed(2)+') is not booked; loss '+retiredLoss.toFixed(2),retiredCost.toFixed(2)])
 sch.push(['2016','Write-off','1330','Inventory included in the 2016 purchase price (accountant agreed 2026-10-19)','Cost never depreciated; not an asset to be sold',inventoryWriteoff.toFixed(2)])
 sch.push(['','','','','TOTAL accumulated depreciation booked through 12/31/2025',totalAcc.toFixed(2)])
 sch.push(['','','','','Debit to Retained Earnings (accumulated + retired dishwasher + 2016 inventory write-off)',debitTotal.toFixed(2)])
 fs.writeFileSync(OUT+'depreciation-catch-up-schedule.csv',sch.map(r=>r.map(c=>/[",]/.test(String(c))?q(String(c)):c).join(',')).join('\n')+'\n')
}
