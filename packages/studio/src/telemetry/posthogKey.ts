/**
 * Write-only PostHog project key. Clapova fork: empty, so `browserTelemetryAllowed()` is
 * always false (the same `telemetry_disabled_build` posture as the CLI) and nothing is sent.
 * Kept in its own module so policy, client and studioTelemetry share one value and tests can mock it.
 */
export const POSTHOG_API_KEY = "";
