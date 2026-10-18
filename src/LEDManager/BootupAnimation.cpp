#include "BootupAnimation.h"

  //bootup animation
  int bootupIds[18] = {
    1,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0
  };

LEDPaletteID* bootupPalette = new LEDPaletteID(bootupIds);

LEDPattern bootupPattern = {
    .palette = {BLACK, BLUE},
    .ids = bootupPalette,
    .animation = new BootupAnimation(bootupPalette)
};

