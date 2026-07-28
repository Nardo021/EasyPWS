# Home Assistant Integration (scaffold)

Native custom component under `custom_components/easypws/`.

## Install (later)

Copy or symlink into HA:

```bash
ln -s /path/to/EasyPWS/integrations/home-assistant/custom_components/easypws \
  /config/custom_components/easypws
```

Configure with EasyPWS API host + scoped HA API token.

## Planned entities

- `sensor.easypws_watched_products`
- `sensor.easypws_active_specials`
- `sensor.easypws_average_discount`
- `sensor.easypws_last_sync`
- `binary_sensor.easypws_adapter_health`
- Per-product price / stock / monitoring entities

## Planned services

See `services.yaml`: add / remove / pause / resume / refresh / set_target_price.

Search and charts stay in EasyPWS Web UI; HA focuses on status, quick control, and automations.
