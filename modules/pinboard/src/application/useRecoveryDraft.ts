import { useEffect, useRef, useState } from 'react';
import { RecoveryDraft } from '../infrastructure/storage/recoveryDrafts';

/** Restore the form's original baseline too, so Save keeps unrelated remote fields. */
export function useRecoveryDraft<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => value is T,
) {
  const [store] = useState(() => new RecoveryDraft<T>(key));
  const [loaded] = useState(() => {
    try {
      return { value: store.read(validate), error: '' };
    } catch {
      return {
        value: undefined,
        error: 'Could not read the recovery copy. It has been kept on this device.',
      };
    }
  });
  const [value, setValue] = useState(loaded.value ?? initial);
  const [error, setError] = useState(loaded.error);
  const cleared = useRef(false);
  const touched = useRef(loaded.value !== undefined);
  const serialized = JSON.stringify(value);
  const initialSerialized = useRef(JSON.stringify(initial));
  useEffect(() => {
    if (cleared.current) return;
    if (serialized === initialSerialized.current) {
      if (touched.current) {
        try {
          store.clear();
          touched.current = false;
          setError('');
        } catch {
          setError('Could not clear the local recovery copy. Your previous draft is kept.');
        }
      }
      return;
    }
    touched.current = true;
    try {
      store.write(value);
      setError('');
    } catch {
      setError('Could not save a local recovery copy. Keep this editor open or copy your draft.');
    }
  }, [serialized, store, value]);
  const clear = () => {
    try {
      store.clear();
      cleared.current = true;
      setError('');
      return true;
    } catch {
      setError('Could not clear the local recovery copy. Your draft is kept.');
      return false;
    }
  };
  return { value, setValue, clear, error, recovered: loaded.value !== undefined };
}

/** JSON form drafts must retain the types of every field the editor reads. */
export function sameShape<T>(sample: T, value: unknown): value is T {
  if (sample === null || sample === undefined) return value === sample;
  if (Array.isArray(sample))
    return (
      Array.isArray(value) &&
      value.every((item) =>
        sample.length
          ? sameShape(sample[0], item)
          : typeof item === 'string' ||
            (!!item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.title === 'string' &&
              typeof item.hidden === 'boolean'),
      )
    );
  if (typeof sample === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (
      object.customFields !== undefined &&
      (!object.customFields ||
        typeof object.customFields !== 'object' ||
        !Object.values(object.customFields).every((field) => typeof field === 'string'))
    )
      return false;
    return Object.entries(sample).every(([key, field]) => sameShape(field, object[key]));
  }
  return typeof sample === typeof value;
}
