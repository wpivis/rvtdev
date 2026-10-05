import { renderToStaticMarkup } from 'react-dom/server';
import * as d3 from 'd3';
import { describe, expect, test } from 'vitest';
import { TrrackedProvenance } from '../../../store/types';
import { TaskProvenanceNodes } from '../TaskProvenanceNodes';
import { ROOT_COLOR, getColorForKey } from '../provenanceColors';
import { PITCH_CLASS_COLORS, midiNoteActionType } from '../../../utils/midiNotes';

function getFills(markup: string): string[] {
  return [...markup.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);
}

function createGraph(nodes: TrrackedProvenance['nodes'], root: string): TrrackedProvenance {
  return {
    current: root,
    root,
    nodes,
  } as TrrackedProvenance;
}

describe('TaskProvenanceNodes', () => {
  test('uses deterministic color per canonical action key regardless of node order', () => {
    const rootNode = {
      id: 'root',
      label: 'Root',
      createdOn: 0,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: ['n1'],
      state: { type: 'checkpoint', val: {} },
      level: 0,
      event: 'Root',
    } as TrrackedProvenance['nodes'][string];
    const actionNode = {
      id: 'n1',
      label: 'Some label',
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

    const graphOne = createGraph({ root: rootNode, n1: actionNode }, 'root');
    const graphTwo = createGraph({ n1: actionNode, root: rootNode }, 'root');

    const xScale = d3.scaleLinear([0, 100]).domain([0, 5]);

    const first = renderToStaticMarkup(
      <svg>
        <TaskProvenanceNodes height={25} xScale={xScale} currentNode={null} provenance={graphOne} />
      </svg>,
    );

    const second = renderToStaticMarkup(
      <svg>
        <TaskProvenanceNodes height={25} xScale={xScale} currentNode={null} provenance={graphTwo} />
      </svg>,
    );

    expect(getFills(first).sort()).toEqual(getFills(second).sort());
    expect(getFills(first)).toContain(getColorForKey('signal setzoom'));
  });

  test('active-node overlay uses the same color as its base node', () => {
    const rootNode = {
      id: 'root',
      label: 'Root',
      createdOn: 0,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: ['n1'],
      state: { type: 'checkpoint', val: {} },
      level: 0,
      event: 'Root',
    } as TrrackedProvenance['nodes'][string];
    const actionNode = {
      id: 'n1',
      label: 'Some label',
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

    const graph = createGraph({ root: rootNode, n1: actionNode }, 'root');
    const xScale = d3.scaleLinear([0, 100]).domain([0, 5]);
    const markup = renderToStaticMarkup(
      <svg>
        <TaskProvenanceNodes height={25} xScale={xScale} currentNode="n1" provenance={graph} />
      </svg>,
    );

    const actionColor = getColorForKey('signal setzoom');
    const actionColorCount = getFills(markup).filter((fill) => fill === actionColor).length;
    expect(actionColorCount).toBe(2);
  });
});

describe('TaskProvenanceNodes with MIDI provenance', () => {
  function node(id: string, actionType: string, createdOn: number): TrrackedProvenance['nodes'][string] {
    return {
      id,
      label: actionType,
      createdOn,
      artifacts: [],
      meta: { annotation: [], bookmark: [] },
      children: [],
      state: { type: 'checkpoint', val: {} },
      level: 1,
      event: 'midi',
      parent: 'root',
      sideEffects: { do: [{ type: actionType }], undo: [] },
    } as TrrackedProvenance['nodes'][string];
  }

  // The action-type sequence from a playthrough of the demo-midi "midi-scale"
  // trial: a prompt, a wrong note, then the right one, and on up the scale. The
  // notes are C4 D4 E4 with a B3 played by mistake, and C5 at the end -- an
  // octave above the first C, which must land on the same color.
  const RECORDED_SEQUENCE = [
    'midi-prompt-note',
    midiNoteActionType(60),
    'midi-prompt-note',
    midiNoteActionType(59),
    midiNoteActionType(62),
    'midi-prompt-note',
    midiNoteActionType(64),
    midiNoteActionType(72),
  ];

  function renderRecordedTimeline() {
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

    const nodes: TrrackedProvenance['nodes'] = { root: rootNode };
    RECORDED_SEQUENCE.forEach((actionType, index) => {
      nodes[`n${index}`] = node(`n${index}`, actionType, index + 1);
    });

    const xScale = d3.scaleLinear([0, 100]).domain([0, RECORDED_SEQUENCE.length + 1]);
    return renderToStaticMarkup(
      <svg>
        <TaskProvenanceNodes height={25} xScale={xScale} currentNode={null} provenance={createGraph(nodes, 'root')} />
      </svg>,
    );
  }

  test('paints each note in the color of the pitch class that produced it', () => {
    const fills = getFills(renderRecordedTimeline());

    expect(fills).toEqual([
      ROOT_COLOR,
      getColorForKey('midi prompt note'),
      PITCH_CLASS_COLORS.c,
      getColorForKey('midi prompt note'),
      PITCH_CLASS_COLORS.b,
      PITCH_CLASS_COLORS.d,
      getColorForKey('midi prompt note'),
      PITCH_CLASS_COLORS.e,
      // C5, an octave above the C4 near the start, and the same fill.
      PITCH_CLASS_COLORS.c,
    ]);
  });

  test('a wrong note is visually obvious next to the note it should have been', () => {
    const fills = getFills(renderRecordedTimeline());
    // B3 was played where C4 was wanted -- one semitone off, and it must not
    // read as a neighbouring shade of the right answer.
    expect(fills).toContain(PITCH_CLASS_COLORS.b);
    expect(PITCH_CLASS_COLORS.b).not.toBe(PITCH_CLASS_COLORS.c);
  });

  test('non-note MIDI actions keep a hashed color, distinct from every pitch class', () => {
    const promptColor = getColorForKey('midi prompt note');
    expect(promptColor).toMatch(/^hsl\(/);
    expect(Object.values(PITCH_CLASS_COLORS)).not.toContain(promptColor);
  });

  test('the same note is always the same color across a session', () => {
    const first = getFills(renderRecordedTimeline());
    const second = getFills(renderRecordedTimeline());
    expect(first).toEqual(second);
  });
});
