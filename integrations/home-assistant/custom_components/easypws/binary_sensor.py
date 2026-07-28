"""Binary sensor platform scaffold."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([EasyPWSAdapterHealth(entry)])


class EasyPWSAdapterHealth(BinarySensorEntity):
    _attr_name = "EasyPWS Adapter Health"
    _attr_should_poll = False

    def __init__(self, entry: ConfigEntry) -> None:
        self._attr_unique_id = f"{entry.entry_id}_adapter_health"
        self._attr_is_on = False
        self._entry = entry

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "EasyPWS",
            "manufacturer": "EasyPWS",
        }
