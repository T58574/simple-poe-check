import type { UpdateCheckResult } from '../shared/types'

export const GITHUB_REPO_URL = 'https://github.com/T58574/simple-poe-check'
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
const LATEST_RELEASE_API = 'https://api.github.com/repos/T58574/simple-poe-check/releases/latest'

function parseSemverParts (version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, '').split('-')[0]
  return cleaned.split('.').map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  })
}

/** Returns -1 if current < latest, 0 if equal, 1 if current > latest. */
export function compareSemver (current: string, latest: string): number {
  const a = parseSemverParts(current)
  const b = parseSemverParts(latest)
  const len = Math.max(a.length, b.length, 3)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av < bv) return -1
    if (av > bv) return 1
  }
  return 0
}

export async function checkForUpdates (
  currentVersion: string,
  timeoutMs = 6000
): Promise<UpdateCheckResult> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `simple-poe-check/${currentVersion}`
      },
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (!res.ok) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: GITHUB_RELEASES_URL,
        error: `GitHub returned HTTP ${res.status}`
      }
    }

    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = typeof data.tag_name === 'string' ? data.tag_name.trim() : ''
    const latestVersion = tag.replace(/^v/i, '') || null
    const releaseUrl =
      typeof data.html_url === 'string' && data.html_url.startsWith('https://')
        ? data.html_url
        : GITHUB_RELEASES_URL

    if (!latestVersion) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl,
        error: 'No release tag found'
      }
    }

    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareSemver(currentVersion, latestVersion) < 0,
      releaseUrl
    }
  } catch (err) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: GITHUB_RELEASES_URL,
      error: err instanceof Error ? err.message : 'Network error'
    }
  }
}
