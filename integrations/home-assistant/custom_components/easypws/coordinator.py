"""DataUpdateCoordinator for EasyPWS."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN


class EasyPWSCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, host: str, token: str) -> None:
        super().__init__(
            hass,
            logger=__import__("logging").getLogger(__name__),
            name="EasyPWS",
            update_interval=timedelta(minutes=5),
        )
        self.host = host.rstrip("/")
        self.token = token

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self.async_get("/api/v1/ha/summary")
        except Exception as err:  # noqa: BLE001
            raise UpdateFailed(str(err)) from err

    async def async_get(self, path: str) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.token}"}
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.host}{path}", headers=headers, timeout=30) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise UpdateFailed(f"EasyPWS GET {path} -> {resp.status}: {text}")
                return await resp.json()

    async def async_post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.host}{path}", headers=headers, json=body, timeout=60
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise UpdateFailed(f"EasyPWS POST {path} -> {resp.status}: {text}")
                return await resp.json()
