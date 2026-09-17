import {
  Box, Group, Text, Tooltip,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMemo } from 'react';
import * as d3 from 'd3';
import { LslWindow } from '../../store/hooks/useLsl';

/**
 * Per-task sensor trace on the analysis timeline.
 *
 * Deliberately labelled as unprocessed. This is the raw concentration change
 * the bridge captured for one trial: no baseline correction, no motion-artifact
 * rejection, no averaging across trials. A single-trial haemodynamic squiggle
 * looks meaningful and usually is not, so the chrome says so rather than
 * letting a smooth curve imply a result.
 */

const HEIGHT = 110;
const MARGIN = {
  top: 14, right: 12, bottom: 18, left: 44,
};

/** Mean across a set of channel indices, so 40 channels read as one trend. */
function meanSeries(values: number[][], indices: number[]): number[] {
  if (!indices.length || !values.length) {
    return [];
  }
  const length = values[indices[0]]?.length ?? 0;
  return Array.from({ length }, (_, i) => (
    indices.reduce((sum, c) => sum + (values[c]?.[i] ?? 0), 0) / indices.length
  ));
}

export function SensorTraceVis({ window, width }: { window: LslWindow | null; width: number }) {
  const chart = useMemo(() => {
    if (!window?.times?.length) {
      return null;
    }
    const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 10);
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

    // Chromophores are resolved from labels by the bridge, never by index.
    const hbo = meanSeries(window.values, window.chromophores?.HbO ?? []);
    const hbr = meanSeries(window.values, window.chromophores?.HbR ?? []);
    const series = [
      {
        key: 'HbO',
        data: hbo,
        count: window.chromophores?.HbO?.length ?? 0,
        color: 'var(--mantine-color-red-6)',
      },
      {
        key: 'HbR',
        data: hbr,
        count: window.chromophores?.HbR?.length ?? 0,
        color: 'var(--mantine-color-blue-6)',
      },
    ].filter((s) => s.data.length);
    if (!series.length) {
      return null;
    }

    const x = d3.scaleLinear()
      .domain(d3.extent(window.times) as [number, number])
      .range([0, innerWidth]);
    const allValues = series.flatMap((s) => s.data);
    const y = d3.scaleLinear()
      .domain(d3.extent(allValues) as [number, number])
      .nice()
      .range([innerHeight, 0]);

    const line = (data: number[]) => d3.line<number>()
      .x((_, i) => x(window.times[i]))
      .y((v) => y(v))(data) ?? '';

    return {
      innerWidth, innerHeight, x, y, series, line,
    };
  }, [window, width]);

  if (!window || !chart) {
    return null;
  }

  const {
    innerWidth, innerHeight, x, y, series, line,
  } = chart;

  return (
    <Box>
      <Group gap={6} mb={2} pl={MARGIN.left} wrap="nowrap">
        <Text size="xs" fw={600}>{window.streamName}</Text>
        {series.map((s) => (
          <Group key={s.key} gap={3} wrap="nowrap">
            <Box w={8} h={2} style={{ background: s.color }} />
            <Text size="xs" c="dimmed">{`${s.key} (mean of ${s.count})`}</Text>
          </Group>
        ))}
        <Tooltip
          multiline
          w={320}
          withArrow
          label="Raw concentration change for this single trial: no baseline correction, no motion-artifact rejection, and no averaging across trials. Not an analysis result."
        >
          <Group gap={3} wrap="nowrap" style={{ cursor: 'help' }}>
            <IconInfoCircle size={12} color="var(--mantine-color-dimmed)" />
            <Text size="xs" c="dimmed">unprocessed</Text>
          </Group>
        </Tooltip>
        {(window.truncatedStart || window.truncatedEnd) && (
          <Text size="xs" c="orange">window truncated</Text>
        )}
      </Group>

      <svg width={width} height={HEIGHT}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Lead-in and lead-out are shaded: the response to this task is still
              unfolding after the task itself has ended. */}
          <rect
            x={x(window.times[0])}
            width={Math.max(x(window.taskStart) - x(window.times[0]), 0)}
            y={0}
            height={innerHeight}
            fill="var(--mantine-color-gray-1)"
          />
          <rect
            x={x(window.taskEnd)}
            width={Math.max(x(window.times[window.times.length - 1]) - x(window.taskEnd), 0)}
            y={0}
            height={innerHeight}
            fill="var(--mantine-color-gray-1)"
          />

          {y.ticks(3).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x2={innerWidth} stroke="var(--mantine-color-gray-3)" strokeDasharray="2,2" />
              <text x={-6} dy="0.32em" textAnchor="end" fontSize={9} fill="var(--mantine-color-dimmed)">{t}</text>
            </g>
          ))}

          {series.map((s) => (
            <path key={s.key} d={line(s.data)} fill="none" stroke={s.color} strokeWidth={1.5} />
          ))}

          {/* Task boundaries drawn inside the window rather than clipping it. */}
          {[
            { at: window.taskStart, label: 'task start' },
            { at: window.taskEnd, label: 'task end' },
          ].map((b) => (
            <g key={b.label} transform={`translate(${x(b.at)},0)`}>
              <line y2={innerHeight} stroke="var(--mantine-color-dark-4)" strokeWidth={1} />
              <text y={-3} fontSize={9} textAnchor="middle" fill="var(--mantine-color-dimmed)">{b.label}</text>
            </g>
          ))}

          {x.ticks(6).map((t) => (
            <text
              key={t}
              x={x(t)}
              y={innerHeight + 12}
              fontSize={9}
              textAnchor="middle"
              fill="var(--mantine-color-dimmed)"
            >
              {`${t}s`}
            </text>
          ))}
        </g>
      </svg>
    </Box>
  );
}
