import { useEffect, useState } from 'react';
import { ActionIcon, Box } from '@mantine/core';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';
import { StimulusParams } from '../../../store/types';
import { useRecordingContext } from '../../../store/hooks/useRecording';
import { usePreviousStep } from '../../../store/hooks/usePreviousStep';
import {
  LEVEL_STYLE, REFLECT_HEADING, ReflectParameters, findLevel, formatDuration,
} from './aspire';
import { SelfView } from './SelfView';
import classes from './ThinkAloudReflect.module.css';

const WAVE_HEIGHTS = [10, 20, 30, 17, 26, 12, 22, 8];
const WAVE_COLORS = ['#ff8787', '#ff6b6b', '#fa5252', '#f03e3e', '#f03e3e', '#fa5252', '#ff6b6b', '#ff8787'];

function useElapsedSeconds(running: boolean) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return seconds;
}

function RecordingPanel() {
  const { isMuted, setIsMuted, studyHasAudioRecording } = useRecordingContext();
  const recording = studyHasAudioRecording && !isMuted;
  const seconds = useElapsedSeconds(recording);

  return (
    <Box
      className={recording ? undefined : classes.paused}
      style={{
        border: '1px solid #ffc9c9',
        backgroundColor: '#fff5f5',
        borderRadius: 8,
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <ActionIcon
        radius="50%"
        size={76}
        aria-label={isMuted ? 'Resume recording' : 'Pause recording'}
        onClick={() => setIsMuted(!isMuted)}
        style={{
          backgroundColor: '#f03e3e',
          color: '#fff',
          boxShadow: '0 0 0 8px rgba(240,62,62,.14)',
        }}
      >
        {isMuted
          ? <IconMicrophoneOff size={34} stroke={1.5} />
          : <IconMicrophone size={34} stroke={1.5} />}
      </ActionIcon>

      <Box style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#c92a2a',
      }}
      >
        <div className={classes.blinkDot} style={{ width: 9, height: 9, backgroundColor: '#f03e3e' }} />
        {recording ? `Recording · ${formatDuration(seconds)}` : 'Paused'}
      </Box>

      <Box style={{
        display: 'flex', alignItems: 'center', gap: 4, height: 30,
      }}
      >
        {WAVE_HEIGHTS.map((height, barIndex) => (
          <div
            key={height.toString() + barIndex.toString()}
            className={classes.waveBar}
            style={{
              height,
              backgroundColor: WAVE_COLORS[barIndex],
              animationDelay: `${barIndex * 0.09}s`,
            }}
          />
        ))}
      </Box>

      <span style={{ fontSize: 12, color: '#495057', textAlign: 'center' }}>
        {recording
          ? 'We are listening. Take your time.'
          : 'Tap the microphone when you are ready to talk.'}
      </span>
    </Box>
  );
}

export function ThinkAloudReflect({ parameters, setAnswer, answers }: StimulusParams<ReflectParameters>) {
  const level = findLevel(answers, parameters.indicatorComponent);
  const { goToPreviousStep, isPreviousDisabled } = usePreviousStep();

  // Speech is the primary channel here, so the step never blocks on the typed fallback.
  useEffect(() => {
    setAnswer({ status: true, answers: { reflectedOn: level ?? '' } });
  }, [level, setAnswer]);

  const style = level ? LEVEL_STYLE[level] : null;

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 16px 8px' }}>
      {style && level && (
        <Box style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          border: '1px solid #dee2e6',
          borderRadius: 8,
          backgroundColor: '#f8f9fa',
          padding: '10px 12px',
        }}
        >
          <span style={{
            width: 22, height: 22, borderRadius: '50%', backgroundColor: style.dot, flex: 'none',
          }}
          />
          <span style={{ fontSize: 13, color: '#212529', flex: 1 }}>
            You answered
            {' '}
            <strong>{style.label}</strong>
            {' '}
            {`for “${parameters.lifemapName}”`}
          </span>
          <Box
            component="button"
            type="button"
            onClick={goToPreviousStep}
            disabled={isPreviousDisabled}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#228be6',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              flex: 'none',
            }}
          >
            Change
          </Box>
        </Box>
      )}

      <h2 style={{
        fontSize: 18, fontWeight: 700, lineHeight: 1.25, margin: 0,
      }}
      >
        {level ? REFLECT_HEADING[level] : 'Tell us what you were weighing'}
      </h2>

      <span style={{ fontSize: 14, color: '#495057' }}>
        Talk for as long as you like. Tell us what you were weighing as you read the three
        descriptions, and share only what you are comfortable sharing.
      </span>

      <RecordingPanel />

      <SelfView placement={parameters.selfView} probes={parameters.probes} />
    </Box>
  );
}

export default ThinkAloudReflect;
