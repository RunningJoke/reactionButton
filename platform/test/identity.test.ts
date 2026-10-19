import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(async () => {
  env = await testEnv();
});
afterEach(() => env.close());

const linkToken = (text: string) => decodeURIComponent(/login\?token=([^\s]+)/.exec(text)![1]!);

describe("sign-in", () => {
  it("mails a code and a link into the app; both sign in once", async () => {
    expect((await env.call("POST", "/v1/auth/login", { email: "Anna@Example.org", locale: "de" })).status).toBe(202);
    const mail = env.mailer.sent.at(-1)!;
    expect(mail.to).toBe("anna@example.org");
    expect(mail.subject).toMatch(/^ReactPod-Anmeldung: \d{6}$/);
    expect(mail.text).toContain("https://app.test/#/login?token=");

    const first = await env.call("POST", "/v1/auth/verify", { token: linkToken(mail.text) });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: true, user: { email: "anna@example.org" } });
    expect((await env.call("POST", "/v1/auth/verify", { token: linkToken(mail.text) })).status).toBe(401);

    await env.call("POST", "/v1/auth/login", { email: "anna@example.org" });
    const second = await env.call("POST", "/v1/auth/verify", { email: "ANNA@example.org", code: env.lastCode("anna@example.org") });
    expect(second.body).toMatchObject({ created: false, user: { id: first.body.user.id } });
  });

  it("answers 202 for every address (no account enumeration)", async () => {
    expect((await env.call("POST", "/v1/auth/login", { email: "nobody@example.org" })).status).toBe(202);
    expect((await env.call("POST", "/v1/auth/login", { email: "not an email" })).status).toBe(400);
  });

  it("allows 5 wrong codes, then the request is dead", async () => {
    await env.call("POST", "/v1/auth/login", { email: "a@example.org" });
    const code = env.lastCode("a@example.org");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const res = await env.call("POST", "/v1/auth/verify", { email: "a@example.org", code: wrong });
      expect(res.status).toBe(401);
      expect(res.body.title).toBe("invalid_login");
    }
    expect((await env.call("POST", "/v1/auth/verify", { email: "a@example.org", code })).status).toBe(401);
  });

  it("expires after 15 minutes", async () => {
    await env.call("POST", "/v1/auth/login", { email: "a@example.org" });
    env.clock.advance(16 * 60_000);
    expect((await env.call("POST", "/v1/auth/verify", { email: "a@example.org", code: env.lastCode("a@example.org") })).status).toBe(401);
  });

  it("limits requests per address", async () => {
    for (let i = 0; i < 5; i++) expect((await env.call("POST", "/v1/auth/login", { email: "a@example.org" })).status).toBe(202);
    const res = await env.call("POST", "/v1/auth/login", { email: "a@example.org" });
    expect(res.status).toBe(429);
    env.clock.advance(61 * 60_000);
    expect((await env.call("POST", "/v1/auth/login", { email: "a@example.org" })).status).toBe(202);
  });

  it("needs token or email + code", async () => {
    expect((await env.call("POST", "/v1/auth/verify", {})).status).toBe(400);
  });
});

describe("me and sessions", () => {
  it("requires a valid token", async () => {
    expect((await env.call("GET", "/v1/me")).status).toBe(401);
    expect((await env.call("GET", "/v1/me", undefined, "bogus")).status).toBe(401);
  });

  it("reads and changes the profile", async () => {
    const token = await env.signIn("a@example.org");
    expect((await env.call("GET", "/v1/me", undefined, token)).body).toMatchObject({ email: "a@example.org", locale: "en" });
    const res = await env.call("PATCH", "/v1/me", { displayName: "Anna", locale: "de" }, token);
    expect(res.body).toMatchObject({ displayName: "Anna", locale: "de" });
  });

  it("lists sessions, revokes one, logs out", async () => {
    const t1 = await env.signIn("a@example.org");
    const t2 = await env.signIn("a@example.org");
    const list = (await env.call("GET", "/v1/me/sessions", undefined, t1)).body.sessions;
    expect(list).toHaveLength(2);
    const other = list.find((s: { current: boolean }) => !s.current);
    expect((await env.call("DELETE", `/v1/me/sessions/${other.id}`, undefined, t1)).status).toBe(200);
    expect((await env.call("GET", "/v1/me", undefined, t2)).status).toBe(401);
    expect((await env.call("POST", "/v1/auth/logout", {}, t1)).status).toBe(200);
    expect((await env.call("GET", "/v1/me", undefined, t1)).status).toBe(401);
  });

  it("sessions expire", async () => {
    const token = await env.signIn("a@example.org");
    env.clock.advance(31 * 86_400_000);
    expect((await env.call("GET", "/v1/me", undefined, token)).status).toBe(401);
  });

  it("exports the user's data", async () => {
    const token = await env.signIn("a@example.org");
    const res = await env.call("GET", "/v1/me/export", undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("a@example.org");
    expect(res.body.memberships).toEqual([expect.objectContaining({ kind: "personal", role: "owner" })]);
    expect(res.body.activity.map((a: { action: string }) => a.action)).toContain("user.created");
  });

  it("deletes the account, but not while being the only owner of a club", async () => {
    const owner = await env.signIn("owner@example.org");
    const other = await env.signIn("other@example.org");
    const club = (await env.call("POST", "/v1/orgs", { name: "Club" }, owner)).body;
    const invite = (await env.call("POST", `/v1/orgs/${club.id}/invites`, { role: "admin" }, owner)).body;
    await env.call("POST", "/v1/invites/accept", { code: invite.code }, other);

    expect((await env.call("DELETE", "/v1/me", undefined, owner)).status).toBe(409);
    const otherId = (await env.call("GET", "/v1/me", undefined, other)).body.id;
    await env.call("POST", `/v1/orgs/${club.id}/transfer`, { userId: otherId }, owner);
    expect((await env.call("DELETE", "/v1/me", undefined, owner)).status).toBe(200);
    expect((await env.call("GET", "/v1/me", undefined, owner)).status).toBe(401);

    const members = (await env.call("GET", `/v1/orgs/${club.id}/members`, undefined, other)).body.members;
    expect(members.map((m: { userId: string }) => m.userId)).toEqual([otherId]);
    // the old address can sign up again as a new account
    await env.call("POST", "/v1/auth/login", { email: "owner@example.org" });
    const again = await env.call("POST", "/v1/auth/verify", { email: "owner@example.org", code: env.lastCode("owner@example.org") });
    expect(again.body.created).toBe(true);
  });
});
