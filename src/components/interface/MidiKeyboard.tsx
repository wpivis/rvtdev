import { useMemo } from 'react';
import {
  colorForNote, isBlackKey, noteName, velocityFraction,
} from '../../utils/midiNotes';

export interface MidiKeyboardProps {
  /** Lowest MIDI note to draw. 48 is C3. */
  lowestNote: number;
  /** How many semitones to draw, inclusive of {@link lowestNote}. */
  keyCount: number;
  /** Notes currently held, mapped to the velocity they were struck with. */
  activeNotes: ReadonlyMap<number, number>;
  /** A note to outline, e.g. the one a task is asking for. */
  highlightNote?: number | null;
  width?: number;
  height?: number;
  /** Draws note names under the C keys, so a participant can find their place. */
  withLabels?: boolean;
}

const WHITE_FILL = '#ffffff';
const BLACK_FILL = '#2b2d31';
const OUTLINE = '#9aa0a6';
const HIGHLIGHT = '#111111';

/**
 * A piano keyboard that lights up the notes currently held, in their pitch-class
 * colors, with the velocity each was struck at shown as the fill's opacity.
 *
 * Shared between the `$midi.components.midiConnection` setup component and study
 * stimuli so a participant sees the same keyboard before and during a task, and
 * so the colors on screen match the ones the analysis timeline uses.
 */
export function MidiKeyboard({
  lowestNote,
  keyCount,
  activeNotes,
  highlightNote = null,
  width = 640,
  height = 120,
  withLabels = true,
}: MidiKeyboardProps) {
  const keys = useMemo(() => {
    const notes = Array.from({ length: keyCount }, (unused, offset) => lowestNote + offset);
    const whiteNotes = notes.filter((note) => !isBlackKey(note));
    // Black keys are drawn straddling the gap between two white keys, so the
    // layout is driven entirely by how many white keys the range contains.
    const whiteWidth = whiteNotes.length > 0 ? width / whiteNotes.length : width;
    const blackWidth = whiteWidth * 0.6;
    const blackHeight = height * 0.62;

    let whiteIndex = 0;
    const white: { note: number; x: number }[] = [];
    const black: { note: number; x: number }[] = [];

    notes.forEach((note) => {
      if (isBlackKey(note)) {
        // A leading black key (a range starting on, say, C sharp) has no white
        // key to its left, so clamp it into view rather than hanging off the edge.
        black.push({ note, x: Math.max(0, whiteIndex * whiteWidth - blackWidth / 2) });
      } else {
        white.push({ note, x: whiteIndex * whiteWidth });
        whiteIndex += 1;
      }
    });

    return {
      white, black, whiteWidth, blackWidth, blackHeight,
    };
  }, [height, keyCount, lowestNote, width]);

  const fillFor = (note: number, base: string) => {
    const velocity = activeNotes.get(note);
    return velocity === undefined ? base : colorForNote(note);
  };

  const opacityFor = (note: number) => {
    const velocity = activeNotes.get(note);
    if (velocity === undefined) {
      return 1;
    }
    // A soft note reads as a pale wash, a hard one as full color.
    return 0.35 + 0.65 * velocityFraction(velocity);
  };

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="MIDI keyboard"
      data-testid="midi-keyboard"
      style={{ display: 'block' }}
    >
      {keys.white.map(({ note, x }) => (
        <g key={note}>
          <rect
            data-testid={`midi-key-${note}`}
            data-active={activeNotes.has(note) ? 'true' : 'false'}
            x={x}
            y={0}
            width={keys.whiteWidth}
            height={height}
            fill={fillFor(note, WHITE_FILL)}
            fillOpacity={opacityFor(note)}
            stroke={highlightNote === note ? HIGHLIGHT : OUTLINE}
            strokeWidth={highlightNote === note ? 3 : 1}
          />
          {withLabels && note % 12 === 0 && (
            <text
              x={x + keys.whiteWidth / 2}
              y={height - 6}
              textAnchor="middle"
              fontSize={Math.min(11, keys.whiteWidth * 0.5)}
              fill="#5f6368"
            >
              {noteName(note)}
            </text>
          )}
        </g>
      ))}

      {keys.black.map(({ note, x }) => (
        <rect
          key={note}
          data-testid={`midi-key-${note}`}
          data-active={activeNotes.has(note) ? 'true' : 'false'}
          x={x}
          y={0}
          width={keys.blackWidth}
          height={keys.blackHeight}
          fill={fillFor(note, BLACK_FILL)}
          fillOpacity={opacityFor(note)}
          stroke={highlightNote === note ? HIGHLIGHT : BLACK_FILL}
          strokeWidth={highlightNote === note ? 3 : 1}
        />
      ))}
    </svg>
  );
}

export default MidiKeyboard;
