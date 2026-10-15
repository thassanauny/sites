import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import type { CardFieldSettings } from '../../../domain/boards/types';
import { FIELD_LIMITS, OPTIONAL_CARD_FIELDS } from '../../../domain/boards/fields';

export function CardFieldsSettings({
  settings,
  savedIds,
  locked,
  onChange,
}: {
  settings: CardFieldSettings;
  savedIds: Set<string>;
  locked: boolean;
  onChange: (settings: CardFieldSettings) => void;
}) {
  const headingId = useId();
  return (
    <section className="card-field-settings" aria-labelledby={headingId}>
      <h3 id={headingId}>Card fields</h3>
      <p>Hidden fields keep their values. Save details to apply changes for everyone.</p>
      <div className="field-visibility-options">
        {OPTIONAL_CARD_FIELDS.map((field) => (
          <label className="field-toggle" key={field.id}>
            <input
              type="checkbox"
              checked={!settings.hidden.includes(field.id)}
              disabled={locked}
              onChange={(event) =>
                onChange({
                  ...settings,
                  hidden: event.target.checked
                    ? settings.hidden.filter((id) => id !== field.id)
                    : [...settings.hidden, field.id],
                })
              }
            />
            {field.title}
          </label>
        ))}
      </div>
      <div className="settings-section-heading">
        <h4>Custom fields</h4>
        <button
          type="button"
          className="button secondary"
          disabled={locked || settings.custom.length >= FIELD_LIMITS.custom}
          onClick={() =>
            onChange({
              ...settings,
              custom: [...settings.custom, { id: crypto.randomUUID(), title: '', hidden: false }],
            })
          }
        >
          <Plus size={16} /> Add field
        </button>
      </div>
      <p>Up to {FIELD_LIMITS.custom} text fields. Rename or hide saved fields.</p>
      {settings.custom.map((field, index) => (
        <div className="custom-field-setting" key={field.id}>
          <label className="field">
            Field {index + 1} name
            <input
              value={field.title}
              required
              maxLength={FIELD_LIMITS.title}
              placeholder="For example, Project link"
              onChange={(event) =>
                onChange({
                  ...settings,
                  custom: settings.custom.map((item) =>
                    item.id === field.id ? { ...item, title: event.target.value } : item,
                  ),
                })
              }
            />
          </label>
          <label className="field-toggle">
            <input
              type="checkbox"
              aria-label={`Show custom field ${index + 1}`}
              checked={!field.hidden}
              disabled={locked}
              onChange={(event) =>
                onChange({
                  ...settings,
                  custom: settings.custom.map((item) =>
                    item.id === field.id ? { ...item, hidden: !event.target.checked } : item,
                  ),
                })
              }
            />
            Show on cards
          </label>
          {!savedIds.has(field.id) && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove new field ${index + 1}`}
              disabled={locked}
              onClick={() =>
                onChange({
                  ...settings,
                  custom: settings.custom.filter((item) => item.id !== field.id),
                })
              }
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
