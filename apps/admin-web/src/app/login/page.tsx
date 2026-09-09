import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button, Card, CardContent, Input, Label } from "@platform/ui";
import { BrandMark } from "@/components/brand-mark";
import { authConfig } from "@/lib/auth/config";
import { oryAdminHeaders } from "@/lib/auth/ory-admin";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/**
 * The Hydra login provider (Phase A.32) — the page `infrastructure/docker/hydra/hydra.yml`'s
 * `urls.login` points at. Also doubles as Kratos's self-service login UI
 * (`infrastructure/docker/kratos/kratos.yml`'s `selfservice.flows.login.ui_url`): the same route
 * serves both roles because both point at admin-web, the only OAuth2 browser client wired up so
 * far. Two arrival shapes:
 *
 *  1. `?login_challenge=X` (from Hydra, via the middleware's redirect to `/oauth2/auth`) — check
 *     for an existing Kratos session; if present, accept the Hydra login request with that
 *     identity and bounce back into the OAuth2 flow. If absent, hand off to Kratos's own
 *     browser login flow, asking it to `return_to` this same URL once it succeeds.
 *  2. `?flow=Y` (from Kratos, once it's created a login flow) — render Kratos's own login form,
 *     which posts directly to Kratos's public API. No password handling of our own: Kratos owns
 *     the credential check (self-service flows are Kratos-owned per `packages/auth/src/
 *     kratos.ts`'s own doc comment) and this page never sees or stores a password.
 *
 * `localhost` cookies are host-only (no explicit Domain), so the Ory RFC 6265 rule that cookies
 * are NOT port-scoped means Kratos's session cookie (set at :4433) is sent by the browser to this
 * app at :3100 too — that's what makes step 1's session check work without a shared parent domain.
 */

interface KratosLoginFlow {
  readonly id: string;
  readonly ui: {
    readonly action: string;
    readonly method: string;
    readonly nodes: readonly KratosUiNode[];
    readonly messages?: readonly { readonly text: string }[];
  };
}

interface KratosUiNode {
  readonly type: string;
  readonly group: string;
  readonly attributes: {
    readonly name: string;
    readonly type?: string;
    readonly value?: string | number | boolean;
    readonly required?: boolean;
    readonly disabled?: boolean;
  };
  readonly messages?: readonly { readonly text: string }[];
}

interface LoginPageProps {
  readonly searchParams: Promise<{
    readonly login_challenge?: string;
    readonly flow?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { login_challenge: loginChallenge, flow } = await searchParams;

  if (loginChallenge !== undefined) {
    await handleLoginChallenge(loginChallenge);
  }

  if (flow !== undefined) {
    const cookieHeader = (await headers()).get("cookie") ?? "";
    return renderKratosLoginForm(await fetchLoginFlow(flow, cookieHeader));
  }

  redirect("/");
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host === null) {
    // A real reverse proxy always sets Host (or X-Forwarded-Host); its absence outside dev means
    // something is misconfigured (Phase A.34 — A.33 P0 #7: fail loudly, don't guess localhost).
    const appEnv = process.env["APP_ENV"] ?? "local";
    if (appEnv === "local" || appEnv === "development") return "http://localhost:3100";
    throw new Error(
      "No Host/X-Forwarded-Host header present — cannot determine the request origin.",
    );
  }
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function handleLoginChallenge(loginChallenge: string): Promise<void> {
  // Validates the challenge is real and unexpired before we act on it; the response body
  // (`skip`/`subject`) isn't needed — the Kratos session lookup below is the source of truth.
  const requestInfo = await fetchWithTimeout(
    `${authConfig.hydraAdminUrl}/admin/oauth2/auth/requests/login?login_challenge=${encodeURIComponent(loginChallenge)}`,
    { headers: oryAdminHeaders() },
  );
  if (!requestInfo.ok) {
    throw new Error(`Hydra rejected the login request: ${requestInfo.status}`);
  }

  const cookieHeader = (await headers()).get("cookie") ?? "";
  const whoami = await fetchWithTimeout(`${authConfig.kratosPublicUrl}/sessions/whoami`, {
    headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });

  if (whoami.status !== 200) {
    const origin = await requestOrigin();
    const returnTo = new URL(
      `/login?login_challenge=${encodeURIComponent(loginChallenge)}`,
      origin,
    );
    const browserFlowUrl = new URL(`${authConfig.kratosPublicUrl}/self-service/login/browser`);
    browserFlowUrl.searchParams.set("return_to", returnTo.toString());
    redirect(browserFlowUrl.toString());
  }

  const session = (await whoami.json()) as {
    identity: {
      id: string;
      traits?: { email?: string };
      metadata_public?: { kind?: string; roles?: readonly string[] };
    };
  };
  const meta = session.identity.metadata_public ?? {};

  const accept = await fetchWithTimeout(
    `${authConfig.hydraAdminUrl}/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(loginChallenge)}`,
    {
      method: "PUT",
      headers: oryAdminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        subject: session.identity.id,
        remember: true,
        remember_for: 3600,
        context: {
          kind: meta.kind ?? "staff",
          roles: meta.roles ?? [],
          email: session.identity.traits?.email,
        },
      }),
    },
  );
  if (!accept.ok) {
    throw new Error(`Hydra rejected the login accept: ${accept.status}`);
  }
  const { redirect_to: redirectTo } = (await accept.json()) as { redirect_to: string };
  redirect(redirectTo);
}

async function fetchLoginFlow(flowId: string, cookieHeader: string): Promise<KratosLoginFlow> {
  // Kratos ties a flow to the browser's csrf/session cookies set when the flow was created
  // (`/self-service/login/browser` sets them at :4433) — same "localhost cookies are port-blind"
  // property `handleLoginChallenge`'s whoami call relies on, forwarded here for the same reason.
  const response = await fetchWithTimeout(
    `${authConfig.kratosPublicUrl}/self-service/login/flows?id=${encodeURIComponent(flowId)}`,
    { headers: cookieHeader.length > 0 ? { cookie: cookieHeader } : {}, cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Kratos rejected the login flow lookup: ${response.status}`);
  }
  return (await response.json()) as KratosLoginFlow;
}

function renderKratosLoginForm(flow: KratosLoginFlow) {
  const messages = flow.ui.messages ?? [];
  return (
    <main className="lumo-canvas flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8">
          <div className="mb-6 flex items-center gap-2.5">
            <BrandMark />
            <span className="text-foreground text-xl font-semibold tracking-tight">
              Morbeh Admin
            </span>
          </div>
          <p className="text-muted-foreground -mt-4 mb-6 text-sm">Sign in to continue.</p>

          {messages.length > 0 && (
            <div className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 rounded-xl px-3.5 py-2.5 text-sm">
              {messages.map((message) => (
                <p key={message.text}>{message.text}</p>
              ))}
            </div>
          )}

          <form
            action={flow.ui.action}
            method={flow.ui.method.toLowerCase() === "get" ? "get" : "post"}
            className="flex flex-col gap-4"
          >
            {flow.ui.nodes.map((node) => renderNode(node))}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function renderNode(node: KratosUiNode) {
  if (node.type !== "input") return null;
  const { name, type, value, required, disabled } = node.attributes;
  const nodeMessages = node.messages ?? [];

  if (type === "hidden") {
    return <input key={name} type="hidden" name={name} defaultValue={String(value ?? "")} />;
  }
  if (type === "submit") {
    return (
      <Button
        key={name}
        type="submit"
        name={name}
        value={String(value ?? "")}
        className="mt-2 w-full"
      >
        Sign in
      </Button>
    );
  }

  const label = name === "identifier" ? "Email" : name === "password" ? "Password" : name;
  return (
    <div key={name} className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type={type === "password" ? "password" : "text"}
        name={name}
        required={required === true}
        disabled={disabled === true}
        autoComplete={
          name === "identifier" ? "username" : name === "password" ? "current-password" : undefined
        }
      />
      {nodeMessages.map((message) => (
        <span key={message.text} className="text-destructive text-xs">
          {message.text}
        </span>
      ))}
    </div>
  );
}
