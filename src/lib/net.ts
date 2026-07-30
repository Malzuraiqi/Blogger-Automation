// FILE: src/lib/net.ts
// safeFetch/fetchWithRetry: shared network helpers used by every external provider call (images, TTS, archive.org uploads).

export async function safeFetch(service: string, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    const chain: string[] = [];
    let cur: any = e;
    let depth = 0;
    while (cur && depth < 5) {
      if (cur.code) chain.push(String(cur.code));
      else if (cur.message) chain.push(String(cur.message));
      cur = cur.cause;
      depth++;
    }
    const detail = chain.length ? chain.join(" -> ") : String(e);
    throw new Error(
      `${service}: network request to ${url} never got a response (${detail}). This means the server process couldn't reach that host at all — check the server's internet connection, and any firewall, antivirus, or corporate/VPN proxy that might be blocking outbound HTTPS to this domain.`
    );
  }
}

export async function fetchWithRetry(service: string, url: string, init: RequestInit | undefined, maxAttempts = 4): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await safeFetch(service, url, init);
    if (res.status !== 429) return res;
    lastRes = res;
    if (attempt < maxAttempts) {
      const waitMs = 3000 * attempt;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return lastRes as Response;
}