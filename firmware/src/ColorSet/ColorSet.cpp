#include "ColorSet.h"

static ColorSet blackValue{0, 0, 0};
static ColorSet redValue{255, 0, 0};
static ColorSet greenValue{0, 255, 0};
static ColorSet blueValue{0, 0, 255};
static ColorSet yellowValue{255, 255, 0};
static ColorSet magentaValue{255, 0, 255};
static ColorSet cyanValue{0, 255, 255};
static ColorSet whiteValue{255, 255, 255};
static ColorSet orangeValue{255, 128, 0};
static ColorSet violetValue{128, 0, 255};
static ColorSet amberValue{255, 160, 0};

ColorSet* const BLACK = &blackValue;
ColorSet* const RED = &redValue;
ColorSet* const GREEN = &greenValue;
ColorSet* const BLUE = &blueValue;
ColorSet* const YELLOW = &yellowValue;
ColorSet* const MAGENTA = &magentaValue;
ColorSet* const CYAN = &cyanValue;
ColorSet* const WHITE = &whiteValue;
ColorSet* const ORANGE = &orangeValue;
ColorSet* const VIOLET = &violetValue;
ColorSet* const AMBER = &amberValue;
