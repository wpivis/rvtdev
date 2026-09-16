import { useEffect } from 'react';
import { Box } from '@mantine/core';
import { IconCheck, IconMicrophone } from '@tabler/icons-react';
import { StimulusParams } from '../../../store/types';
import { ParticipantData } from '../../../parser/types';
import {
  LEVEL_STYLE, LevelColor, SummaryParameters, findLevel, formatDuration,
} from './aspire';

interface SummaryRow {
  component: string;
  shortName: string;
  level: LevelColor;
}

/**
 * Total time spent on the steps that carry a narration, derived from the stored
 * answers rather than a hard-coded figure.
 */
function recordedSeconds(answers: ParticipantData['answers'], componentNames: string[]): number {
  return Object.entries(answers)
    .filter(([key]) => componentNames.some((name) => key === name || key.startsWith(`${name}_`)))
    .reduce((total, [, answer]) => {
      const { startTime, endTime } = answer;
      if (!startTime || !endTime || endTime <= startTime) {
        return total;
      }
      return total + (endTime - startTime) / 1000;
    }, 0);
}

export function SessionSummary({ parameters, setAnswer, answers }: StimulusParams<SummaryParameters>) {
  const rows = parameters.indicators.reduce<SummaryRow[]>((accumulated, indicator) => {
    const level = findLevel(answers, indicator.component);
    return level ? [...accumulated, { ...indicator, level }] : accumulated;
  }, []);

  const componentNames = parameters.indicators.map((indicator) => indicator.component);
  const seconds = recordedSeconds(answers, componentNames);

  useEffect(() => {
    setAnswer({ status: true, answers: {} });
  }, [setAnswer]);

  return (
    <Box style={{
      display: 'flex', flexDirection: 'column', gap: 16, padding: '22px 18px',
    }}
    >
      <Box style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        backgroundColor: '#ebfbee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      >
        <IconCheck size={26} stroke={2} color="#2b8a3e" />
      </Box>

      <h1 style={{
        fontSize: 23, fontWeight: 700, lineHeight: 1.25, margin: 0,
      }}
      >
        Your answers are saved
      </h1>

      <span style={{ fontSize: 15, color: '#495057' }}>
        Thank you for talking us through your household. Here is what we recorded together.
      </span>

      <Box style={{
        border: '1px solid #dee2e6',
        borderRadius: 8,
        backgroundColor: '#f8f9fa',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>This session</span>

        {rows.map((row) => (
          <Box key={row.component} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              backgroundColor: LEVEL_STYLE[row.level].dot,
              flex: 'none',
            }}
            />
            <span style={{ fontSize: 13, color: '#495057', flex: 1 }}>{row.shortName}</span>
            <span style={{ fontSize: 13, color: '#495057' }}>{LEVEL_STYLE[row.level].label}</span>
          </Box>
        ))}

        <Box style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#868e96',
        }}
        >
          <IconMicrophone size={15} stroke={1.5} />
          {`${rows.length} ${rows.length === 1 ? 'recording' : 'recordings'} · ${formatDuration(seconds)}`}
        </Box>
      </Box>
    </Box>
  );
}

export default SessionSummary;
