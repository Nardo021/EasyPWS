"""EasyPWS Home Assistant custom integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_TOKEN, Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from .const import DOMAIN
from .coordinator import EasyPWSCoordinator

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.SWITCH,
    Platform.BUTTON,
]

SERVICE_SCHEMA_URL = vol.Schema(
    {
        vol.Required("url"): cv.string,
        vol.Optional("target_price"): vol.Coerce(float),
    }
)
SERVICE_SCHEMA_LISTING = vol.Schema(
    {
        vol.Optional("listing_id"): cv.string,
        vol.Optional("watchlist_item_id"): cv.string,
    }
)
SERVICE_SCHEMA_TARGET = vol.Schema(
    {
        vol.Optional("listing_id"): cv.string,
        vol.Optional("watchlist_item_id"): cv.string,
        vol.Required("target_price"): vol.Coerce(float),
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    host = entry.data[CONF_HOST].rstrip("/")
    token = entry.data[CONF_TOKEN]
    coordinator = EasyPWSCoordinator(hass, host, token)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def _post(path: str, body: dict) -> None:
        await coordinator.async_post(path, body)
        await coordinator.async_request_refresh()

    async def add_product(call: ServiceCall) -> None:
        await _post(
            "/api/v1/ha/add_product",
            {
                "url": call.data["url"],
                "target_price": call.data.get("target_price"),
            },
        )

    async def remove_product(call: ServiceCall) -> None:
        await _post("/api/v1/ha/remove_product", dict(call.data))

    async def pause_product(call: ServiceCall) -> None:
        await _post("/api/v1/ha/pause_product", dict(call.data))

    async def resume_product(call: ServiceCall) -> None:
        await _post("/api/v1/ha/resume_product", dict(call.data))

    async def refresh_product(call: ServiceCall) -> None:
        await _post("/api/v1/ha/refresh_product", dict(call.data))

    async def set_target_price(call: ServiceCall) -> None:
        await _post("/api/v1/ha/set_target_price", dict(call.data))

    hass.services.async_register(DOMAIN, "add_product", add_product, schema=SERVICE_SCHEMA_URL)
    hass.services.async_register(
        DOMAIN, "remove_product", remove_product, schema=SERVICE_SCHEMA_LISTING
    )
    hass.services.async_register(
        DOMAIN, "pause_product", pause_product, schema=SERVICE_SCHEMA_LISTING
    )
    hass.services.async_register(
        DOMAIN, "resume_product", resume_product, schema=SERVICE_SCHEMA_LISTING
    )
    hass.services.async_register(
        DOMAIN, "refresh_product", refresh_product, schema=SERVICE_SCHEMA_LISTING
    )
    hass.services.async_register(
        DOMAIN, "set_target_price", set_target_price, schema=SERVICE_SCHEMA_TARGET
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok
