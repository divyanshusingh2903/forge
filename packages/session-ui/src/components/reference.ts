export type Reference =
  | { kind: "github-issue" | "github-pr"; owner: string; repo: string; number: number }
  | { kind: "github-release"; owner: string; repo: string; tag: string }
  | { kind: "linear-issue" | "linear-project"; workspace: string; id: string }

const githubPaths = { issues: "github-issue", pull: "github-pr" } as const
// Cycles and milestones are not recognised: the Linear MCP tools cannot resolve them from a bare URL.
const linearPaths = { issue: "linear-issue", project: "linear-project" } as const

// Only github.com and linear.app are recognised so no other host is ever resolved or fetched.
export function parseReference(href: string): Reference | undefined {
  const url = URL.parse(href)
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return
  const segments = url.pathname.split("/").filter(Boolean)
  if (url.hostname === "github.com") return github(segments)
  if (url.hostname === "linear.app") return linear(segments)
}

export function referenceKey(reference: Reference) {
  if ("tag" in reference) return `${reference.kind}:${reference.owner}/${reference.repo}@${reference.tag}`.toLowerCase()
  if ("owner" in reference)
    return `${reference.kind}:${reference.owner}/${reference.repo}#${reference.number}`.toLowerCase()
  return `${reference.kind}:${reference.workspace}/${reference.id}`.toLowerCase()
}

function github(segments: string[]): Reference | undefined {
  const [owner, repo, type, id] = segments
  const tag = segments.slice(4).join("/")
  // A stray "%" would make decodeURIComponent throw, so such tags are simply not references.
  if (owner && repo && type === "releases" && id === "tag" && tag && !/%(?![0-9a-f]{2})/i.test(tag))
    return { kind: "github-release", owner, repo, tag: decodeURIComponent(tag) }
  const kind = githubPaths[type as keyof typeof githubPaths]
  if (!owner || !repo || !kind || !id || !/^\d+$/.test(id)) return
  return { kind, owner, repo, number: Number(id) }
}

function linear(segments: string[]): Reference | undefined {
  const [workspace, type, id] = segments
  const kind = linearPaths[type as keyof typeof linearPaths]
  if (!workspace || !kind || !id) return
  return { kind, workspace, id }
}
