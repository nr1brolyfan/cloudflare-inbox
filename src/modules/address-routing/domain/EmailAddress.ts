import * as Schema from "effect/Schema";

export const EmailAddress = Schema.Trimmed.pipe(
  Schema.check(
    Schema.isLengthBetween(3, 320),
    Schema.makeFilter<string>((value) => {
      const separator = value.lastIndexOf("@");
      if (separator <= 0 || separator !== value.indexOf("@")) {
        return "must contain one local part and one domain";
      }
      const local = value.slice(0, separator);
      const domain = value.slice(separator + 1);
      if (
        local.length > 64 ||
        local.startsWith(".") ||
        local.endsWith(".") ||
        local.includes("..") ||
        !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)
      ) {
        return "must contain a valid dot-atom local part";
      }
      const labels = domain.split(".");
      return labels.length >= 2 &&
        labels.every(
          (label) =>
            label.length >= 1 &&
            label.length <= 63 &&
            /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
        )
        ? undefined
        : "must contain a valid DNS domain";
    })
  ),
  Schema.brand("cloudflare-inbox/EmailAddress")
);
export type EmailAddress = Schema.Schema.Type<typeof EmailAddress>;

export const NormalizedEmailAddress = EmailAddress.pipe(
  Schema.check(
    Schema.makeFilter<EmailAddress>((value) => {
      const separator = value.lastIndexOf("@");
      const domain = value.slice(separator + 1);
      return domain === domain.toLowerCase()
        ? undefined
        : "must contain a lowercase domain";
    })
  ),
  Schema.brand("cloudflare-inbox/NormalizedEmailAddress")
);
export type NormalizedEmailAddress = Schema.Schema.Type<
  typeof NormalizedEmailAddress
>;

/** DNS domains are case-insensitive; SMTP local parts remain case-sensitive. */
export const normalizeEmailAddressDomain = (
  address: EmailAddress
): NormalizedEmailAddress => {
  const separator = address.lastIndexOf("@");
  return Schema.decodeUnknownSync(NormalizedEmailAddress)(
    `${address.slice(0, separator)}@${address.slice(separator + 1).toLowerCase()}`
  );
};
