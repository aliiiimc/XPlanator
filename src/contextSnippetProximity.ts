export const SAME_FILE_PROXIMITY_LINES = 3;

export function shouldSkipSameFileRelatedRange(
  targetStartLine: number,
  targetEndLine: number,
  relatedStartLine: number,
  relatedEndLine: number,
  proximityLines: number = SAME_FILE_PROXIMITY_LINES
): boolean {
  if (rangesOverlap(targetStartLine, targetEndLine, relatedStartLine, relatedEndLine)) {
    return true;
  }

  const distance = lineDistance(targetStartLine, targetEndLine, relatedStartLine, relatedEndLine);
  return distance <= Math.max(0, proximityLines);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function lineDistance(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd < bStart) {
    return bStart - aEnd;
  }

  if (bEnd < aStart) {
    return aStart - bEnd;
  }

  return 0;
}
