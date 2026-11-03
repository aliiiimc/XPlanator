import { createHash, randomUUID } from "node:crypto";
import { ModelProvider } from "./types";

export interface ProviderProfile {
  id: string;
  name: string;
  provider: ModelProvider;
  endpoint: string;
  model: string;
  timeoutSeconds: number;
  structuredOutput?: boolean;
}

interface ProfileState { version: 1; activeId: string; profiles: ProviderProfile[]; legacyImported?: ModelProvider[] }
interface StateStore { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> }
interface Secrets { get(key: string): Thenable<string | undefined>; store(key: string, value: string): Thenable<void>; delete(key: string): Thenable<void> }
const stateKey = "xplanator.profiles.v1";

/** Profiles hold no credentials. Secrets are bound to both profile ID and destination. */
export class ProfileRepository {
  constructor(private readonly state: StateStore, private readonly secrets: Secrets) {}

  read(): ProfileState | undefined { return this.state.get<ProfileState>(stateKey); }

  async migrate(initial: Omit<ProviderProfile, "id">): Promise<ProfileState> {
    const existing = this.read();
    if (existing) return existing;
    // Stable ID makes a retry after a failed state write reuse the same secret slot.
    const id = `legacy-${createHash("sha256").update(initial.provider).update("\0").update(initial.endpoint).digest("hex").slice(0, 24)}`;
    const profile = validateProfile({ ...initial, id }, true);
    const oldKey = profile.provider === "ollama" ? undefined : await this.secrets.get(`xplanator.${profile.provider}.apiKey`);
    // Keep the legacy secret so an interrupted migration or rollback cannot lose it.
    if (oldKey) await this.secrets.store(secretKey(profile), oldKey);
    const migrated: ProfileState = { version: 1, activeId: profile.id, profiles: [profile], legacyImported: oldKey ? [profile.provider] : [] };
    await this.state.update(stateKey, migrated);
    return migrated;
  }

  async save(profile: ProviderProfile): Promise<void> {
    const value = validateProfile(profile);
    const state = this.requireState();
    const index = state.profiles.findIndex(item => item.id === value.id);
    const previous = index < 0 ? undefined : state.profiles[index];
    const profiles = [...state.profiles];
    if (index < 0) profiles.push(value); else profiles[index] = value;
    await this.state.update(stateKey, { ...state, profiles });
    // A changed destination cannot reuse the former credential. Remove the old
    // secret only after the profile update succeeds.
    if (previous && secretKey(previous) !== secretKey(value)) await this.secrets.delete(secretKey(previous));
  }

  async select(id: string): Promise<void> {
    const state = this.requireState();
    if (!state.profiles.some(profile => profile.id === id)) throw new Error("Profil introuvable.");
    await this.state.update(stateKey, { ...state, activeId: id });
  }

  async remove(id: string): Promise<void> {
    const state = this.requireState();
    const profile = state.profiles.find(item => item.id === id);
    if (!profile) throw new Error("Profil introuvable.");
    const profiles = state.profiles.filter(item => item.id !== id);
    if (!profiles.length) throw new Error("Conservez au moins un profil.");
    await this.state.update(stateKey, { ...state, profiles, activeId: state.activeId === id ? profiles[0].id : state.activeId });
    await this.secrets.delete(secretKey(profile));
  }

  async getKey(profile: ProviderProfile): Promise<string | undefined> { return this.secrets.get(secretKey(profile)); }
  async setKey(profile: ProviderProfile, key: string): Promise<void> {
    const value = key.trim();
    if (!value) throw new Error("La clé API est vide.");
    await this.secrets.store(secretKey(profile), value);
  }
  async clearKey(profile: ProviderProfile): Promise<void> { await this.secrets.delete(secretKey(profile)); }

  async importLegacyKey(profile: ProviderProfile, legacyEndpoint: string): Promise<boolean> {
    const state = this.requireState();
    if (profile.provider === "ollama" || state.legacyImported?.includes(profile.provider)) return false;
    let oldDestination: URL;
    try { oldDestination = new URL(legacyEndpoint); } catch { return false; }
    const newDestination = new URL(profile.endpoint);
    oldDestination.pathname = oldDestination.pathname.replace(/\/+$/, "") || "/";
    newDestination.pathname = newDestination.pathname.replace(/\/+$/, "") || "/";
    if (oldDestination.toString() !== newDestination.toString() || await this.getKey(profile)) return false;
    const oldKey = await this.secrets.get(`xplanator.${profile.provider}.apiKey`);
    if (!oldKey) return false;
    await this.setKey(profile, oldKey);
    await this.state.update(stateKey, { ...state, legacyImported: [...(state.legacyImported ?? []), profile.provider] });
    return true;
  }

  private requireState(): ProfileState {
    const state = this.read();
    if (!state) throw new Error("Les profils ne sont pas initialisés.");
    return state;
  }
}

export function newProfile(initial: Omit<ProviderProfile, "id">): ProviderProfile {
  return validateProfile({ ...initial, id: randomUUID() });
}

function validateProfile(profile: ProviderProfile, allowEmptyModel = false): ProviderProfile {
  const name = profile.name.trim();
  const model = profile.model.trim();
  const url = new URL(profile.endpoint);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (!name || (!model && !allowEmptyModel) || !profile.id || url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local))) {
    throw new Error("Profil invalide : vérifiez le nom, le modèle et l'URL sécurisée.");
  }
  if (!Number.isFinite(profile.timeoutSeconds) || profile.timeoutSeconds < 5 || profile.timeoutSeconds > 180) {
    throw new Error("Le délai doit être compris entre 5 et 180 secondes.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return { ...profile, name, model, endpoint: url.toString() };
}

function secretKey(profile: ProviderProfile): string {
  const endpoint = new URL(profile.endpoint);
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") || "/";
  const destination = createHash("sha256").update(endpoint.toString()).digest("hex");
  return `xplanator.profile.${profile.id}.${destination}`;
}
