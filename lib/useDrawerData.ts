import { useState, useEffect } from 'react'

export function useDrawerData() {
  const [statsMap, setStatsMap] = useState<Record<string, any>>({})
  const [mlbToolsMap, setMlbToolsMap] = useState<Record<string, any>>({})
  const [regression, setRegression] = useState<any>(null)
  const [norms, setNorms] = useState<any>(null)
  const [poolStats, setPoolStats] = useState<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/model/tools').then(r => r.json()),
      fetch('/api/model/regression').then(r => r.json()),
      fetch('/api/model/norms').then(r => r.json()),
      fetch('/api/model/pool-stats').then(r => r.json()),
    ]).then(([sd, td, reg, nor, ps]) => {
      setStatsMap(sd.stats ?? {})
      setMlbToolsMap(td.tools ?? {})
      setRegression(reg)
      setNorms(nor)
      setPoolStats(ps)
      setReady(true)
    })
  }, [])

  return { statsMap, mlbToolsMap, regression, norms, poolStats, ready }
}
