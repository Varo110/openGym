export const SWIPE_GAP = 12

export function swipeDecision(dx, dy, { threshold = 70, dominance = 1.5 } = {}) {
  const signedX = Number(dx)
  const horizontal = Math.abs(signedX)
  const vertical = Math.abs(Number(dy))
  const minDistance = Number(threshold)
  const dominanceRatio = Number(dominance)

  if (![signedX, horizontal, vertical, minDistance, dominanceRatio].every(Number.isFinite)) return null
  if (minDistance < 0 || dominanceRatio < 0) return null
  if (horizontal < minDistance || horizontal <= vertical * dominanceRatio) return null
  return signedX > 0 ? 'prev' : 'next'
}

export function resistedSwipeOffset(dx, { atStart = false, atEnd = false, resistance = 0.35 } = {}) {
  const signedX = Number(dx)
  const edgeResistance = Number(resistance)
  if (!Number.isFinite(signedX) || !Number.isFinite(edgeResistance)) return 0

  const blockedDirection = (signedX > 0 && atStart) || (signedX < 0 && atEnd)
  if (!blockedDirection) return signedX
  return signedX * Math.min(1, Math.max(0, edgeResistance))
}
