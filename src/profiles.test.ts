import { strict as assert } from "node:assert";
import { test } from "node:test";
import { newProfile, ProfileRepository } from "./profiles";

function stores() {
  const data = new Map<string, unknown>();
  const values = new Map<string, string>();
  return {
    data, values,
    state: { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value); } },
    secrets: { get: async (key: string) => values.get(key), store: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } }
  };
}
const initial = { name: "OpenAI", provider: "openai" as const, endpoint: "https://api.openai.com/v1", model: "model", timeoutSeconds: 60 };

test("migration is idempotent and preserves legacy secrets without storing them in state", async () => {
  const mock = stores();
  mock.values.set("xplanator.openai.apiKey", "secret");
  const repo = new ProfileRepository(mock.state, mock.secrets);
  const state = await repo.migrate(initial);
  assert.deepEqual(await repo.migrate({ ...initial, model: "different" }), state);
  assert.equal(await repo.getKey(state.profiles[0]), "secret");
  assert.equal(mock.values.get("xplanator.openai.apiKey"), "secret");
  assert.doesNotMatch(JSON.stringify([...mock.data]), /secret/);
});

test("profiles retain models independently and credentials do not follow a changed endpoint", async () => {
  const mock = stores();
  const repo = new ProfileRepository(mock.state, mock.secrets);
  const state = await repo.migrate(initial);
  const first = state.profiles[0];
  await repo.setKey(first, "key-one");
  const second = newProfile({ ...initial, name: "Other", endpoint: "https://other.example/v1", model: "other" });
  await repo.save(second);
  await repo.select(second.id);
  assert.equal(repo.read()?.profiles.find(profile => profile.id === first.id)?.model, "model");
  assert.equal(await repo.getKey(second), undefined);
  assert.equal(await repo.getKey({ ...first, endpoint: "https://other.example/v1" }), undefined);
  await repo.remove(second.id);
  assert.equal(repo.read()?.activeId, first.id);
  await assert.rejects(repo.remove(first.id), /au moins un/);
});

test("profile destinations reject nonlocal HTTP and embedded credentials", () => {
  assert.throws(() => newProfile({ ...initial, endpoint: "http://example.com" }));
  assert.throws(() => newProfile({ ...initial, endpoint: "https://key@example.com" }));
  assert.doesNotThrow(() => newProfile({ ...initial, endpoint: "http://localhost:11434" }));
});

test("changing a destination removes the previous profile credential after saving", async () => {
  const mock = stores();
  const repo = new ProfileRepository(mock.state, mock.secrets);
  const profile = (await repo.migrate(initial)).profiles[0];
  await repo.setKey(profile, "old-key");
  const changed = { ...profile, endpoint: "https://other.example/v1" };
  await repo.setKey(changed, "new-key");
  await repo.save(changed);
  assert.equal(await repo.getKey(profile), undefined);
  assert.equal(await repo.getKey(changed), "new-key");
  assert.equal(repo.read()?.profiles[0].endpoint, changed.endpoint);
});

test("imports another provider's old key only at its original destination and only once", async () => {
  const mock = stores();
  mock.values.set("xplanator.anthropic.apiKey", "old-anthropic-key");
  const repo = new ProfileRepository(mock.state, mock.secrets);
  await repo.migrate(initial);
  const profile = newProfile({ ...initial, provider: "anthropic", name: "Claude", endpoint: "https://api.anthropic.com/v1" });
  await repo.save(profile);
  assert.equal(await repo.importLegacyKey(profile, "https://different.example/v1"), false);
  assert.equal(await repo.getKey(profile), undefined);
  assert.equal(await repo.importLegacyKey(profile, "https://api.anthropic.com/v1/"), true);
  assert.equal(await repo.getKey(profile), "old-anthropic-key");
  await repo.clearKey(profile);
  assert.equal(await repo.importLegacyKey(profile, "https://api.anthropic.com/v1"), false);
  assert.equal(await repo.getKey(profile), undefined);
});

test("interrupted migration retries into the same secret slot", async () => {
  const mock = stores();
  mock.values.set("xplanator.openai.apiKey", "legacy-secret");
  let fail = true;
  const state = { ...mock.state, update: async (key: string, value: unknown) => {
    if (fail) { fail = false; throw new Error("write failed"); }
    await mock.state.update(key, value);
  } };
  const repo = new ProfileRepository(state, mock.secrets);
  await assert.rejects(repo.migrate(initial), /write failed/);
  const slotsAfterFailure = [...mock.values.keys()].filter(key => key.startsWith("xplanator.profile."));
  const migrated = await repo.migrate(initial);
  assert.equal(await repo.getKey(migrated.profiles[0]), "legacy-secret");
  assert.deepEqual([...mock.values.keys()].filter(key => key.startsWith("xplanator.profile.")), slotsAfterFailure);
});
