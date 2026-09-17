import { useEffect, useRef } from 'react';
import { LslState, LslWindow } from './useLsl';
import { useStorageEngine } from '../../storage/storageEngineHooks';

/**
 * Persists per-task sensor windows as they arrive from the bridge.
 *
 * Windows land asynchronously: the bridge waits out its lead-out before cutting
 * one, so a window for a task usually arrives after the participant has already
 * moved on. Saving is therefore driven by arrival rather than by the trial
 * lifecycle.
 */
export function useLslPersistence(lsl: LslState): void {
  const { storageEngine } = useStorageEngine();
  const { enabled, windows } = lsl;
  // Tasks already written, so a re-render or a resent window cannot duplicate
  // the upload. Windows are immutable once cut, so first write wins.
  const saved = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !storageEngine) {
      return;
    }
    Object.entries(windows).forEach(([task, window]: [string, LslWindow]) => {
      if (saved.current.has(task)) {
        return;
      }
      saved.current.add(task);
      storageEngine.saveSensorWindow(window, task).catch((error: unknown) => {
        // Let the participant finish the study: the lab's own recording is the
        // system of record, and this trace is a convenience for analysis.
        saved.current.delete(task);
        console.warn(`Could not save the sensor window for ${task}`, error);
      });
    });
  }, [enabled, windows, storageEngine]);
}
