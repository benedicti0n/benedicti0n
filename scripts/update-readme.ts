#!/usr/bin/env npx tsx
/**
 * GitHubWallpaper Daily Updater
 *
 * Reads profile.config.json and cache/stats.json,
 * fetches current GitHub stats, recalculates changed repos,
 * and regenerates dark_mode.svg and light_mode.svg.
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
    includeLoc: boolean; includeTopLanguages: boolean; includeContributedRepos: boolean
  }
}

interface StatsCache {
  version: number
  lastUpdated: string
  user: { username: string; followers: number; following: number; publicRepos: number; contributedRepos: number }
  repositories: Record<string, {
    nameWithOwner: string; defaultBranch: string; defaultBranchOid: string
    defaultBranchCommitCount: number; stars: number
    userCommitCount: number; additions: number; deletions: number
    topLanguages: Record<string, number>; lastCalculatedAt: string
  }>
  totals: { stars: number; commits: number; additions: number; deletions: number; netLoc: number; topLanguages: Record<string, number> }
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try { return JSON.parse(readFileSync(filePath, "utf-8")) }
  catch { return null }
}

function writeJson(filePath: string, data: unknown) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const darkPalette = { bg: "#0d1117", card: "#161b22", border: "#30363d", text: "#c9d1d9", muted: "#8b949e", label: "#ffa657", value: "#79c0ff", green: "#3fb950", red: "#f85149", purple: "#d2a8ff", yellow: "#d29922" }
const lightPalette = { bg: "#ffffff", card: "#f6f8fa", border: "#d0d7de", text: "#24292f", muted: "#57606a", label: "#bc4c00", value: "#0969da", green: "#1a7f37", red: "#cf222e", purple: "#8250df", yellow: "#9a6700" }

function leader(label: string, target: number, valLen: number) {
  const dotsNeeded = Math.max(2, target - label.length - valLen)
  return { dots: ".".repeat(dotsNeeded) }
}

function makeRow(label: string, value: string, labelC: string, valC: string, x: number, y: number, fs: number, cw: number) {
  const dotsTarget = 42
  const l = leader(label, dotsTarget, value.length)
  return [`<text x="${x}" y="${y}" fill="${labelC}" font-family="${FONT}" font-size="${fs}">${esc(label)}</text>`,
    `<text x="${x + label.length * cw}" y="${y}" fill="${labelC}" font-family="${FONT}" font-size="${fs}" opacity="0.3">${esc(l.dots)}</text>`,
    `<text x="${x + (label.length + l.dots.length) * cw}" y="${y}" fill="${valC}" font-family="${FONT}" font-size="${fs}">${esc(value)}</text>`].join("\n")
}

function makeCompactRow(leftLabel: string, leftVal: string, rightLabel: string, rightVal: string, labelC: string, valC: string, x: number, y: number, fs: number, cw: number) {
  const leftText = `${leftLabel} ${leftVal}`
  const rightText = `${rightLabel} ${rightVal}`
  const maxChars = 58
  const dotsLen = Math.max(1, maxChars - (leftText.length + rightText.length))
  const rx = x + (maxChars - rightText.length) * cw
  return [`<text x="${x}" y="${y}" fill="${labelC}" font-family="${FONT}" font-size="${fs}">${esc(leftLabel)}</text>`,
    `<text x="${x + leftLabel.length * cw}" y="${y}" fill="${valC}" font-family="${FONT}" font-size="${fs}">${esc(" " + leftVal)}</text>`,
    `<text x="${x + leftText.length * cw}" y="${y}" fill="${labelC}" font-family="${FONT}" font-size="${fs}" opacity="0.3">${esc(".".repeat(dotsLen))}</text>`,
    `<text x="${rx}" y="${y}" fill="${labelC}" font-family="${FONT}" font-size="${fs}">${esc(" " + rightLabel)}</text>`,
    `<text x="${rx + rightLabel.length * cw}" y="${y}" fill="${valC}" font-family="${FONT}" font-size="${fs}">${esc(" " + rightVal)}</text>`].join("\n")
}

function sectionHeader(label: string, color: string, x: number, y: number, fs: number, cw: number) {
  const dashLen = Math.max(3, 52 - label.length)
  return [`<text x="${x}" y="${y}" fill="${color}" font-family="${FONT}" font-size="${fs}" font-weight="700">${esc(label)}</text>`,
    `<text x="${x + label.length * cw}" y="${y}" fill="${color}" font-family="${FONT}" font-size="${fs}" opacity="0.3">${esc(" " + "─".repeat(dashLen))}</text>`].join("\n")
}

function buildSvg(config: ProfileConfig, stats: StatsCache, p: typeof darkPalette): string {
  const W = 1000, pad = 16, cw = 8, fs = 14
  let y = 46
  const parts: string[] = []

  parts.push(`<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="100%" rx="14" fill="${p.card}" stroke="${p.border}" stroke-width="1" />`)

  const headerText = `${config.fields.displayName || config.github.username}@github`
  const headerDashes = "─".repeat(Math.max(3, 52 - headerText.length))
  parts.push(`<text x="410" y="${y}" fill="${p.text}" font-family="${FONT}" font-size="15" font-weight="700">${esc(headerText)}</text>`)
  parts.push(`<text x="${410 + headerText.length * 9}" y="${y}" fill="${p.muted}" font-family="${FONT}" font-size="15">${esc(" " + headerDashes)}</text>`)
  y += 24

  const sysFields: [string, string | undefined][] = [
    ["OS:", config.fields.os], ["Host:", config.fields.host],
    ["Kernel:", config.fields.kernel], ["IDE:", config.fields.ide],
  ]
  for (const [label, value] of sysFields) {
    if (value) { parts.push(makeRow(label, value, p.label, p.value, 410, y, fs, cw)); y += 20 }
  }

  const pl = config.fields.programmingLanguages
  const tc = config.fields.technologies
  const sp = config.fields.spokenLanguages
  if (pl.length > 0 || tc.length > 0 || sp.length > 0) {
    y += 4
    parts.push(sectionHeader("Languages", p.text, 410, y, fs, cw))
    y += 20
  }
  if (pl.length > 0) { parts.push(makeRow("Languages.Programming:", pl.join(", "), p.label, p.value, 410, y, fs, cw)); y += 20 }
  if (tc.length > 0) { parts.push(makeRow("Languages.Computer:", tc.join(", "), p.label, p.value, 410, y, fs, cw)); y += 20 }
  if (sp.length > 0) { parts.push(makeRow("Languages.Real:", sp.join(", "), p.label, p.value, 410, y, fs, cw)); y += 20 }

  const sw = config.fields.softwareHobbies
  const hw = config.fields.hardwareHobbies
  if (sw.length > 0 || hw.length > 0) {
    y += 4
    parts.push(sectionHeader("Hobbies", p.text, 410, y, fs, cw))
    y += 20
    if (sw.length > 0) { parts.push(makeRow("Hobbies.Software:", sw.join(", "), p.label, p.value, 410, y, fs, cw)); y += 20 }
    if (hw.length > 0) { parts.push(makeRow("Hobbies.Hardware:", hw.join(", "), p.label, p.value, 410, y, fs, cw)); y += 20 }
  }

  const c = config.fields.contact
  if (c.email || c.website || c.twitter || c.linkedin) {
    y += 4
    parts.push(sectionHeader("Contact", p.text, 410, y, fs, cw))
    y += 20
  }
  if (c.email) { parts.push(makeRow("Email:", c.email, p.label, p.value, 410, y, fs, cw)); y += 20 }
  if (c.website) { parts.push(makeRow("Website:", c.website, p.label, p.value, 410, y, fs, cw)); y += 20 }
  if (c.twitter) { parts.push(makeRow("Twitter:", c.twitter, p.label, p.value, 410, y, fs, cw)); y += 20 }
  if (c.linkedin) { parts.push(makeRow("LinkedIn:", c.linkedin, p.label, p.value, 410, y, fs, cw)); y += 20 }

  if (config.dynamicStats.enabled) {
    y += 4
    parts.push(sectionHeader("GitHub Stats", p.text, 410, y, fs, cw))
    y += 20

    if (config.dynamicStats.includeRepos && config.dynamicStats.includeStars) {
      parts.push(makeCompactRow("Repos:", `${stats.user.publicRepos}`, "Stars:", `${stats.totals.stars}`, p.label, p.yellow, 410, y, fs, cw))
      y += 20
    } else {
      if (config.dynamicStats.includeRepos) { parts.push(makeRow("Repos:", `${stats.user.publicRepos}`, p.label, p.yellow, 410, y, fs, cw)); y += 20 }
      if (config.dynamicStats.includeStars) { parts.push(makeRow("Stars:", `${stats.totals.stars}`, p.label, p.yellow, 410, y, fs, cw)); y += 20 }
    }

    if (config.dynamicStats.includeContributedRepos && stats.user.contributedRepos > 0) {
      parts.push(makeRow("Contributed:", `${stats.user.contributedRepos}`, p.label, p.yellow, 410, y, fs, cw))
      y += 20
    }

    if (config.dynamicStats.includeCommits && config.dynamicStats.includeFollowers) {
      parts.push(makeCompactRow("Commits:", stats.totals.commits.toLocaleString(), "Followers:", `${stats.user.followers}`, p.label, p.value, 410, y, fs, cw))
      y += 20
    } else {
      if (config.dynamicStats.includeCommits) { parts.push(makeRow("Commits:", stats.totals.commits.toLocaleString(), p.label, p.value, 410, y, fs, cw)); y += 20 }
      if (config.dynamicStats.includeFollowers) { parts.push(makeRow("Followers:", `${stats.user.followers}`, p.label, p.value, 410, y, fs, cw)); y += 20 }
    }

    if (config.dynamicStats.includeLoc) {
      const addV = (stats.totals.additions ?? 0).toLocaleString()
      const delV = (stats.totals.deletions ?? 0).toLocaleString()
      const netV = (stats.totals.netLoc ?? 0).toLocaleString()
      const label = "Lines of Code on GitHub:"
      parts.push(makeRow(label, `${netV} net`, p.label, p.green, 410, y, fs, cw))
      y += 20
      const indentW = label.length * cw + 2 * cw
      parts.push(`<text x="${410 + label.length * cw + cw}" y="${y}" fill="${p.green}" font-family="${FONT}" font-size="${fs}">${esc("+" + addV)}</text>`)
      parts.push(`<text x="${410 + label.length * cw + cw + (addV.length + 1) * cw + cw}" y="${y}" fill="${p.red}" font-family="${FONT}" font-size="${fs}">${esc("-" + delV)}</text>`)
      y += 20
    }

    if (config.dynamicStats.includeTopLanguages) {
      const langs = Object.entries(stats.totals.topLanguages)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 5)
      if (langs.length > 0) {
        const langStr = langs.map(([l]) => l).join(", ")
        parts.push(makeRow("Top Languages:", langStr, p.label, p.purple, 410, y, fs, cw))
        y += 20
      }
    }
  }

  y += 6
  const h = y + pad
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" fill="none">`,
    ...parts,
    "</svg>",
  ].join("\n")
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN environment variable is required")
  process.exit(1)
}

interface RepoInfo {
  nameWithOwner: string; owner: string; name: string
  defaultBranchName: string; defaultBranchOid: string
  defaultBranchTotalCommits: number; stars: number
  languages: Record<string, number>
}

interface ContributorEntry {
  author?: { login?: string }; total?: number; weeks?: { a: number; d: number; w: number; c: number }[]
}

async function fetchUserCommitCount(owner: string, repoName: string, username: string, token: string): Promise<number> {
  const url = `https://api.github.com/repos/${owner}/${repoName}/commits?author=${username}&per_page=1`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "githubwallpaper" } })
  if (!res.ok) return 0
  const linkHeader = res.headers.get("link")
  if (!linkHeader) return 0
  const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/)
  if (lastMatch) return parseInt(lastMatch[1], 10)
  return 0
}

async function fetchUserContributorStats(owner: string, repoName: string, username: string, token: string): Promise<{additions:number; deletions:number}> {
  const url = `https://api.github.com/repos/${owner}/${repoName}/stats/contributors`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json", "User-Agent": "githubwallpaper" } })
    if (res.status === 202) { await new Promise(r => setTimeout(r, 1000)); continue }
    if (!res.ok) return {additions:0, deletions:0}
    const data = (await res.json()) as ContributorEntry[]
    const userEntry = data.find(e => e.author?.login === username)
    if (!userEntry || !userEntry.weeks) return {additions:0, deletions:0}
    let add = 0, del = 0
    for (const w of userEntry.weeks) { add += w.a || 0; del += w.d || 0 }
    return {additions: add, deletions: del}
  }
  return {additions:0, deletions:0}
}

async function main() {
  const configPath = join(REPO_ROOT, "profile.config.json")
  const cachePath = join(REPO_ROOT, "cache", "stats.json")

  const config = readJson<ProfileConfig>(configPath)
  if (!config) { console.error("profile.config.json not found"); process.exit(1) }

  let cache = readJson<StatsCache>(cachePath) || {
    version: 1, lastUpdated: "",
    user: { username: config.github.username, followers: 0, following: 0, publicRepos: 0, contributedRepos: 0 },
    repositories: {},
    totals: { stars: 0, commits: 0, additions: 0, deletions: 0, netLoc: 0, topLanguages: {} },
  }

  const username = config.github.username
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }

  async function api(path: string) {
    const res = await fetch(`https://api.github.com${path}`, { headers })
    if (!res.ok) { console.warn(`GitHub API warning: ${res.status} for ${path}`); return null }
    return res.json()
  }

  const userData = await api(`/users/${username}`) as Record<string, unknown>
  if (!userData) { console.error("Failed to fetch user data"); return }

  cache.user = {
    username,
    followers: (userData.followers as number) || 0,
    following: (userData.following as number) || 0,
    publicRepos: (userData.public_repos as number) || 0,
    contributedRepos: cache.user.contributedRepos || 0,
  }

  const repos = (await api(`/users/${username}/repos?per_page=100&type=public&sort=pushed`)) as Record<string, unknown>[]

  let totalStars = 0
  const allLanguages: Record<string, number> = {}
  const updatedRepos: Record<string, unknown> = { ...cache.repositories }
  let totalCommits = 0, totalAdditions = 0, totalDeletions = 0

  for (const repo of repos || []) {
    const nameWithOwner = repo.full_name as string
    totalStars += (repo.stargazers_count as number) || 0

    const prev = cache.repositories[nameWithOwner]
    const defaultBranchOid = repo.default_branch as string || "main"
    const pushedAt = repo.pushed_at as string || ""

    if (prev && prev.defaultBranchOid === defaultBranchOid) {
      updatedRepos[nameWithOwner] = prev
      totalCommits += prev.userCommitCount || 0
      totalAdditions += prev.additions || 0
      totalDeletions += prev.deletions || 0
      for (const [lang, size] of Object.entries(prev.topLanguages || {})) {
        allLanguages[lang] = (allLanguages[lang] || 0) + (size as number)
      }
      continue
    }

    const [owner, name] = nameWithOwner.split("/")
    let commitCount = 0, additions = 0, deletions = 0

    try { commitCount = await fetchUserCommitCount(owner, name, username, GITHUB_TOKEN) }
    catch { commitCount = 0 }

    if (commitCount > 0) {
      try { const loc = await fetchUserContributorStats(owner, name, username, GITHUB_TOKEN); additions = loc.additions; deletions = loc.deletions }
      catch { /* LOC unavailable */ }
    }

    totalCommits += commitCount
    totalAdditions += additions
    totalDeletions += deletions

    updatedRepos[nameWithOwner] = {
      nameWithOwner, defaultBranch: defaultBranchOid, defaultBranchOid,
      defaultBranchCommitCount: 0, stars: repo.stargazers_count || 0,
      userCommitCount: commitCount, additions, deletions,
      topLanguages: {}, lastCalculatedAt: new Date().toISOString(),
    }
  }

  cache.totals = {
    stars: totalStars,
    commits: totalCommits,
    additions: totalAdditions,
    deletions: totalDeletions,
    netLoc: totalAdditions - totalDeletions,
    topLanguages: allLanguages,
  }
  cache.repositories = updatedRepos as StatsCache["repositories"]
  cache.lastUpdated = new Date().toISOString()

  // Regenerate README.md (SVG wrapper only)
  const readme = [
    "<picture>",
    '  <source media="(prefers-color-scheme: dark)" srcset="dark_mode.svg">',
    '  <source media="(prefers-color-scheme: light)" srcset="light_mode.svg">',
    '  <img alt="Dynamic GitHub profile README" src="dark_mode.svg">',
    "</picture>",
  ].join("\n")

  writeFileSync(join(REPO_ROOT, "README.md"), readme)

  // Regenerate SVG files
  const darkSvg = buildSvg(config, cache, darkPalette)
  const lightSvg = buildSvg(config, cache, lightPalette)

  writeFileSync(join(REPO_ROOT, "dark_mode.svg"), darkSvg)
  writeFileSync(join(REPO_ROOT, "light_mode.svg"), lightSvg)

  writeJson(cachePath, cache)

  console.log("Profile README and stats updated successfully")
}

main().catch((err) => {
  console.error("Update failed:", err)
  process.exit(1)
})