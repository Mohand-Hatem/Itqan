import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Auth, AuthSession, AuthUser } from "@itqan/auth";
import type { Request } from "express";
import { toFetchHeaders } from "./headers.util.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      session?: AuthSession;
    }
  }
}

export const AUTH_INSTANCE = Symbol("AUTH_INSTANCE");

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly authClient: Auth,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<Request>();
    const headers = toFetchHeaders(req.headers);

    const sessionResult = (await this.authClient.api
      .getSession({ headers })
      .catch(() => null)) as { session: AuthSession; user: AuthUser } | null;

    if (sessionResult?.session && sessionResult?.user) {
      req.session = sessionResult.session;
      req.user = sessionResult.user;
    }

    if (isPublic) {
      return true;
    }

    if (!sessionResult?.session || !sessionResult?.user) {
      throw new UnauthorizedException("Unauthorized");
    }

    return true;
  }
}
