/**
 * blendTools — for graduated players, blend MiLB model_scores with MLB actuals
 * weighted by sample size. For prospects, returns model_scores as-is.
 */

const HITTER_WEIGHTS = { hit: 0.42, power: 0.47, speed: 0.11 }
const PITCHER_WEIGHTS = { stuff: 0.70, control: 0.30 }

export function blendTools(player: any, mlbToolsMap: Record<string, any>): any {
  const mlbamId = player.mlbam_id
  const mlbEntry = mlbamId ? mlbToolsMap[String(mlbamId)] : null
  const model = player.model_scores

  // No MLB entry — pure prospect, return model scores
  if (!mlbEntry) return model ?? null

  // Has MLB entry but no model scores — fall back to MLB tools only
  if (!model) {
    return withOverall(mlbEntry)
  }

  const isPit = mlbEntry.type === 'pitcher'
  const mlbSample = mlbEntry._pa ?? mlbEntry._bf ?? 0
  const milbSample = model._sample ?? 0
  const total = mlbSample + milbSample
  if (total === 0) return withOverall(mlbEntry)

  const mlbW = mlbSample / total
  const milbW = milbSample / total

  if (isPit) {
    const stuff   = blend(mlbEntry.stuff,   model.stuff,   mlbW, milbW)
    const control = blend(mlbEntry.control, model.control, mlbW, milbW)
    const overall = stuff != null && control != null
      ? Math.round(stuff * 0.70 + control * 0.30) : null
    return { stuff, control, overall, type: 'pitcher',
      _raw: model._raw, _confidence: model._confidence, _sample: milbSample,
      _mlbSample: mlbSample }
  } else {
    const hit   = blend(mlbEntry.hit,   model.hit,   mlbW, milbW)
    const power = blend(mlbEntry.power, model.power, mlbW, milbW)
    const speed = blend(mlbEntry.speed, model.speed, mlbW, milbW)
    const overall = hit != null && power != null && speed != null
      ? Math.round(hit * 0.42 + power * 0.47 + speed * 0.11) : null
    return { hit, power, speed, overall, type: 'hitter',
      _raw: model._raw, _confidence: model._confidence, _sample: milbSample,
      _mlbSample: mlbSample }
  }
}

function blend(mlbVal: number | null | undefined, milbVal: number | null | undefined, mlbW: number, milbW: number): number | null {
  if (mlbVal == null && milbVal == null) return null
  if (mlbVal == null) return milbVal ?? null
  if (milbVal == null) return mlbVal ?? null
  return Math.round(mlbVal * mlbW + milbVal * milbW)
}

function withOverall(t: any): any {
  if (t.overall != null) return t
  const isPit = t.type === 'pitcher'
  let overall = null
  if (isPit && t.stuff != null && t.control != null)
    overall = Math.round(t.stuff * 0.70 + t.control * 0.30)
  else if (!isPit && t.hit != null && t.power != null && t.speed != null)
    overall = Math.round(t.hit * 0.42 + t.power * 0.47 + t.speed * 0.11)
  return { ...t, overall }
}
