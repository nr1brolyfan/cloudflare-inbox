import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  meetsPasswordPolicy,
  minimumPasswordCodePoints,
  PasswordPolicySchema,
} from "./password-policy";

describe("password policy", () => {
  it("accepts exactly the minimum number of Unicode code points", () => {
    const password = `${"a".repeat(minimumPasswordCodePoints - 1)}🔐`;

    expect(password).toHaveLength(minimumPasswordCodePoints + 1);
    expect(meetsPasswordPolicy(password)).toBeTruthy();
    expect(Schema.is(PasswordPolicySchema)(password)).toBeTruthy();
  });

  it("rejects one fewer Unicode code point even when UTF-16 length is enough", () => {
    const password = `${"a".repeat(minimumPasswordCodePoints - 2)}🔐`;

    expect(password).toHaveLength(minimumPasswordCodePoints);
    expect(meetsPasswordPolicy(password)).toBeFalsy();
    expect(Schema.is(PasswordPolicySchema)(password)).toBeFalsy();
  });
});
