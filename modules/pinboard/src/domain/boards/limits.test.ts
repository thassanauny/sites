import { describe, expect, it } from 'vitest';
import schema from '../../../supabase/schema.sql?raw';
import { LIMITS } from './board';

/** Numbers captured by a pattern that the SQL must keep containing. */
function inSchema(pattern: RegExp): number[] {
  const match = pattern.exec(schema);
  if (!match)
    throw new Error(
      `supabase/schema.sql no longer contains ${pattern}; update this test with its new wording.`,
    );
  return match.slice(1).map(Number);
}

describe('client limits match supabase/schema.sql', () => {
  it.each([
    [
      'columns and cards per board',
      /jsonb_array_length\(p_columns\) not between 1 and (\d+) or jsonb_array_length\(p_cards\) > (\d+)/,
      [LIMITS.columns, LIMITS.cards],
    ],
    ['column title', /column_value->'title', (\d+)\)/, [LIMITS.title]],
    ['card title', /card_value->'title', (\d+)\)/, [LIMITS.title]],
    ['card description', /card_value->'description', (\d+), false\)/, [LIMITS.description]],
    ['assignee', /card_value->'assignee', (\d+), false\)/, [LIMITS.assignee]],
    ['labels per card', /jsonb_array_length\(card_value->'labels'\) > (\d+)/, [LIMITS.labels]],
    ['label text', /pinboard_valid_text\(label, (\d+)\)/, [LIMITS.label]],
    [
      'board title',
      /title text not null check \(private\.pinboard_valid_text\(to_jsonb\(title\), (\d+)\)/,
      [LIMITS.title],
    ],
    [
      'board description',
      /description text not null default '' check \(private\.pinboard_valid_text\(to_jsonb\(description\), (\d+), false\)/,
      [LIMITS.description],
    ],
    ['card position', /value >= 0 and value <= (\d+)/, [LIMITS.position]],
  ] as const)('uses the same %s limit', (_name, pattern, expected) => {
    expect(inSchema(pattern)).toEqual(expected);
  });
});
