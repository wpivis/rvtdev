import { useMemo } from 'react';
import { useStudyConfig } from './useStudyConfig';
import { useCurrentComponent } from '../../routes/utils';

/**
 * Whether the current component is recorded as a trial on the LSL network.
 *
 * Recording every component in the sequence produces windows for instruction,
 * setup and debrief screens, which have no experimental meaning — and, for
 * anything before the setup gate, are cut before the sensor has even been
 * verified. Components opt in instead, the way `recordScreen` does.
 */
export function useLslRecordsCurrentComponent(): boolean {
  const studyConfig = useStudyConfig();
  const currentComponent = useCurrentComponent();

  return useMemo(() => {
    const studyDefault = studyConfig?.uiConfig?.lslBridge?.recordSensor ?? false;
    const stepConfig = studyConfig?.components?.[currentComponent];
    return (stepConfig as { recordSensor?: boolean } | undefined)?.recordSensor ?? studyDefault;
  }, [studyConfig, currentComponent]);
}
