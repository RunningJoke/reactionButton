#include "LEDManager.h"

ColorSet* LEDManager::RED = new ColorSet{255,0,0};
ColorSet* LEDManager::GREEN = new ColorSet{0,255,0};
ColorSet* LEDManager::BLUE = new ColorSet{0,0,255};
ColorSet* LEDManager::YELLOW = new ColorSet{255,255,0};
ColorSet* LEDManager::MAGENTA = new ColorSet{255,0,255};
ColorSet* LEDManager::CYAN = new ColorSet{0,255,255};
ColorSet* LEDManager::WHITE = new ColorSet{255,255,255};

LEDManager::LEDManager(uint8_t pinRedLed, uint8_t pinGreenLed, uint8_t pinBlueLed)
{
    this->pOffConfiguration = new ColorSet{0,0,0};
    this->pinRedLed = pinRedLed;
    this->pinGreenLed = pinGreenLed;
    this->pinBlueLed = pinBlueLed;
    pinMode(this->pinRedLed , OUTPUT);
    pinMode(this->pinGreenLed , OUTPUT);
    pinMode(this->pinBlueLed , OUTPUT);
}

void LEDManager::setLEDColors(ColorSet* pNewColorSet)
{
    this->pCurrentColorConfiguration = pNewColorSet;
    analogWrite(this->pinRedLed , this->pCurrentColorConfiguration->red);
    analogWrite(this->pinGreenLed , this->pCurrentColorConfiguration->green);
    analogWrite(this->pinBlueLed , this->pCurrentColorConfiguration->blue);
}

void LEDManager::turnOff()
{
    this->setLEDColors(this->pOffConfiguration);
}
