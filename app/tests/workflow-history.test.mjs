import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowHistory, workflowHistoryShortcut} from '../public/features/workflow-history.js';

const draft = label => ({nodes:[{id:'input',label,position:{x:1,y:2}}],edges:[]});

test('undo restores the node and its links together, redo restores deletion', () => {
  const initial = draft('original');
  initial.nodes.push({id:'output',label:'output'});
  initial.edges.push({source:'input',target:'output'});
  const history = createWorkflowHistory(initial);
  const deleted = draft('original');
  history.record(deleted);
  const restored = history.undo();
  assert.deepEqual(restored, initial);
  assert.equal(history.dirty, false);
  restored.nodes[0].label = 'mutated return value';
  assert.deepEqual(history.redo(), deleted);
  assert.deepEqual(history.undo(), initial);
});

test('saved and AI-confirmed changes can be undone as a draft and saved again', () => {
  const initial = draft('original');
  const next = draft('AI result');
  const history = createWorkflowHistory(initial);
  history.record(next);
  history.markSaved({edges:[],nodes:[{position:{y:2,x:1},label:'AI result',id:'input'}]});
  assert.equal(history.dirty, false);
  assert.deepEqual(history.undo(), initial);
  assert.equal(history.dirty, true);
  assert.deepEqual(history.redo(), next);
  assert.equal(history.dirty, false);
  history.undo();
  history.markSaved(initial);
  assert.equal(history.dirty, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), next);
  assert.equal(history.dirty, true);
});

test('no-ops retain redo, new edits clear it and the stack has a bound', () => {
  const history = createWorkflowHistory(draft('zero'), 2);
  for (const step of ['one','two','three']) history.record(draft(step));
  assert.deepEqual(history.undo(), draft('two'));
  assert.deepEqual(history.undo(), draft('one'));
  assert.equal(history.undo(), null);
  assert.equal(history.record(draft('one')), false);
  assert.equal(history.canRedo, true);
  assert.equal(history.record(draft('branch')), true);
  assert.equal(history.redo(), null);
});

test('shortcuts preserve native editing and ignore composition', () => {
  const shortcut = (opts = {}) => workflowHistoryShortcut({key:'z',ctrlKey:true,...opts});
  assert.equal(shortcut(), 'undo');
  assert.equal(shortcut({ctrlKey:false,metaKey:true,shiftKey:true,key:'Z'}), 'redo');
  assert.equal(shortcut({key:'y'}), 'redo');
  assert.equal(shortcut({target:{closest:() => ({})}}), null);
  assert.equal(shortcut({isComposing:true}), null);
});
