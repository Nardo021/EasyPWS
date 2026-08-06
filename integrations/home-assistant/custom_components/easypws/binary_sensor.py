"""Binary sensors with dynamic per-product discovery."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
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
    known: set[str] = set()

    @callback
    def _add_from_data() -> None:
        entities: list[BinarySensorEntity] = []
        if "adapter" not in known:
            entities.append(EasyPWSAdapterHealth(coordinator, entry))
            known.add("adapter")
        for product in coordinator.data.get("products", []):
            listing_id = product["listingId"]
            key = f"bin_{listing_id}"
            if key in known:
                continue
            known.add(key)
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
        if entities:
            async_add_entities(entities)

    _add_from_data()
    entry.async_on_unload(coordinator.async_add_listener(_add_from_data))


class EasyPWSAdapterHealth(CoordinatorEntity[EasyPWSCoordinator], BinarySensorEntity):
    _attr_name = "EasyPWS Adapter Health"

    def __init__(self, coordinator: EasyPWSCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_adapter_health"
        self._entry = entry

    @property
    def is_on(self) -> bool:
        adapters = self.coordinator.data.get("adapters") or []
        if not adapters:
            return bool(self.coordinator.data.get("adapter_healthy"))
        return any(a.get("status") == "healthy" for a in adapters)

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
    def available(self) -> bool:
        return self._product() is not None

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._listing_id)},
            "name": (self._product() or {}).get("name", "EasyPWS Product"),
            "manufacturer": "EasyPWS",
            "via_device": (DOMAIN, self._entry.entry_id),
        }
