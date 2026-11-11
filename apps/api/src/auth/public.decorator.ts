import { type CustomDecorator, SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Decorator to mark routes as publicly accessible without requiring an active session.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
