import type { NamedViewport } from './types.js'

export const NAMED_VIEWPORTS: NamedViewport[] = [
  {
    name: 'desktop-1280x800',
    label: 'Desktop (1280x800, dpr 1)',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  {
    name: 'tablet-emulation-1180x820',
    label: 'Tablet EMULATION landscape (1180x820, dpr 2, touch)',
    width: 1180,
    height: 820,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'tablet-emulation-820x1180',
    label: 'Tablet EMULATION portrait (820x1180, dpr 2, touch)',
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
]
