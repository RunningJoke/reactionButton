#include "VMode.h"

void VMode::blink(ColorSet* color, uint8_t repetitions)
{
    uint8_t i = 0;
    for(i = 0; i < repetitions ; i++) {
        this->ledManager->setLEDColors(color);
        delay(300);      
        this->ledManager->turnOff();
        delay(300); 
    }
}