const fs = require('fs'), path = require('path'), os = require('os');
const file = path.join(os.homedir(), 'Desktop/fantasy-baseball/components/players/PlayerDrawer.tsx');
let src = fs.readFileSync(file, 'utf8');

const OLD = `  const tiles = useMemo(() => {
    if (!toolGrades) return []
    if (pitch) return [
      toolGrades.stuff!=null?{label:'STF+',val:toolGrades.stuff,color:toolColor(toolGrades.stuff),raw:toolGrades._raw?.stuff??null,conf:toolGrades._confidence?.stuff??null}:null,
      toolGrades.control!=null?{label:'CTL+',val:toolGrades.control,color:toolColor(toolGrades.control),raw:toolGrades._raw?.control??null,conf:toolGrades._confidence?.control??null}:null,
      toolGrades.overall!=null?{label:'OVR+',val:toolGrades.overall,color:toolColor(toolGrades.overall)}:null,
    ].filter(Boolean)
    return [
      toolGrades.hit!=null?{label:'HIT+',val:toolGrades.hit,color:toolColor(toolGrades.hit),raw:toolGrades._raw?.hit??null,conf:toolGrades._confidence?.hit??null}:null,
      toolGrades.power!=null?{label:'PWR+',val:toolGrades.power,color:toolColor(toolGrades.power),raw:toolGrades._raw?.power??null,conf:toolGrades._confidence?.power??null}:null,
      toolGrades.speed!=null?{label:'SPD+',val:toolGrades.speed,color:toolColor(toolGrades.speed),raw:toolGrades._raw?.speed??null,conf:toolGrades._confidence?.speed??null}:null,
      toolGrades.overall!=null?{label:'OVR+',val:toolGrades.overall,color:toolColor(toolGrades.overall)}:null,
    ].filter(Boolean)
  }, [toolGrades, pitch])`;

const NEW = `  const tiles = useMemo(() => {
    if (!toolGrades) return []
    // Hide raw ceiling + confidence for graduated players (blended tools)
    const isBlended = toolGrades._mlbSample != null
    const raw = (key: string) => isBlended ? null : (toolGrades._raw?.[key] ?? null)
    const conf = (key: string) => isBlended ? null : (toolGrades._confidence?.[key] ?? null)
    if (pitch) return [
      toolGrades.stuff!=null?{label:'STF+',val:toolGrades.stuff,color:toolColor(toolGrades.stuff),raw:raw('stuff'),conf:conf('stuff')}:null,
      toolGrades.control!=null?{label:'CTL+',val:toolGrades.control,color:toolColor(toolGrades.control),raw:raw('control'),conf:conf('control')}:null,
      toolGrades.overall!=null?{label:'OVR+',val:toolGrades.overall,color:toolColor(toolGrades.overall)}:null,
    ].filter(Boolean)
    return [
      toolGrades.hit!=null?{label:'HIT+',val:toolGrades.hit,color:toolColor(toolGrades.hit),raw:raw('hit'),conf:conf('hit')}:null,
      toolGrades.power!=null?{label:'PWR+',val:toolGrades.power,color:toolColor(toolGrades.power),raw:raw('power'),conf:conf('power')}:null,
      toolGrades.speed!=null?{label:'SPD+',val:toolGrades.speed,color:toolColor(toolGrades.speed),raw:raw('speed'),conf:conf('speed')}:null,
      toolGrades.overall!=null?{label:'OVR+',val:toolGrades.overall,color:toolColor(toolGrades.overall)}:null,
    ].filter(Boolean)
  }, [toolGrades, pitch])`;

if (!src.includes(OLD)) { console.error('OLD not found'); process.exit(1); }
src = src.replace(OLD, NEW);
fs.writeFileSync(file, src);
console.log('Done');
