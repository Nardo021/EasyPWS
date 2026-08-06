"""Sensor platform for EasyPWS with dynamic per-product entities."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
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

    def _summary_entities() -> list[SensorEntity]:
        return [
            EasyPWSSummarySensor(
                coordinator, entry, "watched_products", "EasyPWS Watched Products"
            ),
            EasyPWSSummarySensor(
                coordinator, entry, "active_specials", "EasyPWS Active Specials"
            ),
            EasyPWSSummarySensor(
                coordinator, entry, "average_discount", "EasyPWS Average Discount"
            ),
            EasyPWSSummarySensor(coordinator, entry, "last_sync", "EasyPWS Last Sync"),
        ]

    def _product_entities(listing_id: str, name: str) -> list[SensorEntity]:
        return [
            EasyPWSProductSensor(
                coordinator, entry, listing_id, name, "currentPrice", "Current Price", "AUD"
            ),
            EasyPWSProductSensor(
                coordinator, entry, listing_id, name, "regularPrice", "Regular Price", "AUD"
            ),
            EasyPWSProductSensor(
                coordinator, entry, listing_id, name, "discountPercentage", "Discount", "%"
            ),
        ]

    @callback
    def _add_from_data() -> None:
        entities: list[SensorEntity] = []
        if "summary" not in known:
            entities.extend(_summary_entities())
            known.add("summary")
        for product in coordinator.data.get("products", []):
            listing_id = product["listingId"]
            if listing_id in known:
                continue
            known.add(listing_id)
            entities.extend(_product_entities(listing_id, product["name"]))
        if entities:
            async_add_entities(entities)

    _add_from_data()
    entry.async_on_unload(coordinator.async_add_listener(_add_from_data))


class EasyPWSSummarySensor(CoordinatorEntity[EasyPWSCoordinator], SensorEntity):
    def __init__(
        self,
        coordinator: EasyPWSCoordinator,
        entry: ConfigEntry,
        key: str,
        name: str,
    ) -> None:
        super().__init__(coordinator)
        self._key = key
        self._attr_name = name
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._entry = entry

    @property
    def native_value(self):
        return self.coordinator.data.get(self._key)

    @property
    def device_info(self):
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": "EasyPWS",
            "manufacturer": "EasyPWS",
        }


class EasyPWSProductSensor(CoordinatorEntity[EasyPWSCoordinator], SensorEntity):
    def __init__(
        self,
        coordinator: EasyPWSCoordinator,
        entry: ConfigEntry,
        listing_id: str,
        product_name: str,
        field: str,
        suffix: str,
        unit: str | None,
    ) -> None:
        super().__init__(coordinator)
        self._listing_id = listing_id
        self._field = field
        self._attr_name = f"{product_name} {suffix}"
        self._attr_unique_id = f"{entry.entry_id}_{listing_id}_{field}"
        self._attr_native_unit_of_measurement = unit
        self._entry = entry

    def _product(self) -> dict | None:
        for product in self.coordinator.data.get("products", []):
            if product.get("listingId") == self._listing_id:
                return product
        return None

    @property
    def native_value(self):
        product = self._product()
        return None if product is None else product.get(self._field)

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
