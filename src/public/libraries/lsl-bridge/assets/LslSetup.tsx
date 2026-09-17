import {
  Alert, Badge, Box, Code, Group, List, Loader, Stack, Table, Text, Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useLslContext } from '../../../../store/hooks/useLsl';
import { StimulusParams } from '../../../../store/types';

/**
 * Setup gate for a study that streams sensor data through the LSL bridge.
 *
 * Unlike the screen-recording gate, the browser cannot verify any of this
 * itself: getDisplayMedia is a browser API, but LSL is invisible from here. All
 * this page can do is ask the bridge what it sees, so every check below is
 * really "the bridge reports that...".
 */

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      {ok
        ? <IconCheck size={18} color="var(--mantine-color-green-6)" />
        : <IconX size={18} color="var(--mantine-color-red-6)" />}
      <Box>
        <Text size="sm" fw={500}>{label}</Text>
        {detail && <Text size="xs" c="dimmed">{detail}</Text>}
      </Box>
    </Group>
  );
}

Check.defaultProps = { detail: undefined };

function LslSetup({ setAnswer }: StimulusParams<undefined>) {
  const {
    enabled, bridgeConnected, status, error,
  } = useLslContext();

  const streamPresent = !!status?.connected;
  const flowing = !!status?.healthy;
  const ready = bridgeConnected && streamPresent && flowing;

  // While samples are not flowing, the last observed rate is stale and reads as
  // healthy. Report the stall instead.
  const since = status?.secondsSinceSample;
  let staleDetail = 'No samples have arrived yet.';
  if (since !== null && since !== undefined) {
    staleDetail = `No samples for ${since.toFixed(1)}s.`;
  } else if (streamPresent) {
    staleDetail = 'Attached to the stream, but no samples have arrived.';
  }

  useEffect(() => {
    setAnswer({
      status: ready,
      answers: { lslBridgeReady: ready },
      message: ready
        ? undefined
        : 'Waiting for the sensor stream. Check that the bridge and the sensor\u2019s acquisition software are both running on this machine.',
    });
  }, [ready, setAnswer]);

  if (!enabled) {
    return (
      <Box p="md">
        <Alert color="yellow" icon={<IconAlertTriangle />} title="LSL bridge not configured">
          This component needs
          {' '}
          <Code>uiConfig.lslBridge.enabled</Code>
          {' '}
          set to true in the study config.
        </Alert>
      </Box>
    );
  }

  return (
    <Box p="md">
      <Title order={1} size="h2">Sensor setup</Title>
      <Text mt="sm">
        This study records from a sensor on the local network. The checks below run
        continuously — they must all pass before the study can start.
      </Text>

      <Stack gap="sm" mt="lg">
        <Check
          ok={bridgeConnected}
          label="Bridge reachable"
          detail={bridgeConnected
            ? 'Connected to the local LSL bridge.'
            : 'Start the bridge on this machine, then wait a moment.'}
        />
        <Check
          ok={streamPresent}
          label="Sensor stream found"
          detail={status?.streamName
            ? `Attached to "${status.streamName}" (${status.channels ?? '?'} channels).`
            : 'The bridge is not seeing a sensor stream on the LSL network.'}
        />
        <Check
          ok={flowing}
          label="Samples arriving"
          detail={flowing
            ? `${status?.effectiveRate} Hz observed against ${status?.nominalRate ?? '?'} Hz nominal.`
            : staleDetail}
        />
      </Stack>

      {!bridgeConnected && (
        <Alert color="blue" mt="lg" title="Start the bridge">
          <Text size="sm">Run this on the machine presenting the study:</Text>
          <Code block mt="xs">
            cd tools/lsl-bridge
            {'\n'}
            python3 revisit_lsl_bridge.py
          </Code>
          {error && <Text size="xs" c="dimmed" mt="xs">{error}</Text>}
        </Alert>
      )}

      {status && (
        <Table mt="lg" withTableBorder withColumnBorders>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>Buffered</Table.Td>
              <Table.Td>
                {flowing ? `${status.bufferedSeconds}s` : 'stream stalled'}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Dropped-sample gaps</Table.Td>
              <Table.Td>{status.gaps}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Clock offset to sensor host</Table.Td>
              <Table.Td>
                {status.timeCorrection === null || status.timeCorrection === undefined
                  ? 'not yet measured'
                  : `${(status.timeCorrection * 1000).toFixed(3)} ms`}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Recorder</Table.Td>
              <Table.Td>
                {status.labRecorder?.available
                  ? <Badge color="green" variant="light">LabRecorder reachable</Badge>
                  : <Badge color="gray" variant="light">LabRecorder not detected</Badge>}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      )}

      {!ready && bridgeConnected && (
        <Group mt="lg" gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">Waiting for the sensor stream…</Text>
        </Group>
      )}

      <Alert color="gray" mt="lg" icon={<IconAlertTriangle />} title="What these checks do not cover">
        <Text size="sm">
          These checks confirm that data is reaching this machine. They say nothing
          about whether the signal is any good.
        </Text>
        <List size="sm" mt="xs">
          <List.Item>Optode coupling, saturation and dark channels are judged in the sensor&apos;s own acquisition software.</List.Item>
          <List.Item>Run that software&apos;s calibration before starting, and keep monitoring it during the session.</List.Item>
        </List>
      </Alert>
    </Box>
  );
}

export default LslSetup;
