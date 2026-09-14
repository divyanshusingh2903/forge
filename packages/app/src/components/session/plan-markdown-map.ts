import { marked } from "marked"
import type { SelectedLineRange } from "@/context/file"

export type PlanMarkdownBlock = {
  start: number
  end: number
}

// Map rendered markdown blocks back to 1-indexed source line ranges in the
// exact `source` string. Uses `marked.lexer` token `raw` substrings located
// sequentially from a cursor so duplicate content maps to the correct
// occurrence. Inter-block blank lines are claimed by the preceding block so
// every source line belongs to exactly one block.
export function mapPlanMarkdownBlocks(source: string): PlanMarkdownBlock[] {
  if (!source) return []
  const normalized = source.replace(/\r\n?/g, "\n")
  const total = normalized.split("\n").length
  let tokens: { type: string; raw: string }[]
  try {
    tokens = marked.lexer(normalized) as { type: string; raw: string }[]
  } catch {
    return [{ start: 1, end: total }]
  }
  const lineStartOffsets = [0]
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "\n") lineStartOffsets.push(i + 1)
  }
  const lineOfOffset = (offset: number) => {
    let low = 0
    let high = lineStartOffsets.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStartOffsets[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
  const raw: PlanMarkdownBlock[] = []
  let cursor = 0
  for (const token of tokens) {
    if (token.type === "space" || !token.raw) continue
    const index = normalized.indexOf(token.raw, cursor)
    if (index < 0) continue
    raw.push({ start: lineOfOffset(index), end: lineOfOffset(index + token.raw.length - 1) })
    cursor = index + token.raw.length
  }
  if (raw.length === 0) return [{ start: 1, end: total }]
  // Fill gaps: extend each block through blank lines up to the next block.
  const blocks = raw.map((block, i) => {
    const next = raw[i + 1]
    const end = next ? Math.max(block.end, next.start - 1) : total
    return { start: block.start, end }
  })
  return blocks
}

export function planBlockForLine(blocks: PlanMarkdownBlock[], line: number) {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (line >= block.start && line <= block.end) return i
  }
  return -1
}

export function planRangeForBlocks(blocks: PlanMarkdownBlock[], from: number, to: number): SelectedLineRange | null {
  const low = Math.max(0, Math.min(from, to))
  const high = Math.min(blocks.length - 1, Math.max(from, to))
  if (low > high || !blocks[low] || !blocks[high]) return null
  return { start: blocks[low]!.start, end: blocks[high]!.end, side: "additions" }
}

export function planBlocksForRange(blocks: PlanMarkdownBlock[], range: SelectedLineRange) {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  const out: number[] = []
  blocks.forEach((block, index) => {
    if (block.end >= start && block.start <= end) out.push(index)
  })
  return out
}
