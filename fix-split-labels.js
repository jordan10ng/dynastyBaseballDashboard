const fs = require('fs');
const f = process.env.HOME + '/Desktop/fantasy-baseball/components/players/PlayerDrawer.tsx';
let s = fs.readFileSync(f, 'utf8');

// Fix split labels to be pitcher-aware
s = s.replace(
  `const splitLabels:Record<string,string>={vl:'vs LHP',vr:'vs RHP',h:'Home',a:'Away'}`,
  `const splitLabels:Record<string,string>=pitch?{vl:'vs LHB',vr:'vs RHB',h:'Home',a:'Away'}:{vl:'vs LHP',vr:'vs RHP',h:'Home',a:'Away'}`
);

// Fix section header
s = s.replace(
  `<SectionHeader title="Splits — vs L/R · Home/Away"/>`,
  `<SectionHeader title={pitch?"Splits — vs LHB/RHB · Home/Away":"Splits — vs LHP/RHP · Home/Away"}/>`
);

if (!s.includes('vs LHB')) { console.error('patch failed'); process.exit(1); }
fs.writeFileSync(f, s);
console.log('done');
