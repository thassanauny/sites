import { useEffect, useRef, useState, type ChangeEvent } from "react";

/** Stage typing immediately so incoming collaboration merges see the local draft. */
export function PropertyField({ value, onChange, normalize = value => value, multiline = false, ...props }: {
  value: string;
  onChange: (value: string, remember: boolean) => void;
  normalize?: (value: string) => string;
  multiline?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const published = useRef<string | undefined>(undefined);
  const edited = useRef(false);
  useEffect(() => {
    if (published.current !== value) setDraft(value);
    published.current = undefined;
  }, [value]);
  const handlers = {
    ...props,
    value: draft,
    onFocus: () => { edited.current = false; },
    onBlur: () => { edited.current = false; setDraft(value); },
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value;
      setDraft(next);
      published.current = normalize(next);
      onChange(published.current, !edited.current);
      edited.current = true;
    },
  };
  return multiline ? <textarea {...handlers} /> : <input {...handlers} />;
}
