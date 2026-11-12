/** UTF-16 offsets, matching VS Code's document offsets. */
export type OffsetRange = { start: number; end: number };

/** Empty cursors are ignored when there is a selection; otherwise convert all. */
export function conversionRanges(length: number, selections: readonly OffsetRange[]): OffsetRange[] {
  const ranges = selections
    .filter(range => range.end > range.start)
    .map(range => ({ ...range }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (ranges.length === 0) return length === 0 ? [] : [{ start: 0, end: length }];

  const merged: OffsetRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}
