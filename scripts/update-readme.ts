#!/usr/bin/env npx tsx
/**
 * ReadMeForge Daily Updater
 *
 * Reads profile.config.json and cache/stats.json,
 * fetches current GitHub stats, recalculates changed repos,
 * and regenerates README.md and assets/profile.svg.
 *
 * Runs inside the user profile repo via GitHub Actions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")

interface ProfileConfig {
  version: number
  github: { username: string; name?: string; avatarUrl?: string; profileUrl?: string }
  template: { type: string; theme: string }
  avatarEffect: { type: string; options: Record<string, unknown> }
  fields: {
    displayName: string; about?: string; os?: string; host?: string
    kernel?: string; ide?: string
    programmingLanguages: string[]; technologies: string[]
    spokenLanguages: string[]; softwareHobbies: string[]; hardwareHobbies: string[]
    contact: { email?: string; website?: string; twitter?: string; linkedin?: string }
  }
  dynamicStats: {
    enabled: boolean; includeFollowers: boolean; includeFollowing: boolean
    includeRepos: boolean; includeStars: boolean; includeCommits: boolean
    includeLoc: boolean; includeTopLanguages: boolean
  }
}

interface RepoEntry {
  nameWithOwner: string
  defaultBranch: string
  defaultBranchCommitCount: number
  stars: number
  userCommitCount: number
  additions: number
  deletions: number
  topLanguages: Record<string, number>
  lastCalculatedAt: string
}

interface StatsCache {
  version: number
  lastUpdated: string
  user: { username: string; followers: number; following: number; publicRepos: number }
  repositories: Record<string, RepoEntry>
  totals: { stars: number; commits: number; additions: number; deletions: number; netLoc: number; topLanguages: Record<string, number> }
}

function readJson(filePath: string) {
  if (!existsSync(filePath)) return null
  try { return JSON.parse(readFileSync(filePath, "utf-8")) }
  catch { return null }
}

function writeJson(filePath: string, data: unknown) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!|]/g, "\\$&")
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`
  return `${bytes}B`
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN environment variable is required")
  process.exit(1)
}

async function main() {
  const configPath = join(REPO_ROOT, "profile.config.json")
  const cachePath = join(REPO_ROOT, "cache", "stats.json")

  const config = readJson<ProfileConfig>(configPath)
  if (!config) {
    console.error("profile.config.json not found")
    process.exit(1)
  }

  let cache = readJson<StatsCache>(cachePath) || {
    version: 1, lastUpdated: "",
    user: { username: config.github.username, followers: 0, following: 0, publicRepos: 0 },
    repositories: {},
    totals: { stars: 0, commits: 0, additions: 0, deletions: 0, netLoc: 0, topLanguages: {} },
  }

  const username = config.github.username
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }

  async function api(path: string) {
    const res = await fetch(`https://api.github.com${path}`, { headers })
    if (!res.ok) {
      console.warn(`GitHub API warning: ${res.status} for ${path}`)
      return null
    }
    return res.json()
  }

  const userData = await api(`/users/${username}`) as any
  if (!userData) {
    console.error("Failed to fetch user data")
    return
  }

  const stats = {
    followers: userData.followers || 0,
    following: userData.following || 0,
    publicRepos: userData.public_repos || 0,
  }

  cache.user = { username, ...stats }

  const repos = await api(`/users/${username}/repos?per_page=100&type=public&sort=pushed`) as any[]
  let totalStars = 0
  const repoCache: Record<string, RepoEntry> = {}

  for (const repo of repos || []) {
    const fullName = repo.full_name
    const defaultBranch = repo.default_branch || "main"
    const stars = repo.stargazers_count || 0
    totalStars += stars

    const existing = cache.repositories[fullName]
    let commitCount = existing?.defaultBranchCommitCount || 0

    const branchData = await api(`/repos/${fullName}/branches/${defaultBranch}`) as any
    if (branchData?.commit) {
      const commitUrl = branchData.commit.url
      const commitInfo = await api(commitUrl.replace("https://api.github.com", "")) as any
      if (commitInfo?.commit) {
        const compare = await api(`/repos/${fullName}/compare/${existing?.defaultBranch || defaultBranch}...${defaultBranch}`) as any
        if (compare) commitCount = compare.total_commits || 0
      }
    }

    let userCommitCount = existing?.userCommitCount || 0
    let additions = existing?.additions || 0
    let deletions = existing?.deletions || 0
    let topLanguages = existing?.topLanguages || {}

    if (commitCount !== existing?.defaultBranchCommitCount) {
      const langData = await api(`/repos/${fullName}/languages`) as any
      if (langData) topLanguages = langData
    }

    repoCache[fullName] = {
      nameWithOwner: fullName, defaultBranch, defaultBranchCommitCount: commitCount,
      stars, userCommitCount, additions, deletions, topLanguages,
      lastCalculatedAt: new Date().toISOString(),
    }
  }

  const allTopLangs: Record<string, number> = {}
  for (const entry of Object.values(repoCache)) {
    for (const [lang, bytes] of Object.entries(entry.topLanguages)) {
      allTopLangs[lang] = (allTopLangs[lang] || 0) + (bytes as number)
    }
  }

  cache.lastUpdated = new Date().toISOString()
  cache.repositories = repoCache
  cache.totals = {
    stars: totalStars,
    commits: Object.values(repoCache).reduce((a, r) => a + r.userCommitCount, 0),
    additions: Object.values(repoCache).reduce((a, r) => a + r.additions, 0),
    deletions: Object.values(repoCache).reduce((a, r) => a + r.deletions, 0),
    netLoc: Object.values(repoCache).reduce((a, r) => a + r.additions - r.deletions, 0),
    topLanguages: allTopLangs,
  }

  // Generate README.md
  const readmeLines: string[] = []
  const push = (s: string) => readmeLines.push(s)

  push('<picture>')
  push('  <source media="(prefers-color-scheme: dark)" srcset="assets/profile.svg">')
  push('  <source media="(prefers-color-scheme: light)" srcset="assets/profile.svg">')
  push('  <img alt="GitHub profile terminal card" src="assets/profile.svg">')
  push('</picture>')
  push('')
  push('---')
  push('')
  push('<!--')
  push('  This README is dynamically generated by ReadMeForge.')
  push('  Do not edit directly.')
  push('-->')
  push('')
  push('## Terminal Profile')
  push('')
  push('```')
  push(` ##### ${escapeMd(config.fields.displayName || username)}`)
  push(` OS:     ${escapeMd(config.fields.os || 'unknown')}`)
  push(` Host:   ${escapeMd(config.fields.host || 'github.com')}`)
  push(` Kernel: ${escapeMd(config.fields.kernel || 'unknown')}`)
  push(` IDE:    ${escapeMd(config.fields.ide || 'unknown')}`)
  push('```')
  push('')

  if (config.fields.about) {
    push(escapeMd(config.fields.about))
    push('')
  }

  push('### Languages & Tools')
  if (config.fields.programmingLanguages.length > 0) {
    push('**Programming:** ' + config.fields.programmingLanguages.map(l => '`' + escapeMd(l) + '`').join(', '))
  }
  if (config.fields.technologies.length > 0) {
    push('**Technologies:** ' + config.fields.technologies.map(t => '`' + escapeMd(t) + '`').join(', '))
  
  }
  if (config.fields.spokenLanguages.length > 0) {
    push('**Spoken:** ' + config.fields.spokenLanguages.join(', '))
  }
  push('')

  if (config.dynamicStats.enabled) {
    push('### GitHub Stats')
    push('```')
    if (config.dynamicStats.includeFollowers) push(`  Followers: ${cache.user.followers}`)
    if (config.dynamicStats.includeFollowing) push(`  Following: ${cache.user.following}`)
    if (config.dynamicStats.includeRepos) push(`  Public repos: ${cache.user.publicRepos}`)
    if (config.dynamicStats.includeStars) push(`  Total stars: ${cache.totals.stars}`)
    if (config.dynamicStats.includeCommits && cache.totals.commits > 0) push(`  Total commits: ${cache.totals.commits.toLocaleString()}`)
    if (config.dynamicStats.includeLoc && cache.totals.netLoc > 0) {
      push(`  LOC added: ${cache.totals.additions.toLocaleString()}`)
      push(`  LOC deleted: ${cache.totals.deletions.toLocaleString()}`)
      push(`  Net LOC: ${cache.totals.netLoc.toLocaleString()}`)
    }
    if (config.dynamicStats.includeTopLanguages) {
      const langs = Object.entries(allTopLangs).sort(([,a], [,b]) => b - a).slice(0, 5)
      if (langs.length > 0) {
        push('  Top languages:')
        for (const [lang, bytes] of langs) push(`    - ${escapeMd(lang)} (${formatBytes(bytes)})`)
      }
    }
    push('```')
    push('')
  }

  push('---')
  push('Generated by ReadMeForge - profile updates daily.')

  writeFileSync(join(REPO_ROOT, "README.md"), readmeLines.join("\n"))
  writeJson(cachePath, cache)

  // Regenerate SVG (simplified)
  const bg = "#0d1117"
  const fg = "#c9d1d9"
  const accent = "#58a6ff"
  const dim = "#8b949e"
  const sectionBg = "#161b22"

  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100%" viewBox="0 0 800 400">`,
    `<rect width="800" height="100%" fill="${bg}" rx="12" />`,
    `<text x="30" y="50" fill="${fg}" font-family="monospace" font-size="22" font-weight="bold">${escapeMd(config.fields.displayName || username)}</text>`,
    `<text x="30" y="76" fill="${accent}" font-family="monospace" font-size="14">@${username}</text>`,
  ]

  let sy = 100
  const fields: [string, string | undefined][] = [
    ["OS", config.fields.os], ["Host", config.fields.host],
    ["Kernel", config.fields.kernel], ["IDE", config.fields.ide],
  ]
  for (const [label, value] of fields) {
    if (value) {
      svgParts.push(`<text x="30" y="${sy}" fill="${dim}" font-family="monospace" font-size="13">${label}:</text>`)
      svgParts.push(`<text x="110" y="${sy}" fill="${fg}" font-family="monospace" font-size="13">${value}</text>`)
      sy += 18
    }
  }

  if (config.dynamicStats.enabled) {
    sy += 10
    svgParts.push(`<text x="30" y="${sy}" fill="${accent}" font-family="monospace" font-size="15" font-weight="bold">Stats</text>`)
    sy += 24

    const items: [string, string | number][] = []
    if (config.dynamicStats.includeFollowers) items.push(["Followers", cache.user.followers])
    if (config.dynamicStats.includeFollowing) items.push(["Following", cache.user.following])
    if (config.dynamicStats.includeRepos) items.push(["Repos", cache.user.publicRepos])
    if (config.dynamicStats.includeStars) items.push(["Stars", cache.totals.stars])

    const bw = items.length > 0 ? Math.floor((740 - 12 * (items.length - 1)) / items.length) : 0
    for (let i = 0; i < items.length; i++) {
      const sx = 30 + i * (bw + 12)
      svgParts.push(`<rect x="${sx}" y="${sy}" width="${bw}" height="54" rx="6" fill="${sectionBg}" />`)
      svgParts.push(`<text x="${sx + bw/2}" y="${sy + 24}" fill="${dim}" font-family="monospace" font-size="11" text-anchor="middle">${items[i][0]}</text>`)
      svgParts.push(`<text x="${sx + bw/2}" y="${sy + 44}" fill="${fg}" font-family="monospace" font-size="16" font-weight="bold" text-anchor="middle">${items[i][1]}</text>`)
    }
    sy += 72
  }

  sy += 10
  svgParts.push(`<text x="30" y="${sy}" fill="${dim}" font-family="monospace" font-size="10">Generated by ReadMeForge - Updates daily</text>`)
  svgParts.push("</svg>")

  const svg = svgParts.join("\n")

  const assetsDir = join(REPO_ROOT, "assets")
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(assetsDir, "profile.svg"), svg)

  console.log("Profile README and stats updated successfully")
}

main().catch((err) => {
  console.error("Update failed:", err)
  process.exit(1)
})