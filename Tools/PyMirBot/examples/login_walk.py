"""
Example: Connect, login, select character, and walk around.

Usage:
    python -m examples.login_walk

Or from the PyMirBot directory:
    python examples/login_walk.py
"""

import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mirbot import MirClient, MirDirection

# Configure logging to see what's happening
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

# -- Configuration --
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 7000
CLIENT_EXE = "Build/Client/Debug/Client.exe"  # path to game client for version check
ACCOUNT = "testaccount"
PASSWORD = "testpassword"


async def main():
    bot = MirClient()

    try:
        # Connect and pass version check
        print(f"Connecting to {SERVER_HOST}:{SERVER_PORT}...")
        await bot.connect(SERVER_HOST, SERVER_PORT, CLIENT_EXE)
        print("Connected!")

        # Login
        print(f"Logging in as {ACCOUNT}...")
        characters = await bot.login(ACCOUNT, PASSWORD)
        print(f"Characters: {[c['name'] for c in characters]}")

        if not characters:
            print("No characters found!")
            return

        # Select first character
        print(f"Selecting character: {characters[0]['name']}...")
        state = await bot.select_character(characters[0]["index"])
        print(f"In game! Name={state.name}, Level={state.level}, Position={state.location}")

        # Walk north 5 steps
        print("Walking north 5 steps...")
        for i in range(5):
            await bot.walk(MirDirection.Up)
            print(f"  Step {i+1}: position = {bot.state.location}")

        # Turn around
        print("Turning south...")
        await bot.turn(MirDirection.Down)

        # Walk south 5 steps
        print("Walking south 5 steps...")
        for i in range(5):
            await bot.walk(MirDirection.Down)
            print(f"  Step {i+1}: position = {bot.state.location}")

        print(f"Final position: {bot.state.location}")
        print(f"HP: {bot.state.hp}, MP: {bot.state.mp}, Gold: {bot.state.gold}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        await bot.disconnect()
        print("Disconnected.")


if __name__ == "__main__":
    asyncio.run(main())
