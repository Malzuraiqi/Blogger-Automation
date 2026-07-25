// FILE: src/lib/blogger.ts
// Google OAuth + Blogger API v3 helpers (auth URL, token exchange/refresh, list blogs, publish post). Used by src/app/api/blogger/*.

// Minimal Google OAuth2 + Blogger API v3 client. No googleapis SDK dependency
// — just fetch, matching the style of the rest of this project.
//
// Setup required in Google Cloud Console:
//   1. Create a project, enable the "Blogger API v3".
//   2. Create an OAuth 2.0 Client ID (type: Web application).
//   3. Add an authorized redirect URI matching BLOGGER_REDIRECT_URI below,
//      e.g. http://localhost:3000/api/blogger/callback for local dev, or
//      https://your-app.vercel.app/api/blogger/callback in production.
//   4. Put the client ID/secret in .env.local as GOOGLE_CLIENT_ID /
//      GOOGLE_CLIENT_SECRET, and set BLOGGER_REDIRECT_URI to match step 3.

import { supabaseServer } from "@/lib/supabase";

const SCOPE = "https://www.googleapis.com/auth/blogger";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Add it to .env.local (see README for Blogger setup).`);
  return v;
}

export function getAuthUrl(): string {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requireEnv("BLOGGER_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("BLOGGER_REDIRECT_URI");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

// Loads the stored credentials, refreshing the access token first if it has
// expired. Throws if no account has been connected yet.
export async function getValidAccessToken(): Promise<{ accessToken: string; blogId: string | null }> {
  const sb = supabaseServer();
  const { data: creds } = await sb.from("blogger_credentials").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!creds) throw new Error("No Blogger account connected yet. Go to Advanced Settings > Blogger and connect your Google account.");

  const expired = !creds.expires_at || new Date(creds.expires_at).getTime() < Date.now() + 60_000;
  if (!expired) return { accessToken: creds.access_token, blogId: creds.blog_id };

  if (!creds.refresh_token) {
    throw new Error("Blogger access token expired and no refresh token is stored. Reconnect your Google account.");
  }
  const refreshed = await refreshAccessToken(creds.refresh_token);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await sb.from("blogger_credentials").update({ access_token: refreshed.access_token, expires_at: expiresAt }).eq("id", creds.id);
  return { accessToken: refreshed.access_token, blogId: creds.blog_id };
}

export async function listBlogs(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/blogger/v3/users/self/blogs", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Blogger listBlogs failed: ${await res.text()}`);
  const data = await res.json();
  return (data.items || []).map((b: any) => ({ id: b.id, name: b.name, url: b.url }));
}

export async function publishPost(
  accessToken: string,
  blogId: string,
  post: { title: string; content: string; labels: string[]; searchDescription?: string; isDraft: boolean; publishDate?: string }
) {
  const params = new URLSearchParams();
  if (post.isDraft) params.set("isDraft", "true");
  const url = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      labels: post.labels,
      ...(post.searchDescription ? { searchDescription: post.searchDescription } : {}),
      ...(post.publishDate ? { published: post.publishDate } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Blogger publish failed: ${await res.text()}`);
  return res.json() as Promise<{ id: string; url: string }>;
}