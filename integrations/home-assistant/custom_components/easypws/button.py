"""Manual refresh buttons."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
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
        EasyPWSRefreshButton(coordinator, entry, product["listingId"], product["name"])
        for product in coordinator.data.get("products", [])
    ]
    async_add_entities(entities)


class EasyPWSRefreshButton(CoordinatorEntity[EasyPWSCoordinator], ButtonEntity):
    def __init__(
        self,
        coordinator: EasyPWSCoordinator,
        entry: ConfigEntry,
        listing_id: str,
        product_name: str,
    ) -> None:
        super().__init__(coordinator)
        self._listing_id = listing_id
        self._attr_name = f"{product_name} Refresh"
        self._attr_unique_id = f"{entry.entry_id}_{listing_id}_refresh"
        self._entry = entry

    def _product(self) -> dict | None:
        for product in self.coordinator.data.get("products", []):
            if product.get("listingId") == self._listing_id:
                return product
        return None

    async def async_press(self) -> None:
        await self.coordinator.async_post(
            "/api/v1/ha/refresh_product", {"listing_id": self._listing_id}
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
