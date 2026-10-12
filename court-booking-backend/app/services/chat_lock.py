"""Per-conversation ordering for the chat: one message of a conversation is processed at a time, in arrival order.

Why: two quick messages from one player used to be processed in parallel, each against the history the other had not yet
extended, so the answers could arrive out of order, twice, or about stale text.

SINGLE-WORKER ASSUMPTION: production runs ONE uvicorn worker (same assumption as the per-process rate-limit counters, see the
backend CLAUDE.md gotcha on finding #25), so an in-process `asyncio.Lock` per conversation is enough. With several worker
processes this module would silently stop ordering across workers: it would then need a shared store (a Postgres advisory
lock cannot simply replace it, because the chat service commits in the middle of a turn). The DB-level "is this still the newest
player message" check in the callers is what keeps the answer coherent even when the lock is bypassed.

Entries are removed as soon as nobody holds or waits for them, so the registry never grows with the number of players.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator, Hashable

import structlog

logger = structlog.get_logger(__name__)

# How long a message may wait for the previous message of the same conversation (model timeout is shorter than this).
LOCK_WAIT_SECONDS = 120.0


class ConversationBusy(Exception):
    """The previous message of this conversation is still being processed and the wait ran out."""


class _Entry:
    __slots__ = ("lock", "users")

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.users = 0  # holders + waiters


class ConversationLocks:
    def __init__(self) -> None:
        self._entries: dict[Hashable, _Entry] = {}

    def __len__(self) -> int:
        return len(self._entries)

    @asynccontextmanager
    async def hold(self, key: Hashable, timeout: float | None = None) -> AsyncIterator[None]:
        """Wait (FIFO: asyncio.Lock wakes waiters in arrival order) for `key`'s turn. Raises ConversationBusy on timeout."""
        entry = self._entries.get(key)
        if entry is None:
            entry = self._entries[key] = _Entry()
        entry.users += 1
        acquired = False
        try:
            wait = LOCK_WAIT_SECONDS if timeout is None else timeout
            try:
                await asyncio.wait_for(entry.lock.acquire(), wait)
            except asyncio.TimeoutError:
                logger.warning("chat_lock.wait_timed_out", waited_seconds=wait)
                raise ConversationBusy() from None
            acquired = True
            yield
        finally:
            if acquired:
                entry.lock.release()
            entry.users -= 1
            if entry.users == 0 and self._entries.get(key) is entry:
                del self._entries[key]


# The one registry for the process. Keys are (channel, user_id) so WhatsApp and the in-app chat do not block each other.
conversation_locks = ConversationLocks()
