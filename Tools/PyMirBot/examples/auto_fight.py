"""
Example: Auto-attack nearby monsters.

The bot will:
1. Connect and enter the game
2. Continuously scan for nearby monsters
3. Face the closest monster and attack
4. Pick up items after kills

Usage:
    python examples/auto_fight.py
"""

import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mirbot import MirClient, MirDirection, GameStage
from mirbot.client import calc_direction

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

# -- Configuration --
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 7000
CLIENT_EXE = "Build/Client/Debug/Client.exe"
ACCOUNT = "testaccount"
PASSWORD = "testpassword"
CHAR_INDEX = 0

# Combat settings
PICKUP_AFTER_KILLS = 3  # pick up items every N kills
HP_POTION_THRESHOLD = 0.5  # use HP potion when below 50%
MP_POTION_THRESHOLD = 0.3  # use MP potion when below 30%


async def main():
    bot = MirClient()

    try:
        print(f"Connecting to {SERVER_HOST}:{SERVER_PORT}...")
        await bot.connect(SERVER_HOST, SERVER_PORT, CLIENT_EXE)

        print(f"Logging in as {ACCOUNT}...")
        characters = await bot.login(ACCOUNT, PASSWORD)

        if not characters:
            print("No characters found!")
            return

        print(f"Selecting character index {CHAR_INDEX}...")
        state = await bot.select_character(characters[CHAR_INDEX]["index"])
        print(f"In game! {state.name} Lv{state.level} at {state.location}")

        kills = 0
        print("Starting auto-fight loop... (Ctrl+C to stop)")

        while not bot.state.dead and bot.connected:
            # Check HP and use potions if needed
            if bot.state.max_hp > 0:
                hp_ratio = bot.state.hp / bot.state.max_hp
                if hp_ratio < HP_POTION_THRESHOLD:
                    potion = bot.find_item_in_inventory("HP Potion")
                    if potion:
                        await bot.use_item(potion["unique_id"])
                        print(f"  Used HP potion (HP: {bot.state.hp})")

            # Find nearby alive monsters
            monsters = bot.nearby_monsters(alive_only=True)

            if monsters:
                target = monsters[0]
                direction = calc_direction(bot.state.location, target.location)

                # If adjacent, attack; otherwise walk towards
                dx = abs(target.location[0] - bot.state.location[0])
                dy = abs(target.location[1] - bot.state.location[1])

                if dx <= 1 and dy <= 1:
                    await bot.attack(direction)
                    print(f"  Attacking {target.name} at {target.location}")
                else:
                    await bot.walk(direction)
                    print(f"  Walking towards {target.name} at {target.location}")
            else:
                # No monsters nearby, wait a bit
                await bot.wait(0.5)

            # Pick up items periodically
            if bot.state.ground_items and kills % PICKUP_AFTER_KILLS == 0:
                await bot.pick_up()

            await bot.wait(0.1)

        if bot.state.dead:
            print("Character died! Reviving at town...")
            await bot.revive()
            print(f"Revived at {bot.state.location}")

    except KeyboardInterrupt:
        print("\nStopping...")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await bot.disconnect()
        print("Disconnected.")


if __name__ == "__main__":
    asyncio.run(main())
