// Shared DocuSign helpers: JWT Grant auth + envelope building.
// ---------------------------------------------------------------------------
// Server-to-server auth per DocuSign's JWT Grant flow. We sign a JWT with the
// integration's RSA private key (RS256 via Web Crypto), exchange it for an
// access token, then call the eSignature REST API.
//
// Required secrets (Supabase → Edge Functions → Secrets):
//   DOCUSIGN_INTEGRATION_KEY  the integration key (client id / GUID)
//   DOCUSIGN_USER_ID          the API username (user GUID) that granted consent
//   DOCUSIGN_ACCOUNT_ID       the API account id (GUID)
//   DOCUSIGN_PRIVATE_KEY      the RSA private key, PKCS8 PEM (BEGIN PRIVATE KEY)
//   DOCUSIGN_ENV              'demo' (sandbox, default) or 'production'
//
// Note: DocuSign hands you a PKCS1 key (BEGIN RSA PRIVATE KEY). Convert once:
//   openssl pkcs8 -topk8 -nocrypt -in ds.pem -out ds_pkcs8.pem

export function dsEnv() {
  const env = (Deno.env.get("DOCUSIGN_ENV") || "demo").toLowerCase();
  const production = env === "production" || env === "prod";
  return {
    production,
    oauthHost: production ? "account.docusign.com" : "account-d.docusign.com",
  };
}

export function dsConfigured(): boolean {
  return !!(Deno.env.get("DOCUSIGN_INTEGRATION_KEY") && Deno.env.get("DOCUSIGN_USER_ID")
    && Deno.env.get("DOCUSIGN_ACCOUNT_ID") && Deno.env.get("DOCUSIGN_PRIVATE_KEY"));
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

// Exchange a JWT assertion for an access token (impersonating DOCUSIGN_USER_ID).
export async function dsAccessToken(): Promise<{ token: string; basePath: string }> {
  const key = Deno.env.get("DOCUSIGN_PRIVATE_KEY")!;
  const iss = Deno.env.get("DOCUSIGN_INTEGRATION_KEY")!;
  const sub = Deno.env.get("DOCUSIGN_USER_ID")!;
  const { oauthHost } = dsEnv();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss, sub, aud: oauthHost, iat: now, exp: now + 3600, scope: "signature impersonation" };
  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claims))}`;

  const cryptoKey = await importPrivateKey(key);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, cryptoKey, new TextEncoder().encode(signingInput),
  ));
  const assertion = `${signingInput}.${b64urlFromBytes(sig)}`;

  const res = await fetch(`https://${oauthHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    // consent_required means an admin must grant consent once (see setup guide).
    throw new Error(`docusign auth failed: ${data.error || res.status} ${data.error_description || ""}`.trim());
  }

  // Resolve the account's REST base URI from userinfo (falls back to the standard host).
  let basePath = dsEnv().production ? "https://na1.docusign.net/restapi" : "https://demo.docusign.net/restapi";
  try {
    const ui = await fetch(`https://${oauthHost}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then((r) => r.json());
    const acctId = Deno.env.get("DOCUSIGN_ACCOUNT_ID");
    const acct = (ui.accounts || []).find((a: { account_id: string }) => a.account_id === acctId) || ui.accounts?.[0];
    if (acct?.base_uri) basePath = `${acct.base_uri}/restapi`;
  } catch { /* keep default base path */ }

  return { token: data.access_token, basePath };
}
