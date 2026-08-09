# Home Assistant Integration

Native custom component under `custom_components/easypws/`.

## Install

```bash
ln -s /path/to/EasyPWS/integrations/home-assistant/custom_components/easypws \
  /config/custom_components/easypws
```

Restart HA, then add **EasyPWS** via UI:

- Host: `http://<easypws-host>:3000`
- Token: scoped `HA_API_TOKEN` from EasyPWS bootstrap logs (`journalctl -u easypws`)

## Entities

- `sensor.easypws_watched_products`
- `sensor.easypws_active_specials`
- `sensor.easypws_average_discount`
- `sensor.easypws_last_sync`
- `binary_sensor.easypws_adapter_health`
- Per product: current/regular/discount sensors, half-price & in-stock binaries, monitoring switch, refresh button

## Services

- `easypws.add_product`
- `easypws.remove_product`
- `easypws.pause_product`
- `easypws.resume_product`
- `easypws.refresh_product`
- `easypws.set_target_price`

Notifications: configure `HA_WEBHOOK_URL` on EasyPWS so price events POST into HA automations.
