from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

dataset_versions = Table(
    "dataset_versions",
    metadata,
    # Keep the logical dataset/version pair explicit; storage engines remain independent.
    Column("dataset_id", String(200), nullable=False),
    Column("version", String(100), nullable=False),
    Column("type", String(64), nullable=False),
    Column("backend", String(64), nullable=False),
    Column("citation", Text, nullable=True),
    Column("storage_uri", Text, nullable=True),
    Column("status", String(32), nullable=False, default="active"),
    Column("is_default", Boolean, nullable=False, default=False),
    Column("schema_version", String(32), nullable=False, default="1.0"),
    Column("metadata_json", JSONB, nullable=False, default=dict),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    ),
    UniqueConstraint("dataset_id", "version", name="uq_dataset_versions_dataset_version"),
)

Index("ix_dataset_versions_dataset_id", dataset_versions.c.dataset_id)
Index("ix_dataset_versions_type_status", dataset_versions.c.type, dataset_versions.c.status)

users = Table(
    "users",
    metadata,
    Column("user_id", String(64), primary_key=True),
    Column("email", String(320), nullable=False, unique=True),
    Column("display_name", String(200), nullable=False),
    Column("status", String(32), nullable=False, default="active"),
    Column("is_superuser", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    ),
)

organizations = Table(
    "organizations",
    metadata,
    Column("org_id", String(64), primary_key=True),
    Column("slug", String(100), nullable=False, unique=True),
    Column("name", String(200), nullable=False),
    Column("created_by", String(64), ForeignKey("users.user_id"), nullable=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    ),
)

projects = Table(
    "projects",
    metadata,
    Column("project_id", String(64), primary_key=True),
    Column("org_id", String(64), ForeignKey("organizations.org_id"), nullable=False),
    Column("slug", String(100), nullable=False),
    Column("name", String(200), nullable=False),
    Column("description", Text, nullable=True),
    Column("visibility", String(32), nullable=False, default="private"),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    ),
    UniqueConstraint("org_id", "slug", name="uq_projects_org_slug"),
)

memberships = Table(
    "memberships",
    metadata,
    Column("membership_id", String(64), primary_key=True),
    Column("org_id", String(64), ForeignKey("organizations.org_id"), nullable=False),
    Column("user_id", String(64), ForeignKey("users.user_id"), nullable=False),
    Column("role", String(32), nullable=False),
    Column("status", String(32), nullable=False, default="active"),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    ),
    UniqueConstraint("org_id", "user_id", name="uq_memberships_org_user"),
)

api_tokens = Table(
    "api_tokens",
    metadata,
    Column("token_id", String(64), primary_key=True),
    Column("user_id", String(64), ForeignKey("users.user_id"), nullable=False),
    Column("name", String(200), nullable=False),
    Column("token_hash", String(128), nullable=False, unique=True),
    Column("scopes", JSONB, nullable=False, default=list),
    Column("expires_at", DateTime(timezone=True), nullable=True),
    Column("revoked_at", DateTime(timezone=True), nullable=True),
    Column("last_used_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

audit_events = Table(
    "audit_events",
    metadata,
    Column("event_id", String(64), primary_key=True),
    Column("actor_user_id", String(64), ForeignKey("users.user_id"), nullable=True),
    Column("action", String(120), nullable=False),
    Column("resource_type", String(80), nullable=False),
    Column("resource_id", String(200), nullable=False),
    Column("metadata_json", JSONB, nullable=False, default=dict),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

Index("ix_users_email", users.c.email)
Index("ix_organizations_slug", organizations.c.slug)
Index("ix_projects_org_id", projects.c.org_id)
Index("ix_memberships_user_id", memberships.c.user_id)
Index("ix_api_tokens_user_id", api_tokens.c.user_id)
Index("ix_audit_events_resource", audit_events.c.resource_type, audit_events.c.resource_id)
Index("ix_audit_events_created_at", audit_events.c.created_at)
