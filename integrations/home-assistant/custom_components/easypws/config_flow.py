"""Config flow for EasyPWS with connectivity validation."""

from __future__ import annotations

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_TOKEN
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN


class EasyPWSConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None):
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].rstrip("/")
            token = user_input[CONF_TOKEN]
            try:
                session = async_get_clientsession(self.hass)
                headers = {"Authorization": f"Bearer {token}"}
                async with session.get(f"{host}/api/v1/health", timeout=15) as resp:
                    if resp.status >= 400:
                        raise RuntimeError("health failed")
                async with session.get(
                    f"{host}/api/v1/ha/summary", headers=headers, timeout=20
                ) as resp:
                    if resp.status == 401:
                        errors["base"] = "invalid_auth"
                    elif resp.status >= 400:
                        errors["base"] = "cannot_connect"
                    else:
                        return self.async_create_entry(
                            title="EasyPWS",
                            data={CONF_HOST: host, CONF_TOKEN: token},
                        )
            except (aiohttp.ClientError, TimeoutError, RuntimeError):
                errors["base"] = "cannot_connect"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default="http://easypws-api:3001"): str,
                    vol.Required(CONF_TOKEN): str,
                }
            ),
            errors=errors,
        )
