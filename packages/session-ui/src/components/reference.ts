export type Reference =
  | { kind: "github-issue" | "github-pr" | "gitlab-issue" | "gitlab-mr"; repository: string; number: number }
  | { kind: "github-release"; repository: string; tag: string }
  | { kind: "linear-issue" | "linear-project"; workspace: string; id: string }
  | { kind: "jira-issue"; site: string; id: string }

const githubPaths = { issues: "github-issue", pull: "github-pr" } as const
// GitLab links issues as work items on newer instances: group/project/-/work_items/1.
const gitlabPaths = { issues: "gitlab-issue", work_items: "gitlab-issue", merge_requests: "gitlab-mr" } as const
// Cycles and milestones are not recognised: the Linear MCP tools cannot resolve them from a bare URL.
const linearPaths = { issue: "linear-issue", project: "linear-project" } as const
const jiraKey = /^[A-Z][A-Z0-9_]*-\d+$/

// Only github.com, gitlab.com, linear.app and Atlassian Cloud sites are recognised, so no other host is ever resolved.
export function parseReference(href: string): Reference | undefined {
  const url = URL.parse(href)
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return
  const segments = url.pathname.split("/").filter(Boolean)
  if (url.hostname === "github.com") return github(segments)
  if (url.hostname === "gitlab.com") return gitlab(segments)
  if (url.hostname === "linear.app") return linear(segments)
  if (url.hostname.endsWith(".atlassian.net")) return jira(url, segments)
}

export function referenceKey(reference: Reference) {
  if ("tag" in reference) return `${reference.kind}:${reference.repository}@${reference.tag}`.toLowerCase()
  if ("number" in reference) return `${reference.kind}:${reference.repository}#${reference.number}`.toLowerCase()
  if ("site" in reference) return `${reference.kind}:${reference.site}/${reference.id}`.toLowerCase()
  return `${reference.kind}:${reference.workspace}/${reference.id}`.toLowerCase()
}

/** The short name a popup shows before its item loads, or when it cannot. */
export function referenceLabel(reference: Reference) {
  if ("tag" in reference) return `${reference.repository} ${reference.tag}`
  if ("number" in reference) return `${reference.repository} ${reference.kind === "gitlab-mr" ? "!" : "#"}${reference.number}`
  return reference.id
}

function github(segments: string[]): Reference | undefined {
  const [owner, repo, type, id] = segments
  const tag = segments.slice(4).join("/")
  // A stray "%" would make decodeURIComponent throw, so such tags are simply not references.
  if (owner && repo && type === "releases" && id === "tag" && tag && !/%(?![0-9a-f]{2})/i.test(tag))
    return { kind: "github-release", repository: `${owner}/${repo}`, tag: decodeURIComponent(tag) }
  const kind = githubPaths[type as keyof typeof githubPaths]
  if (!owner || !repo || !kind || !id || !/^\d+$/.test(id)) return
  return { kind, repository: `${owner}/${repo}`, number: Number(id) }
}

// GitLab puts its routes after a `-` segment, since projects can sit in nested groups: group/sub/project/-/issues/1.
function gitlab(segments: string[]): Reference | undefined {
  const dash = segments.indexOf("-")
  const [type, id] = segments.slice(dash + 1)
  const kind = gitlabPaths[type as keyof typeof gitlabPaths]
  if (dash < 2 || !kind || !id || !/^\d+$/.test(id)) return
  return { kind, repository: segments.slice(0, dash).join("/"), number: Number(id) }
}

function linear(segments: string[]): Reference | undefined {
  const [workspace, type, id] = segments
  const kind = linearPaths[type as keyof typeof linearPaths]
  if (!workspace || !kind || !id) return
  return { kind, workspace, id }
}

// Issues open at /browse/KEY-1, and boards name the open issue in `selectedIssue`.
function jira(url: URL, segments: string[]): Reference | undefined {
  const id = segments[0] === "browse" ? segments[1] : url.searchParams.get("selectedIssue")
  if (!id || !jiraKey.test(id)) return
  return { kind: "jira-issue", site: url.hostname, id }
}
