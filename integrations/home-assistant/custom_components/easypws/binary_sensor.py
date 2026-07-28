"""Binary sensors for EasyPWS."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
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
    entities: list[BinarySensorEntity] = [
        EasyPWSAdapterHealth(coordinator, entry),
    ]
    for product in coordinator.data.get("products", []):
        listing_id = product["listingId"]
        name = product["name"]
        entities.extend(
            [
                EasyPWSProductBinary(
                    coordinator, entry, listing_id, name, "halfPrice", "Half Price"
                ),
                EasyPWSProductBinary(
                    coordinator, entry, listing_id, name, "inStock", "In Stock"
                ),
            ]
        )
    async_add_entities(entities)


class EasyPWSAdapterHealth(CoordinatorEntity[EasyPWSCoordinator], BinarySensorEntity):
    _attr_name = "EasyPWS Adapter Health"

    def __init__(self, coordinator: EasyPWSCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_adapter_health"
        self._entry = entry

    @property
    def is_on(self) -> bool:
        return bool(self.coordinator.data.get("adapter_healthy"))

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "EasyPWS",
            "manufacturer": "EasyPWS",
        }


class EasyPWSProductBinary(CoordinatorEntity[EasyPWSCoordinator], BinarySensorEntity):
    def __init__(
        self,
        coordinator: EasyPWSCoordinator,
        entry: ConfigEntry,
        listing_id: str,
        product_name: str,
        field: str,
        suffix: str,
    ) -> None:
        super().__init__(coordinator)
        self._listing_id = listing_id
        self._field = field
        self._attr_name = f"{product_name} {suffix}"
        self._attr_unique_id = f"{entry.entry_id}_{listing_id}_{field}"
        self._entry = entry

    def _product(self) -> dict | None:
        for product in self.coordinator.data.get("products", []):
            if product.get("listingId") == self._listing_id:
                return product
        return None

    @property
    def is_on(self) -> bool:
        product = self._product()
        return bool(product.get(self._field)) if product else False

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._listing_id)},
            "name": (self._product() or {}).get("name", "EasyPWS Product"),
            "manufacturer": "EasyPWS",
            "via_device": (DOMAIN, self._entry.entry_id),
        }
