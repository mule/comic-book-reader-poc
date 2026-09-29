/** Pointer capture is absent in DOM test environments. */
export function capturePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.setPointerCapture === 'function') {
    element.setPointerCapture(pointerId)
  }
}
