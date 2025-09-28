#ifndef IBUZZER_MODE_H
#define IBUZZER_MODE_H

#include <Arduino.h>
#include <BLERemoteCharacteristic.h>
#include <queue>

class Peripheral; // Forward declaration of Peripheral

class IBuzzerMode {
    public:
    
        std::queue<Peripheral*> peripheralQueue; 

        virtual void runMode() = 0;
        virtual void subscribeNotify(BLERemoteCharacteristic* characteristic, class Peripheral* peripheral) = 0;
        virtual void handleNotify(class Peripheral* peripheral) = 0;

        virtual Peripheral* getPeripheral(uint8_t peripheralId) = 0;
};

#endif