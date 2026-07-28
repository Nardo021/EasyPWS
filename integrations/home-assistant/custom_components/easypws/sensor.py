"""Sensor platform scaffold."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities(
        [
            EasyPWSStubSensor(entry, "watched_products", "EasyPWS Watched Products"),
            EasyPWSStubSensor(entry, "active_specials", "EasyPWS Active Specials"),
            EasyPWSStubSensor(entry, "last_sync", "EasyPWS Last Sync"),
        ]
    )


class EasyPWSStubSensor(SensorEntity):
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry, key: str, name: str) -> None:
        self._attr_name = name
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_native_value = None
        self._entry = entry
        self._key = key

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "EasyPWS",
            "manufacturer": "EasyPWS",
        }
