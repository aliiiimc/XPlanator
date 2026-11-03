import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeHttpError } from "./providerErrors";

test("classifies authentication, permissions, missing model and limits without echoing provider data", async () => {
  const cases: Array<[number, string, RegExp]> = [
    [401, "invalid key SECRET_VALUE", /Authentification/],
    [403, "not allowed SECRET_VALUE", /droits/],
    [404, "unknown SECRET_VALUE", /introuvable/],
    [429, '{"error":{"code":"insufficient_quota"},"secret":"SECRET_VALUE"}', /Quota ou crédit/],
    [429, "rate limit SECRET_VALUE", /Limite/],
    [400, "bad parameter SECRET_VALUE", /paramètres/]
  ];
  for (const [status, body, expected] of cases) {
    const message = await describeHttpError(new Response(body, { status }), "fr");
    assert.match(message, expected);
    assert.doesNotMatch(message, /SECRET_VALUE/);
  }
});
