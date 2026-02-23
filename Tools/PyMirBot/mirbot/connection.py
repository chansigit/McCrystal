"""
Async TCP connection with packet framing for the Crystal game protocol.

Wire format (from Shared/Packet.cs):
  [uint16 LE total_length] [int16 LE packet_id] [payload ...]

The connection handles:
  - Connecting/disconnecting
  - Sending packets (serialise → frame → write)
  - Receiving packets (read frame → parse → dispatch callbacks)
  - Keepalive loop (C_KeepAlive every 5 seconds)
"""

import asyncio
import logging
import struct
import time
from typing import Callable

from .packets import Packet, parse_server_packet, C_KeepAlive

log = logging.getLogger(__name__)


class MirConnection:
    """Async TCP client for the Crystal game protocol."""

    def __init__(self):
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._handlers: dict[int, list[Callable]] = {}
        self._default_handler: Callable | None = None
        self._receive_task: asyncio.Task | None = None
        self._keepalive_task: asyncio.Task | None = None
        self._connected = False
        self._disconnect_event = asyncio.Event()

    # -- public API --

    async def connect(self, host: str, port: int):
        """Open TCP connection and start receive/keepalive loops."""
        self._reader, self._writer = await asyncio.open_connection(host, port)
        self._connected = True
        self._disconnect_event.clear()
        self._receive_task = asyncio.create_task(self._receive_loop())
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())
        log.info("Connected to %s:%d", host, port)

    async def send(self, packet: Packet):
        """Serialise and send a packet."""
        if not self._connected or self._writer is None:
            raise ConnectionError("Not connected")
        data = packet.to_bytes()
        self._writer.write(data)
        await self._writer.drain()
        log.debug("Sent %s (%d bytes)", type(packet).__name__, len(data))

    async def disconnect(self):
        """Close the connection and cancel background tasks."""
        self._connected = False
        self._disconnect_event.set()
        if self._keepalive_task:
            self._keepalive_task.cancel()
            try:
                await self._keepalive_task
            except asyncio.CancelledError:
                pass
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass
        self._reader = None
        self._writer = None
        log.info("Disconnected")

    @property
    def connected(self) -> bool:
        return self._connected

    async def wait_disconnect(self):
        """Block until the connection is closed."""
        await self._disconnect_event.wait()

    # -- event registration --

    def on_packet(self, packet_id: int, callback: Callable):
        """Register a callback for a specific server packet ID."""
        self._handlers.setdefault(packet_id, []).append(callback)

    def on_any_packet(self, callback: Callable):
        """Register a callback for all server packets."""
        self._default_handler = callback

    # -- internal loops --

    async def _receive_loop(self):
        """Read frames from the TCP stream and dispatch parsed packets."""
        try:
            while self._connected and self._reader:
                # Read 2-byte length header
                header = await self._reader.readexactly(2)
                total_length = struct.unpack("<H", header)[0]
                if total_length < 4:
                    log.warning("Invalid packet length: %d", total_length)
                    continue

                # Read the rest of the frame
                remaining = total_length - 2
                body = await self._reader.readexactly(remaining)

                # Extract packet ID and payload
                packet_id = struct.unpack("<h", body[:2])[0]
                payload = body[2:]

                # Parse the packet
                try:
                    pkt = parse_server_packet(packet_id, payload)
                except Exception as e:
                    log.warning("Failed to parse packet id=%d: %s", packet_id, e)
                    continue

                if pkt is None:
                    log.debug("Unknown server packet id=%d (%d bytes payload)",
                              packet_id, len(payload))
                    continue

                log.debug("Received %s", type(pkt).__name__)

                # Dispatch to handlers
                if self._default_handler:
                    try:
                        result = self._default_handler(pkt)
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        log.error("Default handler error: %s", e)

                for handler in self._handlers.get(packet_id, []):
                    try:
                        result = handler(pkt)
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        log.error("Handler error for packet %d: %s", packet_id, e)

        except asyncio.IncompleteReadError:
            log.info("Connection closed by server")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error("Receive loop error: %s", e)
        finally:
            self._connected = False
            self._disconnect_event.set()

    async def _keepalive_loop(self):
        """Send C_KeepAlive every 5 seconds."""
        try:
            while self._connected:
                await asyncio.sleep(5)
                if self._connected:
                    pkt = C_KeepAlive(time=int(time.time() * 1000))
                    await self.send(pkt)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error("Keepalive loop error: %s", e)
