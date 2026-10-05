import {
  Alert, Badge, Box, Button, Code, Group, List, Stack, Table, Text, Title,
} from '@mantine/core';
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { StimulusParams } from '../../../../store/types';
import { useMidi, type MidiNoteMessage } from '../../../../store/hooks/useMidi';
import { MidiKeyboard } from '../../../../components/interface/MidiKeyboard';
import { useStudyConfig } from '../../../../store/hooks/useStudyConfig';
import { useStudyMidi } from '../../../../utils/useStudyMidi';
import { noteName, velocityDynamic } from '../../../../utils/midiNotes';

/** C3 to C6: three octaves, matching a common 37-key controller. */
const DEFAULT_LOWEST_NOTE = 48;
const DEFAULT_KEY_COUNT = 37;

/** How many recent notes to show back to the participant. */
const RECENT_NOTE_LIMIT = 8;

interface MidiConnectionParams {
  /** Lowest note to draw on the confirmation keyboard. Defaults to 48 (C3). */
  lowestNote?: number;
  /** How many semitones to draw. Defaults to 37. */
  keyCount?: number;
  /**
   * How many notes the participant must play before Continue unlocks. Defaults
   * to 1. Raise it if you want them to have felt the instrument out a little.
   */
  requiredNotes?: number;
}

interface PlayedNote {
  note: number;
  velocity: number;
  at: number;
}

/**
 * Setup gate for studies that take input from a MIDI instrument.
 *
 * Unlike the gamepad's equivalent, the browser does not force this step: Web MIDI
 * hands over the device list as soon as access is granted, with no arming gesture
 * required. The gate exists for the study's sake rather than the browser's -- it
 * gets any permission prompt out of the way before a task starts, confirms the
 * right instrument is selected, and confirms that velocity actually varies, which
 * is the one thing a participant cannot discover once a trial is underway.
 */
function MidiConnection({ parameters, setAnswer }: StimulusParams<MidiConnectionParams>) {
  const {
    lowestNote = DEFAULT_LOWEST_NOTE,
    keyCount = DEFAULT_KEY_COUNT,
    requiredNotes = 1,
  } = parameters ?? {};

  const studyConfig = useStudyConfig();
  const { hasMidiCapture } = useStudyMidi(studyConfig);

  const [activeNotes, setActiveNotes] = useState<Map<number, number>>(new Map());
  const [playedNotes, setPlayedNotes] = useState<PlayedNote[]>([]);
  const noteCountRef = useRef(0);
  const [noteCount, setNoteCount] = useState(0);

  const handleNoteOn = useCallback(({ note, velocity }: MidiNoteMessage) => {
    setActiveNotes((previous) => new Map(previous).set(note, velocity));
    setPlayedNotes((previous) => [{ note, velocity, at: Date.now() }, ...previous].slice(0, RECENT_NOTE_LIMIT));
    noteCountRef.current += 1;
    setNoteCount(noteCountRef.current);
  }, []);

  const handleNoteOff = useCallback(({ note }: MidiNoteMessage) => {
    setActiveNotes((previous) => {
      if (!previous.has(note)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(note);
      return next;
    });
  }, []);

  const {
    status, supported, devices, error, requestAccess,
  } = useMidi({
    onNoteOn: handleNoteOn,
    onNoteOff: handleNoteOff,
    // Requesting on mount is the whole job of this page, and Chrome grants
    // non-sysex access without a prompt, so there is nothing to wait for.
    autoRequest: true,
  });

  const connectedDevices = useMemo(
    () => devices.filter((device) => device.state === 'connected'),
    [devices],
  );

  const ready = connectedDevices.length > 0 && noteCount >= requiredNotes;

  // What to tell the participant if they try to continue too early. reVISit
  // leaves the Next button clickable and surfaces this on the attempt, rather
  // than disabling it, so a vague message would leave them stuck.
  const blockedMessage = useMemo(() => {
    if (ready) {
      return undefined;
    }
    if (connectedDevices.length === 0) {
      return 'No MIDI instrument is connected yet. Plug your instrument in over USB and switch it on, then play a note to continue.';
    }
    return requiredNotes === 1
      ? 'Please play one note on your instrument to confirm it is working.'
      : `Please play ${requiredNotes} notes on your instrument to confirm it is working.`;
  }, [connectedDevices.length, ready, requiredNotes]);

  useEffect(() => {
    setAnswer({
      status: ready,
      reason: ready ? undefined : 'customPending',
      message: blockedMessage,
      answers: {
        midiConnection: ready,
        // Recorded so every participant record carries the instrument it was
        // collected on. These strings are device and driver names, not serial
        // numbers, but they are still worth naming in a consent form.
        midiDevices: connectedDevices.map((device) => [device.manufacturer, device.name].filter(Boolean).join(' ')).join('; '),
        midiNotesPlayed: noteCount,
      },
    });
  }, [blockedMessage, connectedDevices, noteCount, ready, setAnswer]);

  if (!supported) {
    return (
      <Box p="md">
        <Title order={1} size="h2">MIDI Instrument Setup</Title>
        <Alert color="red" title="This browser cannot talk to a MIDI instrument" mt="md">
          <Text size="sm">
            This study needs the Web MIDI API, which this browser does not provide.
          </Text>
          <List size="sm" mt="sm">
            <List.Item><strong>Chrome or Edge on desktop</strong> — supported. Please reopen the study there.</List.Item>
            <List.Item><strong>Safari</strong> — not supported on any version or platform.</List.Item>
            <List.Item>
              <strong>Firefox</strong>
              {' '}
              — technically supported from version 108, but it first asks you to install a
              Site Permission Add-On, so we do not recommend it for this study.
            </List.Item>
          </List>
        </Alert>
      </Box>
    );
  }

  return (
    <Box p="md">
      <Title order={1} size="h2">MIDI Instrument Setup</Title>

      <Text mt="sm">
        This study takes its input from a MIDI instrument — a piano or keyboard
        connected to this computer over USB. Connect it now if it is not already.
      </Text>

      <Text mt="sm" size="sm" c="dimmed">
        Web MIDI works in Chrome and Edge only. If you are reading this in another
        browser, please reopen the study in Chrome or Edge.
      </Text>

      {status === 'denied' && (
        <Alert color="red" title="MIDI access was refused" mt="md">
          <Text size="sm">
            The browser refused access
            {error ? ` (${error})` : ''}
            . Check the site permissions for this page, then try again.
          </Text>
          <Button mt="sm" type="button" onClick={requestAccess}>Request MIDI access again</Button>
        </Alert>
      )}

      {status === 'granted' && connectedDevices.length === 0 && (
        <Alert color="yellow" title="No instrument detected" mt="md">
          <Text size="sm">
            MIDI access was granted, but no input device is connected. Plug the
            instrument in with a USB cable and switch it on — it should appear here
            within a second or two, with no need to reload.
          </Text>
        </Alert>
      )}

      {connectedDevices.length > 0 && (
        <Box mt="md">
          <Text fw={600} size="sm">Detected instruments</Text>
          <Table mt="xs" withTableBorder withColumnBorders data-testid="midi-device-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Manufacturer</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {connectedDevices.map((device) => (
                <Table.Tr key={device.id}>
                  <Table.Td>{device.name || <Text c="dimmed" component="span">unnamed</Text>}</Table.Td>
                  <Table.Td>{device.manufacturer || <Text c="dimmed" component="span">unknown</Text>}</Table.Td>
                  <Table.Td>{device.connection === 'open' ? 'receiving' : device.connection}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      <Box mt="lg">
        <Text fw={600} size="sm">
          {requiredNotes === 1
            ? 'Play any note to confirm the instrument works'
            : `Play ${requiredNotes} notes to confirm the instrument works`}
        </Text>
        <Text size="sm" c="dimmed">
          Keys light up in their note color as you play them, and the stronger you
          press, the stronger the color. Try a soft note and a hard one.
        </Text>

        <Box mt="sm" style={{ maxWidth: 640 }}>
          <MidiKeyboard
            lowestNote={lowestNote}
            keyCount={keyCount}
            activeNotes={activeNotes}
          />
        </Box>

        <Group mt="sm" gap="xs">
          <Text size="sm" data-testid="midi-note-count">
            Notes played:
            {' '}
            <strong>{noteCount}</strong>
          </Text>
          {ready && <Badge color="green" data-testid="midi-ready">Instrument confirmed</Badge>}
        </Group>

        {playedNotes.length > 0 && (
          <Group mt="xs" gap={6} data-testid="midi-recent-notes">
            {playedNotes.map((played) => (
              <Badge key={`${played.note}-${played.at}`} variant="light" radius="sm">
                {noteName(played.note)}
                {' · '}
                {velocityDynamic(played.velocity)}
                {` (${played.velocity})`}
              </Badge>
            ))}
          </Group>
        )}
      </Box>

      {!hasMidiCapture && (
        <Alert color="orange" title="This study is not recording MIDI" mt="lg">
          <Text size="sm">
            The study imports the MIDI library but no component sets
            {' '}
            <Code>captureMidi</Code>
            , so nothing played on the instrument will reach
            {' '}
            <Code>windowEvents</Code>
            . Set
            {' '}
            <Code>captureMidi: true</Code>
            {' '}
            in
            {' '}
            <Code>uiConfig</Code>
            {' '}
            or on the components that should record. This notice is for the study
            author and does not block the participant.
          </Text>
        </Alert>
      )}

      <Text mt="lg" size="sm">
        <strong>Note:</strong>
        {' '}
        Please leave the instrument connected for the rest of the study. If you
        unplug it, come back to this page to reconnect.
      </Text>
    </Box>
  );
}

export default MidiConnection;
