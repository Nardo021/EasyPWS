"""Config flow for EasyPWS."""

from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_TOKEN

from .const import DOMAIN


class EasyPWSConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None):
        if user_input is not None:
            return self.async_create_entry(title="EasyPWS", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default="http://easypws-api:3001"): str,
                    vol.Required(CONF_TOKEN): str,
                }
            ),
        )
