-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."organizations" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."memberships" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "identity"."users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tenant_id_slug_key" ON "identity"."organizations"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_organization_id_key" ON "identity"."memberships"("tenant_id", "user_id", "organization_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_organization_id_idx" ON "identity"."memberships"("tenant_id", "organization_id");

-- No foreign keys: users/organizations/memberships carry only bare tenant/user/organization
-- references (D-002) -- consistent with this schema's Address/ConsentRecord FKs being
-- intra-aggregate only, and with finance.prisma's own no-cross-aggregate-FK convention.
