import { Alert, Group, Loader } from '@mantine/core';
import { useLslContext } from '../../store/hooks/useLsl';
import { useCurrentComponent } from '../../routes/utils';

/**
 * Warns, at the end of a study, that sensor traces are still arriving.
 *
 * Each per-task window is cut a lead-out after its task ends — 15 seconds by
 * default — so on a study with short tasks the last few windows land after the
 * participant has finished everything. Closing the tab or opening the analysis
 * view before they arrive loses them silently, which reads as "the trace only
 * showed up for the first couple of tasks".
 */
export function LslPendingWindows() {
  const { enabled, pendingWindows } = useLslContext();
  const currentComponent = useCurrentComponent();

  if (!enabled || currentComponent !== 'end' || pendingWindows.length === 0) {
    return null;
  }

  return (
    <Alert color="blue" mt="md" title="Still saving sensor data">
      <Group gap="xs" wrap="nowrap">
        <Loader size="xs" />
        {`${pendingWindows.length} trace${pendingWindows.length === 1 ? '' : 's'} still to arrive. `}
        Please keep this tab open until this message disappears.
      </Group>
    </Alert>
  );
}
