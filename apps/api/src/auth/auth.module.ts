import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { auth } from "@itqan/auth";
import { AccessGuard } from "./access.guard.js";
import { DeviceGuard } from "./device.guard.js";
import { AUTH_INSTANCE, SessionGuard } from "./session.guard.js";
export { AUTH_INSTANCE } from "./session.guard.js";

@Global()
@Module({
  providers: [
    { provide: AUTH_INSTANCE, useValue: auth },
    SessionGuard,
    AccessGuard,
    DeviceGuard,
    // Order matters: session, then access status (loads the membership), then device.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: DeviceGuard },
  ],
  exports: [AUTH_INSTANCE, SessionGuard, AccessGuard, DeviceGuard],
})
export class AuthModule {}
