import { describe, expect, test } from 'vitest';
import { TrrackedProvenance } from '../../../store/types';
import {
  FORM_UPDATE_COLOR,
  ROOT_COLOR,
  ROOT_KEY,
  buildProvenanceLegendEntries,
  getColorForKey,
  getNodeColorKey,
  normalizeActionName,
} from '../provenanceColors';
import { DOCUMENT_REVIEW_ACTIONS, DOCUMENT_REVIEW_ACTION_COLORS } from '../../../utils/documentReviewActions';

function createGraph(nodes: TrrackedProvenance['nodes'], root: string): TrrackedProvenance {
  return {
    current: root,
    root,
    nodes,
  } as TrrackedProvenance;
}

describe('provenanceColors', () => {
  test('normalizeActionName collapses punctuation and whitespace consistently', () => {
    expect(normalizeActionName('Zoom In')).toBe('zoom in');
    expect(normalizeActionName(' zoom-in ')).toBe('zoom in');
    expect(normalizeActionName('ZOOM   IN')).toBe('zoom in');
  });

  test('getNodeColorKey uses registry action type first', () => {
    const node = {
      id: 'n1',
      label: 'Different Label',
      createdOn: 1,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      event: 'SomeEvent',
      parent: 'root',
      sideEffects: {
        do: [{ type: 'Signal/SetZoom' }],
        undo: [],
      },
    } as TrrackedProvenance['nodes'][string];

    expect(getNodeColorKey(node)).toBe('signal setzoom');
  });

  test('getNodeColorKey falls back to event, then label, and handles root', () => {
    const eventNode = {
      id: 'n1',
      label: '',
      createdOn: 1,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      event: 'BrushMove',
      parent: 'root',
      sideEffects: { do: [], undo: [] },
    } as TrrackedProvenance['nodes'][string];
    expect(getNodeColorKey(eventNode)).toBe('brushmove');

    const labelNode = {
      id: 'n2',
      label: ' Zoom In ',
      createdOn: 2,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      event: '',
      parent: 'root',
      sideEffects: { do: [], undo: [] },
    } as TrrackedProvenance['nodes'][string];
    expect(getNodeColorKey(labelNode)).toBe('zoom in');

    const rootNode = {
      id: 'root',
      label: 'Root',
      createdOn: 0,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 0,
      event: 'Root',
    } as TrrackedProvenance['nodes'][string];
    expect(getNodeColorKey(rootNode)).toBe(ROOT_KEY);
  });

  test('getColorForKey is deterministic and root key always uses root color', () => {
    const key = 'signal setzoom';
    expect(getColorForKey(key)).toBe(getColorForKey(key));
    expect(getColorForKey(ROOT_KEY)).toBe(ROOT_COLOR);
    expect(getColorForKey('update')).toBe(FORM_UPDATE_COLOR);
    expect(getColorForKey('update form field')).toBe(FORM_UPDATE_COLOR);
  });

  test('different keys generally map to different colors', () => {
    expect(getColorForKey('action 2')).not.toBe(getColorForKey('action 3'));
  });

  test('buildProvenanceLegendEntries de-dupes by canonical key across locations', () => {
    const rootNode = {
      id: 'root',
      label: 'Root',
      createdOn: 0,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: ['a1'],
      state: { type: 'checkpoint', val: {} },
      level: 0,
      event: 'Root',
    } as TrrackedProvenance['nodes'][string];
    const locationOneAction = {
      id: 'a1',
      label: 'Zoom In',
      createdOn: 1,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      event: 'signal',
      parent: 'root',
      sideEffects: { do: [{ type: 'Signal/SetZoom' }], undo: [] },
    } as TrrackedProvenance['nodes'][string];
    const locationTwoAction = {
      id: 'b1',
      label: ' zoom-in ',
      createdOn: 2,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      event: 'other',
      parent: 'root',
      sideEffects: { do: [{ type: 'Signal/SetZoom' }], undo: [] },
    } as TrrackedProvenance['nodes'][string];

    const graphA = createGraph({ root: rootNode, a1: locationOneAction }, 'root');
    const graphB = createGraph({ root: rootNode, b1: locationTwoAction }, 'root');

    const legendEntries = buildProvenanceLegendEntries([graphA, graphB]);
    expect(legendEntries.size).toBe(2);
    expect(legendEntries.get('signal setzoom')?.color).toBe(getColorForKey('signal setzoom'));
  });
});

describe('explicit action colors', () => {
  test('every document-review action gets its declared color', () => {
    Object.entries(DOCUMENT_REVIEW_ACTION_COLORS).forEach(([action, color]) => {
      expect(getColorForKey(normalizeActionName(action))).toBe(color);
    });
  });

  test('flagging a clause is the only red, so it stands out on the replay timeline', () => {
    const flagColor = getColorForKey(normalizeActionName(DOCUMENT_REVIEW_ACTIONS.flag));
    const ambient = [DOCUMENT_REVIEW_ACTIONS.scroll, DOCUMENT_REVIEW_ACTIONS.dwell, DOCUMENT_REVIEW_ACTIONS.select]
      .map((action) => getColorForKey(normalizeActionName(action)));
    expect(ambient).not.toContain(flagColor);
  });

  test('a node recorded the way Trrack actually records one gets the explicit color', () => {
    // A registered state action lands in `event`; `sideEffects.do` stays empty.
    // This is the shape read back out of stored provenance in the e2e test.
    const node = {
      id: 'n1',
      label: 'Flag §8',
      event: DOCUMENT_REVIEW_ACTIONS.flag,
      createdOn: 2,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      parent: 'root',
      sideEffects: { do: [], undo: [] },
    } as unknown as TrrackedProvenance['nodes'][string];

    expect(getColorForKey(getNodeColorKey(node)))
      .toBe(DOCUMENT_REVIEW_ACTION_COLORS[DOCUMENT_REVIEW_ACTIONS.flag]);
  });

  test('actions without an explicit color still hash to a stable color', () => {
    const first = getColorForKey('some other study action');
    expect(first).toBe(getColorForKey('some other study action'));
    expect(first).not.toBe(getColorForKey('a different action'));
  });

  test('the root and form-update keys still win over the explicit map', () => {
    expect(getColorForKey(ROOT_KEY)).toBe(ROOT_COLOR);
    expect(getColorForKey('update')).toBe(FORM_UPDATE_COLOR);
  });
});
