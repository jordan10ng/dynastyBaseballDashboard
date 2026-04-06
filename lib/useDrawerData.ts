import { useState, useEffect } from 'react'

export function useDrawerData() {
  const [statsMap, setStatsMap] = useState<Record<string, any>>({})
  const [mlbToolsMap, setMlbToolsMap] = useState<Record<string, any>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/model/tools').then(r => r.json()),
    ]).then(([sd, td]) => {
      setStatsMap(sd.stats ?? {})
      setMlbToolsMap(td.tools ?? {})
      setReady(true)
    })
  }, [])

  return { statsMap, mlbToolsMap, ready }
}
