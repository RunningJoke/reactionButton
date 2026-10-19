#pragma once

#include <Arduino.h>
#include <string>
#include <vector>
#include "ColorSet/ColorSet.h"
#include "LEDManager/LEDManager.h"

/**
 * The list of selectable programs, read from /programs.json on the file system:
 *
 *   { "programs": ["/prog/solo.json", "/prog/weiche.json", ...] }
 *
 * The order in the file is the order in the menu. Only the metadata of each program
 * (name, peripherals, menu LEDs) is read here; the blocks are loaded by BlockManager
 * when the program is selected.
 */
class ProgramCatalog {
    public:
        struct MenuLed {
            uint8_t index;
            ColorSet color;
        };

        struct ProgramInfo {
            std::string path;
            std::string name;
            uint8_t peripherals = 0;
            std::vector<MenuLed> menuLeds;
        };

        bool load(const char* indexPath = "/programs.json");

        size_t size() const { return this->programs.size(); }
        const ProgramInfo& get(size_t index) const { return this->programs[index]; }

        // Shows the menu LED pattern of a program
        void showMenu(size_t index, LEDManager& leds) const;

    private:
        bool loadInfo(const char* path, ProgramInfo& info);

        std::vector<ProgramInfo> programs;
};
