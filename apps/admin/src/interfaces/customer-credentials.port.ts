/**
 * The **customer account-provisioning seam** (T5.17) — the two side effects registering a customer
 * needs that Security's use-case surface does not itself expose, expressed as a port so the admin
 * boundary stays uncoupled from whichever identity provider a deployment actually runs.
 *
 * Why a port rather than direct calls: both operations are *provider-specific* by nature. In this
 * repo's offline/local composition they land on Security's own reference adapters
 * (`InMemoryIdentityDirectory`, `InMemoryPasswordAuthProvider` — see `CustomerCredentialsAdapter` in
 * `apps/admin/src/composition.ts`). In a deployment running a real IdP, *both* become no-ops or thin
 * calls into Kratos/Auth0/Cognito, because that IdP already owns the subject and the password, and
 * Security's `AuthenticationProviderPort` is implemented by a bridge to it instead. Neither this
 * interface nor any caller of it changes in that swap.
 *
 * **This port never hashes, salts, stores, compares, or logs a password itself** (T5.17 constraint
 * 10). `setPassword` hands the credential straight to whichever `AuthenticationProviderPort` the
 * Security composition registered for the `"password"` method and keeps no copy — credential storage
 * and verification stay entirely inside Security's existing authentication machinery, which is also
 * the only thing `Authenticate` ever consults. Nothing here reimplements any part of that.
 */
export interface CustomerCredentialsPort {
  /**
   * Makes an Identity subject id visible to Security's {@link IdentityDirectoryPort} so
   * `RegisterPrincipal` can verify it before creating a `human` principal (it refuses a `subjectRef`
   * the directory does not know — a real check, not a formality). With a live directory (Kratos) the
   * subject already exists and this is a no-op.
   */
  registerSubject(subjectRef: string): Promise<void>;

  /**
   * Registers the customer's login credential with Security's password authentication provider,
   * mapping the login `identifier` (the customer's email) to the `principalExternalId` that
   * `Authenticate` will resolve on success. Called exactly once, at registration.
   */
  setPassword(identifier: string, password: string, principalExternalId: string): Promise<void>;
}
