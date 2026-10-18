#pragma once

#include <Arduino.h>

/**
 * Values kept in flash (NVS) across reboots.
 *
 * setId: identifies the set a pod belongs to. A central creates one if it has none.
 * A peripheral adopts the set id of the central that claims it. Every pod of a set
 * therefore ends up with the same id, and any of them can be the central next time.
 * 0 = not paired.
 */
namespace Settings {
    uint32_t getSetId();
    void setSetId(uint32_t setId);

    // Returns the stored set id, creating and storing a random one if there is none
    uint32_t getOrCreateSetId();

}
