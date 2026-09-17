import { useParams, useSearchParams } from 'react-router';

import { useCallback, useEffect, useMemo } from 'react';
import { useAsync } from '../../store/hooks/useAsync';

import { useStorageEngine } from '../../storage/storageEngineHooks';
import { StorageEngine } from '../../storage/engines/types';
import { ThinkAloudFooter } from '../../analysis/individualStudy/thinkAloud/ThinkAloudFooter';
import { useCurrentIdentifier } from '../../routes/utils';
import { useStoreActions, useStoreDispatch } from '../../store/store';
import { LslWindow } from '../../store/hooks/useLsl';

async function getAllParticipantsNames(storageEngine: StorageEngine | undefined) {
  if (storageEngine) {
    return (await storageEngine.getAllParticipantIds());
  }
  return null;
}

// Fetched once here rather than inside the trace: the footer needs the answer
// to size itself before rendering, and a second read would fetch the same asset
// twice for every task.
async function getSensorWindowForTask(
  storageEngine: StorageEngine | undefined,
  task: string,
  participantId: string,
): Promise<LslWindow | null> {
  if (!storageEngine?.getSensorWindow || !task || !participantId) {
    return null;
  }
  return storageEngine.getSensorWindow(task, participantId) as Promise<LslWindow | null>;
}

export function AnalysisFooter({ setHasAudio, setHasSensor }: {
  setHasAudio: (b: boolean) => void;
  setHasSensor: (b: boolean) => void;
}) {
  const { storageEngine } = useStorageEngine();

  const { value: allParticipants } = useAsync(getAllParticipantsNames, [storageEngine]);

  const identifier = useCurrentIdentifier();

  const storeDispatch = useStoreDispatch();

  const { studyId } = useParams();

  const [searchParams] = useSearchParams();
  const participantId = useMemo(() => searchParams.get('participantId') || '', [searchParams]);

  const {
    saveAnalysisState,
  } = useStoreActions();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveProvenance = useCallback((prov: any) => storeDispatch(saveAnalysisState(prov)), [storeDispatch, saveAnalysisState]);

  const { value: sensorWindow } = useAsync(
    getSensorWindowForTask,
    [storageEngine, identifier, participantId],
  );

  useEffect(() => {
    setHasSensor(!!sensorWindow);
  }, [sensorWindow, setHasSensor]);

  return (
    <ThinkAloudFooter
      sensorWindow={sensorWindow}
      storageEngine={storageEngine}
      setHasAudio={setHasAudio}
      studyId={studyId || ''}
      currentTrial={identifier}
      isReplay
      visibleParticipants={allParticipants || []}
      rawTranscript={null}
      currentShownTranscription={null}
      width={3000}
      onTimeUpdate={() => {}}
      saveProvenance={saveProvenance}
    />
  );
}
