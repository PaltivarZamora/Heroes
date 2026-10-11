/** Rolling AI decision log for the debug panel. DEV tool, not a game feature. */
const MAX_BLOCKS = 8;
let blocks = [];
const listeners = new Set();
function emit() {
    for (const listener of listeners) {
        listener();
    }
}
export function subscribeAiTraces(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export function getAiTraceBlocks() {
    return blocks;
}
export function clearAiTraces() {
    blocks = [];
    emit();
}
export function appendAiTrace(block) {
    const text = block.trim();
    if (!text) {
        return;
    }
    blocks = [...blocks, text].slice(-MAX_BLOCKS);
    emit();
}
export function formatScoredOptions(lines) {
    return lines.join('\n');
}
