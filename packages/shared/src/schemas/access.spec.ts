import { describe, expect, it } from "vitest";
import { AccessReasonCode } from "./access.js";

describe("AccessReasonCode", () => {
  it("defines all required access failure reason codes", () => {
    expect(AccessReasonCode.USER_SUSPENDED).toBe("USER_SUSPENDED");
    expect(AccessReasonCode.NO_ACCESS).toBe("NO_ACCESS");
    expect(AccessReasonCode.TENANT_PAUSED).toBe("TENANT_PAUSED");
    expect(AccessReasonCode.ROLE_FORBIDDEN).toBe("ROLE_FORBIDDEN");
    expect(AccessReasonCode.DEVICE_LIMIT).toBe("DEVICE_LIMIT");
    expect(AccessReasonCode.SESSION_ON_OTHER_DEVICE).toBe("SESSION_ON_OTHER_DEVICE");
  });
});
