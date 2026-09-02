import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import {
  ArchivePolicyRowForm,
  AssignRoleForm,
  CheckAccessPanel,
  ConfigureTenantSecurityForm,
  DefinePolicyForm,
  DefineRoleForm,
  DeleteRelationTupleForm,
  EvaluateAccessPanel,
  GrantDelegationForm,
  GrantRolePermissionRowForm,
  PublishPolicyVersionRowForm,
  RegisterPermissionForm,
  RegisterPolicyFragmentForm,
  RevokeDelegationForm,
  RevokeRoleAssignmentForm,
  SimulatePolicyPanel,
  StartImpersonationForm,
  WriteRelationTupleForm,
} from "@/components/security/access-actions";
import {
  fetchPermissionExplorer,
  fetchPolicyExplorer,
  fetchRegistryExplorer,
} from "@/lib/api/security";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * `/security/access` — permission explorer, policy explorer, and the security registry explorer
 * (T3.1, read-only). T5.12f adds the plan's explicit "policy definition" high-blast-radius write
 * controls — the last of T5.12's 6 parts — organized into 7 sub-sections matching the task brief's
 * own grouping: Roles (define/grant-permission/assign/revoke), Policies (define/publish/archive/
 * simulate — the core "policy definition" controls), Relations (write/delete ReBAC tuples), Access
 * Checks (the unified check + the zero-trust evaluate, both preview panels), Registries (register
 * policy fragment/permission), Delegations & Impersonation (grant/revoke/start-impersonate — the
 * second-highest-risk group in this part, headlined by `start_impersonation`, the single
 * highest-risk individual action in this entire phase), and Tenant Security (configure profile).
 * `RoleSummaryRowDto`/`PolicySummaryRowDto`/`PolicyExplorerRowDto` (T3.1) were checked fresh for
 * this part and do expose `key` per row, so grant-permission/publish/archive attach as per-row
 * controls on the Roles/Policies tables; no assignment/delegation/tuple explorer is wired on this
 * page, so every other write below is a standalone form with a manually-typed key/id, the same
 * conclusion T5.12a-e's own doc comments reach for their own id-less explorers.
 */
export default async function SecurityAccessPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securityAccessPage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securityAccessPage.subtitle}</p>
      </header>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securityAccessPage.sections.roles}</h2>

        <Suspense fallback={<TableCardSkeleton />}>
          <PermissionExplorerSection t={t} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.defineRole.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefineRoleForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.assignRole.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignRoleForm t={t} grantedByDefault={user.name} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t.securityAccessPage.revokeRoleAssignment.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RevokeRoleAssignmentForm t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securityAccessPage.sections.policies}</h2>

        <Suspense fallback={<TableCardSkeleton />}>
          <PolicyExplorerSection t={t} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.definePolicy.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <DefinePolicyForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.simulatePolicy.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <SimulatePolicyPanel t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securityAccessPage.sections.relations}</h2>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.writeRelationTuple.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <WriteRelationTupleForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.deleteRelationTuple.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <DeleteRelationTupleForm t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securityAccessPage.sections.accessChecks}</h2>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.checkAccess.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckAccessPanel t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.evaluateAccess.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <EvaluateAccessPanel t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securityAccessPage.sections.registries}</h2>

        <Suspense fallback={<TableCardSkeleton />}>
          <RegistryExplorerSection t={t} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.registerPolicyFragment.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RegisterPolicyFragmentForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.registerPermission.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RegisterPermissionForm t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t.securityAccessPage.sections.delegations}
        </h2>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.grantDelegation.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <GrantDelegationForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securityAccessPage.revokeDelegation.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RevokeDelegationForm t={t} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t.securityAccessPage.startImpersonation.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <StartImpersonationForm t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t.securityAccessPage.sections.tenantSecurity}
        </h2>

        <Card>
          <CardHeader>
            <CardTitle>{t.securityAccessPage.configureTenantSecurity.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ConfigureTenantSecurityForm t={t} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

async function PermissionExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchPermissionExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAccessPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAccessPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAccessPage.permissionsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div>
          <h3 className="mb-2 text-sm font-medium">{t.securityAccessPage.rolesTitle}</h3>
          {data.roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.securityAccessPage.empty}</p>
          ) : (
            <Table aria-label={t.securityAccessPage.rolesTitle}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.securityAccessPage.roleColumns.key}</TableHead>
                  <TableHead>{t.securityAccessPage.roleColumns.name}</TableHead>
                  <TableHead>{t.securityAccessPage.roleColumns.permissionCount}</TableHead>
                  <TableHead>{t.securityAccessPage.roleColumns.parent}</TableHead>
                  <TableHead>{t.securityAccessPage.roleColumns.scope}</TableHead>
                  <TableHead>{t.securityAccessPage.roleColumns.status}</TableHead>
                  <TableHead>{t.securityAccessPage.roleColumns.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.roles.map((role) => (
                  <TableRow key={role.key}>
                    <TableCell className="font-medium">{role.key}</TableCell>
                    <TableCell>{role.name}</TableCell>
                    <TableCell className="text-muted-foreground">{role.permissionCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {role.parentKey ?? t.securityAccessPage.noParent}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{role.scope}</TableCell>
                    <TableCell>
                      <Badge variant="neutral">{role.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <GrantRolePermissionRowForm roleKey={role.key} t={t} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">{t.securityAccessPage.policiesTitle}</h3>
          {data.policies.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.securityAccessPage.empty}</p>
          ) : (
            <Table aria-label={t.securityAccessPage.policiesTitle}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.securityAccessPage.policyColumns.key}</TableHead>
                  <TableHead>{t.securityAccessPage.policyColumns.mode}</TableHead>
                  <TableHead>{t.securityAccessPage.policyColumns.status}</TableHead>
                  <TableHead>{t.securityAccessPage.policyColumns.activeVersion}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.policies.map((policy) => (
                  <TableRow key={policy.key}>
                    <TableCell className="font-medium">{policy.key}</TableCell>
                    <TableCell className="text-muted-foreground">{policy.mode}</TableCell>
                    <TableCell>
                      <Badge variant="neutral">{policy.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {policy.activeVersion ?? t.securityAccessPage.noActiveVersion}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function PolicyExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchPolicyExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAccessPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAccessPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAccessPage.policyExplorerTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {data.policies.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.securityAccessPage.empty}</p>
        ) : (
          <Table aria-label={t.securityAccessPage.policyExplorerTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityAccessPage.policyColumns.key}</TableHead>
                <TableHead>{t.securityAccessPage.policyColumns.mode}</TableHead>
                <TableHead>{t.securityAccessPage.policyColumns.status}</TableHead>
                <TableHead>{t.securityAccessPage.policyColumns.activeVersion}</TableHead>
                <TableHead>{t.securityAccessPage.versionCount}</TableHead>
                <TableHead>{t.securityAccessPage.policyColumns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.policies.map((policy) => (
                <TableRow key={policy.key}>
                  <TableCell className="font-medium">{policy.key}</TableCell>
                  <TableCell className="text-muted-foreground">{policy.mode}</TableCell>
                  <TableCell>
                    <Badge variant="neutral">{policy.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {policy.activeVersion ?? t.securityAccessPage.noActiveVersion}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{policy.versionCount}</TableCell>
                  <TableCell>
                    {policy.status === "archived" ? (
                      <span className="text-muted-foreground text-xs">
                        {t.securityAccessPage.policyActions.terminal}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <PublishPolicyVersionRowForm policyKey={policy.key} t={t} />
                        <ArchivePolicyRowForm policyKey={policy.key} t={t} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <h3 className="mb-2 text-sm font-medium">{t.securityAccessPage.fragmentsTitle}</h3>
          {data.fragments.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.securityAccessPage.empty}</p>
          ) : (
            <Table aria-label={t.securityAccessPage.fragmentsTitle}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.securityAccessPage.fragmentColumns.key}</TableHead>
                  <TableHead>{t.securityAccessPage.fragmentColumns.version}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.fragments.map((fragment) => (
                  <TableRow key={fragment.key}>
                    <TableCell className="font-medium">{fragment.key}</TableCell>
                    <TableCell className="text-muted-foreground">{fragment.version}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function RegistryExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchRegistryExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAccessPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAccessPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAccessPage.registryExplorerTitle}</CardTitle>
        <span className="text-muted-foreground text-sm">
          {t.securityAccessPage.totalEntries}: <span className="text-foreground font-medium">{data.totalEntries}</span>
        </span>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.registries.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securityAccessPage.empty}</p>
        ) : (
          <Table aria-label={t.securityAccessPage.registryExplorerTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityAccessPage.registryColumns.name}</TableHead>
                <TableHead>{t.securityAccessPage.registryColumns.entryCount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.registries.map((registry) => (
                <TableRow key={registry.name}>
                  <TableCell className="font-medium">{registry.name}</TableCell>
                  <TableCell className="text-muted-foreground">{registry.entryCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}

function TableCardSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
