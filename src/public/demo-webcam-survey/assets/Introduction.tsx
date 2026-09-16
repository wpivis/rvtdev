import { Box } from '@mantine/core';
import { IconMicrophone } from '@tabler/icons-react';

const STOPLIGHT_DOTS = ['#f03e3e', '#fcc419', '#2f9e44'];

export function Introduction() {
  return (
    <Box style={{
      display: 'flex', flexDirection: 'column', gap: 16, padding: '22px 18px', backgroundColor: '#fff',
    }}
    >
      <Box aria-hidden style={{ display: 'flex', gap: 5 }}>
        {STOPLIGHT_DOTS.map((color) => (
          <span
            key={color}
            style={{
              width: 26, height: 26, borderRadius: '50%', backgroundColor: color,
            }}
          />
        ))}
      </Box>

      <h1 style={{
        fontSize: 23, fontWeight: 700, lineHeight: 1.25, margin: 0,
      }}
      >
        Your home, in your own words
      </h1>

      <span style={{ fontSize: 15, color: '#495057' }}>
        You will see a few pictures of everyday situations. For each one, pick the picture that
        is closest to how things are in your household right now. There are no right answers, and
        nothing you say changes any benefit you receive.
      </span>

      <Box style={{
        padding: 14, border: '1px solid #ffd8a8', backgroundColor: '#fff4e6', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8,
      }}
      >
        <Box style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700,
        }}
        >
          <IconMicrophone size={18} stroke={1.5} color="#d9480f" />
          Please think aloud
        </Box>
        <span style={{ fontSize: 14, color: '#495057' }}>
          As you choose, say what you are thinking out loud. We record your microphone and camera
          so a researcher can understand how you read the pictures, not to check your answers.
        </span>
      </Box>

      <span style={{ fontSize: 13, color: '#868e96' }}>
        The recording stays with the research team and is stored with your answers. You can stop
        at any time by closing this window.
      </span>
    </Box>
  );
}

export default Introduction;
