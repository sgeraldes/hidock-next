export {
  createMainWindow,
  getMainWindow,
  focusMainWindow,
  showMainWindow,
} from "./main-window";

export {
  createMiniBarWindow,
  getMiniBarWindow,
  showMiniBar,
  hideMiniBar,
  isMiniBarVisible,
  setMiniBarPositionPersistence,
} from "./mini-bar-window";

export {
  createOverlayWindow,
  getOverlayWindow,
  showOverlay,
  hideOverlay,
  toggleOverlay,
  isOverlayVisible,
} from "./overlay-window";

import { getMainWindow } from "./main-window";
import { getMiniBarWindow } from "./mini-bar-window";
import { getOverlayWindow } from "./overlay-window";

export function destroyAllWindows(): void {
  getOverlayWindow()?.destroy();
  getMiniBarWindow()?.destroy();
  getMainWindow()?.destroy();
}
