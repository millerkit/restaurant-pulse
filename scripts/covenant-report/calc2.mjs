// Covenant report inputs, part 2: Nov-Dec scenario math (budgeted covers per space, value of one more
// cover). Imports calc.mjs. Hard-coded from production on 2026-10-19.
import {areas,cm,laborVarPerCover,debt,req,gap,base} from './calc.mjs'
// Nov-Dec operating nights: Tue-Sun minus 2 holiday closures each month (capacity_seasonality)
const nightsIn=(y,m)=>{let n=0;const d=new Date(Date.UTC(y,m,0)).getUTCDate();for(let i=1;i<=d;i++)if(new Date(Date.UTC(y,m-1,i)).getUTCDay()!==1)n++;return n-2}
const nov=nightsIn(2026,11), dec=nightsIn(2026,12), N=nov+dec
const pc=Object.fromEntries(areas.map(a=>[a.n,a.pc]))
const val=n=>pc[n]*cm-laborVarPerCover   // EBITDA per extra cover
const per1=n=>val(n)*N                    // +1 cover every night, Nov-Dec
const plan={'Chef’s Counter':[10,10],'Dining Room':[46,56],'Bar':[20,20],'Salon':[6,7]}
const planAvg=n=>(plan[n][0]*nov+plan[n][1]*dec)/N
const spendVal=(n,dollars,extraCovers=0)=>dollars*(planAvg(n)+extraCovers)*N*cm
const ratio=v=>(base+v)/debt
export {nov,dec,N,pc,val,per1,plan,planAvg,spendVal,ratio,gap,base,debt,req,cm,laborVarPerCover}
if(process.argv[1].endsWith('calc2.mjs')){
 console.log({nov,dec,N})
 for(const n of Object.keys(plan))console.log(n,'val',val(n).toFixed(2),'per1',per1(n).toFixed(0),'planAvg',planAvg(n).toFixed(1))
 console.log('dining only needs',(gap/per1('Dining Room')).toFixed(1))
 console.log('chef12',2*per1('Chef’s Counter'),'chef11+1+1',per1('Chef’s Counter')+per1('Dining Room')+per1('Bar'))
 console.log('chef12+din10',2*per1('Chef’s Counter')+10*per1('Dining Room'))
 console.log('chef12+din8+bar4',2*per1('Chef’s Counter')+8*per1('Dining Room')+4*per1('Bar'))
 console.log('chef12+din6+$5din',2*per1('Chef’s Counter')+6*per1('Dining Room')+spendVal('Dining Room',5,6))
 console.log('spend: chef+10',spendVal('Chef’s Counter',10),'din+5',spendVal('Dining Room',5),'bar+5',spendVal('Bar',5),'salon+5',spendVal('Salon',5))
 console.log('full-year chef +2', 2*val('Chef’s Counter')*303*62/65)
}
