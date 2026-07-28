import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "easypws-api",
      mode: "scaffold",
      timestamp: new Date().toISOString(),
    };
  }
}
