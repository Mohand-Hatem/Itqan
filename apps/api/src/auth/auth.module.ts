import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { auth } from "@itqan/auth";
import { AccessGuard } from "./access.guard.js";
import { AUTH_INSTANCE, SessionGuard } from "./session.guard.js";

@Global()
@Module({
  providers: [
    { provide: AUTH_INSTANCE, useValue: auth },
    SessionGuard,
    AccessGuard,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AUTH_INSTANCE, SessionGuard, AccessGuard],
})
export class AuthModule {}
