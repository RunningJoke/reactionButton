// Stub of NimBLE-Arduino 1.4.3 (h2zero/NimBLE-Arduino): the peripheral subset PhoneConfig uses.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>

#define BLE_HS_CONN_HANDLE_NONE 0xffff
#define BLE_HS_ADV_F_DISC_GEN 0x02
#define BLE_HS_ADV_F_BREDR_UNSUP 0x04
#define BLE_HS_ADV_TYPE_SLAVE_ITVL_RANGE 0x12

struct ble_gap_conn_desc {
    uint16_t conn_handle;
    uint16_t conn_itvl;
};

class NimBLEUUID {
public:
    NimBLEUUID() {}
    NimBLEUUID(const char* uuid) { (void)uuid; }
};

class NimBLEAttValue {
public:
    uint16_t length() const { return 0; }
    const uint8_t* data() const { return nullptr; }
    const char* c_str() const { return ""; }
};

class NimBLEAdvertisementData {
public:
    void setFlags(uint8_t) {}
    void setCompleteServices(const NimBLEUUID&) {}
    void setManufacturerData(const std::string&) {}
    void setName(const std::string&) {}
    void addData(const std::string&) {}
};

class NimBLEAdvertising {
public:
    void setAdvertisementData(NimBLEAdvertisementData&) {}
    void setScanResponseData(NimBLEAdvertisementData&) {}
};

namespace NIMBLE_PROPERTY {
    enum : uint16_t {
        READ = 1 << 0,
        WRITE_NR = 1 << 1,
        WRITE = 1 << 2,
        NOTIFY = 1 << 3,
        INDICATE = 1 << 4,
    };
}

class NimBLECharacteristic;

class NimBLECharacteristicCallbacks {
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
    virtual ~NimBLECharacteristicCallbacks() {}
    virtual void onWrite(NimBLECharacteristic*) {}
    virtual void onSubscribe(NimBLECharacteristic*, ble_gap_conn_desc*, uint16_t) {}
    virtual void onStatus(NimBLECharacteristic*, Status, int) {}
};

class NimBLECharacteristic {
public:
    NimBLEAttValue getValue() { return NimBLEAttValue(); }
    void setValue(const char*) {}
    void indicate(const uint8_t*, size_t) {}
    void setCallbacks(NimBLECharacteristicCallbacks*) {}
};

class NimBLEService {
public:
    NimBLECharacteristic* createCharacteristic(const char*, uint32_t) { return nullptr; }
    bool start() { return true; }
};

class NimBLEServer;

class NimBLEServerCallbacks {
public:
    virtual ~NimBLEServerCallbacks() {}
    virtual void onConnect(NimBLEServer*, ble_gap_conn_desc*) {}
    virtual void onDisconnect(NimBLEServer*, ble_gap_conn_desc*) {}
    virtual void onMTUChange(uint16_t, ble_gap_conn_desc*) {}
};

class NimBLEConnInfo {
public:
    uint16_t getConnInterval() { return 0; }
};

class NimBLEServer {
public:
    void setCallbacks(NimBLEServerCallbacks*) {}
    void advertiseOnDisconnect(bool) {}
    NimBLEService* createService(const char*) { return nullptr; }
    void updateConnParams(uint16_t, uint16_t, uint16_t, uint16_t, uint16_t) {}
    size_t getConnectedCount() { return 0; }
    NimBLEConnInfo getPeerInfo(size_t) { return NimBLEConnInfo(); }
};

class NimBLEDevice {
public:
    static void init(const std::string& deviceName);
    static void setDeviceName(const std::string& deviceName);
    static int setMTU(uint16_t mtu);
    static NimBLEServer* createServer();
    static NimBLEAdvertising* getAdvertising();
    static bool startAdvertising();
    static bool stopAdvertising();
};
