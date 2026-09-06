# OMP execution policy

- Use the acp-omp provider for workspace work unless the user explicitly selects another provider.
- `.omp/config.yml` is the only model-role policy. Do not duplicate its role map in BB instructions, skills, or workflows.
- Let OMP choose its internal delegation roles.
- A BB workflow may pin a provider, model, and reasoning level only when that specific worker deliberately needs to differ from OMP's default role.
- Keep BB project behavior in `.bb/AGENTS.md`, `.bb/skills/`, and `.bb/workflows/`.

## OpenAI model and prompt upgrades

- Use the official workspace skill at `.bb/skills/openai-docs/SKILL.md` for OpenAI documentation, model migration, and prompt upgrades. Fetch current official guidance before applying model-specific changes.
- Keep `.omp/config.yml` as the only model-role policy. Preserve explicit model choices and effective reasoning effort; do not replace other providers, cheaper fallbacks, historical fixtures, or model registries as part of a prompt-only update.
- For GPT-6 Astra requests, use the Responses API for tool calling; remove `temperature`, `top_p`, and `top_logprobs`, plus Chat Completions `logprobs` or Responses `include: ["message.output_text.logprobs"]`. Replace unsupported `none` or `minimal` reasoning with `low`.
- For migrations from GPT-5.5 or earlier, review `prompt_cache_retention` replacement with `prompt_cache_options.ttl: "30m"`. Check regional fast-mode restrictions and configuration-update compatibility against the current guide before changing those features.
- Scope these restrictions to Astra requests. Broader API, tool-handler, authentication, SDK, or provider architecture changes require separate scope review; do not silently apply them to BB's other providers.
