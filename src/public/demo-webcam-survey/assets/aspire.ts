import { ParticipantData } from '../../../parser/types';

/** The three Poverty Stoplight levels, in the order they appear on the printed ASPIRE card. */
export type LevelColor = 'green' | 'yellow' | 'red';

/** Where the live webcam self-view is drawn during a step. */
export type SelfViewPlacement = 'bar' | 'floating' | 'off';

export interface AspireLevel {
  color: LevelColor;
  /** Path under `public/`. When the file is missing the card falls back to an empty photo slot. */
  image?: string;
  /** Verbatim instrument wording for this level. */
  text: string;
}

export interface IndicatorParameters {
  dimension: string;
  indicator: number;
  /** The instrument's Lifemap name, used verbatim as the prompt. */
  lifemapName: string;
  /** Short name used by the reflect and summary screens. */
  shortName: string;
  stepLabel: string;
  levels: AspireLevel[];
  selfView?: SelfViewPlacement;
  probes?: string[];
}

export interface ReflectParameters {
  /** Component name of the indicator step this reflects on. */
  indicatorComponent: string;
  lifemapName: string;
  selfView?: SelfViewPlacement;
  probes?: string[];
}

export interface SummaryParameters {
  indicators: { component: string; shortName: string }[];
}

export const LEVEL_STYLE: Record<LevelColor, {
  label: string;
  dot: string;
  text: string;
  tint: string;
}> = {
  green: {
    label: 'Green', dot: '#2f9e44', text: '#2b8a3e', tint: 'rgba(47,158,68,.06)',
  },
  yellow: {
    label: 'Yellow', dot: '#fcc419', text: '#e67700', tint: 'rgba(250,176,5,.08)',
  },
  red: {
    label: 'Red', dot: '#f03e3e', text: '#c92a2a', tint: 'rgba(240,62,62,.06)',
  },
};

/** Follow-up heading is derived from the chosen level, never hard-coded per indicator. */
export const REFLECT_HEADING: Record<LevelColor, string> = {
  green: 'Tell us what keeps this one green for your household',
  yellow: 'Tell us what made it yellow and not green',
  red: 'Tell us what made you choose red',
};

export const LEVEL_COLORS: LevelColor[] = ['green', 'yellow', 'red'];

function isLevelColor(value: unknown): value is LevelColor {
  return typeof value === 'string' && (LEVEL_COLORS as string[]).includes(value);
}

/**
 * Answers are keyed `<componentName>_<step>`, so look the step up by name rather
 * than by a hard-coded sequence index.
 */
export function findAnswer(
  answers: ParticipantData['answers'],
  componentName: string,
  responseId: string,
): unknown {
  const entry = Object.entries(answers)
    .find(([key]) => key === componentName || key.startsWith(`${componentName}_`));
  return entry?.[1]?.answer?.[responseId];
}

/** Reads a previously stored stoplight level, or null when the step has not been answered. */
export function findLevel(
  answers: ParticipantData['answers'],
  componentName: string,
): LevelColor | null {
  const value = findAnswer(answers, componentName, 'level');
  return isLevelColor(value) ? value : null;
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
