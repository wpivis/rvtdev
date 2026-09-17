import { Box, Group, Text } from '@mantine/core';
import { useMemo } from 'react';
import * as d3 from 'd3';
import { LslWindow } from '../../store/hooks/useLsl';

/**
 * Per-task sensor trace, drawn on the replay timeline's own scale.
 *
 * Takes the x scale from AudioProvenanceVis rather than building its own, so
 * the trace sits under the provenance track on one shared axis and the playhead
 * crosses both. That scale is seconds from task start, which is the same unit
 * the bridge reports window times in.
 *
 * Deliberately labelled unprocessed: no baseline correction, no motion-artifact
 * rejection, no averaging across trials. A single-trial haemodynamic curve looks
 * meaningful and usually is not.
 */

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

export function SensorTraceVis({
  window: sensorWindow,
  xScale,
  width,
  height,
}: {
  window: LslWindow | null;
  xScale: d3.ScaleLinear<number, number>;
  width: number;
  height: number;
}) {
  const chart = useMemo(() => {
    if (!sensorWindow?.times?.length) {
      return null;
    }
    // Chromophores are resolved from labels by the bridge, never by index.
    const hbo = meanSeries(sensorWindow.values, sensorWindow.chromophores?.HbO ?? []);
    const hbr = meanSeries(sensorWindow.values, sensorWindow.chromophores?.HbR ?? []);
    const series = [
      {
        key: 'HbO',
        data: hbo,
        count: sensorWindow.chromophores?.HbO?.length ?? 0,
        color: 'var(--mantine-color-red-6)',
      },
      {
        key: 'HbR',
        data: hbr,
        count: sensorWindow.chromophores?.HbR?.length ?? 0,
        color: 'var(--mantine-color-blue-6)',
      },
    ].filter((s) => s.data.length);
    if (!series.length) {
      return null;
    }

    // The shared scale only spans the task, so the lead-in and lead-out fall
    // outside it. Clipping keeps every point aligned with the tracks above
    // rather than piling the tails against the edges.
    const [lo, hi] = xScale.domain();
    const visible = sensorWindow.times
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t >= lo && t <= hi);
    if (visible.length < 2) {
      return null;
    }

    const inner = Math.max(height - 14, 8);
    const allValues = series.flatMap((s) => visible.map(({ i }) => s.data[i]));
    const y = d3.scaleLinear()
      .domain(d3.extent(allValues) as [number, number])
      .nice()
      .range([inner, 2]);

    const line = (data: number[]) => d3.line<{ t: number; i: number }>()
      .x((d) => xScale(d.t))
      .y((d) => y(data[d.i]))(visible) ?? '';

    const hidden = sensorWindow.times.length - visible.length;
    return {
      inner, y, series, line, hidden,
    };
  }, [sensorWindow, xScale, height]);

  if (!sensorWindow || !chart) {
    return null;
  }

  const {
    inner, y, series, line, hidden,
  } = chart;

  return (
    <Box>
      <Group gap={8} mb={2} mt={4} pl={8} wrap="nowrap">
        <Text size="xs" fw={600}>{sensorWindow.streamName}</Text>
        {series.map((s) => (
          <Group key={s.key} gap={3} wrap="nowrap">
            <Box w={8} h={2} style={{ background: s.color }} />
            <Text size="xs" c="dimmed">{`${s.key} (mean of ${s.count})`}</Text>
          </Group>
        ))}
        <Text size="xs" c="dimmed">unprocessed</Text>
        {hidden > 0 && (
          <Text size="xs" c="orange">
            {`${hidden} samples outside the replay window are not shown`}
          </Text>
        )}
      </Group>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {y.ticks(2).map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={xScale.range()[0]} x2={xScale.range()[1]} stroke="var(--mantine-color-gray-3)" strokeDasharray="2,2" />
            <text x={xScale.range()[0] - 4} dy="0.32em" textAnchor="end" fontSize={9} fill="var(--mantine-color-dimmed)">{t}</text>
          </g>
        ))}
        {/* Everything outside the task is lead-in and lead-out: the response
            still unfolding before and after the trial it belongs to. */}
        <rect
          x={xScale(xScale.domain()[0])}
          width={Math.max(xScale(sensorWindow.taskStart) - xScale(xScale.domain()[0]), 0)}
          y={0}
          height={inner}
          fill="var(--mantine-color-gray-2)"
          opacity={0.55}
        />
        <rect
          x={xScale(sensorWindow.taskEnd)}
          width={Math.max(xScale(xScale.domain()[1]) - xScale(sensorWindow.taskEnd), 0)}
          y={0}
          height={inner}
          fill="var(--mantine-color-gray-2)"
          opacity={0.55}
        />
        {[
          { at: sensorWindow.taskStart, label: 'task start' },
          { at: sensorWindow.taskEnd, label: 'task end' },
        ].map((b) => (
          <g key={b.label} transform={`translate(${xScale(b.at)},0)`}>
            <line y1={0} y2={inner} stroke="var(--mantine-color-dark-4)" strokeWidth={1} />
            <text y={9} x={3} fontSize={9} fill="var(--mantine-color-dimmed)">{b.label}</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.key} d={line(s.data)} fill="none" stroke={s.color} strokeWidth={1.5} />
        ))}
        <line
          x1={xScale.range()[0]}
          x2={xScale.range()[1]}
          y1={inner}
          y2={inner}
          stroke="var(--mantine-color-gray-4)"
        />
      </svg>
    </Box>
  );
}
