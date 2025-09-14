#include "ErrorAnimation.h"

  //bootup animation
int errorIds[18] = {
    0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0
};

LEDPaletteID* errorPalette = new LEDPaletteID(errorIds);

LEDPattern* errorPattern = new LEDPattern{
    .palette = {BLACK, RED},
    .ids = errorPalette,
    .animation = new ErrorAnimation(errorPalette)
};
