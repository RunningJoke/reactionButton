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

    // Generation of the program store: increased on every change of the stored programs.
    // During sync the pod with the lower generation copies the store of the higher one.
    uint32_t getStoreGeneration();
    void setStoreGeneration(uint32_t generation);

    // Highest store generation reported by any peer so far. A local change uses a
    // generation above it, so it is never overwritten by an older but higher-numbered store.
    uint32_t getSeenGeneration();
    void setSeenGeneration(uint32_t generation);

    // Store hash at the last commit; a different hash at boot means the files were
    // replaced from outside (uploadfs) and count as a local change
    uint32_t getStoreHash();
    void setStoreHash(uint32_t hash);

    // User-defined name of the set (max MAX_SET_NAME bytes, empty = none), advertised over BLE
    // instead of the default "ReactPod <setId>". Stored per pod, not synced.
    static const size_t MAX_SET_NAME = 16;
    String getSetName();
    void setSetName(const String& name);
    // Increased (in RAM) on every setSetName, so the BLE advertisement can pick up the change
    uint32_t setNameRevision();

    // Role for the next boot only, set via the serial/BLE "reboot" command
    // (0 = none: decide by the button, 1 = central, 2 = peripheral)
    void setBootRole(uint8_t role);
    // Returns the stored boot role and clears it
    uint8_t takeBootRole();
}
