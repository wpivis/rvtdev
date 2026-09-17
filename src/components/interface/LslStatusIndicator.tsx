import {
  Badge, Group, HoverCard, Stack, Text,
} from '@mantine/core';
import { IconAlertTriangle, IconActivityHeartbeat } from '@tabler/icons-react';
import { useMemo } from 'react';
import { useLslContext } from '../../store/hooks/useLsl';

/**
 * Always-visible indicator of the sensor connection during a study.
 *
 * Deliberately labelled "signal connected" rather than anything about quality.
 * The bridge can see that samples are arriving at the expected rate; it cannot
 * see whether an optode has lifted off the scalp. A green dot that implied
 * otherwise would be worse than no dot at all.
 */
export function LslStatusIndicator() {
  const {
    enabled, bridgeConnected, status, pendingWindows,
  } = useLslContext();

  const { color, label } = useMemo(() => {
    if (!bridgeConnected) {
      return { color: 'red', label: 'Bridge offline' };
    }
    if (!status?.connected) {
      return { color: 'red', label: 'No sensor stream' };
    }
    if (!status.healthy) {
      return { color: 'yellow', label: 'Signal interrupted' };
    }
    if (pendingWindows.length) {
      // A window is cut leadOut seconds after its task ends, so these are still
      // in flight. Closing the tab now loses them.
      return {
        color: 'blue',
        label: `Saving ${pendingWindows.length} trace${pendingWindows.length === 1 ? '' : 's'}…`,
      };
    }
    return { color: 'green', label: 'Signal connected' };
  }, [bridgeConnected, status, pendingWindows]);

  if (!enabled) {
    return null;
  }

  return (
    <HoverCard width={320} shadow="md" withArrow position="bottom-end">
      <HoverCard.Target>
        <Badge
          color={color}
          variant="light"
          leftSection={color === 'green'
            ? <IconActivityHeartbeat size={14} />
            : <IconAlertTriangle size={14} />}
          style={{ cursor: 'default' }}
        >
          {label}
        </Badge>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={4}>
          <Text size="sm" fw={600}>{status?.streamName ?? 'No stream attached'}</Text>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Rate</Text>
            <Text size="xs">
              {status?.effectiveRate
                ? `${status.effectiveRate} Hz of ${status.nominalRate ?? '?'} Hz`
                : '—'}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Last sample</Text>
            <Text size="xs">
              {status?.secondsSinceSample === null || status?.secondsSinceSample === undefined
                ? '—'
                : `${status.secondsSinceSample.toFixed(1)}s ago`}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Gaps</Text>
            <Text size="xs">{status?.gaps ?? '—'}</Text>
          </Group>
          {pendingWindows.length > 0 && (
            <Text size="xs" c="blue" mt={6}>
              {`Waiting on ${pendingWindows.length} trace(s) from the bridge. `}
              Each arrives a lead-out after its task ends; keep this tab open.
            </Text>
          )}
          <Text size="xs" c="dimmed" mt={6}>
            Connection only. Signal quality is judged in the sensor&apos;s own
            acquisition software.
          </Text>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
