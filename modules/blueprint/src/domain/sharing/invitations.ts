export function invitationCode(value: string): string {
  let input = value.trim();
  if (/^https?:\/\//i.test(input)) {
    try {
      const match = new URL(input).hash.match(/^#\/board\/([^/]+)$/);
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
  url.hash = `#/board/${invitationCode(code)}`;
  return url.href;
}

/** Only a complete canonical board URL identifies an invitation. */
export function boardCodeFromHash(hash: string): string | null {
  const match = /^#\/board\/([a-f0-9]{32})$/i.exec(hash);
  return match ? match[1].toLowerCase() : null;
}
