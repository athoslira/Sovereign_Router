# Hermes model intelligence job

`refresh_model_catalog.py` is the unattended half of Sovereign Router's model-catalog workflow. It downloads OpenRouter's current model IDs, context windows, input/output modalities, tool support, and reference token pricing. It does not print or store the OpenRouter key, and it never changes the plugin's permitted routing list.

Configure `OPENROUTER_API_KEY` as a secret in the environment of a Hermes scheduled task, then run:

```text
python refresh_model_catalog.py --output /secure/path/model-catalog.json
```

Schedule that task every 15 days using the Hermes jobs/cron facility. Keep the generated file behind an authenticated HTTPS endpoint if it will be shared with more than the local machine. The file is deliberately a review artifact: the user must still add a model either to **Manual-only models** (manual selection) or **Permitted executor models** (eligible for Gatekeeper routing) in the plugin settings.

The plugin independently refreshes its own cached catalog whenever it is open and the cache is older than the configured interval. This gives a safe fallback before a central scheduler is configured.
