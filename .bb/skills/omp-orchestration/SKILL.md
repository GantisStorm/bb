---
name: omp-orchestration
description: Configure or run OMP-backed work in this BB workspace. Use when selecting an OMP model role, deciding whether to use a BB workflow, or keeping OMP and BB responsibilities separate.
---

1. Read `.omp/config.yml` before choosing an OMP model role.
2. Treat that file as the sole role-to-model policy.
3. Use `acp-omp` unless the user requests another provider.
4. Let OMP select roles for internal delegation.
5. Use a BB workflow only for durable orchestration with independent workers, phases, or structured results.
6. Do not pin a BB worker model unless its work intentionally needs a non-default OMP model; state that exception explicitly.
