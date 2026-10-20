#include "PeripheralRole.h"
#include "_Definitions.h"
#include "LEDManager/LEDManager.h"
#include "Input/Button.h"
#include "Settings/Settings.h"
#ifdef REACTPOD_BLE_ESPNOW_TEST
#include "TestHw/BleEspNowTest.h"
#endif
#include "Config/ConfigApi.h"
#include "LEDManager/EffectJson.h"

using namespace Protocol;

static const char* TAG = "PERIPHERAL";

PeripheralRole::PeripheralRole() {
    this->setId = Settings::getSetId();
    this->sync.setSetId(this->setId);

    if(!this->link.begin(ESPNOW_CHANNEL)) {
        ESP_LOGE(TAG, "radio start failed");
    }
    this->becomeUnclaimed();
    ESP_LOGI(TAG, "peripheral started, set %08x", this->setId);
}

void PeripheralRole::becomeUnclaimed() {
    this->state = State::UNCLAIMED;
    this->clock.clear();
    this->pairResetDone = false;
    LEDManager::getManager()->setLEDColors(YELLOW);
}

void PeripheralRole::run() {
    Button& button = Button::get();
    button.update();
    this->link.service();

    RxFrame frame;
    while(this->link.receive(frame)) {
        this->handleFrame(frame);
    }

    int64_t now = esp_timer_get_time();

    if(this->state == State::UNCLAIMED) {
        if(now - this->lastHelloUs >= HELLO_INTERVAL_US) {
            this->lastHelloUs = now;
            Hello hello;
            fillHeader(hello.header, MsgType::HELLO, this->setId);
            hello.fwMajor = FW_VERSION_MAJOR;
            hello.fwMinor = FW_VERSION_MINOR;
            this->link.broadcast(&hello, sizeof(hello));
        }

        // hold the button 3 s while unclaimed: forget the set, any central may claim the pod
        if(button.isDown() && !this->pairResetDone && now - button.lastPressTimeUs() >= PAIR_RESET_HOLD_US) {
            this->pairResetDone = true;
            this->setId = 0;
            Settings::setSetId(0);
            ESP_LOGI(TAG, "pairing cleared");
            LEDManager::getManager()->setLEDColors(WHITE);
            delay(500);
            LEDManager::getManager()->setLEDColors(YELLOW);
        }
        return;
    }

    // claimed: heartbeat, central supervision, store sync
    this->sync.service();
    if(now - this->lastPingUs >= PING_INTERVAL_US) {
        this->lastPingUs = now;
        this->sendPing();
    }
    if(now - this->lastPongUs > CENTRAL_TIMEOUT_US) {
        ESP_LOGW(TAG, "central lost");
        this->becomeUnclaimed();
        return;
    }

    switch(this->state) {
        case State::SCHEDULED:
            if(now >= this->scheduledLocalUs) {
                this->activate();
#ifdef REACTPOD_BLE_ESPNOW_TEST
                BleEspNowTest::get().onScheduledStart(this->activatedUs - this->scheduledLocalUs);
#endif
            }
            break;

        case State::ACTIVE:
            if(button.pressCount() != this->pressCountAtActivation) {
                int64_t reactionUs = button.lastPressTimeUs() - this->activatedUs;
                LEDManager::getManager()->setLEDColors(this->colorAfter);

                Pressed pressed;
                fillHeader(pressed.header, MsgType::PRESSED, this->setId);
                pressed.podId = this->podId;
                pressed.cmdSeq = this->cmdSeq;
                pressed.result = this->mode == PodMode::AVOID ? PressResult::AVOID_HIT : PressResult::HIT;
                pressed.reactionUs = (int32_t)reactionUs;
                this->link.send(this->centralMac, &pressed, sizeof(pressed), 8, -1, true);

                this->state = State::DONE;
            }
            break;

        default:
            break;
    }
}

void PeripheralRole::sendPing() {
    Ping ping;
    fillHeader(ping.header, MsgType::PING, this->setId);
    ping.t1 = 0;    // stamped by the link when the frame goes to the radio
    ping.store = StoreSync::localState();
    this->link.send(this->centralMac, &ping, sizeof(ping), 0, (int8_t)offsetof(Ping, t1));
}

void PeripheralRole::handleFrame(const RxFrame& frame) {
    const Header* header = reinterpret_cast<const Header*>(frame.data);
    if(frame.len < frameSize(header->type)) {
        return;
    }

    if(header->type == MsgType::CLAIM) {
        this->handleClaim(frame);
        return;
    }

    // everything else only from our central
    if(this->state == State::UNCLAIMED || !EspNowLink::sameMac(frame.mac, this->centralMac)
        || header->setId != this->setId) {
        return;
    }

    switch(header->type) {
        case MsgType::PONG:
        {
            const Pong* pong = reinterpret_cast<const Pong*>(frame.data);
            this->clock.addSample(pong->t1, pong->t2, pong->t3, frame.rxUs);
            this->lastPongUs = frame.rxUs;
            this->sync.peerState(frame.mac, pong->store, (pong->flags & PONG_FLAG_SYNC_ALLOWED) != 0);
            break;
        }
        case MsgType::ARM:
            this->handleArm(frame);
            break;

        case MsgType::EFFECT:
            this->handleEffect(*reinterpret_cast<const Effect*>(frame.data));
            break;

        case MsgType::SYNC_READ_REQ:
        case MsgType::SYNC_READ_RESP:
            this->sync.handleFrame(frame);
            break;

        case MsgType::RESET:
            this->state = State::READY;
            LEDManager::getManager()->turnOff();
            break;

        default:
            break;
    }
}

void PeripheralRole::handleClaim(const RxFrame& frame) {
    const Claim* claim = reinterpret_cast<const Claim*>(frame.data);

    bool fromOurCentral = this->state != State::UNCLAIMED && EspNowLink::sameMac(frame.mac, this->centralMac);
    if(this->state != State::UNCLAIMED && !fromOurCentral) {
        return;     // already taken by another central
    }
    if(this->setId != 0 && claim->header.setId != this->setId) {
        return;     // paired with another set
    }

    if(this->setId != claim->header.setId) {
        this->setId = claim->header.setId;
        this->sync.setSetId(this->setId);
        Settings::setSetId(this->setId);
        ESP_LOGI(TAG, "paired with set %08x", this->setId);
    }

    memcpy(this->centralMac, frame.mac, 6);
    this->podId = claim->podId;

    ClaimAck ack;
    fillHeader(ack.header, MsgType::CLAIM_ACK, this->setId);
    ack.podId = this->podId;
    ack.linkFeatures = LINK_FEATURE_EFFECTS;
    this->link.send(this->centralMac, &ack, sizeof(ack), 3);

    if(this->state == State::UNCLAIMED) {
        this->state = State::READY;
        this->lastPongUs = esp_timer_get_time();    // grace period until the first PONG
        this->lastPingUs = 0;                       // ping right away to start the clock sync
        LEDManager::getManager()->turnOff();
        ESP_LOGI(TAG, "claimed as pod %u", this->podId);
    }
}

int64_t PeripheralRole::localStartUs(int64_t centralUs) const {
    if(centralUs == 0 || !this->clock.isSynced()) {
        return 0;   // now
    }
    int64_t local = this->clock.toLocal(centralUs);
    return local != 0 ? local : 1;
}

void PeripheralRole::handleArm(const RxFrame& frame) {
    const Arm& arm = *reinterpret_cast<const Arm*>(frame.data);
    this->cmdSeq = arm.cmdSeq;
    this->mode = arm.mode;
    this->colorActive = arm.colorActive;
    this->colorAfter = arm.colorAfter;

    // optional waiting effect (appended field, firmware >= 2.8). It is timed from the start
    // time, so a late ARM joins the animation of the other pods instead of restarting it.
    this->hasWaitingEffect = frame.len >= sizeof(Arm) && arm.waiting.effect != EffectId::NONE;
    if(this->hasWaitingEffect) {
        this->waitingEffect = arm.waiting;
        this->waitingEffectStartUs = this->localStartUs(arm.startAtUs);
    }

    int64_t now = esp_timer_get_time();
    if(arm.startAtUs != 0 && this->clock.isSynced()) {
        this->scheduledLocalUs = this->clock.toLocal(arm.startAtUs);
#ifdef REACTPOD_BLE_ESPNOW_TEST
        BleEspNowTest::get().onScheduledArm(this->scheduledLocalUs - now);
#endif
        if(this->scheduledLocalUs > now) {
            this->state = State::SCHEDULED;
            LEDManager::getManager()->turnOff();
            return;
        }
#ifdef REACTPOD_BLE_ESPNOW_TEST
        this->activate();   // late delivery, as below; also counted as a (late) start
        BleEspNowTest::get().onScheduledStart(this->activatedUs - this->scheduledLocalUs);
        return;
#endif
    }
    // immediate, or the start time has already passed (late delivery)
    this->activate();
}

void PeripheralRole::handleEffect(const Effect& effect) {
    // only the LEDs change; an armed pod stays armed (its next LED change wins)
    if(!LEDManager::getManager()->playEffect(effect.effect, this->localStartUs(effect.startAtUs))) {
        ESP_LOGW(TAG, "unknown effect %u ignored", (unsigned)effect.effect.effect);
    }
}

void PeripheralRole::activate() {
    LEDManager* leds = LEDManager::getManager();
    if(!this->hasWaitingEffect || !leds->playEffect(this->waitingEffect, this->waitingEffectStartUs)) {
        leds->setLEDColors(this->colorActive);
    }
    // measure from the moment the LED data was sent; only presses after this count
    this->activatedUs = esp_timer_get_time();
    this->pressCountAtActivation = Button::get().pressCount();
    this->state = State::ACTIVE;
}

// ---------------------------------------------------------------- configuration API

const char* PeripheralRole::stateName(State state) {
    switch(state) {
        case State::UNCLAIMED: return "UNCLAIMED";
        case State::READY: return "READY";
        case State::SCHEDULED: return "SCHEDULED";
        case State::ACTIVE: return "ACTIVE";
        case State::DONE: return "DONE";
    }
    return "?";
}

bool PeripheralRole::storeEditable() const {
    return !this->sync.isPulling() && this->state != State::ACTIVE && this->state != State::SCHEDULED;
}

void PeripheralRole::describe(JsonObject status) {
    status["state"] = stateName(this->state);
    status["syncing"] = this->sync.isPulling();
#ifdef REACTPOD_BLE_ESPNOW_TEST
    BleEspNowTest::get().describe(status, false);
#endif
    if(this->state == State::UNCLAIMED) {
        return;
    }

    char mac[18];
    snprintf(mac, sizeof(mac), "%02x:%02x:%02x:%02x:%02x:%02x", this->centralMac[0], this->centralMac[1],
             this->centralMac[2], this->centralMac[3], this->centralMac[4], this->centralMac[5]);
    status["podId"] = this->podId;
    status["central"] = mac;
    status["lastPongMs"] = (uint32_t)((esp_timer_get_time() - this->lastPongUs) / 1000);

    JsonObject clock = status["clock"].to<JsonObject>();
    clock["synced"] = this->clock.isSynced();
    clock["offsetUs"] = this->clock.offset();

    EspNowLink::LinkStats st;
    if(this->link.stats(this->centralMac, st)) {
        JsonObject l = status["link"].to<JsonObject>();
        l["txFrames"] = st.txFrames;
        l["txRetries"] = st.txRetries;
        l["txLost"] = st.txLost;
        l["rxFrames"] = st.rxFrames;
        l["rxDuplicates"] = st.rxDuplicates;
        l["ackUsLast"] = st.lastAckUs;
        l["ackUsAvg"] = st.avgAckUs;
        l["ackUsMax"] = st.maxAckUs;
    }
}

bool PeripheralRole::control(const char* op, JsonObjectConst request, JsonDocument& response) {
    if(strcmp(op, "press") == 0) {
        Button::get().simulatePress();
        response["ok"] = true;
        response["state"] = stateName(this->state);
        return true;
    }
#ifdef REACTPOD_BLE_ESPNOW_TEST
    if(strcmp(op, "bleTest") == 0) {
        BleEspNowTest::get().control(request, response, false);
        response["state"] = stateName(this->state);     // short status for the test script's polling
        response["synced"] = this->clock.isSynced();
        response["offsetUs"] = this->clock.offset();
        return true;
    }
#endif
    if(strcmp(op, "effect") == 0) {
        // test op: play an effect on this pod's ring
        if(this->state == State::ACTIVE || this->state == State::SCHEDULED) {
            ConfigApi::setError(response, "busy", String("state is ") + stateName(this->state));
            return true;
        }
        EffectDesc effect;
        String error;
        if(!EffectJson::parse(request, effect, error)) {
            ConfigApi::setError(response, "bad_request", error);
            return true;
        }
        uint32_t delayMs = request["delayMs"] | 0u;
        LEDManager::getManager()->playEffect(effect, delayMs != 0 ? esp_timer_get_time() + (int64_t)delayMs * 1000 : 0);
        response["ok"] = true;
        response["effect"] = LEDManager::effectName(effect.effect);
        return true;
    }
    return false;
}
