export function invitationCode(value: string): string {
  let input = value.trim();
  if (/^https?:\/\//i.test(input)) {
    try {
      const match = new URL(input).hash.match(/^#\/(?:join|board)\/([^/]+)$/);
      if (!match) throw new Error();
      input = decodeURIComponent(match[1]);
    } catch {
      throw new Error(
        "Paste a complete board invitation code or invitation link.",
      );
    }
  }
  const code = input.replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code))
    throw new Error("Enter the complete 32-character invitation code.");
  return code;
}

export function invitationLink(code: string, currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = `#/join/${invitationCode(code)}`;
  return url.href;
}

export function invitationFromHash(hash: string): string | null {
  if (!hash.startsWith("#/join/")) return null;
  try {
    return invitationCode(decodeURIComponent(hash.slice(7)));
  } catch {
    throw new Error(
      "This invitation link is invalid. Paste a complete board invitation.",
    );
  }
}
