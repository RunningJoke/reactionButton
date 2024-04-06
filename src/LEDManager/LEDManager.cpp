#include "LEDManager.h"

ColorSet* LEDManager::RED = new ColorSet{255,0,0};
ColorSet* LEDManager::GREEN = new ColorSet{0,255,0};
ColorSet* LEDManager::BLUE = new ColorSet{0,0,255};
ColorSet* LEDManager::YELLOW = new ColorSet{255,255,0};
ColorSet* LEDManager::MAGENTA = new ColorSet{255,0,255};
ColorSet* LEDManager::CYAN = new ColorSet{0,255,255};
ColorSet* LEDManager::WHITE = new ColorSet{255,255,255};

LEDManager::LEDManager(uint8_t neoPixelPin)
{
    this->pOffConfiguration = new ColorSet{0,0,0};
    this->neoPixelPin = neoPixelPin;

    this->pixelManager = new Adafruit_NeoPixel(NEOPIXEL_SIZE, neoPixelPin, NEO_GRB + NEO_KHZ800);
    this->pixelManager->begin();
}

void LEDManager::setLEDColors(uint8_t colorId)
{
    switch(colorId) {
        case 0: this->setLEDColors(LEDManager::RED); break;
        case 1: this->setLEDColors(LEDManager::GREEN); break;
        case 2: this->setLEDColors(LEDManager::BLUE); break;
        case 3: this->setLEDColors(LEDManager::YELLOW); break;
        case 4: this->setLEDColors(LEDManager::MAGENTA); break;
        case 5: this->setLEDColors(LEDManager::CYAN); break;
        case 6: this->setLEDColors(LEDManager::WHITE); break;
    }
}

void LEDManager::setLEDColors(ColorSet* pNewColorSet)
{
    this->pCurrentColorConfiguration = pNewColorSet;

    this->pixelManager->clear();

    for(int i=0; i<NEOPIXEL_SIZE; i++) {

         this->pixelManager->setPixelColor(i, 
                    this->pixelManager->Color(
                        this->pCurrentColorConfiguration->red, 
                        this->pCurrentColorConfiguration->green, 
                        this->pCurrentColorConfiguration->blue)
                    );
    }
    this->pixelManager->show();
}

void LEDManager::setLEDColors(uint8_t index, ColorSet* pNewColorSet)
{
    if(index < NEOPIXEL_SIZE) {
         this->pixelManager->setPixelColor(index, 
                    this->pixelManager->Color(
                        pNewColorSet->red, 
                        pNewColorSet->green, 
                        pNewColorSet->blue)
                    );
        this->pixelManager->show();
    }
}

void LEDManager::turnOff()
{
    this->setLEDColors(this->pOffConfiguration);
}
