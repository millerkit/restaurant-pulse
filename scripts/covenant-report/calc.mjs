// Covenant report inputs, part 1: trailing 3-month per-space averages, cost shares and the covenant
// baseline, all hard-coded from a READ-ONLY look at production on 2026-10-19 (see CLAUDE.md,
// "Old-location asset sale: catch-up depreciation and the real gain"). To refresh the report, update
// the constants here, in calc2.mjs and at the top of gen.mjs, then run gen.mjs.
const areas=[['Dining Room',2941,277895.64,65],['Chef’s Counter',620,141225.05,62],['Bar',1031,65180.52,65],['Outdoor',449,33496.01,41],['Salon',367,13996.4,55]]
.map(([n,c,r,nt])=>({n,cpn:c/nt,pc:r/c,rev:r/nt,nights:nt}));
const C0=areas.reduce((s,a)=>s+a.cpn,0), R0=areas.reduce((s,a)=>s+a.rev,0), S0=R0/C0;
const rev=1904196.91,cogs=473420.61,labor=1041070.98,opex=542152.05;
const cogsPct=cogs/rev, opexVarPct=opex*0.39493348587363664/rev, cm=1-cogsPct-opexVarPct;
const laborVarPerCover=labor*0.6232834866893954/(C0*303);
const debt=89135.64, req=1.25*debt, gap=28634, base=req-gap;
const Nrest=60, Nfull=303;
const dE=(c,s,N)=>N*((C0+c)*(S0+s)*cm-C0*S0*cm-laborVarPerCover*c);
const ratio=(c,s,N)=>(base+dE(c,s,N))/debt;
const solveC=(target,N)=>{const need=target*debt-base;return need/(N*(S0*cm-laborVarPerCover))};
const solveS=(target,N)=>{const need=target*debt-base;return need/(N*C0*cm)};
export {areas,C0,R0,S0,cogsPct,opexVarPct,cm,laborVarPerCover,debt,req,gap,base,Nrest,Nfull,dE,ratio,solveC,solveS};
if(process.argv[1].endsWith('calc.mjs')){
console.log({C0,R0,S0,cogsPct,opexVarPct,cm,laborVarPerCover,req,base,baseRatio:base/debt});
for(const t of [1.25,1.35])for(const N of [Nrest,Nfull])console.log(t,N,'covers',solveC(t,N).toFixed(2),'spend',solveS(t,N).toFixed(2));
for(const a of areas)console.log(a.n,a.cpn.toFixed(1),a.pc.toFixed(2),a.rev.toFixed(0),'net/cover',(a.pc*cm-laborVarPerCover).toFixed(2));
for(const s of [0,2,4,6,8,10])console.log(s,[0,2,4,6,8,10,12].map(c=>ratio(c,s,Nrest).toFixed(2)).join(' '));
}
