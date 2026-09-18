// TEMPORARY — Arizona Fall League tag, remove after AFL ends.
// Delete this file + data/afl-2026.json + the "AFL" toggle in app/players/page.tsx to fully remove.
import aflRoster from '@/data/afl-2026.json'

const normalize = (name: string) =>
  name.toLowerCase().replace(/[^a-z]/g, '')

const aflNames = new Set(aflRoster.map((p: { name: string }) => normalize(p.name)))

export function isAFLPlayer(name: string | null | undefined): boolean {
  if (!name) return false
  return aflNames.has(normalize(name))
}
