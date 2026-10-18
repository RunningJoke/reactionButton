#ifndef IBUZZER_MODE_H
#define IBUZZER_MODE_H

#include <Arduino.h>
#include <BLERemoteCharacteristic.h>

class Peripheral; // Forward declaration of Peripheral

/**
 * Something a peripheral reported, handed from the BLE task to the main loop.
 */
struct PodEvent {
    uint8_t podId;      // index of the peripheral (0 .. count-1)
    int32_t value;      // reaction time in ms, -1 if an AVOID pod was pressed
    uint32_t rxTime;    // millis() on the central when the notification arrived
};

class IBuzzerMode {
    public:
        virtual ~IBuzzerMode() {}

        virtual void runMode() = 0;
        virtual void subscribeNotify(BLERemoteCharacteristic* characteristic, class Peripheral* peripheral) = 0;
        virtual void handleNotify(class Peripheral* peripheral) = 0;

        virtual Peripheral* getPeripheral(uint8_t peripheralId) = 0;
        virtual uint8_t getPeripheralCount() = 0;

        // Takes the next event from the queue. Returns false if there is none.
        virtual bool pollEvent(PodEvent& event) { return false; }
};

#endif
