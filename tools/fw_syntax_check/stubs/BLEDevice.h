// Stub of the Arduino-ESP32 BLE library (BLEDevice / Server / Service / Characteristic / Advertising).
// Signatures follow arduino-esp32 2.0.x (espressif32@6.10.0): the classic (non-NimBLE) BLE library.
#pragma once
#include <stdint.h>
#include <string>
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_bt_defs.h"

class BLEUUID {
public:
    BLEUUID() {}
    BLEUUID(const char* uuid) { (void)uuid; }
    BLEUUID(std::string uuid) { (void)uuid; }
    BLEUUID(uint16_t uuid) { (void)uuid; }
    std::string toString() const { return ""; }
};

class BLEAdvertisementData {
public:
    void setFlags(uint8_t) {}
    void setCompleteServices(BLEUUID) {}
    void setPartialServices(BLEUUID) {}
    void setManufacturerData(std::string) {}
    void setName(std::string) {}
    void setShortName(std::string) {}
    void addData(std::string) {}
    void setAppearance(uint16_t) {}
    std::string getPayload() { return ""; }
};

class BLEAdvertising {
public:
    void addServiceUUID(BLEUUID) {}
    void addServiceUUID(const char*) {}
    void setScanResponse(bool) {}
    void setMinPreferred(uint16_t) {}
    void setMaxPreferred(uint16_t) {}
    void setAdvertisementData(BLEAdvertisementData&) {}
    void setScanResponseData(BLEAdvertisementData&) {}
    void start() {}
    void stop() {}
};

class BLEDescriptor {
public:
    BLEDescriptor(BLEUUID) {}
    virtual ~BLEDescriptor() {}
};

class BLE2902 : public BLEDescriptor {
public:
    BLE2902() : BLEDescriptor(BLEUUID((uint16_t)0x2902)) {}
    bool getNotifications() { return false; }
    bool getIndications() { return false; }
    void setNotifications(bool) {}
    void setIndications(bool) {}
};

class BLECharacteristic;

class BLECharacteristicCallbacks {
public:
    typedef enum {
        SUCCESS_INDICATE,
        SUCCESS_NOTIFY,
        ERROR_INDICATE_DISABLED,
        ERROR_NOTIFY_DISABLED,
        ERROR_GATT,
        ERROR_NO_CLIENT,
        ERROR_INDICATE_TIMEOUT,
        ERROR_INDICATE_FAILURE
    } Status;
    virtual ~BLECharacteristicCallbacks() {}
    virtual void onRead(BLECharacteristic*) {}
    virtual void onRead(BLECharacteristic*, esp_ble_gatts_cb_param_t*) {}
    virtual void onWrite(BLECharacteristic*) {}
    virtual void onWrite(BLECharacteristic*, esp_ble_gatts_cb_param_t*) {}
    virtual void onNotify(BLECharacteristic*) {}
    virtual void onStatus(BLECharacteristic*, Status, uint32_t) {}
};

class BLECharacteristic {
public:
    static const uint32_t PROPERTY_READ = 1 << 0;
    static const uint32_t PROPERTY_WRITE = 1 << 1;
    static const uint32_t PROPERTY_NOTIFY = 1 << 2;
    static const uint32_t PROPERTY_BROADCAST = 1 << 3;
    static const uint32_t PROPERTY_INDICATE = 1 << 4;
    static const uint32_t PROPERTY_WRITE_NR = 1 << 5;

    std::string getValue() { return ""; }
    uint8_t* getData() { return nullptr; }
    size_t getLength() { return 0; }
    void setValue(uint8_t* data, size_t size) { (void)data; (void)size; }
    void setValue(std::string value) { (void)value; }
    void setValue(const char* value) { (void)value; }
    void setValue(uint32_t) {}
    void setValue(int) {}
    void notify(bool = true) {}
    void indicate() {}
    void setCallbacks(BLECharacteristicCallbacks*) {}
    void addDescriptor(BLEDescriptor*) {}
};

class BLEService {
public:
    BLECharacteristic* createCharacteristic(const char*, uint32_t) { return nullptr; }
    BLECharacteristic* createCharacteristic(BLEUUID, uint32_t) { return nullptr; }
    void start() {}
};

class BLEServer;

class BLEServerCallbacks {
public:
    virtual ~BLEServerCallbacks() {}
    virtual void onConnect(BLEServer*) {}
    virtual void onConnect(BLEServer*, esp_ble_gatts_cb_param_t*) {}
    virtual void onDisconnect(BLEServer*) {}
    virtual void onDisconnect(BLEServer*, esp_ble_gatts_cb_param_t*) {}
    virtual void onMtuChanged(BLEServer*, esp_ble_gatts_cb_param_t*) {}
};

class BLEServer {
public:
    void setCallbacks(BLEServerCallbacks*) {}
    BLEService* createService(const char*) { return nullptr; }
    BLEService* createService(BLEUUID, uint32_t = 15, uint8_t = 0) { return nullptr; }
    BLEAdvertising* getAdvertising() { return nullptr; }
    void startAdvertising() {}
    uint32_t getConnectedCount() { return 0; }
    void disconnect(uint16_t) {}
};

class BLEDevice {
public:
    static void init(std::string deviceName);
    static void deinit(bool release_memory = false);
    static BLEServer* createServer();
    static BLEAdvertising* getAdvertising();
    static void startAdvertising();
    static void stopAdvertising();
    static esp_err_t setMTU(uint16_t mtu);
    static uint16_t getMTU();
    static void setCustomGapHandler(esp_gap_ble_cb_t handler);
    static void setCustomGattsHandler(esp_gatts_cb_t handler);
    static std::string getAddress_str();
};
