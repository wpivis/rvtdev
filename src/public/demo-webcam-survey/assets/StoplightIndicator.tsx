import { useEffect, useState } from 'react';
import { Box } from '@mantine/core';
import { StimulusParams } from '../../../store/types';
import { useCurrentComponent } from '../../../routes/utils';
import {
  AspireLevel, IndicatorParameters, LEVEL_STYLE, LevelColor, findLevel,
} from './aspire';
import { SelfView } from './SelfView';

function PhotoSlot({ level }: { level: AspireLevel }) {
  const [failed, setFailed] = useState(false);
  const style = LEVEL_STYLE[level.color];

  return (
    <Box style={{
      flex: '0 0 38%',
      aspectRatio: '1',
      alignSelf: 'flex-start',
      borderRadius: 6,
      overflow: 'hidden',
      backgroundColor: '#f8f9fa',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
    >
      {level.image && !failed ? (
        <img
          src={level.image}
          alt=""
          onError={() => setFailed(true)}
          // The source photos are square; keeping the column square and cover-fitting
          // is what stops an earlier portrait crop from cutting the tops of heads.
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          }}
        />
      ) : (
        // Deliberate empty slot. The ASPIRE photographs are licensed to
        // Fundacion Paraguaya / the ASPIRE program and are not bundled here;
        // drop the originals at the configured path and they render with no code change.
        <Box
          aria-hidden
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px dashed ${style.dot}`,
            borderRadius: 6,
            color: '#868e96',
            fontSize: 10,
            textAlign: 'center',
            padding: 4,
          }}
        >
          Photo
        </Box>
      )}
    </Box>
  );
}

function LevelCard({
  level, selected, onSelect,
}: {
  level: AspireLevel;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = LEVEL_STYLE[level.color];

  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{
        display: 'flex',
        gap: 9,
        padding: 8,
        width: '100%',
        textAlign: 'left',
        border: '1px solid #ced4da',
        borderRadius: 8,
        backgroundColor: '#fff',
        cursor: 'pointer',
        position: 'relative',
        font: 'inherit',
      }}
    >
      <PhotoSlot level={level} />

      <Box style={{
        flex: '1 1 62%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4,
      }}
      >
        <Box style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: style.text,
        }}
        >
          <span style={{
            width: 18, height: 18, borderRadius: '50%', backgroundColor: style.dot, flex: 'none',
          }}
          />
          {style.label}
        </Box>
        <span style={{
          fontSize: 13, color: '#495057', textWrap: 'pretty', lineHeight: 1.45,
        }}
        >
          {level.text}
        </span>
      </Box>

      {selected && (
        <Box
          aria-hidden
          style={{
            position: 'absolute',
            inset: -1,
            pointerEvents: 'none',
            borderRadius: 8,
            border: `2px solid ${style.dot}`,
            backgroundColor: style.tint,
          }}
        />
      )}
    </Box>
  );
}

export function StoplightIndicator({ parameters, setAnswer, answers }: StimulusParams<IndicatorParameters>) {
  const componentName = useCurrentComponent();
  const [selected, setSelected] = useState<LevelColor | null>(() => findLevel(answers, componentName));

  useEffect(() => {
    setAnswer({
      status: selected !== null,
      answers: { level: selected ?? '' },
      reason: 'customPending',
      message: 'Please tap the picture that matches your household.',
    });
  }, [selected, setAnswer]);

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '10px 16px 8px' }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.03em',
          whiteSpace: 'nowrap',
          color: '#1971c2',
          backgroundColor: '#e7f5ff',
          padding: '2px 8px',
          borderRadius: 4,
        }}
        >
          {parameters.dimension}
        </span>
        <span style={{ fontSize: 12, color: '#868e96', whiteSpace: 'nowrap' }}>
          {parameters.stepLabel}
        </span>
      </Box>

      <h2 style={{
        fontSize: 18, fontWeight: 700, lineHeight: 1.25, margin: 0,
      }}
      >
        {parameters.lifemapName}
      </h2>

      <span style={{ fontSize: 13, color: '#495057' }}>
        Tap the picture that matches your household, and say why out loud.
      </span>

      <Box
        role="radiogroup"
        aria-label={parameters.lifemapName}
        style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
      >
        {parameters.levels.map((level) => (
          <LevelCard
            key={level.color}
            level={level}
            selected={selected === level.color}
            onSelect={() => setSelected(level.color)}
          />
        ))}
      </Box>

      <span style={{ fontSize: 11, color: '#868e96' }}>
        {`ASPIRE Cabarrus · Indicator ${parameters.indicator}`}
      </span>

      <SelfView placement={parameters.selfView} probes={parameters.probes} />
    </Box>
  );
}

export default StoplightIndicator;
