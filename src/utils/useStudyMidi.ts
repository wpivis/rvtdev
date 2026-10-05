import { useEffect, useState } from 'react';
import { StudyConfig } from '../parser/types';
import { studyComponentToIndividualComponent } from './handleComponentInheritance';

/**
 * Whether the study captures MIDI anywhere, either study-wide in `uiConfig` or on
 * an individual component.
 *
 * The `$midi.components.midiConnection` setup component uses this to warn an
 * author who imported the library but never turned capture on -- in that state
 * the participant is asked for their instrument and nothing is recorded, which
 * is silent and easy to miss.
 */
export function useStudyMidi(studyConfig: StudyConfig | undefined) {
  const [hasMidiCapture, setHasMidiCapture] = useState(false);

  useEffect(() => {
    if (!studyConfig) {
      setHasMidiCapture(false);
      return;
    }

    const { captureMidi } = studyConfig.uiConfig;
    const componentConfig = Object.keys(studyConfig.components)
      .map((componentId) => studyComponentToIndividualComponent(studyConfig.components[componentId], studyConfig));

    setHasMidiCapture(Boolean(captureMidi) || componentConfig.some((component) => component.captureMidi));
  }, [studyConfig]);

  return { hasMidiCapture };
}
