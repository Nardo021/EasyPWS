"""DataUpdateCoordinator scaffold for EasyPWS."""

from __future__ import annotations

from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator


class EasyPWSCoordinator(DataUpdateCoordinator[dict]):
    """Polls EasyPWS API for watchlist / health summaries (stub)."""

    def __init__(self, hass: HomeAssistant, host: str, token: str) -> None:
        super().__init__(
            hass,
            logger=__import__("logging").getLogger(__name__),
            name="EasyPWS",
            update_interval=timedelta(minutes=5),
        )
        self.host = host
        self.token = token

    async def _async_update_data(self) -> dict:
        # Scaffold: wire aiohttp GET /api/v1/... in implementation phase.
        return {
            "watched_products": 0,
            "active_specials": 0,
            "average_discount": None,
            "last_sync": None,
            "adapter_healthy": False,
        }
