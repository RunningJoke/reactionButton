#include "LEDManager.h"

LEDManager* LEDManager::manager = nullptr;

LEDManager* LEDManager::getManager() {
    if(LEDManager::manager == nullptr) {
        ESP_LOGI("LEDMANAGER", "Initializing LED manager");
        LEDManager::manager = new LEDManager(LED_PIN);
    }
    return LEDManager::manager;
}

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
        case 0: this->setLEDColors(RED); break;
        case 1: this->setLEDColors(GREEN); break;
        case 2: this->setLEDColors(BLUE); break;
        case 3: this->setLEDColors(YELLOW); break;
        case 4: this->setLEDColors(MAGENTA); break;
        case 5: this->setLEDColors(CYAN); break;
        case 6: this->setLEDColors(WHITE); break;
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
