/** Rolling AI decision log for the debug panel. DEV tool, not a game feature. */

const MAX_BLOCKS = 8

let blocks: string[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeAiTraces(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAiTraceBlocks(): string[] {
  return blocks
}

export function clearAiTraces(): void {
  blocks = []
  emit()
}

export function appendAiTrace(block: string): void {
  const text = block.trim()
  if (!text) {
    return
  }
  blocks = [...blocks, text].slice(-MAX_BLOCKS)
  emit()
}

export function formatScoredOptions(lines: string[]): string {
  return lines.join('\n')
}
