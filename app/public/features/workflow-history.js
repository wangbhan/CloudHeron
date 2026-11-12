function snapshot(document) {
  // PostgreSQL JSONB can return object keys in a different order.
  return JSON.stringify(document, (_, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

export function createWorkflowHistory(document, limit = 50) {
  let current = snapshot(document);
  let saved = current;
  const undo = [];
  const redo = [];

  return {
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    get dirty() { return current !== saved; },
    record(nextDocument) {
      const next = snapshot(nextDocument);
      if (next === current) return false;
      undo.push(current);
      if (undo.length > limit) undo.shift();
      current = next;
      redo.length = 0;
      return true;
    },
    markSaved(document) {
      saved = snapshot(document);
    },
    undo() {
      if (!undo.length) return null;
      redo.push(current);
      current = undo.pop();
      return JSON.parse(current);
    },
    redo() {
      if (!redo.length) return null;
      undo.push(current);
      current = redo.pop();
      return JSON.parse(current);
    },
  };
}

export function workflowHistoryShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey ||
      !(event.ctrlKey || event.metaKey) ||
      event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
