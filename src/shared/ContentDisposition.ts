const rfc5987Value = (value: string) =>
  encodeURIComponent(value).replaceAll(
    /[()*']/gu,
    (character) =>
      `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`
  );

export const attachmentContentDisposition = (fileName: string) => {
  const baseName = fileName.split(/[\\/]/u).at(-1) || "attachment";
  const safeUnicode = [...baseName]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? "_" : character;
    })
    .join("");
  const asciiFallback = [...safeUnicode]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint > 0x7e ? "_" : character;
    })
    .join("")
    .replaceAll(/["\\]/gu, "_");
  const fallback = asciiFallback.length === 0 ? "attachment" : asciiFallback;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${rfc5987Value(safeUnicode)}`;
};
