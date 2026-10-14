import { useCallback, useRef, useState } from 'react';
import { DeviceBoards } from '../infrastructure/storage/deviceBoards';

/** Boards this device has hidden. The removal markers live in localStorage and are shared by every tab. */
export function useDeviceRemovals() {
  const [deviceBoards] = useState(() => new DeviceBoards());
  const [removedCodes, setRemovedCodes] = useState(new Set<string>());
  const [removalsReady, setRemovalsReady] = useState(false);
  const removalsRef = useRef(removedCodes);
  /** Re-read the markers; throws when browser storage cannot be read. */
  const syncRemovals = useCallback(() => {
    let latest: Set<string>;
    try {
      latest = deviceBoards.removedCodes();
      setRemovalsReady(true);
    } catch (failure) {
      setRemovalsReady(false);
      throw failure;
    }
    removalsRef.current = latest;
    setRemovedCodes((current) =>
      current.size === latest.size && [...current].every((code) => latest.has(code))
        ? current
        : latest,
    );
    return latest;
  }, [deviceBoards]);
  /** Hide a board here; throws before changing any state when storage cannot be written. */
  const markRemoved = useCallback(
    (code: string) => {
      deviceBoards.remove(code);
      removalsRef.current = new Set([...removalsRef.current, code]);
      setRemovedCodes(removalsRef.current);
    },
    [deviceBoards],
  );
  return {
    deviceBoards,
    removedCodes,
    removalsReady,
    removalsRef,
    syncRemovals,
    markRemoved,
  };
}
