# Legacy ShennongDB Agent Runtime migration source

> Shennong OS owns the V1 biomedical Pi harness and Agent Runtime. This source
> is retained only for rollback and migration comparison and is not copied into
> the headless ShennongDB production image.

Its private package metadata follows the repository's `1.0.0` release line; it
is not a separately published or deployed V1 component.

Internal Pi Agent sidecar for ShennongDB. It uses the official
`@earendil-works/pi-coding-agent` SDK with in-memory sessions and credential
storage. Provider API keys are accepted only for one authenticated run, are
never written to disk, and are removed from the in-memory credential store when
the run ends.

The runtime binds only to `127.0.0.1`. `POST /v1/runs` requires the shared
`SHENNONG_AGENT_RUNTIME_SECRET`. Pi built-in tools are disabled; the only tools
registered are governed ShennongDB callbacks. The callback URL is supplied at
process startup through `SHENNONG_AGENT_TOOL_CALLBACK_URL`, never by a run
request, which prevents an Agent request from choosing an arbitrary network
target. Rust should mint a short-lived, run-bound callback token and execute all
database operations after its normal user, project, Resource, and write-policy
checks.

Until the Rust chat orchestrator enables `SHENNONG_AGENT_RUNTIME_ENABLED`, the
existing Rust provider loop remains the fallback. This makes deployment
rollback possible without changing stored chats, skills, or memories.
