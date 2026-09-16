import {
  useEffect, useRef, useState,
} from 'react';
import { ActionIcon, Box } from '@mantine/core';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';
import { useRecordingContext } from '../../../store/hooks/useRecording';
import { SelfViewPlacement } from './aspire';
import classes from './SelfView.module.css';

const METER_HEIGHTS = [8, 16, 22, 13, 6];
const PROBE_INTERVAL_MS = 12000;

/**
 * Attaches the study's single long-lived webcam stream to a local <video>.
 *
 * The stream is acquired once by `$webcam-recording.components.webcamRecordingPermission`
 * and stays live for the rest of the study, so every step re-attaches the same
 * MediaStream instead of calling getUserMedia again. `playsInline` is mandatory:
 * without it iOS Safari takes the preview fullscreen.
 */
function useSelfViewVideo(enabled: boolean) {
  const { webcamMediaStream, isWebcamCapturing } = useRecordingContext();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    const stream = webcamMediaStream.current;
    if (!enabled || !element || !stream) {
      return;
    }
    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }
    element.play().catch(() => undefined);
  }, [enabled, isWebcamCapturing, webcamMediaStream]);

  return { videoRef, hasVideo: enabled && isWebcamCapturing };
}

function useRotatingProbe(probes: string[]) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (probes.length < 2) {
      return undefined;
    }
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % probes.length),
      PROBE_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [probes.length]);

  return probes[index % probes.length];
}

function LevelMeter() {
  return (
    <Box style={{
      display: 'flex', alignItems: 'center', gap: 2, height: 22, flex: 'none',
    }}
    >
      {METER_HEIGHTS.map((height, barIndex) => (
        <div
          key={height.toString() + barIndex.toString()}
          className={classes.meterBar}
          style={{ height, animationDelay: `${barIndex * 0.12}s` }}
        />
      ))}
    </Box>
  );
}

function VideoTile({
  videoRef, width, height, radius,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  width: number | string;
  height: number;
  radius: number;
}) {
  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{
        width,
        height,
        borderRadius: radius,
        objectFit: 'cover',
        backgroundColor: '#212529',
        display: 'block',
        // Mirrored so it reads as a mirror, like every other front-camera preview.
        transform: 'scaleX(-1)',
      }}
    />
  );
}

export function SelfView({
  placement = 'bar',
  probes = [],
}: {
  placement?: SelfViewPlacement;
  probes?: string[];
}) {
  const { isMuted, setIsMuted, studyHasAudioRecording } = useRecordingContext();
  const { videoRef, hasVideo } = useSelfViewVideo(placement !== 'off');
  const probe = useRotatingProbe(probes);

  if (placement === 'off') {
    return null;
  }

  if (placement === 'floating') {
    // Costs zero chrome height, at the price of covering a sliver of the stimulus.
    if (!hasVideo) {
      return null;
    }
    return (
      <Box style={{
        position: 'fixed',
        top: 96,
        right: 12,
        width: 74,
        padding: 4,
        borderRadius: 8,
        backgroundColor: 'rgba(33,37,41,.92)',
        boxShadow: '0 6px 18px rgba(0,0,0,.28)',
        zIndex: 200,
      }}
      >
        <VideoTile videoRef={videoRef} width="100%" height={96} radius={5} />
        <Box style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 4,
        }}
        >
          <div className={classes.blinkDot} style={{ width: 6, height: 6, backgroundColor: '#f03e3e' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>Recording you</span>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      // Sticks to the bottom of the scroller where the browser supports it, so the
      // participant keeps the recording cue in view while reading the options.
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '5px 14px',
        minHeight: 51,
        backgroundColor: '#fff5f5',
        borderTop: '1px solid #ffc9c9',
        zIndex: 5,
      }}
    >
      {/* Landscape 4:3 on purpose: a portrait tile pushes the third option below the fold. */}
      {hasVideo && (
        <Box style={{
          width: 46, height: 34, borderRadius: 4, overflow: 'hidden', flex: 'none', boxShadow: '0 0 0 2px #f03e3e',
        }}
        >
          <VideoTile videoRef={videoRef} width={46} height={34} radius={4} />
        </Box>
      )}

      <div className={classes.blinkDot} style={{ width: 9, height: 9, backgroundColor: '#f03e3e' }} />

      <Box style={{
        display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1,
      }}
      >
        <span style={{
          fontSize: 12, fontWeight: 700, color: '#c92a2a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        >
          Recording — keep thinking aloud
        </span>
        {probe && (
          <span style={{
            fontSize: 11, color: '#495057', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
          >
            {`“${probe}”`}
          </span>
        )}
      </Box>

      <LevelMeter />

      {studyHasAudioRecording && (
        <ActionIcon
          variant="subtle"
          color="red.9"
          size={40}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          onClick={() => setIsMuted(!isMuted)}
        >
          {isMuted
            ? <IconMicrophoneOff size={22} stroke={1.5} />
            : <IconMicrophone size={22} stroke={1.5} />}
        </ActionIcon>
      )}
    </Box>
  );
}

export default SelfView;
