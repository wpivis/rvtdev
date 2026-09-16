import {
  ActionIcon,
  Alert,
  AppShell,
  Button,
  Center,
  ColorSwatch,
  Drawer,
  Group, HoverCard, Popover, SegmentedControl, Select, Stack, Text,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import * as d3 from 'd3';

import {
  IconAdjustmentsHorizontal, IconArrowLeft, IconArrowRight, IconDeviceDesktopDown, IconInfoCircle, IconMusicDown, IconPalette, IconPlayerPauseFilled, IconPlayerPlayFilled, IconRestore,
} from '@tabler/icons-react';
import { useAsync } from '../../../store/hooks/useAsync';
import { useAuth } from '../../../store/hooks/useAuth';
import {
  EditedText, ParticipantTags, Tag, TranscribedAudio, TranscriptLinesWithTimes,
} from './types';
import { AudioProvenanceVis } from '../../../components/audioAnalysis/AudioProvenanceVis';
import { TranscriptSegmentsVis } from './TranscriptSegmentsVis';
import { TagSelector } from './tags/TagSelector';
import { encryptIndex } from '../../../utils/encryptDecryptIndex';
import { parseTrialOrder } from '../../../utils/parseTrialOrder';
import { PREFIX } from '../../../utils/Prefix';
import { handleTaskAudio, handleTaskRecordings } from '../../../utils/handleDownloadFiles';
import { ParticipantRejectModal } from '../ParticipantRejectModal';
import { StorageEngine } from '../../../storage/engines/types';
import { useReplayContext } from '../../../store/hooks/useReplay';
import {
  buildProvenanceLegendEntries,
} from '../../../components/audioAnalysis/provenanceColors';
import { revisitPageId, syncChannel } from '../../../utils/syncReplay';
import { getLegacyStoredAnswerProvenance } from '../../../store/provenance';
import { buildTaskNavigationTarget } from './taskNavigation';

const margin = {
  left: 5, top: 0, right: 5, bottom: 0,
};

function getParticipantData(trrackId: string | undefined, storageEngine: StorageEngine | undefined) {
  if (storageEngine) {
    return storageEngine.getParticipantData(trrackId);
  }

  return null;
}

function getLegacyProvenance(answer: unknown) {
  return getLegacyStoredAnswerProvenance(answer);
}

async function getTaskProvenance(
  storageEngine: StorageEngine | undefined,
  participantId: string,
  currentTrial: string,
  answer: unknown,
) {
  const legacyProvenance = getLegacyProvenance(answer);

  if (!storageEngine || !participantId || !currentTrial) {
    return legacyProvenance;
  }

  try {
    return await storageEngine.getProvenance(currentTrial, participantId) ?? legacyProvenance;
  } catch {
    return legacyProvenance;
  }
}

async function getParticipantTags(authEmail: string, trrackId: string | undefined, studyId: string, storageEngine: StorageEngine | undefined) {
  if (storageEngine && trrackId) {
    return (await storageEngine.getAllParticipantAndTaskTags(authEmail, trrackId));
  }

  return null;
}

async function getTags(storageEngine: StorageEngine | undefined, type: 'participant' | 'task' | 'text') {
  if (storageEngine) {
    const tags = await storageEngine.getTags(type);
    if (Array.isArray(tags)) {
      return tags;
    }
    return [];
  }

  return [];
}

function getBrowser(ua: string) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

export function ThinkAloudFooter({
  visibleParticipants, rawTranscript, currentShownTranscription, width, onTimeUpdate, isReplay, editedTranscript, currentTrial, saveProvenance, jumpedToLine = 0, studyId, setHasAudio, storageEngine,
}: {
  visibleParticipants: string[], rawTranscript: TranscribedAudio | null, currentShownTranscription: number | null, width: number, onTimeUpdate: (n: number) => void, isReplay: boolean, editedTranscript?: EditedText[], currentTrial: string, saveProvenance: (prov: unknown) => void, jumpedToLine?: number, studyId: string, setHasAudio: (b: boolean) => void, storageEngine: StorageEngine | undefined,
}) {
  const auth = useAuth();

  // The replay footer is a dense desktop toolbar. On a phone its fixed-width
  // controls ran off the right edge, so below this breakpoint it becomes three
  // stacked rows and only the least-used strip scrolls sideways.
  const isNarrow = useMediaQuery('(max-width: 768px)') ?? false;
  const [controlsOpened, setControlsOpened] = useState(false);
  const controlOffset = isNarrow ? 0 : 'lg';
  // On a phone the selectors live in a bottom drawer, where they get the full
  // width instead of competing for room in the bar.
  const selectStyle = isNarrow ? { width: '100%' } : { width: '200px' };
  const tagStackStyle = isNarrow ? { width: '100%' } : undefined;
  const tagSelectorWidth = isNarrow ? 250 : 200;

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const participantId = useMemo(() => searchParams.get('participantId') || '', [searchParams]);

  const { value: participant } = useAsync(getParticipantData, [participantId, storageEngine]);
  const { value: provenanceGraph } = useAsync(getTaskProvenance, [storageEngine, participantId, currentTrial, participant?.answers[currentTrial]]);

  const { value: taskTags, execute: pullTags } = useAsync(getTags, [storageEngine, 'task']);

  const { value: allParticipantTags, execute: pullAllParticipantTags } = useAsync(getTags, [storageEngine, 'participant']);

  const {
    isPlaying, setIsPlaying, speed, setSpeed, setSeekTime, hasEnded,
  } = useReplayContext();

  const assetKey = `${participantId}\u0000${currentTrial}`;
  const [audio, setAudio] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const [screenRecording, setScreenRecording] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const [webcamRecording, setWebcamRecording] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const audioUrl = audio.key === assetKey ? audio.url : null;
  const screenRecordingUrl = screenRecording.key === assetKey ? screenRecording.url : null;
  const webcamRecordingUrl = webcamRecording.key === assetKey ? webcamRecording.url : null;

  useEffect(() => {
    let cancelled = false;
    const loadedUrls: string[] = [];
    const releaseUrl = (url: string | null) => {
      if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
    const setLoadedAsset = (
      setter: (value: { key: string; url: string | null }) => void,
      url: string | null,
    ) => {
      if (cancelled) {
        releaseUrl(url);
        return;
      }
      if (url) loadedUrls.push(url);
      setter({ key: assetKey, url });
    };

    async function fetchAssetsUrl() {
      setAudio({ key: assetKey, url: null });
      setScreenRecording({ key: assetKey, url: null });
      setWebcamRecording({ key: assetKey, url: null });

      if (!storageEngine || !participantId || !currentTrial) {
        return;
      }

      try {
        const url = await storageEngine.getAudioUrl(currentTrial, participantId);
        setLoadedAsset(setAudio, url);
      } catch {
        if (!cancelled) {
          setAudio({ key: assetKey, url: null });
        }
      }

      try {
        const url = await storageEngine.getScreenRecording(currentTrial, participantId);
        setLoadedAsset(setScreenRecording, url);
      } catch {
        if (!cancelled) {
          setScreenRecording({ key: assetKey, url: null });
        }
      }

      try {
        const url = await storageEngine.getWebcamRecording(currentTrial, participantId);
        setLoadedAsset(setWebcamRecording, url);
      } catch {
        if (!cancelled) {
          setWebcamRecording({ key: assetKey, url: null });
        }
      }
    }

    fetchAssetsUrl();

    return () => {
      cancelled = true;
      loadedUrls.forEach(releaseUrl);
    };
  }, [assetKey, currentTrial, participantId, storageEngine]);

  const handleDownloadAudio = useCallback(async () => {
    if (!storageEngine || !participantId || !currentTrial) {
      return;
    }

    await handleTaskAudio({
      storageEngine,
      participantId,
      identifier: currentTrial,
      audioUrl,
    });
  }, [storageEngine, participantId, currentTrial, audioUrl]);

  const handleDownloadRecordings = useCallback(async () => {
    if (!storageEngine || !participantId || !currentTrial) {
      return;
    }

    await handleTaskRecordings({
      storageEngine,
      participantId,
      identifier: currentTrial,
      includeScreen: !!screenRecordingUrl,
      includeWebcam: !!webcamRecordingUrl,
      screenRecordingUrl,
      webcamRecordingUrl,
    });
  }, [storageEngine, participantId, currentTrial, screenRecordingUrl, webcamRecordingUrl]);

  const [transcriptLines, setTranscriptLines] = useState<TranscriptLinesWithTimes[] | null>(null);

  const { value: participantTags, execute: pullParticipantTags } = useAsync(getParticipantTags, [auth.user.user?.email || 'temp', participantId, studyId, storageEngine]);

  const [localParticipantTags, setLocalParticipantTags] = useState<ParticipantTags>();

  useEffect(() => {
    if (participantTags) {
      setLocalParticipantTags(participantTags);
    }
  }, [participantTags]);

  const currentTrialClean = useMemo(() => {
    if (currentTrial.includes('__dynamicLoading')) {
      return '';
    }

    return participant?.answers[currentTrial]?.componentName ?? '';
  }, [currentTrial, participant]);

  const xScale = useMemo(() => {
    if (!participant || !participant.answers[currentTrial]) {
      return null;
    }

    const allStartTimes = Object.values(participant.answers || {}).map((answer) => [answer.startTime, answer.endTime]).flat();

    const extent = d3.extent(allStartTimes) as [number, number];

    const scale = d3.scaleLinear([margin.left, width + margin.left + margin.right]).domain(currentTrial ? [participant.answers[currentTrial].startTime, participant.answers[currentTrial].endTime] : extent).clamp(true);

    return scale;
  }, [participant, currentTrial, width]);

  useEffect(() => {
    const lines: TranscriptLinesWithTimes[] = [];

    if (!editedTranscript || editedTranscript.length === 0) {
      setTranscriptLines(null);

      return;
    }

    editedTranscript.forEach((l, i) => {
      if (rawTranscript && (i === 0 || l.transcriptMappingStart !== editedTranscript[i - 1].transcriptMappingStart)) {
        lines.push({
          start: i === 0 ? 0 : rawTranscript.results[l.transcriptMappingStart - 1].resultEndTime as number,
          end: i === editedTranscript.length - 1 ? rawTranscript.results[l.transcriptMappingEnd].resultEndTime as number + 500 : rawTranscript.results[l.transcriptMappingEnd].resultEndTime as number,
          lineStart: l.transcriptMappingStart,
          lineEnd: l.transcriptMappingEnd,
          tags: editedTranscript.filter((t) => t.transcriptMappingStart === l.transcriptMappingStart && t.transcriptMappingEnd === l.transcriptMappingEnd).map((t) => t.selectedTags),
        });
      }
    });

    setTranscriptLines(lines);
  }, [editedTranscript, setTranscriptLines, rawTranscript]);

  const nextParticipantCallback = useCallback((indexChange: number) => {
    let index = visibleParticipants.findIndex((part) => part === participantId) + indexChange;

    if (index >= visibleParticipants.length) {
      index = 0;
    } else if (index < 0) {
      index = visibleParticipants.length - 1;
    }

    syncChannel.postMessage({
      key: 'participantId',
      value: visibleParticipants[index],
    });

    setSearchParams((params) => {
      params.set('participantId', visibleParticipants[index] || '');
      return params;
    });
  }, [participantId, setSearchParams, visibleParticipants]);

  const orderedAnswers = useMemo(() => {
    if (!participant) {
      return [];
    }

    const answers = Object.values(participant.answers);
    answers.sort((answerA, answerB) => {
      const a = parseTrialOrder(answerA.trialOrder);
      const b = parseTrialOrder(answerB.trialOrder);

      if (a.step !== b.step) {
        return (a.step ?? Number.MAX_SAFE_INTEGER) - (b.step ?? Number.MAX_SAFE_INTEGER);
      }

      if (a.funcIndex !== b.funcIndex) {
        return (a.funcIndex ?? -1) - (b.funcIndex ?? -1);
      }

      return answerA.identifier.localeCompare(answerB.identifier);
    });

    return answers;
  }, [participant]);

  const navigateToTask = useCallback((answerIdentifier: string) => {
    if (!participant) {
      return;
    }

    const answer = participant.answers[answerIdentifier];
    if (!answer) {
      return;
    }

    const navigationTarget = buildTaskNavigationTarget({
      answerIdentifier,
      trialOrder: answer.trialOrder,
      isReplay,
      studyId,
      search: location.search,
    });

    if (!navigationTarget) {
      return;
    }

    navigate(navigationTarget);

    if (answer.trialOrder) {
      syncChannel.postMessage({
        key: 'trialOrder',
        value: answer.trialOrder,
      });
    }
  }, [isReplay, location.search, navigate, participant, studyId]);

  const nextTaskCallback = useCallback((indexChange: number) => {
    if (!currentTrial || orderedAnswers.length === 0) {
      return;
    }

    const currentIndex = orderedAnswers.findIndex((answer) => answer.identifier === currentTrial);
    if (currentIndex === -1) {
      const fallbackIndex = indexChange >= 0 ? 0 : orderedAnswers.length - 1;
      navigateToTask(orderedAnswers[fallbackIndex].identifier);
      return;
    }

    let nextIndex = currentIndex + indexChange;
    if (nextIndex >= orderedAnswers.length) {
      nextIndex = 0;
    } else if (nextIndex < 0) {
      nextIndex = orderedAnswers.length - 1;
    }

    navigateToTask(orderedAnswers[nextIndex].identifier);
  }, [currentTrial, navigateToTask, orderedAnswers]);

  const setTags = useCallback(async (_tags: Tag[], type: 'task' | 'participant') => {
    if (!storageEngine) {
      return;
    }

    await storageEngine.saveTags(_tags, type);
    if (type === 'task') {
      await pullTags(storageEngine, type);
    } else {
      await pullAllParticipantTags(storageEngine, type);
    }
  }, [pullAllParticipantTags, pullTags, storageEngine]);

  const editTaskTagCallback = useCallback(async (oldTag: Tag, newTag: Tag) => {
    if (!taskTags) {
      return;
    }

    const tagIndex = taskTags.findIndex((t) => t.id === oldTag.id);
    const tagsCopy = Array.from(taskTags);
    tagsCopy[tagIndex] = newTag;

    await setTags(tagsCopy, 'task');
  }, [setTags, taskTags]);

  const editParticipantTagCallback = useCallback(async (oldTag: Tag, newTag: Tag) => {
    if (!allParticipantTags) {
      return;
    }

    const tagIndex = allParticipantTags.findIndex((t) => t.id === oldTag.id);
    const tagsCopy = Array.from(allParticipantTags);
    tagsCopy[tagIndex] = newTag;

    await setTags(tagsCopy, 'participant');
  }, [setTags, allParticipantTags]);

  const createTaskTagCallback = useCallback((t: Tag) => setTags([...(taskTags || []), t], 'task'), [setTags, taskTags]);

  const createParticipantTagCallback = useCallback((t: Tag) => setTags([...(allParticipantTags || []), t], 'participant'), [allParticipantTags, setTags]);

  useEffect(() => {
    const t = transcriptLines ? transcriptLines[jumpedToLine]?.start || 0 : 0;
    setSeekTime(t + 0.001);
  }, [jumpedToLine, transcriptLines, setSeekTime]);

  const [timeString, setTimeString] = useState<string>('');

  const provenanceLegendEntries = useMemo(() => {
    if (!provenanceGraph) {
      return new Map<string, { label: string; color: string }>();
    }

    return buildProvenanceLegendEntries(Object.values(provenanceGraph));
  }, [provenanceGraph]);

  const tasksList = useMemo(() => orderedAnswers
    .filter((answer) => answer.identifier && answer.componentName)
    .map((answer) => ({
      label: answer.componentName,
      value: answer.identifier,
    })), [orderedAnswers]);

  const transcriptHref = useMemo(() => `${PREFIX}analysis/stats/${studyId}/tagging${currentTrial ? `/${encodeURIComponent(currentTrial)}` : ''}?participantId=${participantId}&revisitPageId=${revisitPageId}`, [currentTrial, participantId, studyId]);

  const replayHref = useMemo(() => {
    const { step, funcIndex } = parseTrialOrder(participant?.answers[currentTrial]?.trialOrder);
    const currentStep = step ?? 0;
    const funcPath = funcIndex === null ? '' : `/${encryptIndex(funcIndex)}`;

    return `${PREFIX}${studyId}/${encryptIndex(currentStep)}${funcPath}?participantId=${participantId}&revisitPageId=${revisitPageId}`;
  }, [currentTrial, participant, participantId, studyId]);

  const participantMatchesSelection = participant?.participantId === participantId;
  const participantUsedSameBrowser = useMemo(() => getBrowser(participant?.metadata?.userAgent ?? '') === getBrowser(navigator.userAgent), [participant]);

  const [browserWarningDismissed, setBrowserWarningDismissed] = useState(false);
  useEffect(() => {
    setBrowserWarningDismissed(false);
  }, [participantId, screenRecordingUrl, webcamRecordingUrl]);

  const trailingControls = (
    <>
      <Button
        mt={controlOffset}
        variant="light"
        component="a"
        href={isReplay ? transcriptHref : replayHref}
        target="_blank"
      >
        {isReplay ? 'Transcript' : 'Replay'}
      </Button>
      <Group mt={controlOffset} wrap="nowrap">
        {audioUrl && (
        <Tooltip label="Download audio">
          <ActionIcon variant="light" size={30} onClick={handleDownloadAudio}>
            <IconMusicDown />
          </ActionIcon>
        </Tooltip>
        )}
        {(screenRecordingUrl || webcamRecordingUrl) && (
        <Tooltip label="Download recordings">
          <ActionIcon variant="light" size={30} onClick={handleDownloadRecordings}>
            <IconDeviceDesktopDown />
          </ActionIcon>
        </Tooltip>
        )}
        <ParticipantRejectModal selectedParticipants={[]} footer />
      </Group>
      {provenanceLegendEntries.size > 1 && (
      <HoverCard width={160} position="top" withArrow shadow="md">
        <HoverCard.Target>
          <ActionIcon c="" size="lg" variant="light" mt={controlOffset} style={{ cursor: 'default' }}><IconPalette /></ActionIcon>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          <Stack gap={6}>
            {Array.from(provenanceLegendEntries.entries()).map(([key, value]) => (
              <Group key={key} gap={8}>
                <ColorSwatch color={value.color} size={12} />
                <span style={{ fontSize: 12 }}>{value.label}</span>
              </Group>
            ))}
          </Stack>
        </HoverCard.Dropdown>
      </HoverCard>
      )}
    </>
  );

  const transportControls = (
    <Group wrap="nowrap" gap={isNarrow ? 2 : undefined}>
      <Text ff="monospace" style={{ textAlign: 'right' }} mt={controlOffset} c="dimmed">{timeString}</Text>

      <Tooltip label={hasEnded ? 'Restart' : isPlaying ? 'Pause' : 'Play'}>
        <ActionIcon aria-label={hasEnded ? 'Restart' : isPlaying ? 'Pause' : 'Play'} mt={isNarrow ? 0 : 25} size="lg" variant="light" onClick={() => { setIsPlaying(!isPlaying); }}>
          {hasEnded ? <IconRestore /> : isPlaying ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
        </ActionIcon>
      </Tooltip>

      <Popover styles={{ dropdown: { padding: 0 } }} position="bottom" withArrow shadow="md">
        <Popover.Target>
          <Tooltip label="Speed">
            <ActionIcon style={{ width: '50px' }} mt={isNarrow ? 0 : 25} variant="light">
              {`${speed}x`}
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <SegmentedControl
            value={speed.toString()}
            onChange={(s) => {
              setSpeed(+s);
              syncChannel.postMessage({
                key: 'currentSpeed',
                value: s,
              });
            }}
            orientation="vertical"
            data={[
              { label: '0.5x', value: '0.5' },
              { label: '1x', value: '1' },
              { label: '1.5x', value: '1.5' },
              { label: '2x', value: '2' },
              { label: '4x', value: '4' },
              { label: '8x', value: '8' },
            ]}
          />
          <Stack gap="xs" />
        </Popover.Dropdown>
      </Popover>

    </Group>
  );

  const participantSelect = (
    <Select
      leftSection={(
        <Tooltip label="Previous Participant">
          <ActionIcon size="sm" variant="light" onClick={() => nextParticipantCallback(-1)}>
            <IconArrowLeft />
          </ActionIcon>
        </Tooltip>
              )}
      rightSection={(
        <Tooltip label="Next Participant">
          <ActionIcon size="sm" variant="light" onClick={() => nextParticipantCallback(1)} style={{ pointerEvents: 'all' }}>
            <IconArrowRight />
          </ActionIcon>
        </Tooltip>
              )}
      label="Participant Id"
      style={selectStyle}
      value={participantId}
      onChange={(e: string | null) => {
        setSearchParams((params) => {
          params.set('participantId', e || '');
          return params;
        });
        syncChannel.postMessage({
          key: 'participantId',
          value: e || '',
        });
      }}
      data={visibleParticipants.map((part) => part).sort()}
      searchable
    />
  );

  const participantTagsBlock = (
    <Stack gap="4" style={tagStackStyle}>
      <Group gap="xs" align="center">
        <Text size="sm" fw={500}>Participant Tags</Text>
        <Tooltip w={300} multiline label="Participant tags allow you to categorize or label the participant. Click in the box to add, create, or edit tags.">
          <IconInfoCircle size={16} />
        </Tooltip>
      </Group>
      <TagSelector
        width={tagSelectorWidth}
        tags={allParticipantTags || []}
        editTagCallback={editParticipantTagCallback}
        createTagCallback={createParticipantTagCallback}
        tagsEmptyText="Add Participant Tags"
        onSelectTags={(tempTags) => {
          if (storageEngine && participantTags) {
            let copy = structuredClone(participantTags);
            if (copy) {
              copy.participantTags = tempTags;
            } else {
              copy = { participantTags: [], taskTags: {} };
              copy.participantTags = tempTags;
            }
            setLocalParticipantTags(copy);
            storageEngine.saveAllParticipantAndTaskTags(auth.user.user?.email || 'temp', participantId, copy).then(() => {
              pullParticipantTags(auth.user.user?.email || 'temp', participantId, studyId, storageEngine);
            });
          }
        }}
        selectedTags={localParticipantTags ? localParticipantTags.participantTags : []}
      />
    </Stack>
  );

  const taskSelect = (
    <Select
      leftSection={(
        <Tooltip label="Previous Task">
          <ActionIcon size="sm" variant="light" onClick={() => nextTaskCallback(-1)}>
            <IconArrowLeft />
          </ActionIcon>
        </Tooltip>
              )}
      rightSection={(
        <Tooltip label="Next Task">
          <ActionIcon size="sm" variant="light" onClick={() => nextTaskCallback(1)} style={{ pointerEvents: 'all' }}>
            <IconArrowRight />
          </ActionIcon>
        </Tooltip>
              )}
      label="Task"
      style={selectStyle}
      value={currentTrial}
              // this needs to be in a helper or two which we dont currently have
      onChange={(e: string | null) => {
        if (e) {
          navigateToTask(e);
        }
      }}
      data={tasksList}
      searchable
    />
  );

  const taskTagsBlock = (
    <Stack gap="4" style={tagStackStyle}>
      <Group gap="xs" align="center">
        <Text size="sm" fw={500}>Task Tags</Text>
        <Tooltip w={300} multiline label="Task tags allow you to categorize or label the current task. Click in the box to add, create, or edit tags.">
          <IconInfoCircle size={16} />
        </Tooltip>
      </Group>
      <TagSelector
        width={tagSelectorWidth}
        tags={taskTags || []}
        editTagCallback={editTaskTagCallback}
        createTagCallback={createTaskTagCallback}
        tagsEmptyText="Add Task Tags"
        onSelectTags={(tempTag) => {
          if (storageEngine && participantTags) {
            let copy = structuredClone(participantTags);
            if (copy) {
              copy.taskTags[currentTrial] = tempTag;
            } else {
              copy = { participantTags: [], taskTags: {} };
              copy.taskTags[currentTrial] = tempTag;
            }
            setLocalParticipantTags(copy);

            storageEngine.saveAllParticipantAndTaskTags(auth.user.user?.email || 'temp', participantId, copy).then(() => {
              pullParticipantTags(auth.user.user?.email || 'temp', participantId, studyId, storageEngine);
            });
          }
        }}
        selectedTags={localParticipantTags ? localParticipantTags.taskTags[currentTrial] || [] : []}
      />
    </Stack>
  );

  return (
    <AppShell.Footer zIndex={101} withBorder={false}>
      {currentTrial && participant && currentTrialClean === '' && (
        <div style={{
          position: 'absolute', top: -5, left: 5, transform: 'translateY(-100%)',
        }}
        >
          <Alert variant="filled" color="red" title="Participant hasn&apos;t completed any tasks." icon={<IconInfoCircle />} />
        </div>
      )}
      {participantMatchesSelection && (screenRecordingUrl || webcamRecordingUrl) && !participantUsedSameBrowser && !browserWarningDismissed && (
        <div style={{
          position: 'absolute', top: -5, left: 5, transform: 'translateY(-100%)',
        }}
        >
          <Alert withCloseButton onClose={() => setBrowserWarningDismissed(true)} variant="filled" color="red" title={`Participant used ${getBrowser(participant.metadata?.userAgent ?? '')} — you are using ${getBrowser(navigator.userAgent)}. Video playback may not work properly.`} icon={<IconInfoCircle />} />
        </div>
      )}
      <Stack
        style={{
          backgroundColor: 'var(--mantine-color-blue-1)',
          height: '100%',
          // Belt and braces: if the stacked rows ever outgrow the footer height,
          // scroll rather than clip the controls off the bottom of the screen.
          overflowY: isNarrow ? 'auto' : undefined,
        }}
        gap={5}
        justify="center"
      >

        {participant && currentTrial && (!participant.answers[currentTrial] || participant.answers[currentTrial].endTime === -1) ? <Center><Text c="dimmed">{`Participant ${participant.participantId} has not completed this task`}</Text></Center> : null}
        <AudioProvenanceVis setHasAudio={setHasAudio} saveProvenance={saveProvenance} setTime={onTimeUpdate} setTimeString={(_t) => setTimeString(_t)} answers={participant ? participant.answers : {}} taskName={currentTrial} context={isReplay ? 'provenanceVis' : 'audioAnalysis'} />
        {xScale && transcriptLines ? <TranscriptSegmentsVis startTime={xScale.domain()[0]} xScale={xScale} transcriptLines={transcriptLines} currentShownTranscription={currentShownTranscription || 0} /> : null}

        <Group
          gap={isNarrow ? 2 : 'xs'}
          style={{ width: '100%' }}
          justify="center"
          wrap="nowrap"
          mb={isReplay ? 0 : 'md'}
          px={isNarrow ? 6 : 0}
        >
          {isNarrow ? (
            <>
              {transportControls}
              <Tooltip label="Previous task">
                <ActionIcon aria-label="Previous task" size="lg" variant="subtle" onClick={() => nextTaskCallback(-1)}>
                  <IconArrowLeft />
                </ActionIcon>
              </Tooltip>
              <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 0 }} truncate="end">{currentTrial}</Text>
              <Tooltip label="Next task">
                <ActionIcon aria-label="Next task" size="lg" variant="subtle" onClick={() => nextTaskCallback(1)}>
                  <IconArrowRight />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Replay controls">
                <ActionIcon aria-label="Replay controls" size="lg" variant="light" onClick={() => setControlsOpened(true)}>
                  <IconAdjustmentsHorizontal />
                </ActionIcon>
              </Tooltip>
            </>
          ) : (
            <>
              {transportControls}

              <Group wrap="nowrap" gap="lg">
                {participantSelect}
                {participantTagsBlock}
                {taskSelect}
                {taskTagsBlock}
              </Group>
              {trailingControls}
            </>
          )}
        </Group>
      </Stack>
      <Drawer
        opened={isNarrow && controlsOpened}
        onClose={() => setControlsOpened(false)}
        position="bottom"
        size={420}
        title="Replay controls"
        // Above the floating webcam overlay (z-index 1000), which otherwise
        // sits on top of the participant selector.
        zIndex={2000}
      >
        <Stack gap="md" pb="md">
          {participantSelect}
          {participantTagsBlock}
          {taskSelect}
          {taskTagsBlock}
          <Group gap="xs" wrap="wrap">
            {trailingControls}
          </Group>
        </Stack>
      </Drawer>
    </AppShell.Footer>
  );
}
