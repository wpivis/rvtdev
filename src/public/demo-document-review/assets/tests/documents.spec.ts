import { describe, expect, test } from 'vitest';
import { DOCUMENTS, getDocument } from '../documents';

const documentIds = Object.keys(DOCUMENTS);

describe('documents', () => {
  test('exposes exactly the two contracts the study config references', () => {
    expect(documentIds.sort()).toEqual(['mutual-nda', 'saas-msa']);
  });

  test('getDocument returns null for an unknown or missing id', () => {
    expect(getDocument('no-such-document')).toBeNull();
    expect(getDocument(undefined)).toBeNull();
  });

  test.each(documentIds)('%s is keyed by its own id', (id) => {
    expect(DOCUMENTS[id].id).toBe(id);
  });

  test.each(documentIds)('%s has unique, non-empty clause numbers', (id) => {
    const numbers = DOCUMENTS[id].clauses.map((clause) => clause.number);
    expect(numbers.every((number) => number.length > 0)).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test.each(documentIds)('%s is long enough that reviewing it means scrolling', (id) => {
    const { clauses } = DOCUMENTS[id];
    expect(clauses.length).toBeGreaterThanOrEqual(10);
    clauses.forEach((clause) => {
      expect(clause.heading.length).toBeGreaterThan(0);
      // Short enough to read, long enough that a clause fills a chunk of the pane.
      expect(clause.text.length).toBeGreaterThan(200);
    });
  });

  test.each(documentIds)('%s names its parties and states the reviewing brief', (id) => {
    expect(DOCUMENTS[id].title.length).toBeGreaterThan(0);
    expect(DOCUMENTS[id].parties).toContain('Northvale');
    expect(DOCUMENTS[id].brief.length).toBeGreaterThan(0);
  });
});
