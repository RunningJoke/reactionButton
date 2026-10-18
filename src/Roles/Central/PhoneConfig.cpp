#include "PhoneConfig.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include "_Definitions.h"

void PhoneConfig::start() {
    BLEDevice::init("ReactPod Config");
    BLEServer *pServer = BLEDevice::createServer();
    BLEService *pService = pServer->createService(SERVICE_UUID);

    this->maxLoopCharacteristic = pService->createCharacteristic(
        CHAR_MAX_LOOP_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ
    );
    this->maxLoopCharacteristic->setValue("-1");

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
    pAdvertising->setMaxPreferred(0x12);
    BLEDevice::startAdvertising();

    this->running = true;
}

void PhoneConfig::stop() {
    if(!this->running) {
        return;
    }
    BLEDevice::stopAdvertising();
    // keep the controller memory: releasing it is not reversible and not needed
    BLEDevice::deinit(false);
    this->running = false;
}

bool PhoneConfig::getMaxLoops(int64_t& maxLoops) const {
    if(this->maxLoopCharacteristic == nullptr) {
        return false;
    }
    std::string value = this->maxLoopCharacteristic->getValue();
    char* end = nullptr;
    long long parsed = strtoll(value.c_str(), &end, 10);
    if(end == value.c_str() || *end != '\0' || parsed <= 0) {
        return false;
    }
    maxLoops = parsed;
    return true;
}
