import {
  Alert, Box, Group, List, Loader, Progress, Text, Title,
} from '@mantine/core';
import { IconCheck, IconAlertTriangle } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useLslContext } from '../../../../store/hooks/useLsl';
import { StimulusParams } from '../../../../store/types';

/**
 * Holds the participant while the last sensor windows arrive.
 *
 * A window is cut a lead-out after its task ends — long enough for the
 * haemodynamic response to finish — so the final windows of a study land after
 * the participant has answered everything. That delay is part of the
 * measurement, not an implementation detail, so it belongs in the sequence as a
 * step rather than as a warning the operator has to notice.
 *
 * Place this immediately before the end of the sequence.
 */

// A bridge that dies mid-study must not trap a participant on this screen.
const GIVE_UP_AFTER_MS = 90_000;

function LslWrapUp({ setAnswer }: StimulusParams<undefined>) {
  const { enabled, pendingWindows, bridgeConnected } = useLslContext();
  const [gaveUp, setGaveUp] = useState(false);
  // The high-water mark, so progress does not jump around as windows land.
  const total = useRef(0);
  total.current = Math.max(total.current, pendingWindows.length);

  const drained = pendingWindows.length === 0;
  const done = !enabled || drained || gaveUp;

  useEffect(() => {
    if (drained) {
      return undefined;
    }
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [drained]);

  useEffect(() => {
    setAnswer({
      status: done,
      answers: { lslWrapUpComplete: drained },
      message: done
        ? undefined
        : 'Sensor data is still arriving. This screen continues on its own.',
    });
  }, [done, drained, setAnswer]);

  if (!enabled) {
    return (
      <Box p="md">
        <Text>No sensor bridge is configured for this study.</Text>
      </Box>
    );
  }

  const received = Math.max(total.current - pendingWindows.length, 0);
  const percent = total.current === 0 ? 100 : (received / total.current) * 100;

  return (
    <Box p="md">
      <Title order={1} size="h2">Finishing up</Title>

      {drained ? (
        <Alert color="green" mt="md" icon={<IconCheck />} title="All sensor data saved">
          Every task in this session has its recording. You can continue.
        </Alert>
      ) : (
        <>
          <Text mt="sm">
            Please stay on this screen. The sensor recording for the last tasks is
            still being collected — this takes a few seconds after the final task
            because the response being measured outlasts the task itself.
          </Text>
          <Group gap="xs" mt="lg">
            <Loader size="sm" />
            <Text size="sm">
              {`${received} of ${total.current} recordings saved`}
            </Text>
          </Group>
          <Progress value={percent} mt="xs" striped animated />
          <List size="sm" mt="md" c="dimmed">
            {pendingWindows.map((task) => <List.Item key={task}>{task}</List.Item>)}
          </List>
        </>
      )}

      {gaveUp && !drained && (
        <Alert color="orange" mt="lg" icon={<IconAlertTriangle />} title="Continuing without all data">
          {bridgeConnected
            ? 'Some recordings did not arrive in time. The session will continue, but those tasks will have no trace on the analysis page.'
            : 'The connection to the bridge was lost, so the remaining recordings cannot arrive. The session will continue without them.'}
        </Alert>
      )}
    </Box>
  );
}

export default LslWrapUp;
