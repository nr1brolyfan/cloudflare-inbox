import * as Schema from "effect/Schema";

export const minimumPasswordCodePoints = 12;

/** Password length is measured in Unicode code points, not UTF-16 code units. */
export const meetsPasswordPolicy = (password: string) =>
  [...password].length >= minimumPasswordCodePoints;

export const PasswordPolicySchema = Schema.String.pipe(
  Schema.refine(
    (password): password is string => meetsPasswordPolicy(password),
    {
      message: `Password must contain at least ${minimumPasswordCodePoints} Unicode characters`,
    }
  )
);
