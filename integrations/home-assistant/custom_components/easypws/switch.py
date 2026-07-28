"""Monitoring pause/resume switches."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import EasyPWSCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: EasyPWSCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [
        EasyPWSMonitoringSwitch(coordinator, entry, product["listingId"], product["name"])
        for product in coordinator.data.get("products", [])
    ]
    async_add_entities(entities)


class EasyPWSMonitoringSwitch(CoordinatorEntity[EasyPWSCoordinator], SwitchEntity):
    def __init__(
        self,
        coordinator: EasyPWSCoordinator,
        entry: ConfigEntry,
        listing_id: str,
        product_name: str,
    ) -> None:
        super().__init__(coordinator)
        self._listing_id = listing_id
        self._attr_name = f"{product_name} Monitoring"
        self._attr_unique_id = f"{entry.entry_id}_{listing_id}_monitoring"
        self._entry = entry

    def _product(self) -> dict | None:
        for product in self.coordinator.data.get("products", []):
            if product.get("listingId") == self._listing_id:
                return product
        return None

    @property
    def is_on(self) -> bool:
        product = self._product()
        return bool(product and product.get("monitoring"))

    async def async_turn_on(self, **kwargs) -> None:
        await self.coordinator.async_post(
            "/api/v1/ha/resume_product", {"listing_id": self._listing_id}
        )
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs) -> None:
        await self.coordinator.async_post(
            "/api/v1/ha/pause_product", {"listing_id": self._listing_id}
        )
        await self.coordinator.async_request_refresh()

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._listing_id)},
            "name": (self._product() or {}).get("name", "EasyPWS Product"),
            "manufacturer": "EasyPWS",
            "via_device": (DOMAIN, self._entry.entry_id),
        }
