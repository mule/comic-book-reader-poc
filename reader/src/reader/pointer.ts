/** Real touches/mice always have valid pointer ids; scripted events may not. */
export function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Ignore: the pointer id is not active (e.g. a synthetic event).
  }
}
