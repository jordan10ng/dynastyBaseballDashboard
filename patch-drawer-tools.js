const fs = require('fs'), path = require('path'), os = require('os');
const file = path.join(os.homedir(), 'Desktop/fantasy-baseball/components/players/PlayerDrawer.tsx');
let src = fs.readFileSync(file, 'utf8');

const NEW_BLOCK = `  const toolGrades = useMemo(() => {
    const mlbEntry = mlbamId ? mlbToolsMap[String(mlbamId)] : null
    const model = player.model_scores
    const withOvr = (t: any) => {
      if (t.overall != null) return t
      const isPit = t.type === 'pitcher'
      let overall = null
      if (isPit && t.stuff!=null && t.control!=null) overall=Math.round(t.stuff*0.70+t.control*0.30)
      else if (!isPit && t.hit!=null && t.power!=null && t.speed!=null) overall=Math.round(t.hit*0.42+t.power*0.47+t.speed*0.11)
      else if (!isPit && t.hit!=null && t.power!=null) overall=Math.round((t.hit*0.42+t.power*0.47)/0.89)
      return { ...t, overall }
    }
    if (!mlbEntry) return model ?? null
    if (!model) return withOvr(mlbEntry)
    const mlbSample = mlbEntry._pa ?? mlbEntry._bf ?? 0
    const milbSample = model._sample ?? 0
    const total = mlbSample + milbSample
    if (total === 0) return withOvr(mlbEntry)
    const mlbW = mlbSample / total
    const milbW = milbSample / total
    const bv = (a: any, b: any) => a == null && b == null ? null : a == null ? b : b == null ? a : Math.round(a*mlbW + b*milbW)
    const isPit = mlbEntry.type === 'pitcher'
    if (isPit) {
      const stuff = bv(mlbEntry.stuff, model.stuff)
      const control = bv(mlbEntry.control, model.control)
      const overall = stuff != null && control != null ? Math.round(stuff*0.70+control*0.30) : null
      return { stuff, control, overall, type: 'pitcher', _raw: model._raw, _confidence: model._confidence, _sample: milbSample, _mlbSample: mlbSample }
    } else {
      const hit   = bv(mlbEntry.hit,   model.hit)
      const power = bv(mlbEntry.power, model.power)
      const speed = bv(mlbEntry.speed, model.speed)
      const overall = hit != null && power != null && speed != null ? Math.round(hit*0.42+power*0.47+speed*0.11) : null
      return { hit, power, speed, overall, type: 'hitter', _raw: model._raw, _confidence: model._confidence, _sample: milbSample, _mlbSample: mlbSample }
    }
  }, [mlbamId, mlbToolsMap, player.model_scores])`;

// Replace from the useMemo start to the closing ], [...])
src = src.replace(
  /  const toolGrades = useMemo\(\(\) => \{[\s\S]*?\}, \[mlbamId, mlbToolsMap, player\.model_scores\]\)/,
  NEW_BLOCK
);

fs.writeFileSync(file, src);
console.log('Done. Verify:');
const check = fs.readFileSync(file, 'utf8');
const idx = check.indexOf('const toolGrades = useMemo');
console.log(check.slice(idx, idx + 200));
